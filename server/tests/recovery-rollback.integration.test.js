const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const jwt = require('jsonwebtoken');

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

async function requestJson(baseUrl, endpoint, token, options = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(options.headers || {})
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

test('recovery rollback chain restores package files from backup', async () => {
  assert.equal(typeof fetch, 'function', 'Global fetch must be available for integration tests.');

  const server = await createServer();
  const adminUsername = await serverConfig.get('auth.adminUsername').catch(() => process.env.ADMIN_USERNAME || 'admin');
  const token = signToken(adminUsername);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const appId = `it-recover-${suffix}`;
  const originalHtml = '<!doctype html><html><body><h1>original</h1></body></html>';
  const brokenHtml = '<!doctype html><html><body><h1>broken</h1></body></html>';

  try {
    const createRes = await requestJson(server.baseUrl, '/api/packages', token, {
      method: 'POST',
      body: {
        id: appId,
        title: `Recover ${suffix}`,
        description: 'recovery integration test package',
        version: '1.0.0',
        runtime: 'sandbox',
        entry: 'index.html'
      }
    });
    assert.equal(createRes.status, 201, JSON.stringify(createRes.json));

    const appRoot = await appPaths.getAppRoot(appId);
    const manifestPath = path.join(appRoot, 'manifest.json');
    const entryPath = path.join(appRoot, 'index.html');
    await fs.writeFile(entryPath, originalHtml, 'utf8');

    const backupRes = await requestJson(server.baseUrl, `/api/packages/${appId}/backup`, token, {
      method: 'POST',
      body: { note: 'pre-mutation snapshot' }
    });
    assert.equal(backupRes.status, 201, JSON.stringify(backupRes.json));
    const backupId = String(backupRes.json?.backup?.id || '');
    assert.ok(backupId, JSON.stringify(backupRes.json));

    const mutatedManifest = await fs.readJson(manifestPath);
    mutatedManifest.version = '9.9.9';
    await fs.writeJson(manifestPath, mutatedManifest, { spaces: 2 });
    await fs.writeFile(entryPath, brokenHtml, 'utf8');

    const rollbackRes = await requestJson(server.baseUrl, `/api/packages/${appId}/rollback`, token, {
      method: 'POST',
      body: { backupId }
    });
    assert.equal(rollbackRes.status, 200, JSON.stringify(rollbackRes.json));
    assert.equal(rollbackRes.json?.success, true, JSON.stringify(rollbackRes.json));

    const restoredManifest = await fs.readJson(manifestPath);
    const restoredHtml = await fs.readFile(entryPath, 'utf8');
    assert.equal(String(restoredManifest.version || ''), '1.0.0');
    assert.equal(restoredHtml.includes('original'), true);
    assert.equal(restoredHtml.includes('broken'), false);

    const lifecycleRes = await requestJson(server.baseUrl, `/api/packages/${appId}/lifecycle`, token);
    assert.equal(lifecycleRes.status, 200, JSON.stringify(lifecycleRes.json));
    const rollbackHistory = (lifecycleRes.json?.lifecycle?.history || []).find((item) => item.reason === 'rollback');
    assert.equal(Boolean(rollbackHistory), true, JSON.stringify(lifecycleRes.json));
  } finally {
    await cleanupAppArtifacts(appId);
    await server.close();
  }
});
