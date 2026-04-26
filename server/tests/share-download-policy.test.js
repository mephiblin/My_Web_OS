const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('fs-extra');
const jwt = require('jsonwebtoken');
const os = require('os');
const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'share-download-policy-secret';
process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';

const shareRouter = require('../routes/share');
const shareService = require('../services/shareService');
const auditService = require('../services/auditService');
const serverConfig = require('../config/serverConfig');

function signToken(username = 'share-policy-owner') {
  return jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/share', shareRouter);

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  };
}

async function request(baseUrl, endpoint, options = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: options.method || 'GET',
    headers: options.headers || {}
  });

  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_err) {
    json = { parseError: true, raw: text };
  }

  return { response, status: response.status, text, json };
}

function installShareFixtures(t, fixtures) {
  const originalGetShare = shareService.getShare;
  const originalGetShareRecord = shareService.getShareRecord;
  const originalRemoveShare = shareService.removeShare;
  const originalAuditLog = auditService.log;
  const auditEntries = [];

  shareService.getShare = (id) => fixtures.get(id) || null;
  shareService.getShareRecord = (id) => fixtures.get(id) || null;
  shareService.removeShare = async (id) => {
    fixtures.delete(id);
  };
  auditService.log = async (category, action, details = {}, level = 'INFO') => {
    auditEntries.push({ category, action, details, level });
  };

  t.after(() => {
    shareService.getShare = originalGetShare;
    shareService.getShareRecord = originalGetShareRecord;
    shareService.removeShare = originalRemoveShare;
    auditService.log = originalAuditLog;
  });

  return auditEntries;
}

async function withAllowedRoot(t, allowedRoot) {
  const previousAllowedRoots = process.env.ALLOWED_ROOTS;
  const previousInitialPath = process.env.INITIAL_PATH;
  process.env.ALLOWED_ROOTS = JSON.stringify([allowedRoot]);
  process.env.INITIAL_PATH = allowedRoot;
  await serverConfig.reload();

  t.after(async () => {
    if (previousAllowedRoots === undefined) {
      delete process.env.ALLOWED_ROOTS;
    } else {
      process.env.ALLOWED_ROOTS = previousAllowedRoots;
    }
    if (previousInitialPath === undefined) {
      delete process.env.INITIAL_PATH;
    } else {
      process.env.INITIAL_PATH = previousInitialPath;
    }
    await serverConfig.reload();
  });
}

test('share download supports Range with 206 Partial Content and Content-Range', async (t) => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webos-share-range-'));
  t.after(() => fs.remove(fixtureRoot));

  const targetPath = path.join(fixtureRoot, 'large.txt');
  const payload = '0123456789abcdefghijklmnopqrstuvwxyz';
  await fs.writeFile(targetPath, payload, 'utf8');
  await withAllowedRoot(t, fixtureRoot);

  const fixtures = new Map([
    ['range-file', {
      id: 'range-file',
      path: targetPath,
      name: 'large.txt',
      createdAt: Date.now(),
      expiryDate: Date.now() + 60_000
    }]
  ]);
  installShareFixtures(t, fixtures);

  const server = await createServer();
  t.after(() => server.close());

  const result = await request(server.baseUrl, '/api/share/download/range-file', {
    headers: { range: 'bytes=5-9' }
  });

  assert.equal(result.status, 206, result.text);
  assert.equal(result.response.headers.get('content-range'), `bytes 5-9/${payload.length}`);
  assert.equal(result.response.headers.get('accept-ranges'), 'bytes');
  assert.equal(result.text, '56789');
});

