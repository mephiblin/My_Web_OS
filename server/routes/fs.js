const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const fs = require('fs-extra');
const multer = require('multer');
const path = require('path');
const pathGuard = require('../middleware/pathGuard');
const auth = require('../middleware/auth');
const auditService = require('../services/auditService');
const indexService = require('../services/indexService');
const trashService = require('../services/trashService');
const operationApprovalService = require('../services/operationApprovalService');
const fileGrantService = require('../services/fileGrantService');
const fileTicketService = require('../services/fileTicketService');
const serverConfig = require('../config/serverConfig');
const {
  resolveSafePath,
  isWithinAllowedRoots,
  isProtectedSystemPath,
  isSafeLeafName,
  assertWithinAllowedRealRoots
} = require('../utils/pathPolicy');

function createFsHttpError(status, code, message, details = null) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.details = details;
  return err;
}

function mapFsError(err, fallbackCode = 'FS_OPERATION_FAILED', fallbackMessage = 'File operation failed.') {
  if (err?.status && err?.code) {
    return {
      status: err.status,
      code: err.code,
      message: err.message || fallbackMessage,
      details: err.details || null,
    };
  }

  switch (err?.code) {
    case 'ENOENT':
      return { status: 404, code: 'FS_PATH_NOT_FOUND', message: 'The requested path was not found.', details: null };
    case 'EACCES':
    case 'EPERM':
      return { status: 403, code: 'FS_ACCESS_DENIED', message: 'Permission denied for this file operation.', details: null };
    case 'EEXIST':
      return { status: 409, code: 'FS_CONFLICT', message: 'A file or directory with the same name already exists.', details: null };
    case 'ENOTDIR':
      return { status: 400, code: 'FS_NOT_DIRECTORY', message: 'Path is not a directory.', details: null };
    case 'EISDIR':
      return { status: 400, code: 'FS_NOT_FILE', message: 'Path is not a file.', details: null };
    default:
      return {
        status: err?.status || 500,
        code: err?.code || fallbackCode,
        message: err?.message || fallbackMessage,
        details: err?.details || null,
      };
  }
}

function sendFsError(res, err, fallbackCode, fallbackMessage) {
  const mapped = mapFsError(err, fallbackCode, fallbackMessage);
  return res.status(mapped.status).json({
    error: true,
    code: mapped.code,
    message: mapped.message,
    details: mapped.details,
  });
}

function hashJson(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function buildFileTargetEvidence(targetPath) {
  const stats = await fs.lstat(targetPath);
  const realPath = await fs.realpath(targetPath).catch(() => targetPath);
  const evidence = {
    path: targetPath,
    realPath,
    type: stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other',
    size: stats.size,
    mtimeMs: Math.trunc(stats.mtimeMs),
    inode: stats.ino || null,
    device: stats.dev || null
  };
  return {
    evidence,
    targetHash: hashJson({ scope: 'fs.target.v1', evidence })
  };
}

async function resolveFsOperationPaths(req) {
  const sourcePath = requireSafePath(req);
  const destinationInput = String(req.body?.destinationPath || req.body?.destPath || '').trim();
  if (!destinationInput) {
    throw createFsHttpError(400, 'FS_DESTINATION_REQUIRED', 'destinationPath is required.');
  }

  const destinationPath = resolveSafePath(destinationInput);
  const { allowedRoots, inventoryRoot } = await serverConfig.getPaths();
  if (!isWithinAllowedRoots(destinationPath, allowedRoots)) {
    throw createFsHttpError(403, 'FS_PERMISSION_DENIED', 'Destination path is restricted.');
  }
  await assertWithinAllowedRealRoots(destinationPath, allowedRoots);

  const destinationParent = path.dirname(destinationPath);
  if (!isWithinAllowedRoots(destinationParent, allowedRoots)) {
    throw createFsHttpError(403, 'FS_PERMISSION_DENIED', 'Destination parent is restricted.');
  }
  await assertWithinAllowedRealRoots(destinationParent, allowedRoots);

  if (isProtectedSystemPath(destinationPath, [inventoryRoot])) {
    throw createFsHttpError(403, 'FS_SYSTEM_PROTECTED', 'System inventory is protected. Use the system or package APIs.');
  }

  return { sourcePath, destinationPath, allowedRoots };
}

async function buildFsCopyMoveEvidence(req, action) {
  const { sourcePath, destinationPath } = await resolveFsOperationPaths(req);
  const sourceStats = await fs.lstat(sourcePath);
  const sourceRealPath = await fs.realpath(sourcePath).catch(() => sourcePath);
  const destinationExists = await fs.pathExists(destinationPath);
  const sourceType = sourceStats.isDirectory() ? 'directory' : sourceStats.isFile() ? 'file' : 'other';

  if (sourceType === 'other') {
    throw createFsHttpError(400, 'FS_UNSUPPORTED_SOURCE_TYPE', 'Only files and directories can be copied or moved.');
  }
  if (destinationExists) {
    throw createFsHttpError(409, 'FS_CONFLICT', 'A file or directory already exists at the destination path.');
  }
  if (sourceType === 'directory') {
    const relative = path.relative(sourcePath, destinationPath);
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
      throw createFsHttpError(400, 'FS_DESTINATION_INSIDE_SOURCE', 'Destination cannot be inside the source directory.');
    }
  }

  const evidence = {
    action,
    sourcePath,
    sourceRealPath,
    sourceType,
    sourceSize: sourceStats.size,
    sourceMtimeMs: Math.trunc(sourceStats.mtimeMs),
    destinationPath,
    destinationParent: path.dirname(destinationPath),
    destinationName: path.basename(destinationPath),
    destinationExists
  };

  return {
    evidence,
    sourcePath,
    destinationPath,
    targetId: `${sourcePath}\0${destinationPath}`,
    targetHash: hashJson({ scope: `fs.${action}.v1`, evidence })
  };
}

async function buildTrashTargetEvidence() {
  const items = await trashService.getTrashItems();
  const evidence = {
    count: items.length,
    items: items.map((item) => ({
      id: item.id,
      originalPath: item.originalPath,
      fileName: item.fileName,
      deletedAt: item.deletedAt
    })).sort((a, b) => String(a.id).localeCompare(String(b.id)))
  };
  return {
    evidence,
    targetHash: hashJson({ scope: 'fs.empty-trash.v1', evidence })
  };
}

async function getTrashItemById(id) {
  const itemId = String(id || '').trim();
  if (!itemId) {
    throw createFsHttpError(400, 'FS_TRASH_RESTORE_ID_REQUIRED', 'A valid trash item id is required.');
  }
  const items = await trashService.getTrashItems();
  const item = items.find((candidate) => candidate.id === itemId);
  if (!item) {
    throw createFsHttpError(404, 'FS_TRASH_ITEM_NOT_FOUND', 'Trash item was not found.');
  }
  return item;
}

async function buildRestoreTargetEvidence(id) {
  const item = await getTrashItemById(id);
  const { allowedRoots } = await serverConfig.getPaths();
  await assertWithinAllowedRealRoots(item.originalPath, allowedRoots);
  const sourcePath = trashService.getTrashItemPath(item.id);
  if (!(await fs.pathExists(sourcePath))) {
    throw createFsHttpError(404, 'FS_TRASH_SOURCE_NOT_FOUND', 'Trash payload was not found.');
  }
  const sourceStats = await fs.lstat(sourcePath);
  const conflict = await fs.pathExists(item.originalPath);
  const evidence = {
    id: item.id,
    fileName: item.fileName,
    originalPath: item.originalPath,
    deletedAt: item.deletedAt,
    sourcePath,
    sourceType: sourceStats.isDirectory() ? 'directory' : sourceStats.isFile() ? 'file' : 'other',
    sourceSize: sourceStats.size,
    sourceMtimeMs: Math.trunc(sourceStats.mtimeMs),
    conflict: conflict
      ? {
          path: item.originalPath,
          reason: 'target_exists'
        }
      : null
  };
  return {
    item,
    evidence,
    targetHash: hashJson({ scope: 'fs.restore.v1', evidence })
  };
}

