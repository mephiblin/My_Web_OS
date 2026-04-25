const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';
process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';

const transferRouter = require('../routes/transfer');
const serverConfig = require('../config/serverConfig');

function signToken(username) {
  return jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/transfer', transferRouter);

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
  let json = {};
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

async function waitForTerminal(baseUrl, token, jobId, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const listRes = await requestJson(baseUrl, '/api/transfer/jobs', token);
    if (listRes.status === 200) {
      const jobs = Array.isArray(listRes.json?.jobs) ? listRes.json.jobs : [];
      const job = jobs.find((item) => item.id === jobId);
      if (job && ['completed', 'failed', 'canceled'].includes(String(job.status || '').toLowerCase())) {
        return { job, list: listRes.json };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`Timed out waiting for transfer terminal state: ${jobId}`);
}

async function resolveAllowedRoot() {
  const all = await serverConfig.getAll();
  const roots = Array.isArray(all?.paths?.allowedRoots) ? all.paths.allowedRoots : [];
  const target = String(roots[0] || '').trim();
  assert.ok(target, 'Allowed roots must be configured for transfer integration tests.');
  return path.resolve(target);
}

test('transfer jobs support retry and clear finished history', async () => {
  const server = await createServer();
  const adminUsername = await serverConfig.get('auth.adminUsername').catch(() => process.env.ADMIN_USERNAME || 'admin');
  const token = signToken(adminUsername);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const root = await resolveAllowedRoot();
  const baseDir = path.join(root, '.webos-transfer-test', suffix);
  const sourceDir = path.join(baseDir, 'source');
  const targetDir = path.join(baseDir, 'target');
  const sourcePath = path.join(sourceDir, 'asset.bin');
  const targetPath = path.join(targetDir, 'asset.bin');

  await fs.ensureDir(sourceDir);
  await fs.ensureDir(targetDir);

  try {
    await fs.writeFile(sourcePath, Buffer.alloc(32 * 1024, 7));
    await fs.writeFile(targetPath, Buffer.from('existing target')); // Force first run to fail.

    const firstCreate = await requestJson(server.baseUrl, '/api/transfer/jobs/copy', token, {
      method: 'POST',
      body: {
        sourcePath,
        destinationDir: targetDir
      }
    });
    assert.equal(firstCreate.status, 202, JSON.stringify(firstCreate.json));
    const firstJobId = String(firstCreate.json?.job?.id || '');
    assert.ok(firstJobId, JSON.stringify(firstCreate.json));

    const firstTerminal = await waitForTerminal(server.baseUrl, token, firstJobId);
    assert.equal(firstTerminal.job.status, 'failed', JSON.stringify(firstTerminal.job));

    await fs.remove(targetPath);

    const retryRes = await requestJson(server.baseUrl, `/api/transfer/jobs/${encodeURIComponent(firstJobId)}/retry`, token, {
      method: 'POST'
    });
    assert.equal(retryRes.status, 202, JSON.stringify(retryRes.json));
    const retryJobId = String(retryRes.json?.job?.id || '');
    assert.ok(retryJobId, JSON.stringify(retryRes.json));
    assert.notEqual(retryJobId, firstJobId);

    const retryTerminal = await waitForTerminal(server.baseUrl, token, retryJobId);
    assert.equal(retryTerminal.job.status, 'completed', JSON.stringify(retryTerminal.job));
    assert.equal(await fs.pathExists(targetPath), true);

    const clearRes = await requestJson(server.baseUrl, '/api/transfer/jobs?statuses=completed,error,cancelled', token, {
      method: 'DELETE'
    });
    assert.equal(clearRes.status, 200, JSON.stringify(clearRes.json));
    assert.equal(Number(clearRes.json?.removed || 0) >= 2, true, JSON.stringify(clearRes.json));

    const listAfter = await requestJson(server.baseUrl, '/api/transfer/jobs', token);
    assert.equal(listAfter.status, 200, JSON.stringify(listAfter.json));
    assert.equal(Array.isArray(listAfter.json?.jobs), true, JSON.stringify(listAfter.json));
    assert.equal(listAfter.json.jobs.length, 0, JSON.stringify(listAfter.json));
  } finally {
    await fs.remove(baseDir).catch(() => {});
    await server.close();
  }
});
