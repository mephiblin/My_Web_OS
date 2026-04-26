const express = require('express');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const router = express.Router();
const auth = require('../middleware/auth');
const cloudService = require('../services/cloudService');
const cloudTransferJobService = require('../services/cloudTransferJobService');
const fileTicketService = require('../services/fileTicketService');

const CLOUD_UPLOAD_MAX_BYTES = 64 * 1024 * 1024;
const CLOUD_UPLOAD_TMP_DIR = path.join(__dirname, '../storage/tmp/cloud-uploads');
fs.ensureDirSync(CLOUD_UPLOAD_TMP_DIR);
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, CLOUD_UPLOAD_TMP_DIR),
    filename: (_req, file, cb) => {
      const safeName = String(file?.originalname || 'upload.bin').replace(/[^\w.\-]+/g, '_');
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`);
    }
  }),
  limits: {
    fileSize: CLOUD_UPLOAD_MAX_BYTES
  }
});

function sendError(res, fallbackCode, fallbackMessage, err, fallbackStatus = 500) {
  const status = Number.isInteger(err?.status) ? err.status : fallbackStatus;
  const code = err?.code || fallbackCode;
  const message = err?.message || fallbackMessage;
  const payload = {
    success: false,
    code,
    message,
    // Backward-compatible field for legacy clients that read `error` as string.
    error: message
  };
  if (err?.details !== undefined) {
    payload.details = err.details;
  }
  return res.status(status).json(payload);
}

function parseRemoteName(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function parseRemotePath(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function getUserId(req) {
  return String(req.user?.username || req.user?.id || req.user?.sub || 'unknown');
}

function createCloudHttpError(status, code, message, details = null) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.details = details;
  return err;
}

function parseCloudLocation(input = {}) {
  const cloudPath = parseRemotePath(input.path || input.cloudPath || '');
  if (cloudPath.startsWith('cloud://')) {
    const normalized = cloudPath.slice('cloud://'.length);
    const parts = normalized.split('/');
    const remote = parseRemoteName(parts.shift());
    const remotePath = parts.join('/');
    if (!remote || !remotePath) {
      throw createCloudHttpError(400, 'CLOUD_RAW_INVALID_PATH', 'Cloud path must include remote and file path.');
    }
    return {
      remote,
      remotePath,
      cloudPath: `cloud://${remote}/${remotePath}`
    };
  }

  const remote = parseRemoteName(input.remote || input.remoteName || '');
  const remotePath = parseRemotePath(input.remotePath || input.path || '');
  if (!remote || !remotePath) {
    throw createCloudHttpError(400, 'CLOUD_RAW_INVALID_PATH', 'Remote and remotePath are required.');
  }
  return {
    remote,
    remotePath,
    cloudPath: `cloud://${remote}/${remotePath}`
  };
}

function parseByteRange(rangeHeader, size) {
  const header = String(rangeHeader || '').trim();
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || !Number.isFinite(size) || size < 0) {
    throw createCloudHttpError(416, 'CLOUD_RAW_RANGE_INVALID', 'Requested range is invalid.');
  }

  let start;
  let end;
  if (match[1] === '' && match[2] === '') {
    throw createCloudHttpError(416, 'CLOUD_RAW_RANGE_INVALID', 'Requested range is invalid.');
  }
  if (match[1] === '') {
    const suffixLength = Number.parseInt(match[2], 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      throw createCloudHttpError(416, 'CLOUD_RAW_RANGE_INVALID', 'Requested range is invalid.');
    }
    start = Math.max(0, size - suffixLength);
    end = size > 0 ? size - 1 : 0;
  } else {
    start = Number.parseInt(match[1], 10);
    end = match[2] === '' ? size - 1 : Number.parseInt(match[2], 10);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
    throw createCloudHttpError(416, 'CLOUD_RAW_RANGE_INVALID', 'Requested range is outside the remote file.');
  }
  return {
    start,
    end: Math.min(end, size - 1),
    count: Math.min(end, size - 1) - start + 1
  };
}

