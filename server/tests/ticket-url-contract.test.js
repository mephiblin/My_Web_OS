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
const sandboxRouter = require('../routes/sandbox');
const appPaths = require('../utils/appPaths');
const packageLifecycleService = require('../services/packageLifecycleService');
const fileTicketService = require('../services/fileTicketService');
const serverConfig = require('../config/serverConfig');
const { redactUrl } = require('../utils/urlRedaction');

const MEDIA_IDLE_TIMEOUT_MS = 45 * 60 * 1000;
const MEDIA_ABSOLUTE_TTL_MS = 8 * 60 * 60 * 1000;

function signToken(username = 'ticket-owner') {
  return jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/fs', fsRouter);
  app.use('/api/packages', packagesRouter);
  app.use('/api/sandbox', sandboxRouter);

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

function timestampMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : NaN;
}

async function createRawTicket(server, token, body) {
  return requestJson(`${server.baseUrl}/api/fs/raw-ticket`, {
    method: 'POST',
    token,
    body
  });
}

async function createMediaLease(server, token, targetPath, appId = 'media-player', extraBody = {}) {
  const ticketRes = await createRawTicket(server, token, {
    path: targetPath,
    appId,
    profile: 'media',
    ...extraBody
  });
  assert.equal(ticketRes.response.status, 201, JSON.stringify(ticketRes.json));
  assert.equal(ticketRes.json?.scope, 'fs.raw');
  assert.equal(ticketRes.json?.profile, 'media');
  assert.match(ticketRes.json?.ticket, /^wos_tkt_/);
  assert.doesNotMatch(ticketRes.json?.url, /token=/);
  return ticketRes.json;
}

async function createRawTicketFixture(t, prefix = 'webos-media-lease-') {
  fileTicketService._resetForTests();
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.remove(fixtureRoot));
  await withAllowedRoot(t, fixtureRoot);

  const server = await createServer();
  t.after(() => server.close());

  return {
    fixtureRoot,
    server,
    token: signToken('media-lease-owner')
  };
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

