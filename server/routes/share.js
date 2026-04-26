const express = require('express');
const router = express.Router();
const shareService = require('../services/shareService');
const auth = require('../middleware/auth');
const fs = require('fs-extra');
const path = require('path');
const auditService = require('../services/auditService');
const serverConfig = require('../config/serverConfig');
const { assertWithinAllowedRealRoots } = require('../utils/pathPolicy');

function createShareError(status, code, message, details = null) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.details = details;
  return err;
}

function sendShareError(res, err, fallbackCode = 'SHARE_OPERATION_FAILED', fallbackMessage = 'Share operation failed.') {
  return res.status(err?.status || 500).json({
    error: true,
    code: err?.code || fallbackCode,
    message: err?.message || fallbackMessage,
    details: err?.details || null
  });
}

function getRequestAudit(req, share = null) {
  return {
    shareId: req.params?.id || share?.id || '',
    path: share?.path || null,
    ip: req.ip,
    userAgent: String(req.get('user-agent') || '').slice(0, 256)
  };
}

async function logShareDownload(req, share, result, extra = {}) {
  await auditService.log(
    'SHARE',
    'Download Share',
    {
      ...getRequestAudit(req, share),
      result,
      ...extra
    },
    result === 'success' ? 'INFO' : 'WARNING'
  );
}

function encodeContentDisposition(filename) {
  const safeName = String(filename || 'download').replace(/[\r\n"]/g, '_');
  return `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

function normalizeSharePolicy(policy = {}) {
  const password = policy.password && typeof policy.password === 'object' ? policy.password : null;
  const downloadLimit = policy.downloadLimit && typeof policy.downloadLimit === 'object' ? policy.downloadLimit : null;
  const rateLimit = policy.rateLimit && typeof policy.rateLimit === 'object' ? policy.rateLimit : null;
  const maxDownloads = Number(policy.maxDownloads ?? downloadLimit?.max);
  const usedDownloads = Number(downloadLimit?.used || 0);

  return {
    passwordRequired: Boolean(policy.passwordRequired || password?.required),
    maxDownloads: Number.isFinite(maxDownloads) && maxDownloads > 0 ? maxDownloads : null,
    rateLimit: rateLimit
      ? {
          windowMs: Number(rateLimit.windowMs) || null,
          max: Number(rateLimit.max) || null
        }
      : null,
    ...(downloadLimit
      ? {
          downloadLimit: {
            max: Number(downloadLimit.max) || 0,
            remaining: Math.max((Number(downloadLimit.max) || 0) - usedDownloads, 0)
          }
        }
      : {})
  };
}

function parseRangeHeader(rangeHeader, size) {
  const header = String(rangeHeader || '').trim();
  if (!header) return null;

  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) {
    throw createShareError(416, 'SHARE_RANGE_NOT_SATISFIABLE', 'Requested byte range is invalid.', {
      size
    });
  }

  let start = match[1] === '' ? null : Number(match[1]);
  let end = match[2] === '' ? null : Number(match[2]);

  if (start === null && end === null) {
    throw createShareError(416, 'SHARE_RANGE_NOT_SATISFIABLE', 'Requested byte range is invalid.', {
      size
    });
  }

  if (start === null) {
    const suffixLength = end;
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      throw createShareError(416, 'SHARE_RANGE_NOT_SATISFIABLE', 'Requested byte range is invalid.', {
        size
      });
    }
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    if (!Number.isSafeInteger(start) || start < 0) {
      throw createShareError(416, 'SHARE_RANGE_NOT_SATISFIABLE', 'Requested byte range is invalid.', {
        size
      });
    }
    if (end === null) {
      end = size - 1;
    }
  }

  if (!Number.isSafeInteger(end) || end < start || start >= size) {
    throw createShareError(416, 'SHARE_RANGE_NOT_SATISFIABLE', 'Requested byte range is not satisfiable.', {
      size
    });
  }

  return {
    start,
    end: Math.min(end, size - 1)
  };
}

async function resolveDownloadShare(req) {
  const share = shareService.getShareRecord(req.params.id);
  if (!share) {
    throw createShareError(404, 'SHARE_NOT_FOUND', 'Share link was not found.');
  }
  if (shareService.isExpired(share)) {
    await shareService.removeShare(share.id);
    throw createShareError(410, 'SHARE_EXPIRED', 'Share link has expired.');
  }
  return share;
}

// ==========================
// PUBLIC ENDPOINTS (No Auth)
// ==========================

router.get('/info/:id', (req, res) => {
  const share = shareService.getShare(req.params.id);
  if (!share) {
    return sendShareError(
      res,
      createShareError(404, 'SHARE_NOT_FOUND', 'Share link was not found or has expired.')
    );
  }
  
  res.json({
    id: share.id,
    name: share.name,
    createdAt: share.createdAt,
    expiryDate: share.expiryDate,
    policy: normalizeSharePolicy(share.policy)
  });
});

router.get('/download/:id', async (req, res) => {
  let share = null;
  try {
    share = await resolveDownloadShare(req);
    const { allowedRoots } = await serverConfig.getPaths();
    await assertWithinAllowedRealRoots(share.path, allowedRoots);

    let stats;
    try {
      stats = await fs.stat(share.path);
    } catch (err) {
      if (err?.code === 'ENOENT') {
        throw createShareError(404, 'SHARE_TARGET_NOT_FOUND', 'Shared file no longer exists.');
      }
      throw err;
    }

    if (stats.isDirectory()) {
      throw createShareError(400, 'SHARE_DIRECTORY_UNSUPPORTED', 'Directory share download is not supported yet.');
    }

    const range = parseRangeHeader(req.headers.range, stats.size);
    const start = range ? range.start : 0;
    const end = range ? range.end : stats.size - 1;
    const contentLength = stats.size === 0 ? 0 : end - start + 1;

    res.status(range ? 206 : 200);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', encodeContentDisposition(share.name || path.basename(share.path)));
    res.setHeader('Content-Length', contentLength);
    if (range) {
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stats.size}`);
    }

    await logShareDownload(req, share, 'success', {
      range: req.headers.range || null,
      status: range ? 206 : 200
    });

    if (stats.size === 0) {
      return res.end();
    }

    const stream = fs.createReadStream(share.path, { start, end });
    stream.on('error', async (err) => {
      await logShareDownload(req, share, 'stream_error', { code: err.code || 'STREAM_ERROR' }).catch(() => {});
      if (!res.headersSent) {
        sendShareError(res, err, 'SHARE_STREAM_FAILED', 'Failed to stream shared file.');
      } else {
        res.destroy(err);
      }
    });
    return stream.pipe(res);
  } catch (err) {
    await logShareDownload(req, share, 'failed', {
      code: err.code || 'SHARE_DOWNLOAD_FAILED'
    }).catch(() => {});
    return sendShareError(res, err, 'SHARE_DOWNLOAD_FAILED', 'Failed to download shared file.');
  }
});