function normalizeZipEntryName(entryName) {
  return String(entryName || '').replace(/\\/g, '/');
}

function isUnsafeZipEntryName(entryName) {
  const normalized = normalizeZipEntryName(entryName);
  if (!normalized || normalized.startsWith('/') || path.isAbsolute(normalized)) return true;
  return normalized.split('/').some((segment) => segment === '..');
}

async function resolveExtractDestPath(sourcePath, rawDestPath) {
  const { allowedRoots } = await serverConfig.getPaths();
  const destPath = rawDestPath
    ? resolveSafePath(rawDestPath)
    : path.dirname(sourcePath);
  if (!isWithinAllowedRoots(destPath, allowedRoots)) {
    throw createFsHttpError(403, 'FS_RESTRICTED_DESTINATION', 'Destination path is restricted.');
  }
  await assertWithinAllowedRealRoots(destPath, allowedRoots);
  return { destPath, allowedRoots };
}

async function hashFileContent(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function buildExtractTargetEvidence(sourcePath, rawDestPath) {
  const AdmZip = require('adm-zip');
  const stats = await fs.stat(sourcePath);
  if (stats.isDirectory()) {
    throw createFsHttpError(400, 'FS_ARCHIVE_INVALID', 'Not an archive file.');
  }
  const { destPath, allowedRoots } = await resolveExtractDestPath(sourcePath, rawDestPath);
  const zip = new AdmZip(sourcePath);
  const sourceHash = await hashFileContent(sourcePath);
  const blockers = [];
  const conflicts = [];
  const entries = [];

  for (const entry of zip.getEntries()) {
    const entryName = normalizeZipEntryName(entry.entryName);
    const destinationPath = path.resolve(destPath, entryName);
    const unsafe = isUnsafeZipEntryName(entryName) || !isWithinAllowedRoots(destinationPath, [destPath]);
    if (unsafe) {
      blockers.push({
        entryName,
        code: 'FS_ARCHIVE_ENTRY_TRAVERSAL',
        message: 'Archive entry would extract outside the destination.'
      });
    } else {
      await assertWithinAllowedRealRoots(destinationPath, allowedRoots);
      if (!entry.isDirectory && await fs.pathExists(destinationPath)) {
        conflicts.push({
          entryName,
          path: destinationPath,
          reason: 'target_exists'
        });
      }
    }
    entries.push({
      name: entryName,
      isDirectory: entry.isDirectory,
      size: entry.header?.size || 0,
      destinationPath
    });
  }

  if (blockers.length > 0) {
    throw createFsHttpError(400, 'FS_ARCHIVE_ENTRY_TRAVERSAL', 'Archive contains entries that would extract outside the destination.', {
      blockers
    });
  }

  const evidence = {
    sourcePath,
    sourceHash,
    sourceSize: stats.size,
    sourceMtimeMs: Math.trunc(stats.mtimeMs),
    destPath,
    entryCount: entries.length,
    entries,
    conflicts,
    overwriteRequired: conflicts.length > 0
  };

  return {
    evidence,
    targetHash: hashJson({ scope: 'fs.extract.v1', evidence })
  };
}

function getApprovalInput(body = {}) {
  return body.approval && typeof body.approval === 'object' && !Array.isArray(body.approval)
    ? body.approval
    : {};
}

function sendApprovalRequired(res, code, message, preflight) {
  return res.status(428).json({
    error: true,
    code,
    message,
    preflight
  });
}

async function createFsApprovalPreflight(req, {
  action,
  target,
  targetHash,
  evidence,
  impact,
  recoverability,
  typedConfirmation = ''
}) {
  const operation = operationApprovalService.createOperation({
    action,
    userId: req.user?.username,
    target,
    targetHash,
    typedConfirmation,
    metadata: {
      impact,
      recoverability,
      evidence,
      riskLevel: 'high'
    }
  });

  await auditService.log('FILE_TRANSFER', `${action}.preflight`, {
    operationId: operation.operationId,
    target,
    targetHash,
    impact,
    recoverability,
    expiresAt: operation.expiresAt,
    user: req.user?.username
  }, 'WARNING');

  return {
    action,
    operationId: operation.operationId,
    target,
    targetHash,
    impact,
    recoverability,
    evidence,
    expiresAt: operation.expiresAt,
    approval: {
      required: true,
      typedConfirmation
    }
  };
}

async function approveFsOperation(req, { action, targetId }) {
  const approval = operationApprovalService.approveOperation({
    operationId: req.body?.operationId,
    userId: req.user?.username,
    action,
    targetId,
    typedConfirmation: req.body?.typedConfirmation
  });

  await auditService.log('FILE_TRANSFER', `${action}.approved`, {
    operationId: approval.operationId,
    targetId,
    expiresAt: approval.expiresAt,
    user: req.user?.username
  }, 'WARNING');

  return approval;
}

function consumeFsApproval(req, { action, targetId, targetHash }) {
  const approval = getApprovalInput(req.body);
  const approvalTargetHash = String(approval.targetHash || '').trim();
  if (!String(approval.operationId || '').trim() || !String(approval.nonce || '').trim() || !approvalTargetHash) {
    throw createFsHttpError(428, 'FS_OPERATION_APPROVAL_REQUIRED', 'This file operation requires scoped approval evidence.');
  }
  if (approvalTargetHash !== targetHash) {
    throw createFsHttpError(428, 'FS_OPERATION_APPROVAL_TARGET_CHANGED', 'Approval target changed after preflight.');
  }
  return operationApprovalService.consumeApproval({
    operationId: approval.operationId,
    nonce: approval.nonce,
    userId: req.user?.username,
    action,
    targetId,
    targetHash
  });
}

function requireSafePath(req) {
  if (!req.safePath) {
    throw createFsHttpError(400, 'FS_INVALID_PATH', 'A valid path is required.');
  }
  return req.safePath;
}

function consumeFileGrant(grantId, options = {}) {
  try {
    return fileGrantService.consumeGrant(grantId, options);
  } catch (err) {
    if (String(err.code || '').startsWith('FS_FILE_GRANT_')) {
      throw createFsHttpError(
        err.code === 'FS_FILE_GRANT_REQUIRED' ? 400 : 403,
        err.code,
        err.message
      );
    }
    throw err;
  }
}

function mapFileGrantHttpError(err) {
  if (err?.status && err?.code) {
    return err;
  }
  if (String(err?.code || '').startsWith('FS_FILE_GRANT_')) {
    return createFsHttpError(
      err.code === 'FS_FILE_GRANT_REQUIRED' ? 400 : 403,
      err.code,
      err.message
    );
  }
  return err;
}

function sendRawFile(targetPath, res, options = {}) {
  console.log(`[FS] Sending raw file (${path.basename(targetPath)})`);
  return res.sendFile(targetPath, (err) => {
    if (err) {
      console.error(`[FS] Error sending file: ${err.message}`);
      if (!res.headersSent) {
        sendFsError(res, err, 'FS_RAW_STREAM_FAILED', 'Failed to stream file.');
      }
      return;
    }
    if (options.ticket && options.profile === fileTicketService.PROFILE_MEDIA) {
      fileTicketService.touchTicket(options.ticket, {
        metadata: {
          lastRequestRange: options.range || ''
        }
      });
    }
  });
}

async function assertRawFileTarget(targetPath) {
  const stats = await fs.stat(targetPath);

  if (stats.isDirectory()) {
    throw createFsHttpError(400, 'FS_NOT_FILE', 'Cannot stream a directory.');
  }

  return stats;
}

/**
 * GET /api/fs/raw?ticket=...
 * Redeem a short-lived raw file ticket without requiring Authorization.
 */
router.get('/raw', async (req, res, next) => {
  const ticket = String(req.query?.ticket || '').trim();
  if (!ticket) return next();

  try {
    const record = fileTicketService.getTicket(ticket, { scope: 'fs.raw' });
    const { allowedRoots } = await serverConfig.getPaths();
    await assertWithinAllowedRealRoots(record.path, allowedRoots);
    const stats = await assertRawFileTarget(record.path);
    fileTicketService.assertTicketTargetUnchanged(record, stats);
    return sendRawFile(record.path, res, {
      ticket: record.ticket,
      profile: record.profile,
      range: req.headers.range || ''
    });
  } catch (err) {
    return sendFsError(res, err, 'FS_RAW_TICKET_FAILED', 'Failed to redeem raw file ticket.');
  }
});

// Auth required for all non-ticket fs routes.
router.use(auth);


/**
 * GET /api/fs/trash
 * List trash items
 */
router.get('/trash', async (req, res) => {
  try {
    const items = await trashService.getTrashItems();
    res.json(items);
  } catch (err) {
    sendFsError(res, err, 'FS_TRASH_LIST_FAILED', 'Failed to list trash items.');
  }
});

/**
 * POST /api/fs/restore
 * Restore from trash
 */
router.post('/restore/preflight', async (req, res) => {
  try {
    const { id } = req.body || {};
    const { item, evidence, targetHash } = await buildRestoreTargetEvidence(id);
    const preflight = await createFsApprovalPreflight(req, {
      action: 'fs.restore',
      target: {
        type: 'trash-item',
        id: item.id,
        label: item.fileName || item.id
      },
      targetHash,
      evidence,
      impact: evidence.conflict
        ? `Restores ${item.fileName || item.id}; restore target already exists and must be resolved first.`
        : `Restores ${item.fileName || item.id} to its original path.`,
      recoverability: evidence.conflict ? 'blocked until conflict is resolved' : 'moves item out of trash',
      typedConfirmation: item.fileName || item.id
    });
    return res.json({ success: true, preflight });
  } catch (err) {
    return sendFsError(res, err, 'FS_TRASH_RESTORE_PREFLIGHT_FAILED', 'Failed to prepare restore approval.');
  }
});

router.post('/restore/approve', async (req, res) => {
  try {
    const { id } = req.body || {};
    const item = await getTrashItemById(id);
    const approval = await approveFsOperation(req, {
      action: 'fs.restore',
      targetId: item.id
    });
    return res.json({ success: true, approval });
  } catch (err) {
    await auditService.log('FILE_TRANSFER', 'fs.restore.approval_rejected', {
      operationId: req.body?.operationId || null,
      approvalCode: err?.code || null,
      trashItemId: req.body?.id || null,
      user: req.user?.username
    }, 'WARNING');
    return sendFsError(res, createFsHttpError(400, 'FS_TRASH_RESTORE_APPROVAL_INVALID', err.message), 'FS_TRASH_RESTORE_APPROVAL_INVALID', 'Restore approval is invalid.');
  }
});

router.post('/restore', async (req, res) => {
  const { id } = req.body;
  let approvalContext = null;
  try {
    const { item, evidence, targetHash } = await buildRestoreTargetEvidence(id);
    if (evidence.conflict) {
      throw createFsHttpError(409, 'FS_TRASH_RESTORE_CONFLICT', 'Restore target already exists.', {
        conflict: evidence.conflict
      });
    }
    try {
      approvalContext = consumeFsApproval(req, {
        action: 'fs.restore',
        targetId: item.id,
        targetHash
      });
    } catch (approvalErr) {
      const preflight = await createFsApprovalPreflight(req, {
        action: 'fs.restore',
        target: {
          type: 'trash-item',
          id: item.id,
          label: item.fileName || item.id
        },
        targetHash,
        evidence,
        impact: `Restores ${item.fileName || item.id} to its original path.`,
        recoverability: 'moves item out of trash',
        typedConfirmation: item.fileName || item.id
      });
      await auditService.log('FILE_TRANSFER', 'fs.restore.approval_rejected', {
        approvalCode: approvalErr?.code || null,
        operationId: req.body?.approval?.operationId || null,
        trashItemId: item.id,
        user: req.user?.username
      }, 'WARNING');
      return sendApprovalRequired(res, 'FS_TRASH_RESTORE_APPROVAL_REQUIRED', approvalErr.message, preflight);
    }

    await trashService.restore(item.id);
    await auditService.log('FILE_TRANSFER', 'fs.restore', {
      id: item.id,
      originalPath: item.originalPath,
      operationId: approvalContext.operationId,
      targetHash: approvalContext.targetHash,
      approval: { nonceConsumed: true },
      result: { status: 'success' },
      user: req.user?.username
    }, 'WARNING');
    res.json({ success: true });
  } catch (err) {
    if (approvalContext) {
      await auditService.log('FILE_TRANSFER', 'fs.restore', {
        operationId: approvalContext.operationId,
        targetHash: approvalContext.targetHash,
        approval: { nonceConsumed: true },
        result: { status: 'failure', code: err?.code || 'FS_TRASH_RESTORE_FAILED' },
        user: req.user?.username
      }, 'ERROR');
    }
    sendFsError(res, err, 'FS_TRASH_RESTORE_FAILED', 'Failed to restore trash item.');
  }
});

/**
 * DELETE /api/fs/empty-trash
 */
router.post('/empty-trash/preflight', async (req, res) => {
  try {
    const { evidence, targetHash } = await buildTrashTargetEvidence();
    const preflight = await createFsApprovalPreflight(req, {
      action: 'fs.empty-trash',
      target: {
        type: 'trash',
        id: 'trash',
        label: 'Trash'
      },
      targetHash,
      evidence,
      impact: evidence.count > 0
        ? `Permanently removes ${evidence.count} trash item(s).`
        : 'Trash is already empty.',
      recoverability: 'unrecoverable'
    });
    return res.json({ success: true, preflight });
  } catch (err) {
    return sendFsError(res, err, 'FS_TRASH_EMPTY_PREFLIGHT_FAILED', 'Failed to prepare empty trash approval.');
  }
});

router.post('/empty-trash/approve', async (req, res) => {
  try {
    const approval = await approveFsOperation(req, {
      action: 'fs.empty-trash',
      targetId: 'trash'
    });
    return res.json({ success: true, approval });
  } catch (err) {
    await auditService.log('FILE_TRANSFER', 'fs.empty-trash.approval_rejected', {
      operationId: req.body?.operationId || null,
      approvalCode: err?.code || null,
      user: req.user?.username
    }, 'WARNING');
    return sendFsError(res, createFsHttpError(400, 'FS_TRASH_EMPTY_APPROVAL_INVALID', err.message), 'FS_TRASH_EMPTY_APPROVAL_INVALID', 'Empty trash approval is invalid.');
  }
});

router.delete('/empty-trash', async (req, res) => {
  let approvalContext = null;
  try {
    const { evidence, targetHash } = await buildTrashTargetEvidence();
    try {
      approvalContext = consumeFsApproval(req, {
        action: 'fs.empty-trash',
        targetId: 'trash',
        targetHash
      });
    } catch (approvalErr) {
      const preflight = await createFsApprovalPreflight(req, {
        action: 'fs.empty-trash',
        target: {
          type: 'trash',
          id: 'trash',
          label: 'Trash'
        },
        targetHash,
        evidence,
        impact: evidence.count > 0
          ? `Permanently removes ${evidence.count} trash item(s).`
          : 'Trash is already empty.',
        recoverability: 'unrecoverable'
      });
      await auditService.log('FILE_TRANSFER', 'fs.empty-trash.approval_rejected', {
        approvalCode: approvalErr?.code || null,
        operationId: req.body?.approval?.operationId || null,
        user: req.user?.username
      }, 'WARNING');
      return sendApprovalRequired(res, 'FS_TRASH_EMPTY_APPROVAL_REQUIRED', approvalErr.message, preflight);
    }

    await trashService.emptyTrash();
    await auditService.log('SYSTEM', 'fs.empty-trash', {
      operationId: approvalContext.operationId,
      targetHash: approvalContext.targetHash,
      approval: { nonceConsumed: true },
      result: { status: 'success' },
      user: req.user?.username
    }, 'WARNING');
    res.json({ success: true });
  } catch (err) {
    if (approvalContext) {
      await auditService.log('SYSTEM', 'fs.empty-trash', {
        operationId: approvalContext.operationId,
        targetHash: approvalContext.targetHash,
        approval: { nonceConsumed: true },
        result: { status: 'failure', code: err?.code || 'FS_TRASH_EMPTY_FAILED' },
        user: req.user?.username
      }, 'ERROR');
    }
    sendFsError(res, err, 'FS_TRASH_EMPTY_FAILED', 'Failed to empty trash.');
  }
});

/**
 * Routes that do NOT require pathGuard (no user-supplied path)
 */

/**
 * GET /api/fs/config
 * Return public fs configuration like initial path
 */
router.get('/config', (req, res) => {
  serverConfig.getPaths()
    .then((paths) => {
      res.json({
        initialPath: paths.initialPath || '/',
        allowedRoots: Array.isArray(paths.allowedRoots) ? paths.allowedRoots : [],
        inventoryRoot: paths.inventoryRoot || ''
      });
    })
    .catch((err) => {
      sendFsError(res, err, 'FS_CONFIG_FETCH_FAILED', 'Failed to read file system config.');
    });
});

/**
 * GET /api/fs/user-dirs
 * Auto-detect user directories (cross-platform)
 */
router.get('/user-dirs', (req, res) => {
  try {
    const { detectUserDirs } = require('../services/userDirs');
    const dirs = detectUserDirs();
    res.json(dirs);
  } catch (err) {
    sendFsError(res, err, 'FS_USER_DIRS_FETCH_FAILED', 'Failed to detect user directories.');
  }
});

/**
 * GET /api/fs/grants
 * List active file grants for current user
 */
router.get('/grants', async (req, res) => {
  try {
    const source = typeof req.query?.source === 'string' ? req.query.source.trim() : '';
    const grants = fileGrantService.listActiveGrants({
      user: req.user?.username,
      source
    });

    return res.json({
      success: true,
      count: grants.length,
      grants: grants.map((grant) => ({
        id: grant.id,
        appId: grant.appId,
        source: grant.source,
        scope: grant.scope,
        mode: grant.mode,
        path: grant.path,
        createdAt: new Date(grant.createdAt).toISOString(),
        expiresAt: new Date(grant.expiresAt).toISOString(),
        expiresOnWindowClose: grant.expiresOnWindowClose
      }))
    });
  } catch (err) {
    sendFsError(res, err, 'FS_FILE_GRANT_LIST_FAILED', 'Failed to list active file grants.');
  }
});

/**
 * DELETE /api/fs/grants
 * Revoke active file grants for current user, optionally filtered by source
 */
router.delete('/grants', async (req, res) => {
  try {
    const source = typeof req.query?.source === 'string' ? req.query.source.trim() : '';
    const grants = fileGrantService.revokeGrants({
      user: req.user?.username,
      source
    });

    await auditService.log(
      'FILE_TRANSFER',
      'Revoke File Grants',
      {
        source: source || 'all',
        count: grants.length,
        grantIds: grants.map((grant) => grant.id),
        user: req.user?.username
      },
      'INFO'
    );

    return res.json({
      success: true,
      count: grants.length,
      revoked: grants.map((grant) => ({
        id: grant.id,
        appId: grant.appId,
        source: grant.source,
        scope: grant.scope,
        mode: grant.mode,
        path: grant.path
      }))
    });
  } catch (err) {
    sendFsError(res, mapFileGrantHttpError(err), 'FS_FILE_GRANT_REVOKE_FAILED', 'Failed to revoke file grants.');
  }
});

/**
 * DELETE /api/fs/grants/:grantId
 * Revoke an active file grant for current user
 */
router.delete('/grants/:grantId', async (req, res) => {
  try {
    const source = typeof req.query?.source === 'string' ? req.query.source.trim() : '';
    const grant = fileGrantService.revokeGrant(req.params.grantId, {
      user: req.user?.username,
      source
    });

    if (!grant) {
      throw createFsHttpError(404, 'FS_FILE_GRANT_INVALID', 'File grant is invalid or expired.');
    }

    await auditService.log(
      'FILE_TRANSFER',
      'Revoke File Grant',
      {
        path: grant.path,
        mode: grant.mode,
        appId: grant.appId,
        source: grant.source,
        grantId: grant.id,
        user: req.user?.username
      },
      'INFO'
    );

    return res.json({
      success: true,
      revoked: {
        id: grant.id,
        appId: grant.appId,
        source: grant.source,
        scope: grant.scope,
        mode: grant.mode,
        path: grant.path
      }
    });
  } catch (err) {
    sendFsError(res, mapFileGrantHttpError(err), 'FS_FILE_GRANT_REVOKE_FAILED', 'Failed to revoke file grant.');
  }
});

/**
 * Routes below require pathGuard (user-supplied path)
 */
router.use(pathGuard);

router.post('/raw-ticket', async (req, res) => {
  try {
    const targetPath = requireSafePath(req);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const appId = String(body.appId || '').trim();
    const profile = String(body.profile || body.purpose || fileTicketService.PROFILE_PREVIEW).trim().toLowerCase();

    const stats = await assertRawFileTarget(targetPath);

    const ticket = fileTicketService.createTicket({
      scope: 'fs.raw',
      profile,
      user: req.user?.username,
      appId,
      path: targetPath,
      stats,
      ttlMs: body.ttlMs,
      absoluteTtlMs: body.absoluteTtlMs,
      idleTimeoutMs: body.idleTimeoutMs
    });

    await auditService.log(
      'FILE_TRANSFER',
      'Issue Raw File Ticket',
      {
        path: targetPath,
        appId,
        scope: ticket.scope,
        profile: ticket.profile,
        expiresAt: new Date(ticket.expiresAt).toISOString(),
        absoluteExpiresAt: ticket.absoluteExpiresAt
          ? new Date(ticket.absoluteExpiresAt).toISOString()
          : null,
        user: req.user?.username
      },
      'INFO'
    );

    return res.status(201).json({
      success: true,
      ticket: ticket.ticket,
      url: `/api/fs/raw?ticket=${encodeURIComponent(ticket.ticket)}`,
      scope: ticket.scope,
      profile: ticket.profile,
      path: targetPath,
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
    sendFsError(res, err, 'FS_RAW_TICKET_CREATE_FAILED', 'Failed to create raw file ticket.');
  }
});

router.post('/grant', async (req, res) => {
  try {
    const targetPath = requireSafePath(req);
    const { mode, appId, source } = req.body && typeof req.body === 'object' ? req.body : {};
    const stats = await fs.stat(targetPath);
    if (!stats.isFile()) {
      throw createFsHttpError(400, 'FS_FILE_GRANT_NOT_FILE', 'File grants can only be issued for files.');
    }

    const grant = fileGrantService.createGrant({
      path: targetPath,
      mode,
      appId,
      source,
      user: req.user?.username
    });

    await auditService.log(
      'FILE_TRANSFER',
      'Issue File Grant',
      {
        path: targetPath,
        mode: grant.mode,
        appId: grant.appId,
        source: grant.source,
        grantId: grant.id,
        user: req.user?.username
      },
      'INFO'
    );

    return res.status(201).json({
      success: true,
      grant: {
        id: grant.id,
        appId: grant.appId,
        source: grant.source,
        scope: grant.scope,
        mode: grant.mode,
        path: grant.path,
        createdAt: new Date(grant.createdAt).toISOString(),
        expiresAt: new Date(grant.expiresAt).toISOString(),
        expiresOnWindowClose: grant.expiresOnWindowClose
      }
    });
  } catch (err) {
    sendFsError(res, err, 'FS_FILE_GRANT_FAILED', 'Failed to create file grant.');
  }
});

/**
 * GET /api/fs/list
 * List directory contents
 */
router.get('/list', async (req, res) => {
  try {
    const targetPath = requireSafePath(req);
    const stats = await fs.stat(targetPath);

    if (!stats.isDirectory()) {
      throw createFsHttpError(400, 'FS_NOT_DIRECTORY', 'Path is not a directory.');
    }

    const files = await fs.readdir(targetPath);
    const details = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(targetPath, file);
        try {
          const fileStats = await fs.stat(filePath);
          return {
            name: file,
            path: filePath,
            isDirectory: fileStats.isDirectory(),
            size: fileStats.size,
            mtime: fileStats.mtime,
            birthtime: fileStats.birthtime,
          };
        } catch (err) {
          return { name: file, error: 'Could not retrieve stats' };
        }
      })
    );

    res.json({ path: targetPath, items: details });
  } catch (err) {
    sendFsError(res, err, 'FS_LIST_FAILED', 'Failed to list directory.');
  }
});

