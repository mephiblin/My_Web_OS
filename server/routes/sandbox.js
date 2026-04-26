const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

const auth = require('../middleware/auth');
const auditService = require('../services/auditService');
const packageRegistryService = require('../services/packageRegistryService');
const fileGrantService = require('../services/fileGrantService');
const fileTicketService = require('../services/fileTicketService');
const operationApprovalService = require('../services/operationApprovalService');
const serverConfig = require('../config/serverConfig');
const { CAPABILITY_CATALOG } = require('../services/capabilityCatalog');
const appPaths = require('../utils/appPaths');
const {
  resolveSafePath,
  isWithinAllowedRoots,
  isProtectedSystemPath,
  assertWithinAllowedRealRoots
} = require('../utils/pathPolicy');

const router = express.Router();
const SANDBOX_SDK_FILE = path.join(__dirname, '../static/webos-sandbox-sdk.js');

const CAPABILITY_BY_ID = new Map(CAPABILITY_CATALOG.map((item) => [item.id, item]));

function buildAppCapabilityMap(app) {
  const declared = Array.isArray(app?.permissions) ? app.permissions : [];
  return CAPABILITY_CATALOG.map((item) => ({
    ...item,
    declared: declared.includes(item.id)
  }));
}

async function ensurePermittedSandboxApp(res, appId, permission) {
  try {
    const app = await packageRegistryService.getSandboxApp(appId);
    if (!app) {
      res.status(404).json({
        error: true,
        code: 'APP_NOT_FOUND',
        message: 'Sandbox app not found.'
      });
      return null;
    }

    if (!app.permissions.includes(permission)) {
      const capability = CAPABILITY_BY_ID.get(permission) || null;
      auditService.log(
        'SANDBOX',
        `Sandbox permission denied: ${app.id}`,
        {
          appId: app.id,
          requiredPermission: permission,
          declaredPermissions: Array.isArray(app.permissions) ? app.permissions : [],
          capabilityRisk: capability?.risk || 'unknown'
        },
        'WARNING'
      ).catch(() => {});

      res.status(403).json({
        error: true,
        code: 'APP_PERMISSION_DENIED',
        message: `Sandbox app is not allowed to use "${permission}".`,
        permission,
        declaredPermissions: Array.isArray(app.permissions) ? app.permissions : [],
        capability: capability
          ? {
              id: capability.id,
              category: capability.category,
              risk: capability.risk,
              summary: capability.summary
            }
          : null
      });
      return null;
    }

    return app;
  } catch (err) {
    res.status(400).json({
      error: true,
      code: err.code || 'APP_ID_INVALID',
      message: err.message
    });
    return null;
  }
}

async function readJsonBody(req) {
  return req.body && typeof req.body === 'object' ? req.body : {};
}

async function resolveAllowedHostPath(rawPath) {
  const pathValue = String(rawPath || '').trim();
  if (!pathValue) {
    const err = new Error('path is required.');
    err.code = 'SANDBOX_FILE_PATH_REQUIRED';
    throw err;
  }

  let resolvedPath;
  try {
    resolvedPath = resolveSafePath(pathValue);
  } catch (err) {
    const wrapped = new Error(err.message || 'Invalid host path.');
    wrapped.code = 'FS_INVALID_PATH';
    throw wrapped;
  }

  const { allowedRoots, inventoryRoot } = await serverConfig.getPaths();
  if (!isWithinAllowedRoots(resolvedPath, allowedRoots)) {
    const err = new Error('Access to this path is restricted.');
    err.code = 'FS_PERMISSION_DENIED';
    throw err;
  }

  if (isProtectedSystemPath(resolvedPath, [inventoryRoot])) {
    const err = new Error('System inventory is protected from direct host path access.');
    err.code = 'FS_SYSTEM_PROTECTED';
    throw err;
  }

  await assertWithinAllowedRealRoots(resolvedPath, allowedRoots);

  return resolvedPath;
}

