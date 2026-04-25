const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';

const fsRouter = require('../routes/fs');
const fileGrantService = require('../services/fileGrantService');

function signToken(username = 'admin') {
  return jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/fs', fsRouter);

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
  return { status: response.status, json };
}

test('file grant service revokes grants by user and source', () => {
  const grant = fileGrantService.createGrant({
    path: '/tmp/web-os-preview-grant.txt',
    mode: 'read',
    appId: 'doc-viewer',
    source: 'file-station',
    user: 'grant-owner'
  });

  assert.equal(fileGrantService.listActiveGrants({ user: 'grant-owner', source: 'file-station' }).some((item) => item.id === grant.id), true);
  const revoked = fileGrantService.revokeGrant(grant.id, { user: 'grant-owner', source: 'file-station' });
  assert.equal(revoked.id, grant.id);
  assert.equal(fileGrantService.listActiveGrants({ user: 'grant-owner', source: 'file-station' }).some((item) => item.id === grant.id), false);
});

test('file grant service revokes multiple grants without crossing user/source boundaries', () => {
  const previewGrant = fileGrantService.createGrant({
    path: '/tmp/web-os-preview-a.txt',
    mode: 'read',
    appId: 'doc-viewer',
    source: 'file-station-preview',
    user: 'bulk-owner'
  });
  const openGrant = fileGrantService.createGrant({
    path: '/tmp/web-os-open-a.txt',
    mode: 'readwrite',
    appId: 'editor',
    source: 'file-station',
    user: 'bulk-owner'
  });
  const otherUserGrant = fileGrantService.createGrant({
    path: '/tmp/web-os-other-user.txt',
    mode: 'read',
    appId: 'doc-viewer',
    source: 'file-station-preview',
    user: 'bulk-other'
  });

  const revoked = fileGrantService.revokeGrants({ user: 'bulk-owner', source: 'file-station-preview' });
  assert.deepEqual(revoked.map((item) => item.id), [previewGrant.id]);
  assert.equal(fileGrantService.listActiveGrants({ user: 'bulk-owner' }).some((item) => item.id === openGrant.id), true);
  assert.equal(fileGrantService.listActiveGrants({ user: 'bulk-other' }).some((item) => item.id === otherUserGrant.id), true);

  fileGrantService.revokeGrant(openGrant.id, { user: 'bulk-owner' });
  fileGrantService.revokeGrant(otherUserGrant.id, { user: 'bulk-other' });
});

test('file grant revoke route removes current-user grants without pathGuard', async () => {
  const server = await createServer();
  const token = signToken('route-owner');
  const grant = fileGrantService.createGrant({
    path: '/tmp/web-os-route-preview-grant.txt',
    mode: 'read',
    appId: 'doc-viewer',
    source: 'file-station',
    user: 'route-owner'
  });

  try {
    const response = await requestJson(server.baseUrl, `/api/fs/grants/${encodeURIComponent(grant.id)}?source=file-station`, token, {
      method: 'DELETE'
    });

    assert.equal(response.status, 200, JSON.stringify(response.json));
    assert.equal(response.json?.success, true);
    assert.equal(response.json?.revoked?.id, grant.id);
    assert.equal(fileGrantService.listActiveGrants({ user: 'route-owner', source: 'file-station' }).some((item) => item.id === grant.id), false);
  } finally {
    await server.close();
  }
});

test('file grant revoke-all route removes current-user grants with optional source filter', async () => {
  const server = await createServer();
  const token = signToken('route-bulk-owner');
  const previewGrant = fileGrantService.createGrant({
    path: '/tmp/web-os-route-preview-a.txt',
    mode: 'read',
    appId: 'doc-viewer',
    source: 'file-station-preview',
    user: 'route-bulk-owner'
  });
  const openGrant = fileGrantService.createGrant({
    path: '/tmp/web-os-route-open-a.txt',
    mode: 'readwrite',
    appId: 'editor',
    source: 'file-station',
    user: 'route-bulk-owner'
  });
  const otherUserGrant = fileGrantService.createGrant({
    path: '/tmp/web-os-route-other.txt',
    mode: 'read',
    appId: 'doc-viewer',
    source: 'file-station-preview',
    user: 'route-bulk-other'
  });

  try {
    const filtered = await requestJson(server.baseUrl, '/api/fs/grants?source=file-station-preview', token, {
      method: 'DELETE'
    });

    assert.equal(filtered.status, 200, JSON.stringify(filtered.json));
    assert.equal(filtered.json?.success, true);
    assert.deepEqual(filtered.json?.revoked?.map((item) => item.id), [previewGrant.id]);
    assert.equal(fileGrantService.listActiveGrants({ user: 'route-bulk-owner' }).some((item) => item.id === openGrant.id), true);
    assert.equal(fileGrantService.listActiveGrants({ user: 'route-bulk-other' }).some((item) => item.id === otherUserGrant.id), true);

    const all = await requestJson(server.baseUrl, '/api/fs/grants', token, { method: 'DELETE' });
    assert.equal(all.status, 200, JSON.stringify(all.json));
    assert.deepEqual(all.json?.revoked?.map((item) => item.id), [openGrant.id]);
    assert.equal(fileGrantService.listActiveGrants({ user: 'route-bulk-owner' }).length, 0);
    assert.equal(fileGrantService.listActiveGrants({ user: 'route-bulk-other' }).some((item) => item.id === otherUserGrant.id), true);
  } finally {
    fileGrantService.revokeGrant(otherUserGrant.id, { user: 'route-bulk-other' });
    await server.close();
  }
});