/**
 * GET /api/fs/search
 * Recursive directory file search
 */
async function searchDirectory(dir, query, limit, results = []) {
  if (results.length >= limit) return results;
  try {
    const files = await fs.readdir(dir, { withFileTypes: true });
    for (const file of files) {
      if (results.length >= limit) break;
      const fullPath = path.join(dir, file.name);
      
      if (file.name.toLowerCase().includes(query)) {
        try {
          const stats = await fs.stat(fullPath);
          results.push({
            name: file.name,
            path: fullPath,
            isDirectory: file.isDirectory(),
            size: stats.size,
            mtime: stats.mtime
          });
        } catch(e) {}
      }

      if (file.isDirectory() && !file.name.startsWith('.')) {
         await searchDirectory(fullPath, query, limit, results);
      }
    }
  } catch (err) {
    // Ignore permissions/access errors
  }
  return results;
}

router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    const targetPath = requireSafePath(req);
    if (!q) {
      return res.json({ items: [], meta: null });
    }
    const query = q.toLowerCase();
    
    // 1. Try index search first
    let results = indexService.search(query, targetPath);
    let source = 'index';

    // 2. Fallback to recursive scan if index is empty or has very few results 
    // (This helps if indexing is still in progress or specifically excluded by index rules)
    if (results.length < 5) {
      const scanResults = await searchDirectory(targetPath, query, 200);
      // Merge results, avoiding duplicates by path
      const resultPaths = new Set(results.map(r => r.path));
      for (const item of scanResults) {
        if (!resultPaths.has(item.path)) {
          results.push(item);
        }
        if (results.length >= 200) break;
      }
      source = results.length > scanResults.length ? 'mixed' : 'scan';
    }

    res.json({
      items: results,
      meta: {
        query: q,
        source: source,
        total: results.length,
        path: targetPath
      }
    });

  } catch (err) {
    sendFsError(res, err, 'FS_SEARCH_FAILED', 'Failed to search files.');
  }
});