function hashJson(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function buildSandboxFileTargetEvidence(appId, targetPath) {
  const stats = await fs.lstat(targetPath);
  const realPath = await fs.realpath(targetPath).catch(() => targetPath);
  const evidence = {
    appId,
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
    targetHash: hashJson({ scope: 'sandbox.file.write.overwrite.v1', evidence })
  };
}

function sandboxWriteTargetId(appId, targetPath) {
  return `${appId}:${targetPath}`;
}

function getApprovalInput(body = {}) {
  return body.approval && typeof body.approval === 'object' && !Array.isArray(body.approval)
    ? body.approval
    : {};
}

async function createSandboxWritePreflight(req, { app, targetPath }) {
  const { evidence, targetHash } = await buildSandboxFileTargetEvidence(app.id, targetPath);
  const targetId = sandboxWriteTargetId(app.id, targetPath);
  const operation = operationApprovalService.createOperation({
    action: 'sandbox.file.write.overwrite',
    userId: req.user?.username,
    target: {
      type: evidence.type,
      id: targetId,
      label: path.basename(targetPath)
    },
    targetHash,
    typedConfirmation: path.basename(targetPath),
    metadata: {
      impact: 'Sandbox app overwrites the current host file contents.',
      recoverability: 'recoverable only from external backup or previous app state',
      evidence,
      appId: app.id,
      riskLevel: 'high'
    }
  });

  await auditService.log('SANDBOX', 'sandbox.file.write.overwrite.preflight', {
    operationId: operation.operationId,
    appId: app.id,
    path: targetPath,
    targetHash,
    expiresAt: operation.expiresAt,
    user: req.user?.username
  }, 'WARNING');

  return {
    action: 'sandbox.file.write.overwrite',
    operationId: operation.operationId,
    target: operation.target,
    targetHash,
    impact: operation.metadata.impact,
    recoverability: operation.metadata.recoverability,
    evidence,
    expiresAt: operation.expiresAt,
    approval: {
      required: true,
      typedConfirmation: path.basename(targetPath)
    }
  };
}

function consumeSandboxWriteApproval(req, { app, targetPath, targetHash }) {
  const approval = getApprovalInput(req.body);
  if (!String(approval.operationId || '').trim() || !String(approval.nonce || '').trim()) {
    const err = new Error('Sandbox overwrite requires a scoped approval nonce.');
    err.code = 'SANDBOX_FILE_WRITE_APPROVAL_REQUIRED';
    throw err;
  }
  return operationApprovalService.consumeApproval({
    operationId: approval.operationId,
    nonce: approval.nonce,
    userId: req.user?.username,
    action: 'sandbox.file.write.overwrite',
    targetId: sandboxWriteTargetId(app.id, targetPath),
    targetHash
  });
}

router.get('/sdk.js', async (_req, res) => {
  try {
    if (!(await fs.pathExists(SANDBOX_SDK_FILE))) {
      return res.status(404).send('Sandbox SDK not found.');
    }
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(SANDBOX_SDK_FILE);
  } catch (err) {
    return res.status(500).send(err.message || 'Failed to load sandbox SDK.');
  }
});

router.post('/:appId/data/list', auth, async (req, res) => {
  const app = await ensurePermittedSandboxApp(res, req.params.appId, 'app.data.list');
  if (!app) return;

  try {
    const body = await readJsonBody(req);
    const targetDir = await appPaths.resolveAppDataPath(req.params.appId, body.path || '');
    await fs.ensureDir(targetDir);

    const entries = await fs.readdir(targetDir, { withFileTypes: true });
    res.json({
      success: true,
      result: entries.map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file'
      }))
    });
  } catch (err) {
    const status = err.code === 'APP_PATH_OUTSIDE_ROOT' ? 400 : 500;
    res.status(status).json({ error: true, message: err.message, code: err.code || 'SANDBOX_LIST_FAILED' });
  }
});

router.get('/:appId/capabilities', auth, async (req, res) => {
  try {
    const app = await packageRegistryService.getSandboxApp(req.params.appId);
    if (!app) {
      return res.status(404).json({
        error: true,
        code: 'APP_NOT_FOUND',
        message: 'Sandbox app not found.'
      });
    }

    return res.json({
      success: true,
      appId: app.id,
      declaredPermissions: Array.isArray(app.permissions) ? app.permissions : [],
      capabilities: buildAppCapabilityMap(app)
    });
  } catch (err) {
    return res.status(500).json({
      error: true,
      code: err.code || 'SANDBOX_CAPABILITIES_FETCH_FAILED',
      message: err.message
    });
  }
});

