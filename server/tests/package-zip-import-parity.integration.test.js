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
const stateStore = require('../services/stateStore');

function signToken(username) {
  return jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/packages', packagesRouter);

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  };
}

function buildPackageZipBuffer(appId, version, html = '<!doctype html><title>zip import</title>') {
  const zip = new AdmZip();
  const manifest = {
    id: appId,
    title: `Zip Import ${appId}`,
    description: 'zip import parity integration package',
    version,
    type: 'app',
    runtime: 'sandbox',
    entry: 'index.html',
    permissions: [],
    capabilities: [],
    release: {
      channel: 'stable'
    },
    compatibility: {
      minServerVersion: '',
      maxServerVersion: '',
      requiredRuntimeTypes: []
    },
    dependencies: [],
    window: {
      width: 960,
      height: 720,
      minWidth: 480,
      minHeight: 320
    }
  };

  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
  zip.addFile('index.html', Buffer.from(html, 'utf8'));
  return zip.toBuffer();
}

async function requestMultipart(baseUrl, endpoint, token, fields = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'package') {
      form.append('package', new Blob([value], { type: 'application/zip' }), 'package.zip');
      continue;
    }
    form.append(key, typeof value === 'string' ? value : JSON.stringify(value));
  }

  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`
    },
    body: form
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_err) {
    json = { parseError: true, raw: text };
  }

  return {
    status: response.status,
    json
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
  let json = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_err) {
    json = { parseError: true, raw: text };
  }

  return {
    status: response.status,
    json
  };
}

async function requestDelete(baseUrl, endpoint, token, body = undefined) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_err) {
    json = { parseError: true, raw: text };
  }

  return {
    status: response.status,
    json
  };
}

async function deletePackageWithApproval(baseUrl, appId, token) {
  const preflightRes = await requestJson(baseUrl, `/api/packages/${appId}/delete/preflight`, token, {
    method: 'POST',
    body: {}
  });
  assert.equal(preflightRes.status, 200, JSON.stringify(preflightRes.json));
  const operationId = preflightRes.json?.preflight?.operationId;
  const targetHash = preflightRes.json?.preflight?.targetHash;
  assert.ok(operationId, JSON.stringify(preflightRes.json));
  assert.ok(targetHash, JSON.stringify(preflightRes.json));

  const approveRes = await requestJson(baseUrl, `/api/packages/${appId}/delete/approve`, token, {
    method: 'POST',
    body: {
      operationId,
      typedConfirmation: appId
    }
  });
  assert.equal(approveRes.status, 200, JSON.stringify(approveRes.json));
  const nonce = approveRes.json?.approval?.nonce;
  assert.ok(nonce, JSON.stringify(approveRes.json));

  return requestDelete(baseUrl, `/api/packages/${appId}`, token, {
    approval: {
      operationId,
      nonce,
      targetHash
    },
    reason: 'zip-import-parity-open-with-cleanup'
  });
}

async function cleanupAppArtifacts(appId) {
  const roots = await inventoryPaths.ensureInventoryStructure();
  const appRoot = await appPaths.getAppRoot(appId).catch(() => null);
  if (appRoot) {
    await fs.remove(appRoot).catch(() => {});
  }

  const backupRoot = path.join(roots.systemDir, 'package-backups', appId);
  await fs.remove(backupRoot).catch(() => {});
  await packageLifecycleService.deleteLifecycle(appId).catch(() => {});
}

test('zip import preflight returns registry-style readiness and local workspace evidence', async () => {
  assert.equal(typeof fetch, 'function', 'Global fetch must be available for integration tests.');
  assert.equal(typeof FormData, 'function', 'Global FormData must be available for integration tests.');

  const server = await createServer();
  const adminUsername = await serverConfig.get('auth.adminUsername').catch(() => process.env.ADMIN_USERNAME || 'admin');
  const token = signToken(adminUsername);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const appId = `it-zip-preflight-${suffix}`;

  try {
    const paths = await serverConfig.getPaths();
    const allowedRoot = Array.isArray(paths.allowedRoots) && paths.allowedRoots.length > 0
      ? paths.allowedRoots[0]
      : process.cwd();
    const localWorkspacePath = path.join(allowedRoot, `webos-zip-import-workspace-${suffix}`);

    const response = await requestMultipart(server.baseUrl, '/api/packages/import/preflight', token, {
      package: buildPackageZipBuffer(appId, '1.0.0'),
      localWorkspace: {
        path: localWorkspacePath,
        mode: 'readwrite'
      }
    });

    assert.equal(response.status, 200, JSON.stringify(response.json));
    assert.equal(response.json?.success, true, JSON.stringify(response.json));
    assert.equal(response.json?.preflight?.operation?.type, 'install', JSON.stringify(response.json));
    assert.equal(response.json?.preflight?.operation?.source, 'upload:zip', JSON.stringify(response.json));
    assert.equal(response.json?.preflight?.operation?.appId, appId, JSON.stringify(response.json));
    assert.equal(response.json?.preflight?.operation?.existing?.installed, false, JSON.stringify(response.json));
    assert.equal(response.json?.preflight?.backupPlan?.required, false, JSON.stringify(response.json));
    assert.equal(response.json?.preflight?.executionReadiness?.ready, true, JSON.stringify(response.json));
    assert.equal(
      response.json?.preflight?.localWorkspaceBridge?.status,
      'inventory+local-workspace',
      JSON.stringify(response.json)
    );
    assert.equal(
      response.json?.preflight?.localWorkspaceBridge?.path,
      path.resolve(localWorkspacePath),
      JSON.stringify(response.json)
    );
    assert.ok(Array.isArray(response.json?.preflight?.lifecycleSafeguards?.checks), JSON.stringify(response.json));
  } finally {
    await cleanupAppArtifacts(appId);
    await server.close();
  }
});

test('zip import overwrite creates backup and records lifecycle evidence', async () => {
  const server = await createServer();
  const adminUsername = await serverConfig.get('auth.adminUsername').catch(() => process.env.ADMIN_USERNAME || 'admin');
  const token = signToken(adminUsername);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const appId = `it-zip-import-${suffix}`;

  try {
    const installRes = await requestMultipart(server.baseUrl, '/api/packages/import', token, {
      package: buildPackageZipBuffer(appId, '1.0.0', '<!doctype html><title>v1</title>')
    });
    assert.equal(installRes.status, 201, JSON.stringify(installRes.json));
    assert.equal(installRes.json?.localWorkspaceBridge?.status, 'inventory-only', JSON.stringify(installRes.json));

    const preflightRes = await requestMultipart(server.baseUrl, '/api/packages/import/preflight', token, {
      package: buildPackageZipBuffer(appId, '2.0.0', '<!doctype html><title>v2</title>'),
      overwrite: 'true'
    });
    assert.equal(preflightRes.status, 200, JSON.stringify(preflightRes.json));
    assert.equal(preflightRes.json?.preflight?.operation?.type, 'update', JSON.stringify(preflightRes.json));
    assert.equal(preflightRes.json?.preflight?.operation?.existing?.installed, true, JSON.stringify(preflightRes.json));
    assert.equal(preflightRes.json?.preflight?.backupPlan?.required, true, JSON.stringify(preflightRes.json));
    assert.equal(preflightRes.json?.preflight?.executionReadiness?.ready, true, JSON.stringify(preflightRes.json));

    const overwriteRes = await requestMultipart(server.baseUrl, '/api/packages/import', token, {
      package: buildPackageZipBuffer(appId, '2.0.0', '<!doctype html><title>v2</title>'),
      overwrite: 'true'
    });
    assert.equal(overwriteRes.status, 201, JSON.stringify(overwriteRes.json));
    assert.equal(String(overwriteRes.json?.package?.version || ''), '2.0.0', JSON.stringify(overwriteRes.json));

    const lifecycleRes = await requestJson(server.baseUrl, `/api/packages/${appId}/lifecycle`, token);
    assert.equal(lifecycleRes.status, 200, JSON.stringify(lifecycleRes.json));
    assert.equal(lifecycleRes.json?.lifecycle?.current?.version, '2.0.0', JSON.stringify(lifecycleRes.json));
    assert.equal(lifecycleRes.json?.lifecycle?.current?.source, 'upload:zip', JSON.stringify(lifecycleRes.json));
    assert.equal(lifecycleRes.json?.lifecycle?.current?.reason, 'import-overwrite', JSON.stringify(lifecycleRes.json));

    const backups = Array.isArray(lifecycleRes.json?.lifecycle?.backups) ? lifecycleRes.json.lifecycle.backups : [];
    assert.equal(backups.length, 1, JSON.stringify(lifecycleRes.json));
    assert.equal(backups[0]?.version, '1.0.0', JSON.stringify(lifecycleRes.json));

    const history = Array.isArray(lifecycleRes.json?.lifecycle?.history) ? lifecycleRes.json.lifecycle.history : [];
    const overwriteHistory = history.find((item) => item.reason === 'import-overwrite');
    assert.ok(overwriteHistory, JSON.stringify(lifecycleRes.json));
    assert.equal(overwriteHistory.backupId, backups[0].id, JSON.stringify(lifecycleRes.json));

    const appRoot = await appPaths.getAppRoot(appId);
    const html = await fs.readFile(path.join(appRoot, 'index.html'), 'utf8');
    assert.match(html, /v2/);
  } finally {
    await cleanupAppArtifacts(appId);
    await server.close();
  }
});

test('package delete clears stale file association default app settings', async () => {
  const server = await createServer();
  const adminUsername = await serverConfig.get('auth.adminUsername').catch(() => process.env.ADMIN_USERNAME || 'admin');
  const token = signToken(adminUsername);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const appId = `it-openwith-cleanup-${suffix}`;
  const previousContextMenu = await stateStore.readState('contextMenu');

  try {
    const installRes = await requestMultipart(server.baseUrl, '/api/packages/import', token, {
      package: buildPackageZipBuffer(appId, '1.0.0')
    });
    assert.equal(installRes.status, 201, JSON.stringify(installRes.json));

    await stateStore.writeState('contextMenu', {
      ...previousContextMenu,
      openWithByExtension: {
        ...(previousContextMenu.openWithByExtension || {}),
        ziptest: appId,
        keep: 'editor'
      }
    });

    const deleteRes = await deletePackageWithApproval(server.baseUrl, appId, token);
    assert.equal(deleteRes.status, 200, JSON.stringify(deleteRes.json));
    assert.deepEqual(deleteRes.json?.associationCleanup?.removedExtensions, ['ziptest']);

    const after = await stateStore.readState('contextMenu');
    assert.equal(after.openWithByExtension.ziptest, undefined);
    assert.equal(after.openWithByExtension.keep, 'editor');
  } finally {
    await stateStore.writeState('contextMenu', previousContextMenu).catch(() => {});
    await cleanupAppArtifacts(appId);
    await server.close();
  }
});
