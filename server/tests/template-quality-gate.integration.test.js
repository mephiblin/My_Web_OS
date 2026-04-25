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

async function postJson(baseUrl, endpoint, token, body) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body || {})
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

async function createSandboxPackage(appId, options = {}) {
  const appRoot = await appPaths.getAppRoot(appId);
  await fs.ensureDir(appRoot);
  const manifest = {
    id: appId,
    title: options.title || appId,
    description: options.description || '',
    version: options.version || '1.0.0',
    type: 'app',
    runtime: 'sandbox',
    entry: 'index.html',
    permissions: [],
    capabilities: [],
    window: {
      width: 960,
      height: 720,
      minWidth: 480,
      minHeight: 320
    },
    dependencies: [],
    compatibility: {
      minServerVersion: '',
      maxServerVersion: '',
      requiredRuntimeTypes: []
    },
    release: {
      channel: 'stable'
    }
  };

  await fs.writeJson(path.join(appRoot, 'manifest.json'), manifest, { spaces: 2 });
  await fs.writeFile(path.join(appRoot, 'index.html'), '<!doctype html><title>seed</title>', 'utf8');
}

test('template quality gate scaffold blocking integration flow', async () => {
  assert.equal(typeof fetch, 'function', 'Global fetch must be available for integration tests.');

  const server = await createServer();
  const adminUsername = await serverConfig.get('auth.adminUsername').catch(() => process.env.ADMIN_USERNAME || 'admin');
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const failId = `it-fail-${suffix}`;
  const warnId = `it-warn-${suffix}`;
  const depId = `it-dep-${suffix}`;
  const mismatchId = `it-mismatch-${suffix}`;
  const templateId = 'markdown-editor';

  const failBody = {
    appId: failId,
    manifestPatch: {
      compatibility: {
        minServerVersion: '9999.0.0'
      }
    }
  };

  const warnBody = {
    appId: warnId,
    manifestPatch: {
      permissions: [
        'app.data.read',
        'app.data.write',
        'ui.notification',
        'system.info',
        'window.open',
        'app.data.list',
        'fs.host.read'
      ],
      dependencies: [
        {
          id: `optional-missing-${suffix}`,
          version: '^1.0.0',
          optional: true
        }
      ]
    }
  };

  const mismatchBody = {
    appId: mismatchId,
    manifestPatch: {
      dependencies: [
        {
          id: depId,
          version: '^2.0.0',
          optional: false
        }
      ]
    }
  };

  try {
    await createSandboxPackage(depId, { version: '1.3.0' });

    const failCheck = await postJson(
      server.baseUrl,
      `/api/packages/ecosystem/templates/${templateId}/quality-check`,
      signToken(adminUsername),
      failBody
    );
    assert.equal(failCheck.status, 200, JSON.stringify(failCheck.json));
    assert.equal(failCheck.json?.report?.status, 'fail', JSON.stringify(failCheck.json));

    const failScaffold = await postJson(
      server.baseUrl,
      `/api/packages/ecosystem/templates/${templateId}/scaffold`,
      signToken(adminUsername),
      failBody
    );
    assert.equal(failScaffold.status, 409, JSON.stringify(failScaffold.json));
    assert.equal(failScaffold.json?.code, 'TEMPLATE_QUALITY_GATE_FAILED', JSON.stringify(failScaffold.json));

    const warnCheck = await postJson(
      server.baseUrl,
      `/api/packages/ecosystem/templates/${templateId}/quality-check`,
      signToken(adminUsername),
      warnBody
    );
    assert.equal(warnCheck.status, 200, JSON.stringify(warnCheck.json));
    assert.equal(warnCheck.json?.report?.status, 'warn', JSON.stringify(warnCheck.json));

    const warnBlocked = await postJson(
      server.baseUrl,
      `/api/packages/ecosystem/templates/${templateId}/scaffold`,
      signToken(adminUsername),
      warnBody
    );
    assert.equal(warnBlocked.status, 409, JSON.stringify(warnBlocked.json));
    assert.equal(warnBlocked.json?.code, 'TEMPLATE_QUALITY_WARN_REVIEW_REQUIRED', JSON.stringify(warnBlocked.json));

    const warnForceDenied = await postJson(
      server.baseUrl,
      `/api/packages/ecosystem/templates/${templateId}/scaffold`,
      signToken('integration-user'),
      { ...warnBody, force: true }
    );
    assert.equal(warnForceDenied.status, 403, JSON.stringify(warnForceDenied.json));
    assert.equal(warnForceDenied.json?.code, 'TEMPLATE_QUALITY_FORCE_FORBIDDEN', JSON.stringify(warnForceDenied.json));

    const warnForceAllowed = await postJson(
      server.baseUrl,
      `/api/packages/ecosystem/templates/${templateId}/scaffold`,
      signToken(adminUsername),
      { ...warnBody, force: true }
    );
    assert.equal(warnForceAllowed.status, 201, JSON.stringify(warnForceAllowed.json));
    assert.equal(warnForceAllowed.json?.report?.status, 'warn', JSON.stringify(warnForceAllowed.json));

    const mismatchCheck = await postJson(
      server.baseUrl,
      `/api/packages/ecosystem/templates/${templateId}/quality-check`,
      signToken(adminUsername),
      mismatchBody
    );
    assert.equal(mismatchCheck.status, 200, JSON.stringify(mismatchCheck.json));
    assert.equal(mismatchCheck.json?.report?.status, 'fail', JSON.stringify(mismatchCheck.json));
    const depCheck = (mismatchCheck.json?.report?.checks || []).find((item) => item.id === 'compatibility.dependencies');
    assert.equal(Boolean(depCheck), true, JSON.stringify(mismatchCheck.json));
    assert.match(String(depCheck?.message || ''), /version mismatch/i);

    const createdAppRoot = await appPaths.getAppRoot(warnId);
    assert.equal(await fs.pathExists(createdAppRoot), true, `Scaffolded app root missing: ${warnId}`);
  } finally {
    await cleanupAppArtifacts(failId);
    await cleanupAppArtifacts(warnId);
    await cleanupAppArtifacts(depId);
    await cleanupAppArtifacts(mismatchId);
    await server.close();
  }
});