router.post('/:appId/data/read', auth, async (req, res) => {
  const app = await ensurePermittedSandboxApp(res, req.params.appId, 'app.data.read');
  if (!app) return;

  try {
    const body = await readJsonBody(req);
    const targetFile = await appPaths.resolveAppDataPath(req.params.appId, body.path || '');
    const exists = await fs.pathExists(targetFile);

    if (!exists) {
      return res.status(404).json({
        error: true,
        code: 'APP_DATA_NOT_FOUND',
        message: 'App data file not found.'
      });
    }

    const stats = await fs.stat(targetFile);
    if (!stats.isFile()) {
      return res.status(400).json({
        error: true,
        code: 'APP_DATA_NOT_FILE',
        message: 'Requested path is not a file.'
      });
    }

    const content = await fs.readFile(targetFile, 'utf8');
    return res.json({
      success: true,
      result: {
        path: body.path || '',
        content
      }
    });
  } catch (err) {
    const status = err.code === 'APP_PATH_OUTSIDE_ROOT' ? 400 : 500;
    return res.status(status).json({ error: true, message: err.message, code: err.code || 'SANDBOX_READ_FAILED' });
  }
});

router.post('/:appId/data/write', auth, async (req, res) => {
  const app = await ensurePermittedSandboxApp(res, req.params.appId, 'app.data.write');
  if (!app) return;

  try {
    const body = await readJsonBody(req);
    const targetFile = await appPaths.resolveAppDataPath(req.params.appId, body.path || '');
    await fs.ensureDir(path.dirname(targetFile));
    await fs.writeFile(targetFile, String(body.content || ''), 'utf8');

    await auditService.log(
      'SANDBOX',
      `Write App Data: ${app.id}`,
      { appId: app.id, path: body.path || '', user: req.user?.username },
      'INFO'
    );

    return res.json({
      success: true,
      result: {
        path: body.path || ''
      }
    });
  } catch (err) {
    const status = err.code === 'APP_PATH_OUTSIDE_ROOT' ? 400 : 500;
    return res.status(status).json({ error: true, message: err.message, code: err.code || 'SANDBOX_WRITE_FAILED' });
  }
});

router.post('/:appId/file/read', auth, async (req, res) => {
  const app = await ensurePermittedSandboxApp(res, req.params.appId, 'host.file.read');
  if (!app) return;

  try {
    const body = await readJsonBody(req);
    const targetPath = await resolveAllowedHostPath(body.path);
    fileGrantService.consumeGrant(body.grantId, {
      path: targetPath,
      requiredMode: 'read',
      appId: app.id,
      user: req.user?.username
    });

    const stats = await fs.stat(targetPath);
    if (!stats.isFile()) {
      return res.status(400).json({
        error: true,
        code: 'FS_NOT_FILE',
        message: 'Requested path is not a file.'
      });
    }

    const content = await fs.readFile(targetPath, 'utf8');
    return res.json({
      success: true,
      result: {
        path: targetPath,
        content
      }
    });
  } catch (err) {
    const status = err.code?.startsWith('FS_') || err.code === 'SANDBOX_FILE_PATH_REQUIRED' ? 400 : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'SANDBOX_FILE_READ_FAILED',
      message: err.message
    });
  }
});

router.post('/:appId/file/write/preflight', auth, async (req, res) => {
  const app = await ensurePermittedSandboxApp(res, req.params.appId, 'host.file.write');
  if (!app) return;

  try {
    const body = await readJsonBody(req);
    const targetPath = await resolveAllowedHostPath(body.path);
    fileGrantService.consumeGrant(body.grantId, {
      path: targetPath,
      requiredMode: 'readwrite',
      appId: app.id,
      user: req.user?.username
    });

    const exists = await fs.pathExists(targetPath);
    if (!exists) {
      return res.status(400).json({
        error: true,
        code: 'SANDBOX_FILE_WRITE_APPROVAL_NOT_REQUIRED',
        message: 'Overwrite approval is only required for an existing file.'
      });
    }

    const preflight = await createSandboxWritePreflight(req, { app, targetPath });
    return res.json({ success: true, preflight });
  } catch (err) {
    const status = err.code?.startsWith('FS_') || err.code === 'SANDBOX_FILE_PATH_REQUIRED' ? 400 : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'SANDBOX_FILE_WRITE_PREFLIGHT_FAILED',
      message: err.message,
      details: err.details || null
    });
  }
});

