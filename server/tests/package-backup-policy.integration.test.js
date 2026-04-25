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

test('package backup policy applies retention maxBackups', async () => {
  const server = await createServer();
  const adminUsername = await serverConfig.get('auth.adminUsername').catch(() => process.env.ADMIN_USERNAME || 'admin');
  const token = signToken(adminUsername);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const appId = `it-backup-policy-${suffix}`;

  try {
    const createRes = await requestJson(server.baseUrl, '/api/packages', token, {
      method: 'POST',
      body: {
        id: appId,
        title: `Backup Policy ${suffix}`,
        description: 'backup policy integration test package',
        version: '1.0.0',
        runtime: 'sandbox',
        entry: 'index.html'
      }
    });
    assert.equal(createRes.status, 201, JSON.stringify(createRes.json));

    const policyUpdate = await requestJson(server.baseUrl, `/api/packages/${appId}/backup-policy`, token, {
      method: 'PUT',
      body: {
        maxBackups: 2
      }
    });
    assert.equal(policyUpdate.status, 200, JSON.stringify(policyUpdate.json));
    assert.equal(policyUpdate.json?.backupPolicy?.maxBackups, 2, JSON.stringify(policyUpdate.json));

    for (let index = 0; index < 3; index += 1) {
      const backupRes = await requestJson(server.baseUrl, `/api/packages/${appId}/backup`, token, {
        method: 'POST',
        body: { note: `backup-${index}` }
      });
      assert.equal(backupRes.status, 201, JSON.stringify(backupRes.json));
    }

    const lifecycleRes = await requestJson(server.baseUrl, `/api/packages/${appId}/lifecycle`, token);
    assert.equal(lifecycleRes.status, 200, JSON.stringify(lifecycleRes.json));
    const backups = Array.isArray(lifecycleRes.json?.lifecycle?.backups) ? lifecycleRes.json.lifecycle.backups : [];
    assert.equal(backups.length, 2, JSON.stringify(lifecycleRes.json));
    assert.equal(lifecycleRes.json?.lifecycle?.backupPolicy?.maxBackups, 2, JSON.stringify(lifecycleRes.json));

    const roots = await inventoryPaths.ensureInventoryStructure();
    const backupDir = path.join(roots.systemDir, 'package-backups', appId);
    const files = (await fs.readdir(backupDir).catch(() => [])).filter((name) => name.endsWith('.zip'));
    assert.equal(files.length, 2, JSON.stringify({ files }));
  } finally {
    await cleanupAppArtifacts(appId);
    await server.close();
  }
});

test('package backup policy accepts schedule policy', async () => {
  const server = await createServer();
  const adminUsername = await serverConfig.get('auth.adminUsername').catch(() => process.env.ADMIN_USERNAME || 'admin');
  const token = signToken(adminUsername);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const appId = `it-backup-policy-schedule-${suffix}`;

  try {
    const createRes = await requestJson(server.baseUrl, '/api/packages', token, {
      method: 'POST',
      body: {
        id: appId,
        title: `Backup Policy Schedule ${suffix}`,
        description: 'backup policy scheduling integration test package',
        version: '1.0.0',
        runtime: 'sandbox',
        entry: 'index.html'
      }
    });
    assert.equal(createRes.status, 201, JSON.stringify(createRes.json));

    const policyUpdate = await requestJson(server.baseUrl, `/api/packages/${appId}/backup-policy`, token, {
      method: 'PUT',
      body: {
        maxBackups: 4,
        schedule: {
          enabled: true,
          interval: 'daily',
          timeOfDay: '06:30',
          timezone: 'UTC'
        }
      }
    });

    assert.equal(policyUpdate.status, 200, JSON.stringify(policyUpdate.json));
    assert.equal(policyUpdate.json?.backupPolicy?.maxBackups, 4, JSON.stringify(policyUpdate.json));
    assert.equal(policyUpdate.json?.backupPolicy?.schedule?.interval, 'daily', JSON.stringify(policyUpdate.json));
    assert.equal(policyUpdate.json?.backupPolicy?.schedule?.timeOfDay, '06:30', JSON.stringify(policyUpdate.json));
    assert.equal(policyUpdate.json?.backupPolicy?.schedule?.enabled, true, JSON.stringify(policyUpdate.json));

    const lifecycleRes = await requestJson(server.baseUrl, `/api/packages/${appId}/lifecycle`, token);
    assert.equal(lifecycleRes.status, 200, JSON.stringify(lifecycleRes.json));
    assert.equal(lifecycleRes.json?.lifecycle?.backupPolicy?.schedule?.interval, 'daily', JSON.stringify(lifecycleRes.json));
    assert.equal(lifecycleRes.json?.lifecycle?.backupPolicy?.schedule?.enabled, true, JSON.stringify(lifecycleRes.json));

    const policySetManual = await requestJson(server.baseUrl, `/api/packages/${appId}/backup-policy`, token, {
      method: 'PUT',
      body: {
        schedule: {
          enabled: true,
          interval: 'manual',
          timeOfDay: '03:00'
        }
      }
    });
    assert.equal(policySetManual.status, 200, JSON.stringify(policySetManual.json));
    assert.equal(policySetManual.json?.backupPolicy?.schedule?.interval, 'manual', JSON.stringify(policySetManual.json));
    assert.equal(policySetManual.json?.backupPolicy?.schedule?.enabled, false, JSON.stringify(policySetManual.json));
  } finally {
    await cleanupAppArtifacts(appId);
    await server.close();
  }
});

