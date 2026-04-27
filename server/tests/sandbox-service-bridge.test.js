const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'sandbox-service-bridge-secret';
process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';

const sandboxRouter = require('../routes/sandbox');
const packageRegistryService = require('../services/packageRegistryService');

function signToken(username = 'service-bridge-owner') {
  return jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

async function createServer(runtimeManager) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.set('runtimeManager', runtimeManager);
  app.use('/api/sandbox', sandboxRouter);

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  };
}

async function requestJson(server, body) {
  const response = await fetch(`${server.baseUrl}/api/sandbox/hybrid-tool/service/request`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${signToken()}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  return {
    status: response.status,
    json: text ? JSON.parse(text) : {}
  };
}

test('sandbox service bridge rejects unsafe paths before proxying', async (t) => {
  const originalGetSandboxApp = packageRegistryService.getSandboxApp;
  packageRegistryService.getSandboxApp = async () => ({
    id: 'hybrid-tool',
    permissions: ['service.bridge']
  });
  t.after(() => {
    packageRegistryService.getSandboxApp = originalGetSandboxApp;
  });

  let connectionInfoCalls = 0;
  const server = await createServer({
    async getServiceConnectionInfo() {
      connectionInfoCalls += 1;
      return {
        port: 38000,
        status: 'running',
        healthStatus: 'healthy'
      };
    },
    getServiceProxyTimeoutMs() {
      return 500;
    }
  });
  t.after(() => server.close());

  for (const unsafePath of [
    'http://127.0.0.1:1/admin',
    '//127.0.0.1:1/admin',
    '/admin/../secret',
    '/admin\\secret',
    '/admin\r\nx-webos-test: bad'
  ]) {
    const result = await requestJson(server, {
      method: 'GET',
      path: unsafePath
    });
    assert.equal(result.status, 400, JSON.stringify(result.json));
    assert.equal(result.json.code, 'SANDBOX_SERVICE_PATH_INVALID');
  }

  assert.equal(connectionInfoCalls, 0, 'unsafe paths should not reach runtime manager');
});

test('sandbox service bridge rejects invalid service ports and oversized bodies', async (t) => {
  const originalGetSandboxApp = packageRegistryService.getSandboxApp;
  packageRegistryService.getSandboxApp = async () => ({
    id: 'hybrid-tool',
    permissions: ['service.bridge']
  });
  t.after(() => {
    packageRegistryService.getSandboxApp = originalGetSandboxApp;
  });

  const invalidPortServer = await createServer({
    async getServiceConnectionInfo() {
      return {
        port: 70000,
        status: 'running',
        healthStatus: 'healthy'
      };
    },
    getServiceProxyTimeoutMs() {
      return 500;
    }
  });
  t.after(() => invalidPortServer.close());

  const invalidPort = await requestJson(invalidPortServer, {
    method: 'GET',
    path: '/health'
  });
  assert.equal(invalidPort.status, 503, JSON.stringify(invalidPort.json));
  assert.equal(invalidPort.json.code, 'RUNTIME_SERVICE_PORT_INVALID');

  const oversizedBodyServer = await createServer({
    async getServiceConnectionInfo() {
      return {
        port: 38000,
        status: 'running',
        healthStatus: 'healthy'
      };
    },
    getServiceProxyTimeoutMs() {
      return 500;
    }
  });
  t.after(() => oversizedBodyServer.close());

  const oversized = await requestJson(oversizedBodyServer, {
    method: 'POST',
    path: '/ingest',
    body: 'x'.repeat((1024 * 1024) + 1)
  });
  assert.equal(oversized.status, 400, JSON.stringify(oversized.json));
  assert.equal(oversized.json.code, 'SANDBOX_SERVICE_BODY_TOO_LARGE');
});