router.post('/:appId/file/write/approve', auth, async (req, res) => {
  const app = await ensurePermittedSandboxApp(res, req.params.appId, 'host.file.write');
  if (!app) return;

  try {
    const body = await readJsonBody(req);
    const targetPath = await resolveAllowedHostPath(body.path);
    const approval = operationApprovalService.approveOperation({
      operationId: body.operationId,
      userId: req.user?.username,
      action: 'sandbox.file.write.overwrite',
      targetId: sandboxWriteTargetId(app.id, targetPath),
      typedConfirmation: body.typedConfirmation
    });

    await auditService.log('SANDBOX', 'sandbox.file.write.overwrite.approved', {
      operationId: approval.operationId,
      appId: app.id,
      path: targetPath,
      expiresAt: approval.expiresAt,
      user: req.user?.username
    }, 'WARNING');

    return res.json({ success: true, approval });
  } catch (err) {
    await auditService.log('SANDBOX', 'sandbox.file.write.overwrite.approval_rejected', {
      operationId: req.body?.operationId || null,
      appId: req.params.appId,
      approvalCode: err?.code || null,
      user: req.user?.username
    }, 'WARNING');
    return res.status(400).json({
      error: true,
      code: 'SANDBOX_FILE_WRITE_APPROVAL_INVALID',
      message: err.message
    });
  }
});

router.post('/:appId/file/raw-ticket', auth, async (req, res) => {
  const app = await ensurePermittedSandboxApp(res, req.params.appId, 'host.file.read');
  if (!app) return;

  try {
    const body = await readJsonBody(req);
    const targetPath = await resolveAllowedHostPath(body.path);
    fileGrantService.consumeGrant(body.grantId, {
      path: targetPath,
      requiredMode: 'read',
      appId: app.id,
      user: req.user?.username
    });

    const stats = await fs.stat(targetPath);
    if (!stats.isFile()) {
      return res.status(400).json({
        error: true,
        code: 'FS_NOT_FILE',
        message: 'Requested path is not a file.'
      });
    }

    const profile = String(body.profile || body.purpose || fileTicketService.PROFILE_PREVIEW).trim().toLowerCase();
    const ticket = fileTicketService.createTicket({
      scope: 'fs.raw',
      profile,
      user: req.user?.username,
      appId: app.id,
      path: targetPath,
      stats,
      ttlMs: body.ttlMs,
      absoluteTtlMs: body.absoluteTtlMs,
      idleTimeoutMs: body.idleTimeoutMs,
      metadata: {
        source: 'sandbox.raw-ticket'
      }
    });

    await auditService.log(
      'SANDBOX',
      `Issue Host Raw Ticket via Grant: ${app.id}`,
      {
        appId: app.id,
        path: targetPath,
        scope: ticket.scope,
        profile: ticket.profile,
        expiresAt: new Date(ticket.expiresAt).toISOString(),
        user: req.user?.username
      },
      'INFO'
    );

    return res.status(201).json({
      success: true,
      result: {
        url: `/api/fs/raw?ticket=${encodeURIComponent(ticket.ticket)}`,
        scope: ticket.scope,
        profile: ticket.profile,
        path: targetPath,
        appId: app.id,
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
      }
    });
  } catch (err) {
    const status = err.code?.startsWith('FS_') || err.code === 'SANDBOX_FILE_PATH_REQUIRED' ? 400 : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'SANDBOX_FILE_RAW_TICKET_FAILED',
      message: err.message,
      details: err.details || null
    });
  }
});