/**
 * GET /api/fs/read
 * Read file content
 */
router.get('/read', async (req, res) => {
  try {
    const targetPath = requireSafePath(req);
    const grantId = String(req.query?.grantId || '').trim();
    const appId = String(req.query?.appId || '').trim();
    if (grantId) {
      consumeFileGrant(grantId, {
        path: targetPath,
        requiredMode: 'read',
        appId,
        user: req.user?.username
      });
    }
    const stats = await fs.stat(targetPath);

    if (stats.isDirectory()) {
      throw createFsHttpError(400, 'FS_NOT_FILE', 'Cannot read a directory as a file.');
    }

    const content = await fs.readFile(targetPath, 'utf8');
    res.json({ path: targetPath, content });
  } catch (err) {
    sendFsError(res, err, 'FS_READ_FAILED', 'Failed to read file.');
  }
});

/**
 * GET /api/fs/raw
 * Serve raw file for streaming/viewing
 */
router.get('/raw', async (req, res) => {
  try {
    const targetPath = requireSafePath(req);
    await assertRawFileTarget(targetPath);
    return sendRawFile(targetPath, res);
  } catch (err) {
    console.error(`[FS] Error in /raw: ${err.message}`);
    sendFsError(res, err, 'FS_RAW_FETCH_FAILED', 'Failed to fetch file stream.');
  }
});