// ==========================
// PROTECTED ENDPOINTS (Auth)
// ==========================

router.use(auth);

const pathGuard = require('../middleware/pathGuard');

router.post('/create', pathGuard, async (req, res) => {
  const targetPath = req.safePath; 
  if (!targetPath) {
    return sendShareError(res, createShareError(400, 'SHARE_PATH_REQUIRED', 'Path is required.'));
  }

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const unsupportedPolicyFields = ['password', 'passwordHash', 'maxDownloads', 'rateLimit', 'rateLimitPerMinute']
      .filter((field) => Object.prototype.hasOwnProperty.call(body, field));
    if (unsupportedPolicyFields.length > 0) {
      throw createShareError(400, 'SHARE_POLICY_UNSUPPORTED', 'Password, download count, and rate limit policies are not enabled yet.', {
        fields: unsupportedPolicyFields
      });
    }

    const stats = await fs.stat(targetPath);
    if (stats.isDirectory()) {
      throw createShareError(400, 'SHARE_DIRECTORY_UNSUPPORTED', 'Directory share download is not supported yet.');
    }

    const { expiryHours } = body;
    const hours = parseInt(expiryHours) || 0;
    
    const linkId = await shareService.createShare(targetPath, hours);
    res.json({
      success: true,
      linkId,
      policy: {
        passwordRequired: false,
        maxDownloads: null,
        rateLimit: null
      }
    });
  } catch (e) {
    sendShareError(res, e, 'SHARE_CREATE_FAILED', 'Failed to create share link.');
  }
});

module.exports = router;
