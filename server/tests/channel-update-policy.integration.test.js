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

function signToken(username) {
  return jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

async function createPackageServer(router) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/packages', router);

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

async function createPlainServer(app) {
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

function buildPackageZipBuffer(appId, version, channel = 'beta') {
  const zip = new AdmZip();
  const manifest = {
    id: appId,
    title: `Policy ${appId}`,
    description: 'channel policy integration package',
    version,
    type: 'app',
    runtime: 'sandbox',
    entry: 'index.html',
    permissions: [],
    capabilities: [],
    release: {
      channel
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
  zip.addFile('index.html', Buffer.from('<!doctype html><title>policy</title>', 'utf8'));
  return zip.toBuffer();
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

async function cleanupRegistrySource(sourceId) {
  const roots = await inventoryPaths.ensureInventoryStructure();
  const filePath = path.join(roots.systemDir, 'package-registries.json');
  if (!(await fs.pathExists(filePath))) return;
  const sources = await fs.readJson(filePath).catch(() => []);
  if (!Array.isArray(sources)) return;
  const next = sources.filter((item) => String(item?.id || '').trim() !== sourceId);
  await fs.writeJson(filePath, next, { spaces: 2 });
}

test('channel-based policy blocks and allows registry overwrite updates', async () => {
  assert.equal(typeof fetch, 'function', 'Global fetch must be available for integration tests.');

  const pkgServer = await createPackageServer(packagesRouter);
  const adminUsername = await serverConfig.get('auth.adminUsername').catch(() => process.env.ADMIN_USERNAME || 'admin');
  const token = signToken(adminUsername);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const appId = `it-policy-${suffix}`;
  const sourceId = `it-source-${suffix}`;

  const zipBuffer = buildPackageZipBuffer(appId, '2.0.0', 'beta');
  const publishedAt = '2026-04-18T00:00:00.000Z';

  let registryServer = null;
  const registryApp = express();
  registryApp.get('/registry.json', (_req, res) => {
    res.json({
      packages: [
        {
          id: appId,
          title: `Policy ${appId}`,
          version: '2.0.0',
          zipUrl: `${registryServer.baseUrl}/pkg.zip`,
          release: {
            channel: 'beta',
            publishedAt
          }
        }
      ]
    });
  });
  registryApp.get('/pkg.zip', (_req, res) => {
    res.setHeader('content-type', 'application/zip');
    res.send(zipBuffer);
  });
  registryServer = await createPlainServer(registryApp);

  try {
    const createRes = await requestJson(pkgServer.baseUrl, '/api/packages', token, {
      method: 'POST',
      body: {
        id: appId,
        title: `Policy ${suffix}`,
        version: '1.0.0',
        runtime: 'sandbox',
        entry: 'index.html'
      }
    });
    assert.equal(createRes.status, 201, JSON.stringify(createRes.json));

    const addSource = await requestJson(pkgServer.baseUrl, '/api/packages/registry/sources', token, {
      method: 'POST',
      body: {
        id: sourceId,
        title: sourceId,
        url: `${registryServer.baseUrl}/registry.json`,
        enabled: true
      }
    });
    assert.equal(addSource.status, 201, JSON.stringify(addSource.json));

    const updatesBlocked = await requestJson(
      pkgServer.baseUrl,
      '/api/packages/registry/updates?includeBlocked=true',
      token
    );
    assert.equal(updatesBlocked.status, 200, JSON.stringify(updatesBlocked.json));
    const blockedItem = (updatesBlocked.json?.updates || []).find((item) => item.appId === appId);
    assert.equal(Boolean(blockedItem), true, JSON.stringify(updatesBlocked.json));
    assert.equal(blockedItem.hasUpdate, false, JSON.stringify(updatesBlocked.json));

    const blockedInstall = await requestJson(pkgServer.baseUrl, '/api/packages/registry/install', token, {
      method: 'POST',
      body: {
        sourceId,
        packageId: appId,
        overwrite: true
      }
    });
    assert.equal(blockedInstall.status, 409, JSON.stringify(blockedInstall.json));
    assert.equal(blockedInstall.json?.code, 'REGISTRY_UPDATE_POLICY_BLOCKED', JSON.stringify(blockedInstall.json));

    const setBeta = await requestJson(pkgServer.baseUrl, `/api/packages/${appId}/channel`, token, {
      method: 'PUT',
      body: { channel: 'beta' }
    });
    assert.equal(setBeta.status, 200, JSON.stringify(setBeta.json));

    const updatesAllowed = await requestJson(pkgServer.baseUrl, '/api/packages/registry/updates', token);
    assert.equal(updatesAllowed.status, 200, JSON.stringify(updatesAllowed.json));
    const allowedItem = (updatesAllowed.json?.updates || []).find((item) => item.appId === appId);
    assert.equal(Boolean(allowedItem), true, JSON.stringify(updatesAllowed.json));
    assert.equal(allowedItem.hasUpdate, true, JSON.stringify(updatesAllowed.json));
    assert.equal(String(allowedItem?.selected?.version || ''), '2.0.0', JSON.stringify(updatesAllowed.json));

    const installAllowed = await requestJson(pkgServer.baseUrl, '/api/packages/registry/install', token, {
      method: 'POST',
      body: {
        sourceId,
        packageId: appId,
        overwrite: true
      }
    });
    assert.equal(installAllowed.status, 201, JSON.stringify(installAllowed.json));
    assert.equal(String(installAllowed.json?.package?.version || ''), '2.0.0', JSON.stringify(installAllowed.json));
  } finally {
    await cleanupAppArtifacts(appId);
    await cleanupRegistrySource(sourceId);
    await pkgServer.close();
    if (registryServer) {
      await registryServer.close();
    }
  }
});
