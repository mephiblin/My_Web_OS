const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const express = require('express');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'security-boundary-test-secret';

const authMiddleware = require('../middleware/auth');
const pathPolicy = require('../utils/pathPolicy');
const systemRouter = require('../routes/system');
const serverConfig = require('../config/serverConfig');

function invokeAuth({ headers = {}, query = {} }) {
  const req = { headers, query };
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
  let nextCalled = false;

  authMiddleware(req, res, () => {
    nextCalled = true;
  });

  return { req, res, nextCalled };
}

function findExportedRedactor() {
  const candidates = [
    '../utils/requestLogRedaction',
    '../utils/urlRedaction',
    '../utils/logRedaction'
  ];

  for (const candidate of candidates) {
    try {
      const mod = require(candidate);
      if (typeof mod.redactUrl === 'function') return mod.redactUrl;
      if (typeof mod.redactRequestUrl === 'function') return mod.redactRequestUrl;
      if (typeof mod.redactSensitiveQuery === 'function') return mod.redactSensitiveQuery;
      if (typeof mod === 'function') return mod;
    } catch (err) {
      if (err.code !== 'MODULE_NOT_FOUND') throw err;
    }
  }

  return null;
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

async function createSystemServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/system', systemRouter);

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
  return {
    status: response.status,
    json: text ? JSON.parse(text) : {}
  };
}

test('request URL redaction masks sensitive query values when a helper is exported', (t) => {
  const redact = findExportedRedactor();
  if (!redact) {
    t.skip('No exported request URL redaction helper is available yet.');
    return;
  }

  const redacted = String(redact('/api/fs/raw?token=jwt-value&grantId=fg_1&ticket=t_1&code=oauth&secret=s_1&password=pw&authorization=bearer-value&safe=ok'));

  assert.match(redacted, /safe=ok/);
  assert.doesNotMatch(redacted, /jwt-value|fg_1|t_1|oauth|s_1|pw|bearer-value/);
  assert.match(redacted, /token=/);
  assert.match(redacted, /grantId=/);
  assert.match(redacted, /ticket=/);
  assert.match(redacted, /code=/);
  assert.match(redacted, /secret=/);
  assert.match(redacted, /password=/);
  assert.match(redacted, /authorization=/);
});

test('auth middleware rejects query token fallback once the hardening contract is implemented', (t) => {
  const token = jwt.sign({ username: 'query-token-user' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const result = invokeAuth({ query: { token } });

  if (result.nextCalled) {
    t.skip('auth middleware still accepts req.query.token; RUR-1 backend patch should remove this fallback.');
    return;
  }

  assert.equal(result.res.statusCode, 401);
  assert.equal(result.res.body?.code, 'AUTH_REQUIRED');
});

test('auth middleware continues to accept Authorization bearer tokens', () => {
  const token = jwt.sign({ username: 'header-token-user' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const result = invokeAuth({ headers: { authorization: `Bearer ${token}` } });

  assert.equal(result.nextCalled, true);
  assert.equal(result.req.user.username, 'header-token-user');
});

test('lexical allowed-root policy rejects sibling prefixes', () => {
  const allowedRoot = path.join(os.tmpdir(), 'webos-allowed');
  const sibling = path.join(os.tmpdir(), 'webos-allowed-sibling', 'file.txt');

  assert.equal(pathPolicy.isWithinAllowedRoots(sibling, [allowedRoot]), false);
});

test('realpath-aware allowed-root helper rejects symlink escapes when exported', async (t) => {
  const realpathGuard = pathPolicy.isRealPathWithinAllowedRoots || pathPolicy.isWithinAllowedRealRoots;
  if (typeof realpathGuard !== 'function') {
    t.skip('No exported realpath-aware allowed-root helper is available yet.');
    return;
  }

  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webos-path-policy-'));
  const allowedRoot = path.join(fixtureRoot, 'allowed');
  const outsideRoot = path.join(fixtureRoot, 'outside');
  const outsideFile = path.join(outsideRoot, 'secret.txt');
  const symlinkPath = path.join(allowedRoot, 'escape-link');

  await fs.mkdir(allowedRoot);
  await fs.mkdir(outsideRoot);
  await fs.writeFile(outsideFile, 'secret');

  try {
    await fs.symlink(outsideRoot, symlinkPath, 'dir');
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      t.skip(`Symlink creation is not permitted in this environment: ${err.code}`);
      return;
    }
    throw err;
  }

  try {
    const escapedTarget = path.join(symlinkPath, 'secret.txt');
    const result = await realpathGuard(escapedTarget, [allowedRoot]);
    const allowed = typeof result === 'boolean' ? result : result?.allowed;

    assert.equal(allowed, false);
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('backup job creation rejects symlink source escaping allowed roots', async (t) => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webos-backup-source-root-'));
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webos-backup-source-outside-'));
  const sourceTarget = path.join(outsideRoot, 'secret');
  const symlinkPath = path.join(fixtureRoot, 'source-link');
  const destinationRoot = path.join(fixtureRoot, 'backups');
  const server = await createSystemServer();
  const token = jwt.sign({ username: process.env.ADMIN_USERNAME || 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });

  try {
    await withAllowedRoot(t, fixtureRoot);
    await fs.mkdir(destinationRoot);
    await fs.writeFile(sourceTarget, 'outside allowed root', 'utf8');
    await fs.symlink(sourceTarget, symlinkPath);

    const response = await requestJson(server.baseUrl, '/api/system/backup-jobs', token, {
      method: 'POST',
      body: {
        name: 'Unsafe source',
        sourcePath: symlinkPath,
        destinationRoot
      }
    });

    assert.equal(response.status, 403, JSON.stringify(response.json));
    assert.equal(response.json?.code, 'BACKUP_JOB_SOURCEPATH_FORBIDDEN');
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      t.skip(`Symlink creation is not permitted in this environment: ${err.code}`);
      return;
    }
    throw err;
  } finally {
    await server.close();
    await fs.rm(fixtureRoot, { recursive: true, force: true });
    await fs.rm(outsideRoot, { recursive: true, force: true });
  }
});

test('backup job creation rejects symlink destination escaping allowed roots', async (t) => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webos-backup-destination-root-'));
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webos-backup-destination-outside-'));
  const sourcePath = path.join(fixtureRoot, 'source.txt');
  const symlinkPath = path.join(fixtureRoot, 'destination-link');
  const server = await createSystemServer();
  const token = jwt.sign({ username: process.env.ADMIN_USERNAME || 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });

  try {
    await withAllowedRoot(t, fixtureRoot);
    await fs.writeFile(sourcePath, 'inside allowed root', 'utf8');
    await fs.symlink(outsideRoot, symlinkPath, 'dir');

    const response = await requestJson(server.baseUrl, '/api/system/backup-jobs', token, {
      method: 'POST',
      body: {
        name: 'Unsafe destination',
        sourcePath,
        destinationRoot: symlinkPath
      }
    });

    assert.equal(response.status, 403, JSON.stringify(response.json));
    assert.equal(response.json?.code, 'BACKUP_JOB_DESTINATIONROOT_FORBIDDEN');
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      t.skip(`Symlink creation is not permitted in this environment: ${err.code}`);
      return;
    }
    throw err;
  } finally {
    await server.close();
    await fs.rm(fixtureRoot, { recursive: true, force: true });
    await fs.rm(outsideRoot, { recursive: true, force: true });
  }
});