router.post('/:appId/file/write', auth, async (req, res) => {
  const app = await ensurePermittedSandboxApp(res, req.params.appId, 'host.file.write');
  if (!app) return;

  try {
    const body = await readJsonBody(req);
    const targetPath = await resolveAllowedHostPath(body.path);
    fileGrantService.consumeGrant(body.grantId, {
      path: targetPath,
      requiredMode: 'readwrite',
      appId: app.id,
      user: req.user?.username
    });

    const content = String(body.content || '');
    const overwrite = body.overwrite === true;
    const approval = body.approval && typeof body.approval === 'object' ? body.approval : {};
    let approvalContext = null;
    const exists = await fs.pathExists(targetPath);

    if (exists && !overwrite) {
      return res.status(409).json({
        error: true,
        code: 'FS_WRITE_OVERWRITE_APPROVAL_REQUIRED',
        message: 'Overwrite requires explicit approval for sandbox addon file writes.',
        details: {
          path: targetPath,
          requiresApproval: true
        }
      });
    }
    if (exists && overwrite) {
      const { targetHash } = await buildSandboxFileTargetEvidence(app.id, targetPath);
      try {
        approvalContext = consumeSandboxWriteApproval(req, { app, targetPath, targetHash });
      } catch (approvalErr) {
        if (approval.approved === true) {
          await auditService.log('SANDBOX', 'sandbox.file.write.overwrite.legacy_approval_rejected', {
            appId: app.id,
            path: targetPath,
            approvalCode: approvalErr?.code || null,
            user: req.user?.username
          }, 'WARNING');
        }
        const preflight = await createSandboxWritePreflight(req, { app, targetPath });
        return res.status(428).json({
          error: true,
          code: 'SANDBOX_FILE_WRITE_APPROVAL_REQUIRED',
          message: approvalErr.message || 'Sandbox overwrite approval is required.',
          preflight
        });
      }
    }

    await fs.writeFile(targetPath, content, 'utf8');
    await auditService.log(
      'SANDBOX',
      `Write Host File via Grant: ${app.id}`,
      {
        appId: app.id,
        path: targetPath,
        overwrite,
        approvalReceived: Boolean(approvalContext),
        operationId: approvalContext?.operationId || null,
        targetHash: approvalContext?.targetHash || null,
        user: req.user?.username
      },
      'INFO'
    );
    return res.json({
      success: true,
      result: {
        path: targetPath
      }
    });
  } catch (err) {
    const status = err.code?.startsWith('FS_') || err.code === 'SANDBOX_FILE_PATH_REQUIRED' ? 400 : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'SANDBOX_FILE_WRITE_FAILED',
      message: err.message
    });
  }
});

router.get('/:appId/file/raw', async (_req, res) => {
  return res.status(410).json({
    error: true,
    code: 'SANDBOX_RAW_GRANT_URL_DISABLED',
    message: 'Sandbox raw grant URLs are disabled. Request a raw ticket and use WebOS.files.rawUrl({ url }).',
    details: {
      replacement: 'POST /api/sandbox/:appId/file/raw-ticket'
    }
  });
});

router.get('/:appId/manifest', async (req, res) => {
  try {
    const app = await packageRegistryService.getSandboxApp(req.params.appId);
    if (!app) {
      return res.status(404).json({
        error: true,
        code: 'APP_NOT_FOUND',
        message: 'Sandbox app not found.'
      });
    }

    return res.json({
      success: true,
      app
    });
  } catch (err) {
    return res.status(500).json({ error: true, message: err.message });
  }
});

router.use('/:appId', async (req, res) => {
  try {
    const app = await packageRegistryService.getSandboxApp(req.params.appId);
    if (!app) {
      return res.status(404).send('Sandbox app not found.');
    }

    const requestedPath = req.path === '/' ? app.entry : req.path.replace(/^[/\\]+/, '');
    if (requestedPath === 'manifest.json' || requestedPath.endsWith('/manifest.json')) {
      return res.status(403).send('Sandbox package manifest is not served as a static asset.');
    }

    const absolutePath = await appPaths.resolveAppAssetPath(req.params.appId, requestedPath);
    const exists = await fs.pathExists(absolutePath);

    if (!exists) {
      return res.status(404).send('Sandbox asset not found.');
    }

    const stats = await fs.stat(absolutePath);
    if (!stats.isFile()) {
      return res.status(404).send('Sandbox asset not found.');
    }

    return res.sendFile(absolutePath);
  } catch (err) {
    const status = err.code === 'APP_PATH_OUTSIDE_ROOT' ? 400 : 500;
    return res.status(status).send(err.message);
  }
});

module.exports = router;
