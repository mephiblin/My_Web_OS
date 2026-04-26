const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';
process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';

const transferRouter = require('../routes/transfer');
const transferJobService = require('../services/transferJobService');
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

async function waitForServiceStatus(jobId, expectedStatuses, timeoutMs = 12000) {
  const statuses = new Set(Array.isArray(expectedStatuses) ? expectedStatuses : [expectedStatuses]);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const job = transferJobService.getJob(jobId);
    if (job && statuses.has(job.status)) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`Timed out waiting for transfer service status: ${jobId}`);
}

async function resolveAllowedRoot() {
  const all = await serverConfig.getAll();
  const roots = Array.isArray(all?.paths?.allowedRoots) ? all.paths.allowedRoots : [];
  const target = String(roots[0] || '').trim();
  assert.ok(target, 'Allowed roots must be configured for transfer integration tests.');
  return path.resolve(target);
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

async function createTransferTestStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'webos-transfer-jobs-'));
  const jobStoreFile = path.join(dir, 'transfer-jobs.json');
  transferJobService._resetForTests({ jobStoreFile });
  return {
    dir,
    jobStoreFile,
    async cleanup() {
      transferJobService._resetForTests({ jobStoreFile });
      await fs.remove(dir).catch(() => {});
    }
  };
}

function makeStoredJob(overrides = {}) {
  const timestamp = overrides.createdAt || new Date('2026-04-26T00:00:00.000Z').toISOString();
  const destinationPath = overrides.destinationPath || path.join(os.tmpdir(), 'webos-transfer-destination.bin');
  return {
    id: overrides.id || `transfer-test-${Math.random().toString(36).slice(2, 10)}`,
    type: overrides.type || 'copy',
    fileName: overrides.fileName || path.basename(destinationPath),
    status: overrides.status || 'completed',
    source: overrides.source || { path: path.join(os.tmpdir(), 'webos-transfer-source.bin') },
    destinationDir: overrides.destinationDir || path.dirname(destinationPath),
    destinationPath,
    partialPolicy: overrides.partialPolicy || {
      mode: 'cleanup-on-failure',
      tempPath: null,
      resume: false
    },
    createdAt: timestamp,
    startedAt: Object.prototype.hasOwnProperty.call(overrides, 'startedAt') ? overrides.startedAt : timestamp,
    endedAt: Object.prototype.hasOwnProperty.call(overrides, 'endedAt') ? overrides.endedAt : timestamp,
    progress: overrides.progress || {
      transferredBytes: 0,
      totalBytes: null,
      percent: 0,
      updatedAt: timestamp
    },
    error: Object.prototype.hasOwnProperty.call(overrides, 'error') ? overrides.error : null
  };
}

async function writeJobStore(jobStoreFile, jobs) {
  await fs.ensureDir(path.dirname(jobStoreFile));
  await fs.writeJson(
    jobStoreFile,
    {
      version: 1,
      updatedAt: new Date('2026-04-26T00:00:00.000Z').toISOString(),
      jobs
    },
    { spaces: 2 }
  );
}

test('transfer copy rejects symlink source escaping allowed roots', async (t) => {
  const store = await createTransferTestStore();
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webos-transfer-symlink-root-'));
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webos-transfer-symlink-outside-'));
  const sourceTarget = path.join(outsideRoot, 'secret.txt');
  const symlinkPath = path.join(fixtureRoot, 'linked-secret.txt');
  const targetDir = path.join(fixtureRoot, 'target');

  try {
    await withAllowedRoot(t, fixtureRoot);
    await fs.writeFile(sourceTarget, 'outside allowed root', 'utf8');
    await fs.ensureDir(targetDir);
    await fs.symlink(sourceTarget, symlinkPath);

    await assert.rejects(
      () => transferJobService.enqueueCopy({
        sourcePath: symlinkPath,
        destinationDir: targetDir
      }),
      (err) => err?.code === 'FS_PERMISSION_DENIED' || err?.code === 'TRANSFER_PATH_NOT_ALLOWED'
    );
  } finally {
    await fs.remove(fixtureRoot).catch(() => {});
    await fs.remove(outsideRoot).catch(() => {});
    await store.cleanup();
  }
});

