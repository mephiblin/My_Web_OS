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

async function waitForJobTerminalState(baseUrl, appId, jobId, token, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const listRes = await requestJson(baseUrl, `/api/packages/${appId}/backup-jobs`, token);
    if (listRes.status === 200) {
      const jobs = Array.isArray(listRes.json?.jobs) ? listRes.json.jobs : [];
      const target = jobs.find((item) => item.id === jobId);
      if (target && ['completed', 'failed', 'canceled'].includes(String(target.status || '').toLowerCase())) {
        return target;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`Timed out waiting for backup job terminal state: ${jobId}`);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
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

test('package backup jobs create and complete lifecycle', async () => {
  assert.equal(typeof fetch, 'function', 'Global fetch must be available for integration tests.');

  const server = await createServer();
  const adminUsername = await serverConfig.get('auth.adminUsername').catch(() => process.env.ADMIN_USERNAME || 'admin');
  const token = signToken(adminUsername);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const appId = `it-backup-job-${suffix}`;

  try {
    const createRes = await requestJson(server.baseUrl, '/api/packages', token, {
      method: 'POST',
      body: {
        id: appId,
        title: `Backup Job ${suffix}`,
        description: 'backup job integration test package',
        version: '1.0.0',
        runtime: 'sandbox',
        entry: 'index.html'
      }
    });
    assert.equal(createRes.status, 201, JSON.stringify(createRes.json));

    const queueRes = await requestJson(server.baseUrl, `/api/packages/${appId}/backup-jobs`, token, {
      method: 'POST',
      body: { note: 'integration backup job' }
    });
    assert.equal(queueRes.status, 201, JSON.stringify(queueRes.json));
    assert.equal(queueRes.json?.success, true, JSON.stringify(queueRes.json));
    const jobId = String(queueRes.json?.job?.id || '');
    assert.ok(jobId, JSON.stringify(queueRes.json));

    const terminalJob = await waitForJobTerminalState(server.baseUrl, appId, jobId, token, 12000);
    assert.equal(terminalJob.status, 'completed', JSON.stringify(terminalJob));
    assert.ok(String(terminalJob.backupId || '').trim().length > 0, JSON.stringify(terminalJob));

    const listRes = await requestJson(server.baseUrl, `/api/packages/${appId}/backup-jobs`, token);
    assert.equal(listRes.status, 200, JSON.stringify(listRes.json));
    const listed = Array.isArray(listRes.json?.jobs) ? listRes.json.jobs : [];
    assert.equal(listed.some((item) => item.id === jobId), true, JSON.stringify(listRes.json));
  } finally {
    await cleanupAppArtifacts(appId);
    await server.close();
  }
});

test('package backup jobs reject cancel on completed job', async () => {
  assert.equal(typeof fetch, 'function', 'Global fetch must be available for integration tests.');

  const server = await createServer();
  const adminUsername = await serverConfig.get('auth.adminUsername').catch(() => process.env.ADMIN_USERNAME || 'admin');
  const token = signToken(adminUsername);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const appId = `it-backup-cancel-${suffix}`;

  try {
    const createRes = await requestJson(server.baseUrl, '/api/packages', token, {
      method: 'POST',
      body: {
        id: appId,
        title: `Backup Cancel ${suffix}`,
        description: 'backup cancel integration test package',
        version: '1.0.0',
        runtime: 'sandbox',
        entry: 'index.html'
      }
    });
    assert.equal(createRes.status, 201, JSON.stringify(createRes.json));

    const queueRes = await requestJson(server.baseUrl, `/api/packages/${appId}/backup-jobs`, token, {
      method: 'POST',
      body: { note: 'integration cancel check' }
    });
    assert.equal(queueRes.status, 201, JSON.stringify(queueRes.json));
    const jobId = String(queueRes.json?.job?.id || '');
    assert.ok(jobId, JSON.stringify(queueRes.json));

    await waitForJobTerminalState(server.baseUrl, appId, jobId, token, 12000);

    const cancelRes = await requestJson(server.baseUrl, `/api/packages/${appId}/backup-jobs/${jobId}/cancel`, token, {
      method: 'POST'
    });
    assert.equal(cancelRes.status, 409, JSON.stringify(cancelRes.json));
    assert.equal(cancelRes.json?.code, 'PACKAGE_BACKUP_JOB_NOT_CANCELABLE', JSON.stringify(cancelRes.json));
  } finally {
    await cleanupAppArtifacts(appId);
    await server.close();
  }
});

test('package backup jobs handle queued-to-running cancel race without inconsistent state', async () => {
  assert.equal(typeof fetch, 'function', 'Global fetch must be available for integration tests.');

  const server = await createServer();
  const adminUsername = await serverConfig.get('auth.adminUsername').catch(() => process.env.ADMIN_USERNAME || 'admin');
  const token = signToken(adminUsername);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const appId = `it-backup-cancel-race-${suffix}`;
  const originalCreateBackup = packageLifecycleService.createBackup.bind(packageLifecycleService);

  packageLifecycleService.createBackup = async (...args) => {
    await sleep(250);
    return originalCreateBackup(...args);
  };

  try {
    const createRes = await requestJson(server.baseUrl, '/api/packages', token, {
      method: 'POST',
      body: {
        id: appId,
        title: `Backup Cancel Race ${suffix}`,
        description: 'backup queued/running cancel race integration test package',
        version: '1.0.0',
        runtime: 'sandbox',
        entry: 'index.html'
      }
    });
    assert.equal(createRes.status, 201, JSON.stringify(createRes.json));

    const queueRes = await requestJson(server.baseUrl, `/api/packages/${appId}/backup-jobs`, token, {
      method: 'POST',
      body: { note: 'integration queued/running cancel race' }
    });
    assert.equal(queueRes.status, 201, JSON.stringify(queueRes.json));
    const jobId = String(queueRes.json?.job?.id || '');
    assert.ok(jobId, JSON.stringify(queueRes.json));

    const cancelRes = await requestJson(server.baseUrl, `/api/packages/${appId}/backup-jobs/${jobId}/cancel`, token, {
      method: 'POST'
    });
    assert.equal([200, 409].includes(cancelRes.status), true, JSON.stringify(cancelRes.json));
    if (cancelRes.status === 200) {
      assert.equal(cancelRes.json?.job?.status, 'canceled', JSON.stringify(cancelRes.json));
      assert.equal(cancelRes.json?.job?.error?.code, 'PACKAGE_BACKUP_JOB_CANCELED', JSON.stringify(cancelRes.json));
    } else {
      assert.equal(cancelRes.json?.code, 'PACKAGE_BACKUP_JOB_NOT_CANCELABLE', JSON.stringify(cancelRes.json));
    }

    const terminalJob = await waitForJobTerminalState(server.baseUrl, appId, jobId, token, 15000);
    if (cancelRes.status === 200) {
      assert.equal(terminalJob.status, 'canceled', JSON.stringify(terminalJob));
      assert.equal(terminalJob.error?.code, 'PACKAGE_BACKUP_JOB_CANCELED', JSON.stringify(terminalJob));
    } else {
      assert.equal(terminalJob.status, 'completed', JSON.stringify(terminalJob));
      assert.ok(String(terminalJob.backupId || '').trim().length > 0, JSON.stringify(terminalJob));
    }
  } finally {
    packageLifecycleService.createBackup = originalCreateBackup;
    await cleanupAppArtifacts(appId);
    await server.close();
  }
});
