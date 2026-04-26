const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const jwt = require('jsonwebtoken');
const AdmZip = require('adm-zip');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';
process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';

const packagesRouter = require('../routes/packages');
const appPaths = require('../utils/appPaths');
const inventoryPaths = require('../utils/inventoryPaths');
const serverConfig = require('../config/serverConfig');
const packageLifecycleService = require('../services/packageLifecycleService');
const operationApprovalService = require('../services/operationApprovalService');

function signToken(username) {
  return jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.set('runtimeManager', {
    getRuntimeStatusMap: () => ({}),
    stopApp: async () => {},
    startApp: async () => {}
  });
  app.use('/api/packages', packagesRouter);

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  };
}

async function createZipServer(getZipBuffer) {
  const app = express();
  app.get('/package.zip', (_req, res) => {
    res.type('application/zip');
    res.send(getZipBuffer());
  });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  return {
    zipUrl: `http://127.0.0.1:${server.address().port}/package.zip`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  };
}

async function requestJson(baseUrl, endpoint, token, options = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_err) {
    json = { parseError: true, raw: text };
  }
  return { status: response.status, json };
}

async function requestMultipart(baseUrl, endpoint, token, fields = {}, zipBuffer) {
  const form = new FormData();
  form.set('package', new Blob([zipBuffer], { type: 'application/zip' }), 'package.zip');
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`
    },
    body: form
  });
  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_err) {
    json = { parseError: true, raw: text };
  }
  return { status: response.status, json };
}

function buildPackageZip(appId, version = '1.0.0') {
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify({
    id: appId,
    title: `Lifecycle ${appId}`,
    version,
    type: 'app',
    runtime: {
      type: 'sandbox-html',
      entry: 'index.html'
    },
    permissions: []
  }, null, 2)));
  zip.addFile('index.html', Buffer.from('<!doctype html><title>Lifecycle Test</title>'));
  return zip.toBuffer();
}

async function cleanupAppArtifacts(appId) {
  const roots = await inventoryPaths.ensureInventoryStructure();
  const appRoot = await appPaths.getAppRoot(appId).catch(() => null);
  if (appRoot) await fs.remove(appRoot).catch(() => {});
  const backupRoot = path.join(roots.systemDir, 'package-backups', appId);
  await fs.remove(backupRoot).catch(() => {});
  await packageLifecycleService.deleteLifecycle(appId).catch(() => {});
}

async function createPackage(baseUrl, token, appId) {
  return requestJson(baseUrl, '/api/packages', token, {
    method: 'POST',
    body: {
      id: appId,
      title: `Lifecycle ${appId}`,
      description: 'package lifecycle approval contract test package',
      version: '1.0.0',
      runtime: 'sandbox',
      entry: 'index.html'
    }
  });
}

async function approveLifecycle(baseUrl, token, preflight, typedConfirmation = preflight.approval.typedConfirmation) {
  return requestJson(baseUrl, '/api/packages/lifecycle/approve', token, {
    method: 'POST',
    body: {
      operationId: preflight.operationId,
      action: preflight.action,
      targetId: preflight.target.id,
      typedConfirmation
    }
  });
}

test('registry install requires consume-once backend approval', async () => {
  operationApprovalService._resetForTests();
  const server = await createServer();
  const appId = `it-reg-install-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let zipBuffer = buildPackageZip(appId, '1.0.0');
  const zipServer = await createZipServer(() => zipBuffer);
  const token = signToken(await serverConfig.get('auth.adminUsername').catch(() => 'admin'));

  try {
    const blocked = await requestJson(server.baseUrl, '/api/packages/registry/install', token, {
      method: 'POST',
      body: { zipUrl: zipServer.zipUrl }
    });
    assert.equal(blocked.status, 428, JSON.stringify(blocked.json));
    assert.equal(blocked.json?.code, 'PACKAGE_INSTALL_APPROVAL_REQUIRED', JSON.stringify(blocked.json));
    assert.equal(blocked.json?.preflight?.action, 'package.install', JSON.stringify(blocked.json));
    assert.ok(blocked.json?.preflight?.operationId, JSON.stringify(blocked.json));
    assert.ok(blocked.json?.preflight?.targetHash, JSON.stringify(blocked.json));

    const preflight = await requestJson(server.baseUrl, '/api/packages/registry/preflight', token, {
      method: 'POST',
      body: { zipUrl: zipServer.zipUrl }
    });
    assert.equal(preflight.status, 200, JSON.stringify(preflight.json));

    const wrongApproval = await approveLifecycle(server.baseUrl, token, preflight.json.preflight, 'wrong-confirmation');
    assert.equal(wrongApproval.status, 400, JSON.stringify(wrongApproval.json));
    assert.equal(wrongApproval.json?.code, 'PACKAGE_LIFECYCLE_APPROVAL_INVALID', JSON.stringify(wrongApproval.json));
    assert.equal(wrongApproval.json?.approval?.nonce, undefined, JSON.stringify(wrongApproval.json));

    const approval = await approveLifecycle(server.baseUrl, token, preflight.json.preflight);
    assert.equal(approval.status, 200, JSON.stringify(approval.json));

    const installed = await requestJson(server.baseUrl, '/api/packages/registry/install', token, {
      method: 'POST',
      body: {
        zipUrl: zipServer.zipUrl,
        approval: {
          operationId: approval.json.approval.operationId,
          nonce: approval.json.approval.nonce,
          targetHash: preflight.json.preflight.targetHash
        }
      }
    });
    assert.equal(installed.status, 201, JSON.stringify(installed.json));
    assert.equal(installed.json?.package?.id, appId, JSON.stringify(installed.json));

    const replay = await requestJson(server.baseUrl, '/api/packages/registry/install', token, {
      method: 'POST',
      body: {
        zipUrl: zipServer.zipUrl,
        overwrite: true,
        approval: {
          operationId: approval.json.approval.operationId,
          nonce: approval.json.approval.nonce,
          targetHash: preflight.json.preflight.targetHash
        }
      }
    });
    assert.equal(replay.status, 428, JSON.stringify(replay.json));
    assert.equal(replay.json?.code, 'PACKAGE_UPDATE_APPROVAL_TARGET_CHANGED', JSON.stringify(replay.json));

    zipBuffer = buildPackageZip(appId, '2.0.0');
  } finally {
    await cleanupAppArtifacts(appId);
    await zipServer.close();
    await server.close();
  }
});

