const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';

const dockerRouter = require('../routes/docker');
const operationApprovalService = require('../services/operationApprovalService');
const {
  buildDockerApprovalTargetHash,
  parseDockerJsonLines
} = require('../services/dockerService');

function signToken(username = 'admin') {
  return jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/docker', dockerRouter);

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

test('parseDockerJsonLines handles newline-delimited docker --format json output', () => {
  const output = [
    '{"ID":"a1","Names":"api"}',
    '{"ID":"b2","Names":"worker"}'
  ].join('\n');

  const rows = parseDockerJsonLines(output);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].ID, 'a1');
  assert.equal(rows[1].Names, 'worker');
});

test('parseDockerJsonLines handles docker compose array JSON output', () => {
  const output = JSON.stringify([
    { Name: 'stack-a', Status: 'running(2)' },
    { Name: 'stack-b', Status: 'exited(1)' }
  ]);

  const rows = parseDockerJsonLines(output);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].Name, 'stack-a');
  assert.equal(rows[1].Status, 'exited(1)');
});

test('buildDockerApprovalTargetHash is stable and action scoped', () => {
  const stopHash = buildDockerApprovalTargetHash({ id: 'webos-api', action: 'stop' });
  assert.equal(stopHash, buildDockerApprovalTargetHash({ id: 'webos-api', action: 'stop' }));
  assert.notEqual(stopHash, buildDockerApprovalTargetHash({ id: 'webos-api', action: 'remove' }));
});

test('docker stop requires backend approval before command execution', async () => {
  operationApprovalService._resetForTests();
  const server = await createServer();
  const token = signToken('docker-owner');

  try {
    const blocked = await requestJson(server.baseUrl, '/api/docker/stop', token, {
      method: 'POST',
      body: { id: 'webos-api' }
    });
    assert.equal(blocked.status, 428, JSON.stringify(blocked.json));
    assert.equal(blocked.json?.code, 'DOCKER_CONTAINER_STOP_APPROVAL_REQUIRED', JSON.stringify(blocked.json));
    assert.equal(blocked.json?.preflight?.action, 'docker.stop', JSON.stringify(blocked.json));
    assert.equal(blocked.json?.preflight?.approval?.typedConfirmation, 'webos-api', JSON.stringify(blocked.json));
  } finally {
    await server.close();
  }
});

test('docker remove preflight and approval issue scoped nonce without running docker', async () => {
  operationApprovalService._resetForTests();
  const server = await createServer();
  const token = signToken('docker-owner');

  try {
    const preflight = await requestJson(server.baseUrl, '/api/docker/remove/preflight', token, {
      method: 'POST',
      body: { id: 'webos-api' }
    });
    assert.equal(preflight.status, 200, JSON.stringify(preflight.json));
    assert.equal(preflight.json?.preflight?.action, 'docker.remove', JSON.stringify(preflight.json));

    const approve = await requestJson(server.baseUrl, '/api/docker/remove/approve', token, {
      method: 'POST',
      body: {
        id: 'webos-api',
        operationId: preflight.json.preflight.operationId,
        typedConfirmation: 'webos-api'
      }
    });
    assert.equal(approve.status, 200, JSON.stringify(approve.json));
    assert.equal(approve.json?.approval?.operationId, preflight.json.preflight.operationId, JSON.stringify(approve.json));
    assert.ok(approve.json?.approval?.nonce, JSON.stringify(approve.json));
  } finally {
    await server.close();
  }
});