async function sendCloudRawFile(req, res, location, options = {}) {
  const entry = await cloudService.getEntryMetadata(location.remote, location.remotePath);
  if (entry.isDirectory) {
    throw createCloudHttpError(400, 'CLOUD_RAW_DIRECTORY_UNSUPPORTED', 'Cannot stream a remote directory.');
  }

  if (options.ticketRecord) {
    fileTicketService.assertTicketTargetUnchanged(options.ticketRecord, {
      size: entry.size,
      mtimeMs: entry.mtimeMs
    });
  }

  const range = parseByteRange(req.headers.range, entry.size);
  const child = cloudService.createReadStream(location.remote, location.remotePath, range
    ? { offset: range.start, count: range.count }
    : {});
  let stderr = '';
  let settled = false;

  const finishWithError = (err) => {
    if (settled) return;
    settled = true;
    if (!res.headersSent) {
      sendError(res, 'CLOUD_RAW_STREAM_FAILED', 'Failed to stream remote file', err);
      return;
    }
    res.destroy(err);
  };

  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  child.on('error', (err) => {
    const code = err?.code === 'ENOENT' ? 'CLOUD_RAW_RCLONE_NOT_FOUND' : 'CLOUD_RAW_STREAM_FAILED';
    finishWithError(createCloudHttpError(502, code, err?.code === 'ENOENT'
      ? 'rclone binary not found. Please install rclone.'
      : 'Failed to start remote file stream.'));
  });
  child.on('close', (code) => {
    if (settled) return;
    settled = true;
    if (code !== 0 && !res.writableEnded) {
      const err = createCloudHttpError(502, 'CLOUD_RAW_RCLONE_FAILED', 'rclone failed while streaming remote file.', {
        stderrSummary: String(stderr || '').replace(/\s+/g, ' ').trim().slice(0, 500) || null,
        exitCode: code
      });
      if (!res.headersSent) {
        sendError(res, 'CLOUD_RAW_STREAM_FAILED', 'Failed to stream remote file', err);
      } else {
        res.destroy(err);
      }
      return;
    }
    if (options.ticketRecord?.profile === fileTicketService.PROFILE_MEDIA) {
      fileTicketService.touchTicket(options.ticketRecord.ticket, {
        metadata: {
          lastRequestRange: req.headers.range || ''
        }
      });
    }
  });
  res.on('close', () => {
    if (!settled && !child.killed) child.kill('SIGTERM');
  });

  res.setHeader('Accept-Ranges', 'bytes');
  res.type(entry.mimeType || path.basename(location.remotePath) || 'application/octet-stream');
  if (range) {
    res.status(206);
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${entry.size}`);
    res.setHeader('Content-Length', String(range.count));
  } else if (Number.isFinite(entry.size)) {
    res.setHeader('Content-Length', String(entry.size));
  }
  child.stdout.pipe(res);
}

const CLOUD_TRANSFER_STATUS_ALIASES = new Map([
  ['error', 'failed'],
  ['cancelled', 'canceled'],
  ['success', 'completed'],
  ['done', 'completed'],
  ['active', 'running'],
  ['working', 'running'],
  ['quota', 'paused_by_quota'],
  ['retryable', 'retryable_failed']
]);

function parsePruneStatuses(req) {
  const raw = Array.isArray(req.body?.statuses)
    ? req.body.statuses
    : String(req.query?.statuses || '')
      .split(',');
  return raw
    .map((item) => String(item || '').trim().toLowerCase())
    .map((status) => CLOUD_TRANSFER_STATUS_ALIASES.get(status) || status)
    .filter(Boolean);
}

function uploadSingle(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) {
      next();
      return;
    }

    if (err?.code === 'LIMIT_FILE_SIZE') {
      sendError(
        res,
        'CLOUD_UPLOAD_TOO_LARGE',
        `Upload exceeds ${CLOUD_UPLOAD_MAX_BYTES} bytes`,
        null,
        413
      );
      return;
    }

    sendError(res, 'CLOUD_UPLOAD_PARSE_FAILED', 'Failed to parse upload payload', err);
  });
}

/**
 * GET /api/cloud/raw?ticket=...
 * Redeem a short-lived cloud raw ticket without Authorization.
 */
router.get('/raw', async (req, res, next) => {
  const ticket = String(req.query?.ticket || '').trim();
  if (!ticket) return next();

  try {
    const record = fileTicketService.getTicket(ticket, { scope: 'cloud.raw' });
    const metadata = record.metadata && typeof record.metadata === 'object' ? record.metadata : {};
    const location = parseCloudLocation({
      remote: metadata.remote,
      remotePath: metadata.remotePath,
      path: record.path
    });
    return await sendCloudRawFile(req, res, location, { ticketRecord: record });
  } catch (err) {
    return sendError(res, 'CLOUD_RAW_TICKET_FAILED', 'Failed to redeem cloud raw ticket', err);
  }
});

router.use(auth);
// Get available cloud providers
router.get('/providers', async (req, res) => {
  const providers = await cloudService.listProviders();
  res.json(providers);
});

// Get currently configured remotes
router.get('/remotes', async (req, res) => {
  try {
    const remotes = await cloudService.listRemotes();
    const statuses = await cloudService.getMountStatus();
    const statusByName = new Map((Array.isArray(statuses) ? statuses : []).map((item) => [item.name, item]));
    res.json(remotes.map((remote) => {
      const status = statusByName.get(remote.name) || null;
      return {
        ...remote,
        mountStatus: status?.status || 'unmounted',
        mountUrl: status?.mountUrl || null,
        mounted: status?.status === 'mounted',
        mountDetails: status?.details || null
      };
    }));
  } catch (err) {
    sendError(res, 'CLOUD_REMOTES_FETCH_FAILED', 'Failed to list remotes', err);
  }
});

// Setup a new cloud remote
router.post('/setup', async (req, res) => {
  const { name, provider } = req.body;
  if (!name || !provider) {
    return sendError(res, 'CLOUD_SETUP_INVALID_REQUEST', 'Name and provider are required', null, 400);
  }
  try {
    const result = await cloudService.setupRemote(name, provider);
    return res.json(result);
  } catch (err) {
    return sendError(res, 'CLOUD_SETUP_FAILED', 'Failed to setup cloud remote', err);
  }
});

// List entries in a remote
router.get('/list', async (req, res) => {
  const remote = parseRemoteName(req.query.remote);
  const remotePath = parseRemotePath(req.query.path);
  try {
    const items = await cloudService.listEntries(remote, remotePath || '');
    res.json(items);
  } catch (err) {
    sendError(res, 'CLOUD_LIST_FAILED', 'Failed to list remote entries', err);
  }
});

// Read file content from a remote
router.get('/read', async (req, res) => {
  const remote = parseRemoteName(req.query.remote);
  const remotePath = parseRemotePath(req.query.path);
  try {
    const content = await cloudService.getFileContent(remote, remotePath);
    res.json({ content });
  } catch (err) {
    sendError(res, 'CLOUD_READ_FAILED', 'Failed to read remote file', err);
  }
});

router.post('/raw-ticket', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const location = parseCloudLocation(body);
    const appId = String(body.appId || '').trim();
    const profile = String(body.profile || body.purpose || fileTicketService.PROFILE_PREVIEW).trim().toLowerCase();
    const entry = await cloudService.getEntryMetadata(location.remote, location.remotePath);
    if (entry.isDirectory) {
      throw createCloudHttpError(400, 'CLOUD_RAW_DIRECTORY_UNSUPPORTED', 'Cannot issue a raw ticket for a remote directory.');
    }

    const ticket = fileTicketService.createTicket({
      scope: 'cloud.raw',
      profile,
      user: req.user?.username,
      appId,
      path: location.cloudPath,
      stats: {
        size: entry.size,
        mtimeMs: entry.mtimeMs
      },
      ttlMs: body.ttlMs,
      absoluteTtlMs: body.absoluteTtlMs,
      idleTimeoutMs: body.idleTimeoutMs,
      metadata: {
        remote: location.remote,
        remotePath: location.remotePath,
        mimeType: entry.mimeType || null
      }
    });

    return res.status(201).json({
      success: true,
      ticket: ticket.ticket,
      url: `/api/cloud/raw?ticket=${encodeURIComponent(ticket.ticket)}`,
      scope: ticket.scope,
      profile: ticket.profile,
      path: location.cloudPath,
      remote: location.remote,
      remotePath: location.remotePath,
      appId,
      expiresAt: new Date(ticket.expiresAt).toISOString(),
      ttlMs: ticket.expiresAt - ticket.createdAt,
      ...(ticket.profile === fileTicketService.PROFILE_MEDIA
        ? {
            idleTimeoutMs: ticket.idleTimeoutMs,
            absoluteExpiresAt: new Date(ticket.absoluteExpiresAt).toISOString(),
            lastAccess: new Date(ticket.lastAccess).toISOString(),
            size: ticket.size,
            mtime: ticket.mtime
          }
        : {})
    });
  } catch (err) {
    return sendError(res, 'CLOUD_RAW_TICKET_CREATE_FAILED', 'Failed to create cloud raw ticket', err);
  }
});

router.get('/raw', async (req, res) => {
  try {
    const location = parseCloudLocation({
      remote: req.query.remote,
      remotePath: req.query.remotePath || req.query.path,
      path: req.query.path
    });
    return await sendCloudRawFile(req, res, location);
  } catch (err) {
    return sendError(res, 'CLOUD_RAW_FETCH_FAILED', 'Failed to stream remote file', err);
  }
});

// Mount a configured remote and return mount URL + status
router.post('/mount', async (req, res) => {
  const name = parseRemoteName(req.body?.name);
  if (!name) {
    return sendError(
      res,
      'CLOUD_MOUNT_INVALID_NAME',
      'Remote name is required',
      null,
      400
    );
  }
  try {
    const mounted = await cloudService.mountRemote(name);
    const status = await cloudService.getMountStatus(name);
    return res.json({
      success: true,
      mountUrl: mounted.mountUrl,
      url: mounted.url,
      status: status.status,
      details: status.details
    });
  } catch (err) {
    return sendError(res, 'CLOUD_MOUNT_FAILED', 'Failed to mount remote', err);
  }
});

// Get mount status for all remotes or one remote
router.get('/mount-status', async (req, res) => {
  const name = parseRemoteName(req.query.name);
  try {
    if (name) {
      const status = await cloudService.getMountStatus(name);
      return res.json({ success: true, status });
    }
    const statuses = await cloudService.getMountStatus();
    return res.json({ success: true, statuses });
  } catch (err) {
    return sendError(res, 'CLOUD_MOUNT_STATUS_FAILED', 'Failed to fetch mount status', err);
  }
});

// List cloud upload jobs
router.get('/upload-jobs', async (_req, res) => {
  try {
    return res.json({
      success: true,
      jobs: cloudService.listUploadJobs()
    });
  } catch (err) {
    return sendError(res, 'CLOUD_UPLOAD_JOBS_LIST_FAILED', 'Failed to list cloud upload jobs', err);
  }
});

// Get one cloud upload job
router.get('/upload-jobs/:id', async (req, res) => {
  try {
    const job = cloudService.getUploadJob(req.params.id);
    if (!job) {
      return sendError(res, 'CLOUD_UPLOAD_JOB_NOT_FOUND', 'Cloud upload job was not found', null, 404);
    }
    return res.json({
      success: true,
      job
    });
  } catch (err) {
    return sendError(res, 'CLOUD_UPLOAD_JOB_FETCH_FAILED', 'Failed to fetch cloud upload job', err);
  }
});

// Cancel one cloud upload job
router.post('/upload-jobs/:id/cancel', async (req, res) => {
  try {
    const job = cloudService.cancelUploadJob(req.params.id);
    return res.json({
      success: true,
      accepted: true,
      job
    });
  } catch (err) {
    return sendError(res, 'CLOUD_UPLOAD_CANCEL_FAILED', 'Failed to cancel cloud upload job', err);
  }
});

// Write text file content to a remote path
router.post('/write', async (req, res) => {
  const remote = parseRemoteName(req.body?.remote);
  const path = parseRemotePath(req.body?.path);
  const { content } = req.body || {};

  if (!remote) {
    return sendError(res, 'CLOUD_WRITE_INVALID_REMOTE', 'Remote is required', null, 400);
  }
  if (!path) {
    return sendError(res, 'CLOUD_WRITE_INVALID_PATH', 'Path is required', null, 400);
  }
  if (typeof content !== 'string') {
    return sendError(res, 'CLOUD_WRITE_INVALID_CONTENT', 'Content must be a text string', null, 400);
  }

  try {
    const result = await cloudService.writeRemoteFile(remote, path, content);
    return res.json(result);
  } catch (err) {
    return sendError(res, 'CLOUD_WRITE_FAILED', 'Failed to write remote file', err);
  }
});

// Upload a binary file to a remote path
router.post('/upload', uploadSingle, async (req, res) => {
  const remote = parseRemoteName(req.body?.remote);
  const remotePath = parseRemotePath(req.body?.path || '');
  const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName.trim() : '';
  const file = req.file;
  const asyncUpload = parseBoolean(req.body?.async || req.query?.async);
  let cleanupTempFile = true;

  if (!remote) {
    return sendError(res, 'CLOUD_UPLOAD_INVALID_REMOTE', 'Remote is required', null, 400);
  }
  if (!file || typeof file.path !== 'string' || !file.path.trim()) {
    return sendError(res, 'CLOUD_UPLOAD_INVALID_FILE', 'A file upload is required', null, 400);
  }

  try {
    if (asyncUpload) {
      const job = await cloudService.startUploadRemoteFileFromPath(
        remote,
        remotePath,
        fileName || file.originalname || 'upload.bin',
        file.path,
        {
          cleanup: async () => fs.remove(file.path)
        }
      );
      cleanupTempFile = false;
      job.completion.catch(() => {});
      return res.status(202).json({
        success: true,
        accepted: true,
        jobId: job.id,
        status: 'running',
        job: cloudService.getUploadJob(job.id)
      });
    }

    const result = await cloudService.uploadRemoteFileFromPath(
      remote,
      remotePath,
      fileName || file.originalname || 'upload.bin',
      file.path
    );
    return res.json(result);
  } catch (err) {
    return sendError(res, 'CLOUD_UPLOAD_FAILED', 'Failed to upload remote file', err);
  } finally {
    if (cleanupTempFile) {
      await fs.remove(file?.path).catch(() => {});
    }
  }
});

// Preflight an A-owned server-to-cloud transfer. This does not upload browser files.
router.post('/transfer/preflight', async (req, res) => {
  try {
    const preflight = await cloudTransferJobService.preflight(req.body || {}, {
      userId: getUserId(req)
    });
    return res.json({
      success: true,
      ...preflight
    });
  } catch (err) {
    return sendError(res, 'CLOUD_TRANSFER_PREFLIGHT_FAILED', 'Failed to preflight cloud transfer', err);
  }
});

// Approve a risky A-owned cloud transfer, currently overwrite/destination conflict.
router.post('/transfer/approve', async (req, res) => {
  try {
    const result = cloudTransferJobService.approve(req.body || {}, {
      userId: getUserId(req)
    });
    return res.json(result);
  } catch (err) {
    return sendError(res, 'CLOUD_TRANSFER_APPROVAL_INVALID', 'Failed to approve cloud transfer', err, 409);
  }
});

// Enqueue an A-owned server-to-cloud transfer.
router.post('/transfer', async (req, res) => {
  try {
    const job = await cloudTransferJobService.enqueue(req.body || {}, {
      userId: getUserId(req)
    });
    return res.status(202).json({
      success: true,
      accepted: true,
      jobId: job.id,
      job
    });
  } catch (err) {
    return sendError(res, 'CLOUD_TRANSFER_CREATE_FAILED', 'Failed to create cloud transfer job', err);
  }
});

router.get('/transfer-jobs', (_req, res) => {
  try {
    return res.json({
      success: true,
      jobs: cloudTransferJobService.listJobs(),
      summary: cloudTransferJobService.getSummary()
    });
  } catch (err) {
    return sendError(res, 'CLOUD_TRANSFER_JOBS_LIST_FAILED', 'Failed to list cloud transfer jobs', err);
  }
});

router.get('/transfer-jobs/:id', (req, res) => {
  try {
    const job = cloudTransferJobService.getJob(req.params.id);
    if (!job) {
      return sendError(res, 'CLOUD_TRANSFER_JOB_NOT_FOUND', 'Cloud transfer job was not found', null, 404);
    }
    return res.json({
      success: true,
      job
    });
  } catch (err) {
    return sendError(res, 'CLOUD_TRANSFER_JOB_FETCH_FAILED', 'Failed to fetch cloud transfer job', err);
  }
});

router.post('/transfer-jobs/:id/cancel', (req, res) => {
  try {
    const job = cloudTransferJobService.cancelJob(req.params.id);
    return res.json({
      success: true,
      accepted: true,
      job
    });
  } catch (err) {
    return sendError(res, 'CLOUD_TRANSFER_CANCEL_FAILED', 'Failed to cancel cloud transfer job', err);
  }
});

router.post('/transfer-jobs/:id/retry', async (req, res) => {
  try {
    const job = await cloudTransferJobService.retryJob(req.params.id, {
      userId: getUserId(req)
    });
    return res.status(202).json({
      success: true,
      job
    });
  } catch (err) {
    return sendError(res, 'CLOUD_TRANSFER_RETRY_FAILED', 'Failed to retry cloud transfer job', err);
  }
});

router.delete('/transfer-jobs', (req, res) => {
  try {
    const result = cloudTransferJobService.clearJobs({
      statuses: parsePruneStatuses(req)
    });
    return res.json({
      success: true,
      ...result
    });
  } catch (err) {
    return sendError(res, 'CLOUD_TRANSFER_PRUNE_FAILED', 'Failed to prune cloud transfer jobs', err);
  }
});

// Setup a new WebDAV connection
router.post('/add-webdav', async (req, res) => {
  const { name, url, user, pass } = req.body;
  if (!name || !url) {
    return sendError(res, 'CLOUD_ADD_WEBDAV_INVALID_REQUEST', 'Name and URL are required', null, 400);
  }
  try {
    await cloudService.addWebDAV(name, url, user, pass);
    res.json({ success: true });
  } catch (err) {
    sendError(res, 'CLOUD_ADD_WEBDAV_FAILED', 'Failed to add WebDAV remote', err);
  }
});

module.exports = router;