test('zip import rejects legacy approval shortcut and accepts scoped approval', async () => {
  operationApprovalService._resetForTests();
  const server = await createServer();
  const appId = `it-zip-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const zipBuffer = buildPackageZip(appId, '1.0.0');
  const token = signToken(await serverConfig.get('auth.adminUsername').catch(() => 'admin'));

  try {
    const legacy = await requestMultipart(server.baseUrl, '/api/packages/import', token, {
      approval: { approved: true }
    }, zipBuffer);
    assert.equal(legacy.status, 428, JSON.stringify(legacy.json));
    assert.equal(legacy.json?.code, 'PACKAGE_IMPORT_APPROVAL_LEGACY_APPROVAL_REJECTED', JSON.stringify(legacy.json));

    const preflight = await requestMultipart(server.baseUrl, '/api/packages/import/preflight', token, {}, zipBuffer);
    assert.equal(preflight.status, 200, JSON.stringify(preflight.json));
    assert.equal(preflight.json?.preflight?.action, 'package.import', JSON.stringify(preflight.json));
    const approval = await approveLifecycle(server.baseUrl, token, preflight.json.preflight);
    assert.equal(approval.status, 200, JSON.stringify(approval.json));

    const imported = await requestMultipart(server.baseUrl, '/api/packages/import', token, {
      approval: {
        operationId: approval.json.approval.operationId,
        nonce: approval.json.approval.nonce,
        targetHash: preflight.json.preflight.targetHash
      }
    }, zipBuffer);
    assert.equal(imported.status, 201, JSON.stringify(imported.json));
    assert.equal(imported.json?.package?.id, appId, JSON.stringify(imported.json));
  } finally {
    await cleanupAppArtifacts(appId);
    await server.close();
  }
});

test('rollback and manifest update require scoped lifecycle approval', async () => {
  operationApprovalService._resetForTests();
  const server = await createServer();
  const token = signToken(await serverConfig.get('auth.adminUsername').catch(() => 'admin'));
  const appId = `it-lifecycle-high-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const createRes = await createPackage(server.baseUrl, token, appId);
    assert.equal(createRes.status, 201, JSON.stringify(createRes.json));
    const backup = await packageLifecycleService.createBackup(appId, { note: 'rollback approval test' });

    const rollbackBlocked = await requestJson(server.baseUrl, `/api/packages/${appId}/rollback`, token, {
      method: 'POST',
      body: { backupId: backup.id }
    });
    assert.equal(rollbackBlocked.status, 428, JSON.stringify(rollbackBlocked.json));
    assert.equal(rollbackBlocked.json?.code, 'PACKAGE_ROLLBACK_APPROVAL_REQUIRED', JSON.stringify(rollbackBlocked.json));

    const currentManifest = await requestJson(server.baseUrl, `/api/packages/${appId}/manifest`, token);
    assert.equal(currentManifest.status, 200, JSON.stringify(currentManifest.json));
    const manifest = {
      ...currentManifest.json.manifest,
      version: '1.0.1',
      permissions: ['host.file.read']
    };
    const manifestBlocked = await requestJson(server.baseUrl, `/api/packages/${appId}/manifest`, token, {
      method: 'PUT',
      body: {
        manifest,
        approvals: { mediaScopesAccepted: true }
      }
    });
    assert.equal(manifestBlocked.status, 428, JSON.stringify(manifestBlocked.json));
    assert.equal(manifestBlocked.json?.code, 'PACKAGE_MANIFEST_APPROVAL_REQUIRED', JSON.stringify(manifestBlocked.json));

    const manifestPreflight = await requestJson(server.baseUrl, `/api/packages/${appId}/manifest/preflight`, token, {
      method: 'POST',
      body: {
        manifest,
        approvals: { mediaScopesAccepted: true }
      }
    });
    assert.equal(manifestPreflight.status, 200, JSON.stringify(manifestPreflight.json));
    const approval = await approveLifecycle(server.baseUrl, token, manifestPreflight.json.preflight);
    assert.equal(approval.status, 200, JSON.stringify(approval.json));

    const updated = await requestJson(server.baseUrl, `/api/packages/${appId}/manifest`, token, {
      method: 'PUT',
      body: {
        manifest,
        approvals: { mediaScopesAccepted: true },
        approval: {
          operationId: approval.json.approval.operationId,
          nonce: approval.json.approval.nonce,
          targetHash: manifestPreflight.json.preflight.targetHash
        }
      }
    });
    assert.equal(updated.status, 200, JSON.stringify(updated.json));
    assert.equal(updated.json?.manifest?.version, '1.0.1', JSON.stringify(updated.json));
  } finally {
    await cleanupAppArtifacts(appId);
    await server.close();
  }
});