test('transfer jobs support retry and clear finished history', async () => {
  const store = await createTransferTestStore();
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
    await store.cleanup();
  }
});

test('transfer job state survives service reload from the durable store', async () => {
  const store = await createTransferTestStore();
  const root = await resolveAllowedRoot();
  const baseDir = path.join(root, '.webos-transfer-test', `persist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const sourceDir = path.join(baseDir, 'source');
  const targetDir = path.join(baseDir, 'target');
  const sourcePath = path.join(sourceDir, 'asset.bin');
  const targetPath = path.join(targetDir, 'asset.bin');

  await fs.ensureDir(sourceDir);
  await fs.ensureDir(targetDir);

  try {
    await fs.writeFile(sourcePath, Buffer.alloc(4096, 3));

    const created = await transferJobService.enqueueCopy({
      sourcePath,
      destinationDir: targetDir
    });
    const completed = await waitForServiceStatus(created.id, 'completed');
    assert.equal(completed.destinationPath, targetPath);
    assert.equal(await fs.pathExists(store.jobStoreFile), true);

    transferJobService._resetForTests({ jobStoreFile: store.jobStoreFile, removeStore: false });
    transferJobService._reloadForTests({ jobStoreFile: store.jobStoreFile });

    const restored = transferJobService.getJob(created.id);
    assert.ok(restored, JSON.stringify(transferJobService.listJobs()));
    assert.equal(restored.status, 'completed');
    assert.equal(restored.destinationPath, targetPath);
    assert.deepEqual(restored.partialPolicy, {
      mode: 'cleanup-on-failure',
      tempPath: null,
      resume: false
    });
  } finally {
    await fs.remove(baseDir).catch(() => {});
    await store.cleanup();
  }
});

test('corrupt transfer job store is preserved and ignored on reload', async () => {
  const store = await createTransferTestStore();

  try {
    await fs.outputFile(store.jobStoreFile, '{ this is not valid json', 'utf8');

    transferJobService._reloadForTests({ jobStoreFile: store.jobStoreFile });

    assert.equal(transferJobService.listJobs().length, 0);
    assert.equal(await fs.pathExists(store.jobStoreFile), false);

    const files = await fs.readdir(store.dir);
    const corruptFiles = files.filter((file) => file.startsWith('transfer-jobs.json.corrupt-'));
    assert.equal(corruptFiles.length, 1, JSON.stringify(files));

    const preserved = await fs.readFile(path.join(store.dir, corruptFiles[0]), 'utf8');
    assert.equal(preserved, '{ this is not valid json');
  } finally {
    await store.cleanup();
  }
});

test('stale running transfer jobs reload as interrupted with visible error evidence', async () => {
  const store = await createTransferTestStore();
  const root = await resolveAllowedRoot();
  const baseDir = path.join(root, '.webos-transfer-test', `interrupted-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const sourcePath = path.join(baseDir, 'source.bin');
  const destinationPath = path.join(baseDir, 'target.bin');
  const runningJob = makeStoredJob({
    id: 'transfer-test-running-restart',
    status: 'running',
    source: { path: sourcePath },
    destinationDir: baseDir,
    destinationPath,
    endedAt: null,
    progress: {
      transferredBytes: 128,
      totalBytes: 1024,
      percent: 13,
      updatedAt: new Date('2026-04-26T00:00:00.000Z').toISOString()
    }
  });

  try {
    await fs.ensureDir(baseDir);
    await writeJobStore(store.jobStoreFile, [runningJob]);

    transferJobService._reloadForTests({ jobStoreFile: store.jobStoreFile });

    const interrupted = transferJobService.getJob(runningJob.id);
    assert.ok(interrupted, JSON.stringify(transferJobService.listJobs()));
    assert.equal(interrupted.status, 'interrupted');
    assert.equal(interrupted.error?.code, 'TRANSFER_JOB_INTERRUPTED');
    assert.equal(interrupted.error?.details?.previousStatus, 'running');
    assert.equal(transferJobService.getSummary().interrupted, 1);

    const persisted = await fs.readJson(store.jobStoreFile);
    assert.equal(persisted.jobs[0].status, 'interrupted');
    assert.equal(persisted.jobs[0].error?.code, 'TRANSFER_JOB_INTERRUPTED');
  } finally {
    await fs.remove(baseDir).catch(() => {});
    await store.cleanup();
  }
});

test('interrupted transfer jobs remain visible and can be retried explicitly', async () => {
  const store = await createTransferTestStore();
  const root = await resolveAllowedRoot();
  const baseDir = path.join(root, '.webos-transfer-test', `retry-interrupted-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const sourceDir = path.join(baseDir, 'source');
  const targetDir = path.join(baseDir, 'target');
  const sourcePath = path.join(sourceDir, 'asset.bin');
  const destinationPath = path.join(targetDir, 'asset.bin');
  const interruptedJob = makeStoredJob({
    id: 'transfer-test-interrupted-retry',
    status: 'interrupted',
    source: { path: sourcePath },
    destinationDir: targetDir,
    destinationPath,
    error: {
      code: 'TRANSFER_JOB_INTERRUPTED',
      message: 'Transfer job was interrupted by backend restart.',
      details: { previousStatus: 'running' }
    }
  });

  try {
    await fs.ensureDir(sourceDir);
    await fs.ensureDir(targetDir);
    await fs.writeFile(sourcePath, Buffer.alloc(4096, 5));
    await writeJobStore(store.jobStoreFile, [interruptedJob]);

    transferJobService._reloadForTests({ jobStoreFile: store.jobStoreFile });

    const visible = transferJobService.listJobs().find((job) => job.id === interruptedJob.id);
    assert.ok(visible, JSON.stringify(transferJobService.listJobs()));
    assert.equal(visible.status, 'interrupted');

    const retry = await transferJobService.retryJob(interruptedJob.id);
    assert.notEqual(retry.id, interruptedJob.id);

    const completed = await waitForServiceStatus(retry.id, 'completed');
    assert.equal(completed.status, 'completed');
    assert.equal(await fs.pathExists(destinationPath), true);
  } finally {
    await fs.remove(baseDir).catch(() => {});
    await store.cleanup();
  }
});

test('finished transfer jobs are pruned only through an explicit clear action', async () => {
  const store = await createTransferTestStore();
  const root = await resolveAllowedRoot();
  const baseDir = path.join(root, '.webos-transfer-test', `prune-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const jobs = ['completed', 'failed', 'canceled', 'interrupted'].map((status) =>
    makeStoredJob({
      id: `transfer-test-prune-${status}`,
      status,
      source: { path: path.join(baseDir, `${status}.source`) },
      destinationDir: baseDir,
      destinationPath: path.join(baseDir, `${status}.target`),
      error: status === 'completed'
        ? null
        : {
            code: `TRANSFER_JOB_${status.toUpperCase()}`,
            message: `Transfer job is ${status}.`
          }
    })
  );

  try {
    await fs.ensureDir(baseDir);
    await writeJobStore(store.jobStoreFile, jobs);
    transferJobService._reloadForTests({ jobStoreFile: store.jobStoreFile });

    assert.equal(transferJobService.listJobs().length, 4);

    const result = transferJobService.clearJobs({
      statuses: ['completed', 'failed', 'canceled', 'interrupted']
    });
    assert.deepEqual(result, {
      removed: 4,
      remaining: 0
    });
    assert.equal(transferJobService.listJobs().length, 0);

    const persisted = await fs.readJson(store.jobStoreFile);
    assert.equal(Array.isArray(persisted.jobs), true);
    assert.equal(persisted.jobs.length, 0);
  } finally {
    await fs.remove(baseDir).catch(() => {});
    await store.cleanup();
  }
});