/**
 * POST /api/fs/write
 * Create or update file content
 */
router.post('/write/preflight', async (req, res) => {
  try {
    const targetPath = requireSafePath(req);
    const exists = await fs.pathExists(targetPath);
    if (!exists) {
      throw createFsHttpError(400, 'FS_WRITE_APPROVAL_NOT_REQUIRED', 'Overwrite approval is only required for an existing file.');
    }
    const { evidence, targetHash } = await buildFileTargetEvidence(targetPath);
    const preflight = await createFsApprovalPreflight(req, {
      action: 'fs.write.overwrite',
      target: {
        type: evidence.type,
        id: targetPath,
        label: path.basename(targetPath)
      },
      targetHash,
      evidence,
      impact: 'Overwrites the current file contents.',
      recoverability: 'recoverable only from external backup or previous app state',
      typedConfirmation: path.basename(targetPath)
    });
    return res.json({ success: true, preflight });
  } catch (err) {
    return sendFsError(res, err, 'FS_WRITE_PREFLIGHT_FAILED', 'Failed to prepare overwrite approval.');
  }
});

router.post('/write/approve', async (req, res) => {
  try {
    const targetPath = requireSafePath(req);
    const approval = await approveFsOperation(req, {
      action: 'fs.write.overwrite',
      targetId: targetPath
    });
    return res.json({ success: true, approval });
  } catch (err) {
    await auditService.log('FILE_TRANSFER', 'fs.write.overwrite.approval_rejected', {
      operationId: req.body?.operationId || null,
      approvalCode: err?.code || null,
      user: req.user?.username
    }, 'WARNING');
    return sendFsError(res, createFsHttpError(400, 'FS_WRITE_APPROVAL_INVALID', err.message), 'FS_WRITE_APPROVAL_INVALID', 'Overwrite approval is invalid.');
  }
});

router.post('/write', async (req, res) => {
  let approvalContext = null;
  try {
    const targetPath = requireSafePath(req);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { content } = body;
    const grantId = String(body.grantId || '').trim();
    const appId = String(body.appId || '').trim();
    const operationSource = String(body.operationSource || '').trim().toLowerCase();
    const overwrite = body.overwrite === true;
    const legacyApproval = body.approval && typeof body.approval === 'object' ? body.approval : {};
    let approvalReceived = legacyApproval.approved === true;

    if (typeof content !== 'string' && content !== undefined && content !== null) {
      throw createFsHttpError(400, 'FS_WRITE_CONTENT_INVALID', 'File content must be a string.');
    }

    if (operationSource === 'addon') {
      consumeFileGrant(grantId, {
        path: targetPath,
        requiredMode: 'readwrite',
        appId,
        user: req.user?.username
      });
    }

    const exists = await fs.pathExists(targetPath);
    if (operationSource === 'addon' && exists && !overwrite) {
      throw createFsHttpError(
        409,
        'FS_WRITE_OVERWRITE_APPROVAL_REQUIRED',
        'Overwrite requires explicit approval for addon file writes.',
        {
          path: targetPath,
          requiresApproval: true
        }
      );
    }
    if (exists) {
      const { evidence, targetHash } = await buildFileTargetEvidence(targetPath);
      try {
        approvalContext = consumeFsApproval(req, {
          action: 'fs.write.overwrite',
          targetId: targetPath,
          targetHash
        });
        approvalReceived = true;
      } catch (approvalErr) {
        if (operationSource === 'addon' && legacyApproval.approved === true) {
          await auditService.log('FILE_TRANSFER', 'fs.write.overwrite.legacy_approval_rejected', {
            path: targetPath,
            appId: appId || null,
            approvalCode: approvalErr?.code || null,
            user: req.user?.username
          }, 'WARNING');
        }
        const preflight = await createFsApprovalPreflight(req, {
          action: 'fs.write.overwrite',
          target: {
            type: evidence.type,
            id: targetPath,
            label: path.basename(targetPath)
          },
          targetHash,
          evidence,
          impact: 'Overwrites the current file contents.',
          recoverability: 'recoverable only from external backup or previous app state',
          typedConfirmation: path.basename(targetPath)
        });
        return sendApprovalRequired(res, 'FS_WRITE_APPROVAL_REQUIRED', approvalErr.message, preflight);
      }
    }

    await fs.writeFile(targetPath, content || '', 'utf8');
    await auditService.log(
      'FILE_TRANSFER',
      'Write File',
      {
        path: targetPath,
        appId: appId || null,
        operationSource: operationSource || 'direct',
        grantId: grantId || null,
        overwrite,
        approvalReceived,
        operationId: approvalContext?.operationId || null,
        targetHash: approvalContext?.targetHash || null,
        user: req.user?.username
      },
      'INFO'
    );
    res.json({ success: true, message: 'File saved successfully.' });
  } catch (err) {
    sendFsError(res, err, 'FS_WRITE_FAILED', 'Failed to save file.');
  }
});