test('expired share rejects a new download request with structured SHARE_EXPIRED', async (t) => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webos-share-expired-'));
  t.after(() => fs.remove(fixtureRoot));

  const targetPath = path.join(fixtureRoot, 'expired.txt');
  await fs.writeFile(targetPath, 'expired share payload', 'utf8');
  await withAllowedRoot(t, fixtureRoot);

  const fixtures = new Map([
    ['expired-file', {
      id: 'expired-file',
      path: targetPath,
      name: 'expired.txt',
      createdAt: Date.now() - 120_000,
      expiryDate: Date.now() - 60_000
    }]
  ]);
  installShareFixtures(t, fixtures);

  const server = await createServer();
  t.after(() => server.close());

  const result = await request(server.baseUrl, '/api/share/download/expired-file');

  assert.equal(result.status, 410, result.text);
  assert.equal(result.json?.error, true, result.text);
  assert.equal(result.json?.code, 'SHARE_EXPIRED', result.text);
  assert.equal(typeof result.json?.message, 'string', result.text);
  assert.equal(result.json?.details, null, result.text);
});

test('directory share download is rejected until archive policy exists', async (t) => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webos-share-directory-'));
  t.after(() => fs.remove(fixtureRoot));

  const targetPath = path.join(fixtureRoot, 'folder');
  await fs.ensureDir(targetPath);
  await withAllowedRoot(t, fixtureRoot);

  const fixtures = new Map([
    ['directory-share', {
      id: 'directory-share',
      path: targetPath,
      name: 'folder',
      createdAt: Date.now(),
      expiryDate: null
    }]
  ]);
  installShareFixtures(t, fixtures);

  const server = await createServer();
  t.after(() => server.close());

  const result = await request(server.baseUrl, '/api/share/download/directory-share');

  assert.equal(result.status, 400, result.text);
  assert.equal(result.json?.error, true, result.text);
  assert.equal(result.json?.code, 'SHARE_DIRECTORY_UNSUPPORTED', result.text);
  assert.equal(typeof result.json?.message, 'string', result.text);
  assert.equal(result.json?.details, null, result.text);
});

test('deleted or moved share target returns structured SHARE_TARGET_NOT_FOUND', async (t) => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webos-share-missing-'));
  t.after(() => fs.remove(fixtureRoot));
  await withAllowedRoot(t, fixtureRoot);

  const missingPath = path.join(fixtureRoot, 'moved.bin');
  const fixtures = new Map([
    ['missing-target', {
      id: 'missing-target',
      path: missingPath,
      name: 'moved.bin',
      createdAt: Date.now(),
      expiryDate: null
    }]
  ]);
  installShareFixtures(t, fixtures);

  const server = await createServer();
  t.after(() => server.close());

  const result = await request(server.baseUrl, '/api/share/download/missing-target');

  assert.equal(result.status, 404, result.text);
  assert.equal(result.json?.error, true, result.text);
  assert.equal(result.json?.code, 'SHARE_TARGET_NOT_FOUND', result.text);
  assert.equal(typeof result.json?.message, 'string', result.text);
  assert.equal(result.json?.details, null, result.text);
});

test('share creation rejects unsupported optional policy fields before external exposure', async (t) => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webos-share-policy-'));
  t.after(() => fs.remove(fixtureRoot));

  const targetPath = path.join(fixtureRoot, 'policy.txt');
  await fs.writeFile(targetPath, 'policy payload', 'utf8');
  await withAllowedRoot(t, fixtureRoot);

  const server = await createServer();
  t.after(() => server.close());

  const result = await fetch(`${server.baseUrl}/api/share/create`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${signToken()}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      path: targetPath,
      expiryHours: 1,
      password: 'secret',
      maxDownloads: 5,
      rateLimit: { windowMs: 60_000, max: 3 }
    })
  });
  const text = await result.text();
  const json = JSON.parse(text);

  assert.equal(result.status, 400, text);
  assert.equal(json?.error, true, text);
  assert.equal(json?.code, 'SHARE_POLICY_UNSUPPORTED', text);
  assert.deepEqual(json?.details?.fields, ['password', 'maxDownloads', 'rateLimit'], text);
  assert.doesNotMatch(text, /secret/i);
});