test('legacy sandbox raw grant URL endpoint is disabled with structured 410', async (t) => {
  const server = await createServer();
  t.after(() => server.close());

  const legacyRes = await requestJson(
    `${server.baseUrl}/api/sandbox/document-viewer/file/raw?path=${encodeURIComponent('/tmp/a.txt')}&grantId=fg_legacy`
  );

  assert.equal(legacyRes.response.status, 410, JSON.stringify(legacyRes.json));
  assert.equal(legacyRes.json?.code, 'SANDBOX_RAW_GRANT_URL_DISABLED');
  assert.equal(legacyRes.json?.details?.replacement, 'POST /api/sandbox/:appId/file/raw-ticket');
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

test('media raw lease supports Range requests and refreshes lastAccess', async (t) => {
  const { fixtureRoot, server, token } = await createRawTicketFixture(t);

  const targetPath = path.join(fixtureRoot, 'clip.bin');
  await fs.writeFile(targetPath, 'abcdefghijklmnopqrstuvwxyz', 'utf8');
  const stats = await fs.stat(targetPath);

  const ticket = await createMediaLease(server, token, targetPath);
  const issuedRecord = fileTicketService.getTicket(ticket.ticket, { scope: 'fs.raw' });

  assert.equal(issuedRecord.profile, 'media');
  assert.equal(issuedRecord.path, targetPath);
  assert.equal(issuedRecord.appId, 'media-player');
  assert.equal(issuedRecord.size, stats.size);
  assert.equal(timestampMs(issuedRecord.mtime), Math.trunc(stats.mtimeMs));
  assert.equal(issuedRecord.idleTimeoutMs, MEDIA_IDLE_TIMEOUT_MS);
  assert.ok(Number.isFinite(timestampMs(issuedRecord.createdAt)));
  assert.ok(Number.isFinite(timestampMs(issuedRecord.lastAccess)));
  assert.ok(Number.isFinite(timestampMs(issuedRecord.absoluteExpiresAt)));
  assert.equal(timestampMs(issuedRecord.lastAccess), timestampMs(issuedRecord.createdAt));
  assert.ok(timestampMs(issuedRecord.absoluteExpiresAt) - timestampMs(issuedRecord.createdAt) <= MEDIA_ABSOLUTE_TTL_MS);

  await sleep(5);
  const streamRes = await fetch(`${server.baseUrl}${ticket.url}`, {
    headers: { range: 'bytes=2-5' }
  });
  assert.equal(streamRes.status, 206);
  assert.equal(await streamRes.text(), 'cdef');
  assert.equal(streamRes.headers.get('content-range'), `bytes 2-5/${stats.size}`);

  const redeemedRecord = fileTicketService.getTicket(ticket.ticket, { scope: 'fs.raw' });
  assert.ok(timestampMs(redeemedRecord.lastAccess) > timestampMs(issuedRecord.lastAccess));
});

test('expired media raw lease returns structured media expiry error', async (t) => {
  const { fixtureRoot, server } = await createRawTicketFixture(t);

  const targetPath = path.join(fixtureRoot, 'expired.txt');
  await fs.writeFile(targetPath, 'expired-media-lease', 'utf8');
  const stats = await fs.stat(targetPath);
  const expiredTicket = fileTicketService.createTicket({
    scope: 'fs.raw',
    user: 'media-lease-owner',
    appId: 'media-player',
    path: targetPath,
    profile: 'media',
    size: stats.size,
    mtime: stats.mtimeMs,
    ttlMs: 1,
    absoluteTtlMs: 1
  });

  await sleep(20);

  const streamRes = await requestJson(`${server.baseUrl}/api/fs/raw?ticket=${encodeURIComponent(expiredTicket.ticket)}`);
  assert.ok([403, 410].includes(streamRes.response.status), JSON.stringify(streamRes.json));
  assert.equal(streamRes.json?.code, 'FS_MEDIA_LEASE_EXPIRED');
  assert.match(streamRes.json?.message || '', /expired/i);
});

test('idle media raw lease returns structured idle timeout error', async (t) => {
  const { fixtureRoot, server } = await createRawTicketFixture(t);

  const targetPath = path.join(fixtureRoot, 'idle.txt');
  await fs.writeFile(targetPath, 'idle-media-lease', 'utf8');
  const stats = await fs.stat(targetPath);
  const idleTicket = fileTicketService.createTicket({
    scope: 'fs.raw',
    user: 'media-lease-owner',
    appId: 'media-player',
    path: targetPath,
    profile: 'media',
    size: stats.size,
    mtime: stats.mtimeMs,
    idleTimeoutMs: 1,
    absoluteTtlMs: MEDIA_ABSOLUTE_TTL_MS
  });

  await sleep(20);

  const streamRes = await requestJson(`${server.baseUrl}/api/fs/raw?ticket=${encodeURIComponent(idleTicket.ticket)}`);
  assert.ok([403, 410].includes(streamRes.response.status), JSON.stringify(streamRes.json));
  assert.equal(streamRes.json?.code, 'FS_MEDIA_LEASE_IDLE_TIMEOUT');
  assert.match(streamRes.json?.message || '', /idle|timeout/i);
});

test('media raw lease rejects target mutation by size and mtime', async (t) => {
  const { fixtureRoot, server, token } = await createRawTicketFixture(t);

  const targetPath = path.join(fixtureRoot, 'mutated.txt');
  await fs.writeFile(targetPath, 'original-media-payload', 'utf8');
  const ticket = await createMediaLease(server, token, targetPath);

  await sleep(5);
  await fs.writeFile(targetPath, 'changed-media-payload-with-different-size', 'utf8');

  const streamRes = await requestJson(`${server.baseUrl}${ticket.url}`);
  assert.ok([403, 409, 410].includes(streamRes.response.status), JSON.stringify(streamRes.json));
  assert.equal(streamRes.json?.code, 'FS_MEDIA_LEASE_TARGET_CHANGED');
  assert.match(streamRes.json?.message || '', /changed|modified|mutation/i);
});

test('media raw lease rejects scope and app mismatches', async (t) => {
  const { fixtureRoot, server, token } = await createRawTicketFixture(t);

  const targetPath = path.join(fixtureRoot, 'scope-app.txt');
  await fs.writeFile(targetPath, 'scope-app-media-lease', 'utf8');
  const ticket = await createMediaLease(server, token, targetPath, 'media-player');

  const wrongScopeRes = await fetch(`${server.baseUrl}/api/packages/${encodeURIComponent('other-app')}/export?ticket=${encodeURIComponent(ticket.ticket)}`);
  const wrongScopeJson = await wrongScopeRes.json();
  assert.equal(wrongScopeRes.status, 403, JSON.stringify(wrongScopeJson));
  assert.equal(wrongScopeJson?.code, 'FS_MEDIA_LEASE_INVALID');
  assert.match(wrongScopeJson?.message || '', /invalid/i);

  assert.throws(
    () => fileTicketService.getTicket(ticket.ticket, { scope: 'fs.raw', appId: 'document-viewer' }),
    (err) => err?.code === 'FS_MEDIA_LEASE_INVALID' && err?.details?.reason === 'app_mismatch'
  );
});

test('raw ticket and media lease URL redaction masks sensitive token values', async (t) => {
  const { fixtureRoot, server, token } = await createRawTicketFixture(t);

  const targetPath = path.join(fixtureRoot, 'redacted.txt');
  await fs.writeFile(targetPath, 'redaction-media-lease', 'utf8');
  const ticket = await createMediaLease(server, token, targetPath);

  const rawUrl = `${ticket.url}&token=jwt-value&authorization=bearer-value&grantId=fg_1&code=oauth&secret=s_1&password=pw&safe=ok`;
  const redacted = redactUrl(rawUrl);

  assert.match(redacted, /safe=ok/);
  assert.match(redacted, /ticket=/);
  assert.match(redacted, /token=/);
  assert.match(redacted, /authorization=/);
  assert.match(redacted, /grantId=/);
  assert.match(redacted, /code=/);
  assert.match(redacted, /secret=/);
  assert.match(redacted, /password=/);
  assert.doesNotMatch(redacted, new RegExp(ticket.ticket.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(redacted, /jwt-value|bearer-value|fg_1|oauth|s_1|pw/);
});