/**
 * DELETE /api/fs/delete
 * Delete file or directory
 */
router.post('/delete/preflight', async (req, res) => {
  try {
    const targetPath = requireSafePath(req);
    const { evidence, targetHash } = await buildFileTargetEvidence(targetPath);
    const preflight = await createFsApprovalPreflight(req, {
      action: 'fs.delete',
      target: {
        type: evidence.type,
        id: targetPath,
        label: path.basename(targetPath)
      },
      targetHash,
      evidence,
      impact: evidence.type === 'directory'
        ? 'Moves this directory and its contents to trash.'
        : 'Moves this item to trash.',
      recoverability: 'trash-restore',
      typedConfirmation: path.basename(targetPath)
    });
    return res.json({ success: true, preflight });
  } catch (err) {
    return sendFsError(res, err, 'FS_DELETE_PREFLIGHT_FAILED', 'Failed to prepare delete approval.');
  }
});

router.post('/delete/approve', async (req, res) => {
  try {
    const targetPath = requireSafePath(req);
    const approval = await approveFsOperation(req, {
      action: 'fs.delete',
      targetId: targetPath
    });
    return res.json({ success: true, approval });
  } catch (err) {
    await auditService.log('FILE_TRANSFER', 'fs.delete.approval_rejected', {
      operationId: req.body?.operationId || null,
      approvalCode: err?.code || null,
      user: req.user?.username
    }, 'WARNING');
    return sendFsError(res, createFsHttpError(400, 'FS_DELETE_APPROVAL_INVALID', err.message), 'FS_DELETE_APPROVAL_INVALID', 'Delete approval is invalid.');
  }
});

router.delete('/delete', async (req, res) => {
  let approvalContext = null;
  try {
    const targetPath = requireSafePath(req);
    const { evidence, targetHash } = await buildFileTargetEvidence(targetPath);
    try {
      approvalContext = consumeFsApproval(req, {
        action: 'fs.delete',
        targetId: targetPath,
        targetHash
      });
    } catch (approvalErr) {
      const preflight = await createFsApprovalPreflight(req, {
        action: 'fs.delete',
        target: {
          type: evidence.type,
          id: targetPath,
          label: path.basename(targetPath)
        },
        targetHash,
        evidence,
        impact: evidence.type === 'directory'
          ? 'Moves this directory and its contents to trash.'
          : 'Moves this item to trash.',
        recoverability: 'trash-restore',
        typedConfirmation: path.basename(targetPath)
      });
      await auditService.log('FILE_TRANSFER', 'fs.delete.approval_rejected', {
        approvalCode: approvalErr?.code || null,
        operationId: req.body?.approval?.operationId || null,
        path: targetPath,
        user: req.user?.username
      }, 'WARNING');
      return sendApprovalRequired(res, 'FS_DELETE_APPROVAL_REQUIRED', approvalErr.message, preflight);
    }

    await trashService.moveToTrash(targetPath);
    await auditService.log('FILE_TRANSFER', 'fs.delete', {
      path: targetPath,
      operationId: approvalContext.operationId,
      targetHash: approvalContext.targetHash,
      approval: { nonceConsumed: true },
      result: { status: 'success' },
      user: req.user?.username
    }, 'WARNING');
    res.json({ success: true, message: 'Item moved to trash.' });
  } catch (err) {
    if (approvalContext) {
      await auditService.log('FILE_TRANSFER', 'fs.delete', {
        operationId: approvalContext.operationId,
        targetHash: approvalContext.targetHash,
        approval: { nonceConsumed: true },
        result: { status: 'failure', code: err?.code || 'FS_DELETE_FAILED' },
        user: req.user?.username
      }, 'ERROR');
    }
    sendFsError(res, err, 'FS_DELETE_FAILED', 'Failed to move item to trash.');
  }
});

router.post('/copy/preflight', async (req, res) => {
  try {
    const { evidence, sourcePath, targetId, targetHash } = await buildFsCopyMoveEvidence(req, 'copy');
    const preflight = await createFsApprovalPreflight(req, {
      action: 'fs.copy',
      target: {
        type: evidence.sourceType,
        id: targetId,
        label: `${path.basename(sourcePath)} -> ${path.basename(evidence.destinationPath)}`
      },
      targetHash,
      evidence,
      impact: evidence.sourceType === 'directory'
        ? 'Copies this directory and its contents to the destination.'
        : 'Copies this file to the destination.',
      recoverability: 'destination can be moved to trash after copy',
      typedConfirmation: path.basename(sourcePath)
    });
    return res.json({ success: true, preflight });
  } catch (err) {
    return sendFsError(res, err, 'FS_COPY_PREFLIGHT_FAILED', 'Failed to prepare copy approval.');
  }
});

router.post('/copy/approve', async (req, res) => {
  try {
    const { targetId } = await buildFsCopyMoveEvidence(req, 'copy');
    const approval = await approveFsOperation(req, {
      action: 'fs.copy',
      targetId
    });
    return res.json({ success: true, approval });
  } catch (err) {
    await auditService.log('FILE_TRANSFER', 'fs.copy.approval_rejected', {
      operationId: req.body?.operationId || null,
      approvalCode: err?.code || null,
      user: req.user?.username
    }, 'WARNING');
    return sendFsError(res, createFsHttpError(400, 'FS_COPY_APPROVAL_INVALID', err.message), 'FS_COPY_APPROVAL_INVALID', 'Copy approval is invalid.');
  }
});

router.post('/copy', async (req, res) => {
  let approvalContext = null;
  try {
    const { evidence, sourcePath, destinationPath, targetId, targetHash } = await buildFsCopyMoveEvidence(req, 'copy');
    try {
      approvalContext = consumeFsApproval(req, {
        action: 'fs.copy',
        targetId,
        targetHash
      });
    } catch (approvalErr) {
      const preflight = await createFsApprovalPreflight(req, {
        action: 'fs.copy',
        target: {
          type: evidence.sourceType,
          id: targetId,
          label: `${path.basename(sourcePath)} -> ${path.basename(destinationPath)}`
        },
        targetHash,
        evidence,
        impact: evidence.sourceType === 'directory'
          ? 'Copies this directory and its contents to the destination.'
          : 'Copies this file to the destination.',
        recoverability: 'destination can be moved to trash after copy',
        typedConfirmation: path.basename(sourcePath)
      });
      await auditService.log('FILE_TRANSFER', 'fs.copy.approval_rejected', {
        approvalCode: approvalErr?.code || null,
        operationId: req.body?.approval?.operationId || null,
        sourcePath,
        destinationPath,
        user: req.user?.username
      }, 'WARNING');
      return sendApprovalRequired(res, 'FS_COPY_APPROVAL_REQUIRED', approvalErr.message, preflight);
    }

    await fs.copy(sourcePath, destinationPath, {
      overwrite: false,
      errorOnExist: true,
      preserveTimestamps: true
    });
    await auditService.log('FILE_TRANSFER', 'fs.copy', {
      sourcePath,
      destinationPath,
      sourceType: evidence.sourceType,
      operationId: approvalContext.operationId,
      targetHash: approvalContext.targetHash,
      approval: { nonceConsumed: true },
      result: { status: 'success' },
      user: req.user?.username
    }, 'WARNING');
    res.json({ success: true, message: 'Item copied successfully.', path: destinationPath });
  } catch (err) {
    if (approvalContext) {
      await auditService.log('FILE_TRANSFER', 'fs.copy', {
        operationId: approvalContext.operationId,
        targetHash: approvalContext.targetHash,
        approval: { nonceConsumed: true },
        result: { status: 'failure', code: err?.code || 'FS_COPY_FAILED' },
        user: req.user?.username
      }, 'ERROR');
    }
    sendFsError(res, err, 'FS_COPY_FAILED', 'Failed to copy item.');
  }
});