test('package backup policy validates schedule fields', async () => {
  const server = await createServer();
  const adminUsername = await serverConfig.get('auth.adminUsername').catch(() => process.env.ADMIN_USERNAME || 'admin');
  const token = signToken(adminUsername);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const appId = `it-backup-policy-validate-${suffix}`;

  try {
    const createRes = await requestJson(server.baseUrl, '/api/packages', token, {
      method: 'POST',
      body: {
        id: appId,
        title: `Backup Policy Validate ${suffix}`,
        description: 'backup policy validation integration test package',
        version: '1.0.0',
        runtime: 'sandbox',
        entry: 'index.html'
      }
    });
    assert.equal(createRes.status, 201, JSON.stringify(createRes.json));

    const badInterval = await requestJson(server.baseUrl, `/api/packages/${appId}/backup-policy`, token, {
      method: 'PUT',
      body: {
        schedule: {
          interval: 'yearly'
        }
      }
    });
    assert.equal(badInterval.status, 400, JSON.stringify(badInterval.json));
    assert.equal(badInterval.json?.code, 'PACKAGE_BACKUP_POLICY_INVALID_SCHEDULE_INTERVAL', JSON.stringify(badInterval.json));

    const badTime = await requestJson(server.baseUrl, `/api/packages/${appId}/backup-policy`, token, {
      method: 'PUT',
      body: {
        schedule: {
          interval: 'daily',
          timeOfDay: '99:99'
        }
      }
    });
    assert.equal(badTime.status, 400, JSON.stringify(badTime.json));
    assert.equal(badTime.json?.code, 'PACKAGE_BACKUP_POLICY_INVALID_SCHEDULE_TIME', JSON.stringify(badTime.json));
  } finally {
    await cleanupAppArtifacts(appId);
    await server.close();
  }
});

test('package backup policy returns not found for nonexistent app', async () => {
  const server = await createServer();
  const adminUsername = await serverConfig.get('auth.adminUsername').catch(() => process.env.ADMIN_USERNAME || 'admin');
  const token = signToken(adminUsername);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const appId = `it-backup-policy-missing-${suffix}`;

  try {
    const getRes = await requestJson(server.baseUrl, `/api/packages/${appId}/backup-policy`, token);
    assert.equal(getRes.status, 404, JSON.stringify(getRes.json));
    assert.equal(getRes.json?.code, 'PACKAGE_NOT_FOUND', JSON.stringify(getRes.json));

    const putRes = await requestJson(server.baseUrl, `/api/packages/${appId}/backup-policy`, token, {
      method: 'PUT',
      body: {
        maxBackups: 3
      }
    });
    assert.equal(putRes.status, 404, JSON.stringify(putRes.json));
    assert.equal(putRes.json?.code, 'PACKAGE_NOT_FOUND', JSON.stringify(putRes.json));
  } finally {
    await cleanupAppArtifacts(appId);
    await server.close();
  }
});
