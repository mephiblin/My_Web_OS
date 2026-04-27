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
const packageRegistryService = require('../services/packageRegistryService');
const packageLifecycleService = require('../services/packageLifecycleService');

function signToken(username = 'admin') {
  return jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
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

async function requestJson(baseUrl, endpoint, token, options = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();
  return {
    status: response.status,
    json: text ? JSON.parse(text) : {}
  };
}

async function cleanupAppArtifacts(appId) {
  const roots = await inventoryPaths.ensureInventoryStructure();
  const appRoot = await appPaths.getAppRoot(appId).catch(() => null);
  if (appRoot) {
    await fs.remove(appRoot).catch(() => {});
  }
  await fs.remove(path.join(roots.systemDir, 'package-backups', appId)).catch(() => {});
  await packageLifecycleService.deleteLifecycle(appId).catch(() => {});
}

test('hybrid template scaffold creates separate service/UI entries and launch metadata targets UI', async () => {
  assert.equal(typeof fetch, 'function', 'Global fetch must be available for integration tests.');

  const server = await createServer();
  const token = signToken();
  const appId = `it-hybrid-template-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const scaffold = await requestJson(
      server.baseUrl,
      '/api/packages/ecosystem/templates/node-hybrid-tool/scaffold',
      token,
      {
        method: 'POST',
        body: { appId }
      }
    );
    assert.equal(scaffold.status, 201, JSON.stringify(scaffold.json));

    const appRoot = await appPaths.getAppRoot(appId);
    const manifest = await fs.readJson(path.join(appRoot, 'manifest.json'));
    assert.equal(manifest.type, 'hybrid');
    assert.equal(manifest.runtime?.entry, 'service/index.js');
    assert.equal(manifest.ui?.entry, 'ui/index.html');
    assert.equal(manifest.entry, 'ui/index.html');
    assert.equal(await fs.pathExists(path.join(appRoot, 'service/index.js')), true);
    assert.equal(await fs.pathExists(path.join(appRoot, 'ui/index.html')), true);

    const registered = await packageRegistryService.getSandboxApp(appId);
    assert.equal(registered?.appType, 'hybrid');
    assert.equal(registered?.entry, 'ui/index.html');
    assert.equal(registered?.runtimeProfile?.entry, 'service/index.js');
    assert.equal(registered?.launch?.mode, 'sandbox');
    assert.match(registered?.launch?.entryUrl || '', /\/ui\/index\.html$/);
    assert.equal(registered?.service?.entry, 'service/index.js');
    assert.equal(registered?.service?.http?.enabled, true);

    const health = await requestJson(server.baseUrl, `/api/packages/${appId}/health`, token);
    assert.equal(health.status, 200, JSON.stringify(health.json));
    assert.equal(health.json?.report?.checks?.some((item) => item.id === 'package.entry' && item.level === 'pass'), true);
  } finally {
    await cleanupAppArtifacts(appId);
    await server.close();
  }
});

test('wizard preflight exposes blocking hybrid tool package review', async () => {
  const server = await createServer();
  const token = signToken();
  const appId = `it-hybrid-review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const preflight = await requestJson(server.baseUrl, '/api/packages/wizard/preflight', token, {
      method: 'POST',
      body: {
        manifest: {
          id: appId,
          title: 'Hybrid Review',
          version: '0.1.0',
          type: 'hybrid',
          runtime: {
            type: 'process-node',
            entry: 'service/index.js'
          },
          ui: {
            type: 'sandbox-html',
            entry: 'ui/index.html'
          },
          service: {
            http: { enabled: true }
          },
          healthcheck: {
            type: 'http',
            path: '/health'
          },
          permissions: ['runtime.process']
        }
      }
    });

    assert.equal(preflight.status, 200, JSON.stringify(preflight.json));
    const review = preflight.json?.preflight;
    assert.equal(review?.toolPackageReview?.applies, true);
    assert.equal(review?.toolPackageReview?.status, 'fail');
    assert.equal(
      review?.toolPackageReview?.checks?.some((item) => item.id === 'tool.permission.service.bridge' && item.status === 'fail'),
      true
    );
    assert.equal(
      review?.executionReadiness?.blockers?.some((item) => item.code === 'HYBRID_TOOL_PACKAGE_CONTRACT_FAILED'),
      true
    );
  } finally {
    await cleanupAppArtifacts(appId);
    await server.close();
  }
});
