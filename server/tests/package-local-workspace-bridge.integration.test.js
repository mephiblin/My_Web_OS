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

test('wizard preflight/create persists local workspace bridge in lifecycle and package list', async () => {
  const server = await createServer();
  const adminUsername = await serverConfig.get('auth.adminUsername').catch(() => process.env.ADMIN_USERNAME || 'admin');
  const token = signToken(adminUsername);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const appId = `it-local-bridge-${suffix}`;

  try {
    const paths = await serverConfig.getPaths();
    const allowedRoot = Array.isArray(paths.allowedRoots) && paths.allowedRoots.length > 0
      ? paths.allowedRoots[0]
      : process.cwd();
    const localWorkspacePath = path.join(allowedRoot, `webos-local-workspace-${suffix}`);

    const preflightRes = await requestJson(server.baseUrl, '/api/packages/wizard/preflight', token, {
      method: 'POST',
      body: {
        manifest: {
          id: appId,
          title: `Local Bridge ${suffix}`,
          version: '0.1.0',
          appType: 'app',
          runtime: {
            runtimeType: 'sandbox-html',
            entry: 'index.html'
          },
          permissions: []
        },
        localWorkspace: {
          path: localWorkspacePath,
          mode: 'readwrite'
        }
      }
    });

    assert.equal(preflightRes.status, 200, JSON.stringify(preflightRes.json));
    assert.equal(
      preflightRes.json?.preflight?.operation?.localWorkspaceBridge?.status,
      'inventory+local-workspace',
      JSON.stringify(preflightRes.json)
    );
    assert.equal(
      preflightRes.json?.preflight?.operation?.localWorkspaceBridge?.path,
      path.resolve(localWorkspacePath),
      JSON.stringify(preflightRes.json)
    );

    const createRes = await requestJson(server.baseUrl, '/api/packages/wizard/create', token, {
      method: 'POST',
      body: {
        manifest: {
          id: appId,
          title: `Local Bridge ${suffix}`,
          version: '0.1.0',
          appType: 'app',
          runtime: {
            runtimeType: 'sandbox-html',
            entry: 'index.html'
          },
          permissions: []
        },
        localWorkspace: {
          path: localWorkspacePath,
          mode: 'readwrite'
        }
      }
    });

    assert.equal(createRes.status, 201, JSON.stringify(createRes.json));
    assert.equal(createRes.json?.localWorkspaceBridge?.status, 'inventory+local-workspace', JSON.stringify(createRes.json));

    const lifecycleRes = await requestJson(server.baseUrl, `/api/packages/${appId}/lifecycle`, token);
    assert.equal(lifecycleRes.status, 200, JSON.stringify(lifecycleRes.json));
    assert.equal(lifecycleRes.json?.lifecycle?.workspaceBridge?.status, 'inventory+local-workspace', JSON.stringify(lifecycleRes.json));
    assert.equal(lifecycleRes.json?.lifecycle?.workspaceBridge?.path, path.resolve(localWorkspacePath), JSON.stringify(lifecycleRes.json));

    const listRes = await requestJson(server.baseUrl, '/api/packages', token);
    assert.equal(listRes.status, 200, JSON.stringify(listRes.json));
    const listed = Array.isArray(listRes.json?.packages)
      ? listRes.json.packages.find((item) => item.id === appId)
      : null;
    assert.ok(listed, JSON.stringify(listRes.json));
    assert.equal(listed?.workspaceBridge?.status, 'inventory+local-workspace', JSON.stringify(listRes.json));
  } finally {
    await cleanupAppArtifacts(appId);
    await server.close();
  }
});

test('wizard preflight rejects protected local workspace paths with explicit code/message', async () => {
  const server = await createServer();
  const adminUsername = await serverConfig.get('auth.adminUsername').catch(() => process.env.ADMIN_USERNAME || 'admin');
  const token = signToken(adminUsername);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  try {
    const paths = await serverConfig.getPaths();
    const protectedPath = path.join(paths.inventoryRoot, 'system');

    const response = await requestJson(server.baseUrl, '/api/packages/wizard/preflight', token, {
      method: 'POST',
      body: {
        manifest: {
          id: `it-local-bridge-protected-${suffix}`,
          title: `Local Bridge Protected ${suffix}`,
          version: '0.1.0',
          appType: 'app',
          runtime: {
            runtimeType: 'sandbox-html',
            entry: 'index.html'
          },
          permissions: []
        },
        localWorkspace: {
          path: protectedPath,
          mode: 'readwrite'
        }
      }
    });

    assert.equal(response.status, 403, JSON.stringify(response.json));
    assert.equal(response.json?.error, true, JSON.stringify(response.json));
    assert.ok(
      ['LOCAL_WORKSPACE_PATH_NOT_ALLOWED', 'LOCAL_WORKSPACE_PATH_SYSTEM_PROTECTED'].includes(response.json?.code),
      JSON.stringify(response.json)
    );
    assert.match(String(response.json?.message || ''), /localWorkspace\.path/i, JSON.stringify(response.json));
  } finally {
    await server.close();
  }
});

test('wizard create without local workspace keeps inventory-only bridge metadata stable', async () => {
  const server = await createServer();
  const adminUsername = await serverConfig.get('auth.adminUsername').catch(() => process.env.ADMIN_USERNAME || 'admin');
  const token = signToken(adminUsername);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const appId = `it-local-bridge-default-${suffix}`;

  try {
    const preflightRes = await requestJson(server.baseUrl, '/api/packages/wizard/preflight', token, {
      method: 'POST',
      body: {
        manifest: {
          id: appId,
          title: `Local Bridge Default ${suffix}`,
          version: '0.1.0',
          appType: 'app',
          runtime: {
            runtimeType: 'sandbox-html',
            entry: 'index.html'
          },
          permissions: []
        }
      }
    });

    assert.equal(preflightRes.status, 200, JSON.stringify(preflightRes.json));
    assert.equal(
      preflightRes.json?.preflight?.operation?.localWorkspaceBridge?.status,
      'inventory-only',
      JSON.stringify(preflightRes.json)
    );
    assert.equal(preflightRes.json?.preflight?.operation?.localWorkspaceBridge?.updatedAt, null, JSON.stringify(preflightRes.json));

    const createRes = await requestJson(server.baseUrl, '/api/packages/wizard/create', token, {
      method: 'POST',
      body: {
        manifest: {
          id: appId,
          title: `Local Bridge Default ${suffix}`,
          version: '0.1.0',
          appType: 'app',
          runtime: {
            runtimeType: 'sandbox-html',
            entry: 'index.html'
          },
          permissions: []
        }
      }
    });

    assert.equal(createRes.status, 201, JSON.stringify(createRes.json));
    assert.equal(createRes.json?.localWorkspaceBridge?.status, 'inventory-only', JSON.stringify(createRes.json));
    assert.equal(createRes.json?.localWorkspaceBridge?.updatedAt, null, JSON.stringify(createRes.json));

    const listRes = await requestJson(server.baseUrl, '/api/packages', token);
    assert.equal(listRes.status, 200, JSON.stringify(listRes.json));
    const listed = Array.isArray(listRes.json?.packages)
      ? listRes.json.packages.find((item) => item.id === appId)
      : null;
    assert.ok(listed, JSON.stringify(listRes.json));
    assert.equal(listed?.workspaceBridge?.status, 'inventory-only', JSON.stringify(listRes.json));
    assert.equal(listed?.workspaceBridge?.updatedAt, null, JSON.stringify(listRes.json));
  } finally {
    await cleanupAppArtifacts(appId);
    await server.close();
  }
});
