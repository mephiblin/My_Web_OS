const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'ticket-url-contract-secret';
process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';

const fsRouter = require('../routes/fs');
const packagesRouter = require('../routes/packages');
const appPaths = require('../utils/appPaths');
const packageLifecycleService = require('../services/packageLifecycleService');
const fileTicketService = require('../services/fileTicketService');
const serverConfig = require('../config/serverConfig');

function signToken(username = 'ticket-owner') {
  return jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/fs', fsRouter);
  app.use('/api/packages', packagesRouter);

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

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {})
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
  return { response, json, text };
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

async function cleanupAppArtifacts(appId) {
  const appRoot = await appPaths.getAppRoot(appId).catch(() => null);
  if (appRoot) {
    await fs.remove(appRoot).catch(() => {});
  }
  await packageLifecycleService.deleteLifecycle(appId).catch(() => {});
}

test('raw file ticket streams without Authorization while query token remains rejected', async (t) => {
  fileTicketService._resetForTests();
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webos-raw-ticket-'));
  t.after(() => fs.remove(fixtureRoot));
  await withAllowedRoot(t, fixtureRoot);

  const targetPath = path.join(fixtureRoot, 'clip.txt');
  await fs.writeFile(targetPath, 'ticket-stream-ok', 'utf8');
  const server = await createServer();
  t.after(() => server.close());

  const token = signToken('raw-ticket-owner');
  const rejected = await requestJson(
    `${server.baseUrl}/api/fs/raw?path=${encodeURIComponent(targetPath)}&token=${encodeURIComponent(token)}`
  );
  assert.equal(rejected.response.status, 401);
  assert.equal(rejected.json?.code, 'AUTH_REQUIRED');

  const ticketRes = await requestJson(`${server.baseUrl}/api/fs/raw-ticket`, {
    method: 'POST',
    token,
    body: {
      path: targetPath,
      appId: 'media-player'
    }
  });
  assert.equal(ticketRes.response.status, 201, JSON.stringify(ticketRes.json));
  assert.equal(ticketRes.json?.scope, 'fs.raw');
  assert.match(ticketRes.json?.ticket, /^wos_tkt_/);
  assert.doesNotMatch(ticketRes.json?.url, /token=/);

  const streamRes = await fetch(`${server.baseUrl}${ticketRes.json.url}`);
  assert.equal(streamRes.status, 200);
  assert.equal(await streamRes.text(), 'ticket-stream-ok');
});

test('package export ticket downloads package zip without Authorization', async (t) => {
  fileTicketService._resetForTests();
  const server = await createServer();
  t.after(() => server.close());

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const appId = `it-export-ticket-${suffix}`;
  t.after(() => cleanupAppArtifacts(appId));

  const appRoot = await appPaths.getAppRoot(appId);
  await fs.ensureDir(appRoot);
  await fs.writeJson(path.join(appRoot, 'manifest.json'), {
    id: appId,
    title: 'Export Ticket Test',
    version: '1.2.3',
    type: 'app',
    runtime: {
      type: 'sandbox-html',
      entry: 'index.html'
    },
    permissions: []
  });
  await fs.writeFile(path.join(appRoot, 'index.html'), '<!doctype html><p>export-ticket</p>', 'utf8');

  const ticketRes = await requestJson(`${server.baseUrl}/api/packages/${encodeURIComponent(appId)}/export-ticket`, {
    method: 'POST',
    token: signToken('package-ticket-owner'),
    body: {}
  });
  assert.equal(ticketRes.response.status, 201, JSON.stringify(ticketRes.json));
  assert.equal(ticketRes.json?.scope, 'package.export');
  assert.equal(ticketRes.json?.appId, appId);
  assert.doesNotMatch(ticketRes.json?.url, /token=/);

  const exportRes = await fetch(`${server.baseUrl}${ticketRes.json.url}`);
  assert.equal(exportRes.status, 200);
  assert.equal(exportRes.headers.get('content-type'), 'application/zip');
  assert.match(
    exportRes.headers.get('content-disposition') || '',
    new RegExp(`${appId}-1\\.2\\.3\\.webospkg\\.zip`)
  );
  const payload = Buffer.from(await exportRes.arrayBuffer());
  assert.ok(payload.length > 0);
});