router.post('/move/preflight', async (req, res) => {
  try {
    const { evidence, sourcePath, targetId, targetHash } = await buildFsCopyMoveEvidence(req, 'move');
    const preflight = await createFsApprovalPreflight(req, {
      action: 'fs.move',
      target: {
        type: evidence.sourceType,
        id: targetId,
        label: `${path.basename(sourcePath)} -> ${path.basename(evidence.destinationPath)}`
      },
      targetHash,
      evidence,
      impact: evidence.sourceType === 'directory'
        ? 'Moves this directory and its contents to the destination.'
        : 'Moves this file to the destination.',
      recoverability: 'recoverable by moving it back if the destination remains available',
      typedConfirmation: path.basename(sourcePath)
    });
    return res.json({ success: true, preflight });
  } catch (err) {
    return sendFsError(res, err, 'FS_MOVE_PREFLIGHT_FAILED', 'Failed to prepare move approval.');
  }
});

router.post('/move/approve', async (req, res) => {
  try {
    const { targetId } = await buildFsCopyMoveEvidence(req, 'move');
    const approval = await approveFsOperation(req, {
      action: 'fs.move',
      targetId
    });
    return res.json({ success: true, approval });
  } catch (err) {
    await auditService.log('FILE_TRANSFER', 'fs.move.approval_rejected', {
      operationId: req.body?.operationId || null,
      approvalCode: err?.code || null,
      user: req.user?.username
    }, 'WARNING');
    return sendFsError(res, createFsHttpError(400, 'FS_MOVE_APPROVAL_INVALID', err.message), 'FS_MOVE_APPROVAL_INVALID', 'Move approval is invalid.');
  }
});

router.post('/move', async (req, res) => {
  let approvalContext = null;
  try {
    const { evidence, sourcePath, destinationPath, targetId, targetHash } = await buildFsCopyMoveEvidence(req, 'move');
    try {
      approvalContext = consumeFsApproval(req, {
        action: 'fs.move',
        targetId,
        targetHash
      });
    } catch (approvalErr) {
      const preflight = await createFsApprovalPreflight(req, {
        action: 'fs.move',
        target: {
          type: evidence.sourceType,
          id: targetId,
          label: `${path.basename(sourcePath)} -> ${path.basename(destinationPath)}`
        },
        targetHash,
        evidence,
        impact: evidence.sourceType === 'directory'
          ? 'Moves this directory and its contents to the destination.'
          : 'Moves this file to the destination.',
        recoverability: 'recoverable by moving it back if the destination remains available',
        typedConfirmation: path.basename(sourcePath)
      });
      await auditService.log('FILE_TRANSFER', 'fs.move.approval_rejected', {
        approvalCode: approvalErr?.code || null,
        operationId: req.body?.approval?.operationId || null,
        sourcePath,
        destinationPath,
        user: req.user?.username
      }, 'WARNING');
      return sendApprovalRequired(res, 'FS_MOVE_APPROVAL_REQUIRED', approvalErr.message, preflight);
    }

    await fs.move(sourcePath, destinationPath, {
      overwrite: false
    });
    await auditService.log('FILE_TRANSFER', 'fs.move', {
      sourcePath,
      destinationPath,
      sourceType: evidence.sourceType,
      operationId: approvalContext.operationId,
      targetHash: approvalContext.targetHash,
      approval: { nonceConsumed: true },
      result: { status: 'success' },
      user: req.user?.username
    }, 'WARNING');
    res.json({ success: true, message: 'Item moved successfully.', path: destinationPath });
  } catch (err) {
    if (approvalContext) {
      await auditService.log('FILE_TRANSFER', 'fs.move', {
        operationId: approvalContext.operationId,
        targetHash: approvalContext.targetHash,
        approval: { nonceConsumed: true },
        result: { status: 'failure', code: err?.code || 'FS_MOVE_FAILED' },
        user: req.user?.username
      }, 'ERROR');
    }
    sendFsError(res, err, 'FS_MOVE_FAILED', 'Failed to move item.');
  }
});

/**
 * POST /api/fs/create-dir
 * Create a new directory
 */
router.post('/create-dir', async (req, res) => {
  try {
    const targetPath = requireSafePath(req);

    if (await fs.pathExists(targetPath)) {
      throw createFsHttpError(409, 'FS_CONFLICT', 'A file or directory already exists at this location.');
    }

    await fs.ensureDir(targetPath);
    await auditService.log('FILE_TRANSFER', 'Create Directory', { path: targetPath, user: req.user?.username }, 'INFO');
    res.json({ success: true, message: 'Directory created successfully.' });
  } catch (err) {
    sendFsError(res, err, 'FS_CREATE_DIR_FAILED', 'Failed to create directory.');
  }
});

/**
 * PUT /api/fs/rename
 * Rename a file or directory
 */
router.put('/rename', async (req, res) => {
  try {
    const { oldPath, newName } = req.body;
    if (!oldPath || !newName) {
      throw createFsHttpError(400, 'FS_RENAME_PARAMS_INVALID', 'oldPath and newName are required.');
    }

    const resolvedOld = resolveSafePath(oldPath);
    const { allowedRoots } = await serverConfig.getPaths();
    const isAllowed = isWithinAllowedRoots(resolvedOld, allowedRoots);
    if (!isAllowed) {
      throw createFsHttpError(403, 'FS_PERMISSION_DENIED', 'Access to this path is restricted.');
    }
    await assertWithinAllowedRealRoots(resolvedOld, allowedRoots);

    if (!isSafeLeafName(newName)) {
      throw createFsHttpError(400, 'FS_INVALID_NAME', 'Invalid file name.');
    }

    const newPath = path.join(path.dirname(resolvedOld), newName);
    await assertWithinAllowedRealRoots(newPath, allowedRoots);
    if (await fs.pathExists(newPath)) {
      throw createFsHttpError(409, 'FS_CONFLICT', 'A file or directory with the target name already exists.');
    }
    await fs.rename(resolvedOld, newPath);
    await auditService.log('FILE_TRANSFER', 'Rename Item', { oldPath: resolvedOld, newPath, user: req.user?.username }, 'INFO');
    res.json({ success: true, message: 'Renamed successfully.' });
  } catch (err) {
    sendFsError(res, err, 'FS_RENAME_FAILED', 'Failed to rename item.');
  }
});

/**
 * GET /api/fs/archive-list
 * List contents of a ZIP archive
 */
router.get('/archive-list', async (req, res) => {
  try {
    const AdmZip = require('adm-zip');
    const targetPath = requireSafePath(req);
    
    const stats = await fs.stat(targetPath);
    if (stats.isDirectory()) {
      throw createFsHttpError(400, 'FS_ARCHIVE_INVALID', 'Not an archive file.');
    }

    const zip = new AdmZip(targetPath);
    const zipEntries = zip.getEntries();
    
    const items = zipEntries.map(e => ({
      name: e.entryName,
      isDirectory: e.isDirectory,
      size: e.header.size
    }));
    
    res.json({ path: targetPath, items });
  } catch (err) {
    sendFsError(res, err, 'FS_ARCHIVE_READ_FAILED', 'Failed to read archive.');
  }
});

