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
const MAX_SERVICE_REQUEST_PATH_LENGTH = 2048;
const MAX_SERVICE_HEADER_VALUE_LENGTH = 8192;
const MAX_SERVICE_REQUEST_BODY_BYTES = 1024 * 1024;

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

function normalizeServiceRequestPath(value) {
  const requestPath = String(value || '').trim();
  if (requestPath.length > MAX_SERVICE_REQUEST_PATH_LENGTH) {
    const err = new Error('Service request path is too long.');
    err.code = 'SANDBOX_SERVICE_PATH_INVALID';
    throw err;
  }
  if (!requestPath || !requestPath.startsWith('/')) {
    const err = new Error('Service request path must start with "/".');
    err.code = 'SANDBOX_SERVICE_PATH_INVALID';
    throw err;
  }
  if (/[\u0000-\u001f\u007f]/.test(requestPath)) {
    const err = new Error('Service request path cannot contain control characters.');
    err.code = 'SANDBOX_SERVICE_PATH_INVALID';
    throw err;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(requestPath) || requestPath.startsWith('//') || requestPath.includes('\\')) {
    const err = new Error('Service request path must be relative to the package service.');
    err.code = 'SANDBOX_SERVICE_PATH_INVALID';
    throw err;
  }
  if (requestPath.includes('#') || /[\u0000-\u001f\u007f]/.test(requestPath)) {
    const err = new Error('Service request path contains unsupported characters.');
    err.code = 'SANDBOX_SERVICE_PATH_INVALID';
    throw err;
  }
  const pathname = requestPath.split('?')[0];
  let decodedPathname = pathname;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch (_err) {
    const err = new Error('Service request path contains invalid encoding.');
    err.code = 'SANDBOX_SERVICE_PATH_INVALID';
    throw err;
  }
  if (decodedPathname.split('/').some((segment) => segment === '..')) {
    const err = new Error('Service request path cannot contain parent traversal.');
    err.code = 'SANDBOX_SERVICE_PATH_INVALID';
    throw err;
  }
  return requestPath;
}

function normalizeServiceRequestMethod(value) {
  const method = String(value || 'GET').trim().toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const err = new Error('Service request method is not supported.');
    err.code = 'SANDBOX_SERVICE_METHOD_INVALID';
    throw err;
  }
  return method;
}

function normalizeServiceRequestHeaders(value) {
  const headers = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return headers;
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = String(rawKey || '').trim().toLowerCase();
    if (!key || ['host', 'connection', 'content-length', 'authorization', 'cookie', 'set-cookie'].includes(key)) continue;
    if (!['accept', 'content-type'].includes(key)) continue;
    const headerValue = String(rawValue || '');
    if (/[\r\n]/.test(headerValue) || headerValue.length > MAX_SERVICE_HEADER_VALUE_LENGTH) {
      const err = new Error('Service request header value is invalid.');
      err.code = 'SANDBOX_SERVICE_HEADER_INVALID';
      throw err;
    }
    headers[key] = headerValue;
  }
  return headers;
}

function assertServiceRequestBodySize(value) {
  const byteLength = Buffer.byteLength(String(value || ''), 'utf8');
  if (byteLength > MAX_SERVICE_REQUEST_BODY_BYTES) {
    const err = new Error('Service request body is too large.');
    err.code = 'SANDBOX_SERVICE_BODY_TOO_LARGE';
    err.details = {
      limitBytes: MAX_SERVICE_REQUEST_BODY_BYTES
    };
    throw err;
  }
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

router.post('/:appId/service/request', auth, async (req, res) => {
  const app = await ensurePermittedSandboxApp(res, req.params.appId, 'service.bridge');
  if (!app) return;

  try {
    const runtimeManager = req.app.get('runtimeManager');
    if (!runtimeManager || typeof runtimeManager.getServiceConnectionInfo !== 'function') {
      return res.status(503).json({
        error: true,
        code: 'RUNTIME_MANAGER_UNAVAILABLE',
        message: 'Runtime manager is not initialized.'
      });
    }

    const body = await readJsonBody(req);
    const method = normalizeServiceRequestMethod(body.method);
    const requestPath = normalizeServiceRequestPath(body.path);
    const service = await runtimeManager.getServiceConnectionInfo(app.id);
    const servicePort = Number(service.port);
    if (!Number.isInteger(servicePort) || servicePort <= 0 || servicePort > 65535) {
      return res.status(503).json({
        error: true,
        code: 'RUNTIME_SERVICE_PORT_INVALID',
        message: 'Package service port is invalid.'
      });
    }
    const target = new URL(requestPath, `http://127.0.0.1:${servicePort}`).toString();
    const headers = normalizeServiceRequestHeaders(body.headers);
    const hasBody = method !== 'GET' && method !== 'DELETE' && body.body !== undefined;
    let requestBody;
    if (hasBody) {
      if (typeof body.body === 'string') {
        requestBody = body.body;
      } else {
        requestBody = JSON.stringify(body.body == null ? {} : body.body);
        if (!headers['content-type']) headers['content-type'] = 'application/json';
      }
      assertServiceRequestBodySize(requestBody);
    }

    const response = await fetch(target, {
      method,
      headers,
      body: requestBody,
      signal: AbortSignal.timeout(runtimeManager.getServiceProxyTimeoutMs())
    });
    const text = await response.text();
    let result = text;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        result = text ? JSON.parse(text) : null;
      } catch (_err) {
        result = text;
      }
    }

    if (!response.ok) {
      return res.status(502).json({
        error: true,
        code: 'SANDBOX_SERVICE_REQUEST_FAILED',
        message: `Package service returned HTTP ${response.status}.`,
        details: {
          status: response.status,
          result
        }
      });
    }

    await auditService.log('SANDBOX', 'sandbox.service.request', {
      appId: app.id,
      method,
      path: requestPath,
      user: req.user?.username
    }, 'INFO');

    return res.json({
      success: true,
      result,
      service: {
        status: service.status,
        healthStatus: service.healthStatus
      }
    });
  } catch (err) {
    const status =
      err.code === 'APP_PERMISSION_DENIED' ? 403 :
      err.code === 'RUNTIME_SERVICE_UNAVAILABLE' || err.code === 'RUNTIME_SERVICE_PORT_MISSING' || err.code === 'RUNTIME_SERVICE_PORT_INVALID' ? 503 :
      err.code === 'RUNTIME_APP_NOT_FOUND' ? 404 :
      err.code?.startsWith('SANDBOX_SERVICE_') ? 400 :
      err.name === 'TimeoutError' ? 504 :
      500;
    return res.status(status).json({
      error: true,
      code: err.code || (err.name === 'TimeoutError' ? 'SANDBOX_SERVICE_TIMEOUT' : 'SANDBOX_SERVICE_REQUEST_FAILED'),
      message: err.message || 'Package service request failed.',
      details: err.details || null
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