/**
 * POST /api/fs/extract
 * Extract a ZIP archive to a destination
 */
router.post('/extract/preflight', async (req, res) => {
  try {
    const sourcePath = requireSafePath(req);
    const { destPath } = req.body || {};
    const { evidence, targetHash } = await buildExtractTargetEvidence(sourcePath, destPath);
    const preflight = await createFsApprovalPreflight(req, {
      action: 'fs.extract',
      target: {
        type: 'archive',
        id: `${sourcePath} -> ${evidence.destPath}`,
        label: path.basename(sourcePath)
      },
      targetHash,
      evidence,
      impact: evidence.overwriteRequired
        ? `Extracts ${evidence.entryCount} ZIP item(s) and overwrites ${evidence.conflicts.length} existing item(s).`
        : `Extracts ${evidence.entryCount} ZIP item(s).`,
      recoverability: evidence.overwriteRequired
        ? 'overwritten files are recoverable only from backup'
        : 'creates files in the destination folder',
      typedConfirmation: path.basename(sourcePath)
    });
    return res.json({ success: true, preflight });
  } catch (err) {
    return sendFsError(res, err, 'FS_ARCHIVE_EXTRACT_PREFLIGHT_FAILED', 'Failed to prepare archive extraction approval.');
  }
});

router.post('/extract/approve', async (req, res) => {
  try {
    const sourcePath = requireSafePath(req);
    const { destPath } = req.body || {};
    const { evidence } = await buildExtractTargetEvidence(sourcePath, destPath);
    const approval = await approveFsOperation(req, {
      action: 'fs.extract',
      targetId: `${sourcePath} -> ${evidence.destPath}`
    });
    return res.json({ success: true, approval });
  } catch (err) {
    await auditService.log('FILE_TRANSFER', 'fs.extract.approval_rejected', {
      operationId: req.body?.operationId || null,
      approvalCode: err?.code || null,
      path: req.body?.path || null,
      user: req.user?.username
    }, 'WARNING');
    return sendFsError(res, createFsHttpError(400, 'FS_ARCHIVE_EXTRACT_APPROVAL_INVALID', err.message), 'FS_ARCHIVE_EXTRACT_APPROVAL_INVALID', 'Archive extraction approval is invalid.');
  }
});

router.post('/extract', async (req, res) => {
  let approvalContext = null;
  try {
    const AdmZip = require('adm-zip');
    const sourcePath = requireSafePath(req);
    const { destPath } = req.body || {};
    const { evidence, targetHash } = await buildExtractTargetEvidence(sourcePath, destPath);
    try {
      approvalContext = consumeFsApproval(req, {
        action: 'fs.extract',
        targetId: `${sourcePath} -> ${evidence.destPath}`,
        targetHash
      });
    } catch (approvalErr) {
      const preflight = await createFsApprovalPreflight(req, {
        action: 'fs.extract',
        target: {
          type: 'archive',
          id: `${sourcePath} -> ${evidence.destPath}`,
          label: path.basename(sourcePath)
        },
        targetHash,
        evidence,
        impact: evidence.overwriteRequired
          ? `Extracts ${evidence.entryCount} ZIP item(s) and overwrites ${evidence.conflicts.length} existing item(s).`
          : `Extracts ${evidence.entryCount} ZIP item(s).`,
        recoverability: evidence.overwriteRequired
          ? 'overwritten files are recoverable only from backup'
          : 'creates files in the destination folder',
        typedConfirmation: path.basename(sourcePath)
      });
      await auditService.log('FILE_TRANSFER', 'fs.extract.approval_rejected', {
        approvalCode: approvalErr?.code || null,
        operationId: req.body?.approval?.operationId || null,
        path: sourcePath,
        destPath: evidence.destPath,
        user: req.user?.username
      }, 'WARNING');
      return sendApprovalRequired(res, 'FS_ARCHIVE_EXTRACT_APPROVAL_REQUIRED', approvalErr.message, preflight);
    }

    const zip = new AdmZip(sourcePath);
    zip.extractAllTo(evidence.destPath, evidence.overwriteRequired);
    await auditService.log('FILE_TRANSFER', 'fs.extract', {
      path: sourcePath,
      destPath: evidence.destPath,
      conflicts: evidence.conflicts,
      operationId: approvalContext.operationId,
      targetHash: approvalContext.targetHash,
      approval: { nonceConsumed: true },
      result: { status: 'success' },
      user: req.user?.username
    }, 'WARNING');
    return res.json({ success: true, message: 'Extracted successfully.' });
  } catch (err) {
    if (approvalContext) {
      await auditService.log('FILE_TRANSFER', 'fs.extract', {
        operationId: approvalContext.operationId,
        targetHash: approvalContext.targetHash,
        approval: { nonceConsumed: true },
        result: { status: 'failure', code: err?.code || 'FS_ARCHIVE_EXTRACT_FAILED' },
        user: req.user?.username
      }, 'ERROR');
    }
    sendFsError(res, err, 'FS_ARCHIVE_EXTRACT_FAILED', 'Failed to extract archive.');
  }
});

const upload = multer({ dest: path.join(__dirname, '../storage/tmp/') });

/**
 * POST /api/fs/upload-chunk
 * Handle multipart chunked file upload
 * Body should have: path (target directory valid for pathGuard), uploadId, chunkIndex, totalChunks, fileName
 */
router.post('/upload-chunk', upload.single('chunk'), async (req, res) => {
  try {
    const { uploadId, chunkIndex, totalChunks, fileName } = req.body;
    const targetDir = requireSafePath(req);
    
    if (!req.file || !uploadId || chunkIndex === undefined || !totalChunks || !fileName) {
      if (req.file) await fs.remove(req.file.path);
      throw createFsHttpError(400, 'FS_UPLOAD_PARAMS_INVALID', 'Missing upload parameters.');
    }

    if (!isSafeLeafName(fileName)) {
      if (req.file) await fs.remove(req.file.path);
      throw createFsHttpError(400, 'FS_INVALID_NAME', 'Invalid file name.');
    }

    const parsedChunkIndex = Number(chunkIndex);
    const parsedTotalChunks = Number(totalChunks);
    if (!Number.isInteger(parsedChunkIndex) || !Number.isInteger(parsedTotalChunks) || parsedChunkIndex < 0 || parsedTotalChunks < 1 || parsedChunkIndex >= parsedTotalChunks) {
      if (req.file) await fs.remove(req.file.path);
      throw createFsHttpError(400, 'FS_UPLOAD_PARAMS_INVALID', 'Invalid chunk metadata.');
    }

    const chunkDir = path.join(__dirname, '../storage/tmp', uploadId);
    await fs.ensureDir(chunkDir);
    
    // Move uploaded chunk to uploadId folder named by chunkIndex
    await fs.move(req.file.path, path.join(chunkDir, chunkIndex), { overwrite: true });

    // Merge if last chunk
    if (parsedChunkIndex === parsedTotalChunks - 1) {
       const finalPath = path.join(targetDir, fileName);

       if (await fs.pathExists(finalPath)) {
         await fs.remove(chunkDir);
         throw createFsHttpError(409, 'FS_CONFLICT', 'A file with the same name already exists.');
       }

       const outStream = fs.createWriteStream(finalPath);
       
       for (let i = 0; i < parsedTotalChunks; i++) {
         const cp = path.join(chunkDir, i.toString());
         const data = await fs.readFile(cp);
         outStream.write(data);
       }
       outStream.end();
       
       await new Promise((resolve, reject) => {
         outStream.on('finish', resolve);
         outStream.on('error', reject);
       });
       
       await fs.remove(chunkDir);
       await auditService.log('FILE_TRANSFER', 'Upload File', { path: finalPath, user: req.user?.username }, 'INFO');
       return res.json({ success: true, complete: true });
    }
    
    res.json({ success: true, complete: false });
  } catch (err) {
    if (req.file) await fs.remove(req.file.path);
    sendFsError(res, err, 'FS_UPLOAD_FAILED', 'File upload failed.');
  }
});

module.exports = router;
