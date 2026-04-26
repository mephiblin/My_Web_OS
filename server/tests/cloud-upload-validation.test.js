const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';
process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';

const cloudRouter = require('../routes/cloud');
const cloudService = require('../services/cloudService');
const cloudTransferJobService = require('../services/cloudTransferJobService');
const operationApprovalService = require('../services/operationApprovalService');
const serverConfig = require('../config/serverConfig');

function signToken(username = 'admin') {
  return jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/cloud', cloudRouter);

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
      ...(options.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
      ...(options.headers || {})
    },
    body: options.body instanceof FormData
      ? options.body
      : (options.body !== undefined ? JSON.stringify(options.body) : undefined)
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_err) {
    json = { parseError: true, raw: text };
  }

  return { status: response.status, json };
}

async function withFakeRclone(script, fn) {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-rclone-test-'));
  const binPath = path.join(tmpRoot, 'rclone');
  const originalPath = process.env.PATH;
  await fs.writeFile(binPath, script, { mode: 0o755 });
  process.env.PATH = `${tmpRoot}${path.delimiter}${originalPath || ''}`;
  try {
    return await fn();
  } finally {
    process.env.PATH = originalPath;
    await fs.remove(tmpRoot).catch(() => {});
  }
}

async function createCloudTransferTestStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'webos-cloud-transfer-jobs-'));
  const jobStoreFile = path.join(dir, 'cloud-transfer-jobs.json');
  cloudTransferJobService._resetForTests({ jobStoreFile });
  operationApprovalService._resetForTests();
  return {
    dir,
    jobStoreFile,
    async cleanup() {
      cloudTransferJobService._resetForTests({ jobStoreFile });
      operationApprovalService._resetForTests();
      await fs.remove(dir).catch(() => {});
    }
  };
}

async function waitForJob(baseUrl, token, jobId, predicate, timeoutMs = 3000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    const result = await requestJson(baseUrl, `/api/cloud/upload-jobs/${jobId}`, token);
    if (result.status === 200 && predicate(result.json?.job)) return result.json.job;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

async function waitForCloudTransferJob(baseUrl, token, jobId, predicate, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    const result = await requestJson(baseUrl, `/api/cloud/transfer-jobs/${jobId}`, token);
    if (result.status === 200 && predicate(result.json?.job)) return result.json.job;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return null;
}

async function withAllowedRoot(allowedRoot, fn) {
  const previousAllowedRoots = process.env.ALLOWED_ROOTS;
  const previousInitialPath = process.env.INITIAL_PATH;
  process.env.ALLOWED_ROOTS = JSON.stringify([allowedRoot]);
  process.env.INITIAL_PATH = allowedRoot;
  await serverConfig.reload();
  try {
    return await fn();
  } finally {
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
  }
}

async function createCloudTransferTestStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'webos-cloud-transfer-jobs-'));
  const jobStoreFile = path.join(dir, 'cloud-transfer-jobs.json');
  cloudTransferJobService._resetForTests({ jobStoreFile });
  operationApprovalService._resetForTests();
  return {
    dir,
    jobStoreFile,
    async cleanup() {
      cloudTransferJobService._resetForTests({ jobStoreFile });
      operationApprovalService._resetForTests();
      await fs.remove(dir).catch(() => {});
    }
  };
}

async function writeCloudTransferStore(jobStoreFile, jobs) {
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

function makeCloudTransferJob(overrides = {}) {
  const timestamp = overrides.createdAt || new Date('2026-04-26T00:00:00.000Z').toISOString();
  const targetPath = overrides.targetPath || 'backup/demo.txt';
  const sourcePath = overrides.sourcePath || path.join(os.tmpdir(), 'webos-cloud-transfer-source.bin');
  return {
    id: overrides.id || `cloud-transfer-test-${Math.random().toString(36).slice(2, 10)}`,
    type: 'cloud-upload',
    status: overrides.status || 'failed',
    sourcePath,
    sourceRealPath: overrides.sourceRealPath || sourcePath,
    fileName: overrides.fileName || path.basename(sourcePath),
    remote: overrides.remote || 'remote1',
    remotePath: overrides.remotePath || 'backup',
    targetPath,
    overwrite: Boolean(overrides.overwrite),
    provider: overrides.provider || 'remote1',
    rclone: overrides.rclone || {
      command: 'copyto',
      flags: ['--retries', '3']
    },
    approval: overrides.approval || null,
    createdAt: timestamp,
    startedAt: Object.prototype.hasOwnProperty.call(overrides, 'startedAt') ? overrides.startedAt : timestamp,
    endedAt: Object.prototype.hasOwnProperty.call(overrides, 'endedAt') ? overrides.endedAt : timestamp,
    cancelRequestedAt: overrides.cancelRequestedAt || null,
    nextRetryAt: overrides.nextRetryAt || null,
    progress: overrides.progress || {
      transferredBytes: 0,
      totalBytes: null,
      percent: 0,
      updatedAt: timestamp
    },
    error: Object.prototype.hasOwnProperty.call(overrides, 'error') ? overrides.error : {
      code: 'CLOUD_TRANSFER_FAILED',
      message: 'Cloud transfer failed.'
    }
  };
}

function getJobProvider(job) {
  return job?.provider || job?.error?.details?.provider || null;
}

function getJobNextRetryAt(job) {
  return job?.nextRetryAt || job?.error?.details?.nextRetryAt || null;
}

function getJobStderrSummary(job) {
  return job?.stderrSummary || job?.error?.details?.stderrSummary || job?.error?.details?.stderr || '';
}

function assertRetryDate(value, context) {
  assert.equal(typeof value, 'string', context);
  assert.ok(!Number.isNaN(Date.parse(value)), context);
  assert.ok(Date.parse(value) >= Date.now() - 1000, context);
}

test('cloud WebDAV setup passes credentials to rclone without shell evaluation', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-rclone-webdav-shell-'));
  const argsPath = path.join(tmpRoot, 'args.txt');
  const markerPath = path.join(tmpRoot, 'shell-injection-marker');
  const fakeRclone = `#!/usr/bin/env bash
set -e
printf '%s\\n' "$*" >> "${argsPath}"
if [[ "$*" == *"obscure"* ]]; then
  echo "obscured-password"
  exit 0
fi
exit 0
`;

  try {
    await withFakeRclone(fakeRclone, async () => {
      const injectionValue = `$(touch ${markerPath})`;
      const result = await cloudService.addWebDAV('davsafe', 'https://example.test/webdav', injectionValue, injectionValue);

      assert.deepEqual(result, { success: true });
      assert.equal(await fs.pathExists(markerPath), false);
      const argsLog = await fs.readFile(argsPath, 'utf8');
      assert.match(argsLog, /\$\(touch /);
      assert.match(argsLog, /config create davsafe webdav/);
    });
  } finally {
    await fs.remove(tmpRoot).catch(() => {});
  }
});

test('cloud upload route validates missing remote and missing file', async () => {
  const server = await createServer();
  const token = signToken();
  try {
    const missingRemote = await requestJson(server.baseUrl, '/api/cloud/upload', token, {
      method: 'POST',
      body: {}
    });
    assert.equal(missingRemote.status, 400, JSON.stringify(missingRemote.json));
    assert.equal(missingRemote.json?.code, 'CLOUD_UPLOAD_INVALID_REMOTE', JSON.stringify(missingRemote.json));

    const form = new FormData();
    form.append('remote', 'myremote');
    form.append('path', '');
    form.append('fileName', 'demo.txt');
    const missingFile = await requestJson(server.baseUrl, '/api/cloud/upload', token, {
      method: 'POST',
      body: form
    });
    assert.equal(missingFile.status, 400, JSON.stringify(missingFile.json));
    assert.equal(missingFile.json?.code, 'CLOUD_UPLOAD_INVALID_FILE', JSON.stringify(missingFile.json));
  } finally {
    await server.close();
  }
});

test('cloud raw tickets stream WebDAV/rclone files without frontend auth and support byte ranges', async () => {
  const content = 'hello-webdav';
  const fakeRclone = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes('lsjson')) {
  console.log(JSON.stringify([{
    Name: 'clip.txt',
    Path: 'docs/clip.txt',
    Size: ${content.length},
    ModTime: '2026-04-26T00:00:00.000Z',
    IsDir: false,
    MimeType: 'text/plain'
  }]));
  process.exit(0);
}
if (args.includes('cat')) {
  const text = ${JSON.stringify(content)};
  const offsetIndex = args.indexOf('--offset');
  const countIndex = args.indexOf('--count');
  const offset = offsetIndex >= 0 ? Number(args[offsetIndex + 1]) : 0;
  const count = countIndex >= 0 ? Number(args[countIndex + 1]) : text.length - offset;
  process.stdout.write(text.slice(offset, offset + count));
  process.exit(0);
}
process.exit(0);
`;

  await withFakeRclone(fakeRclone, async () => {
    const server = await createServer();
    const token = signToken();
    try {
      const previewTicket = await requestJson(server.baseUrl, '/api/cloud/raw-ticket', token, {
        method: 'POST',
        body: {
          path: 'cloud://remote1/docs/clip.txt'
        }
      });
      assert.equal(previewTicket.status, 201, JSON.stringify(previewTicket.json));
      assert.equal(previewTicket.json?.scope, 'cloud.raw', JSON.stringify(previewTicket.json));

      const raw = await fetch(`${server.baseUrl}${previewTicket.json.url}`);
      assert.equal(raw.status, 200);
      assert.match(raw.headers.get('content-type') || '', /text\/plain/);
      assert.equal(await raw.text(), content);

      const mediaTicket = await requestJson(server.baseUrl, '/api/cloud/raw-ticket', token, {
        method: 'POST',
        body: {
          path: 'cloud://remote1/docs/clip.txt',
          profile: 'media',
          appId: 'media-player'
        }
      });
      assert.equal(mediaTicket.status, 201, JSON.stringify(mediaTicket.json));

      const range = await fetch(`${server.baseUrl}${mediaTicket.json.url}`, {
        headers: {
          range: 'bytes=6-11'
        }
      });
      assert.equal(range.status, 206);
      assert.equal(range.headers.get('content-range'), `bytes 6-11/${content.length}`);
      assert.equal(await range.text(), 'webdav');
    } finally {
      await server.close();
    }
  });
});

test('cloud service upload validation rejects invalid filename and too-large file before remote lookup', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-upload-test-'));
  const oversizedPath = path.join(tmpRoot, 'oversized.bin');

  try {
    const invalidNameErr = await cloudService
      .uploadRemoteFileFromPath('remote1', '', 'bad;name.txt', '/tmp/none')
      .catch((err) => err);
    assert.equal(invalidNameErr?.code, 'CLOUD_UPLOAD_INVALID_FILENAME');

    await fs.ensureFile(oversizedPath);
    await fs.truncate(oversizedPath, 64 * 1024 * 1024 + 1);
    const tooLargeErr = await cloudService
      .uploadRemoteFileFromPath('remote1', '', 'big.bin', oversizedPath)
      .catch((err) => err);
    assert.equal(tooLargeErr?.code, 'CLOUD_UPLOAD_TOO_LARGE');
  } finally {
    await fs.remove(tmpRoot).catch(() => {});
  }
});

test('cloud upload async route exposes running status and accepts cancel', async () => {
  const fakeRclone = `#!/usr/bin/env node
const args = process.argv.slice(2).join(' ');
if (args.includes('listremotes')) {
  console.log('remote1:');
  process.exit(0);
}
if (args.includes('rcat')) {
  process.stdin.resume();
  process.on('SIGTERM', () => process.exit(143));
  setInterval(() => {}, 1000);
  return;
}
process.exit(0);
`;

  await withFakeRclone(fakeRclone, async () => {
    const server = await createServer();
    const token = signToken();
    try {
      const form = new FormData();
      form.append('remote', 'remote1');
      form.append('path', 'folder');
      form.append('fileName', 'demo.txt');
      form.append('async', 'true');
      form.append('file', new Blob(['hello cloud']), 'demo.txt');

      const uploadRes = await requestJson(server.baseUrl, '/api/cloud/upload', token, {
        method: 'POST',
        body: form
      });
      assert.equal(uploadRes.status, 202, JSON.stringify(uploadRes.json));
      assert.equal(uploadRes.json?.success, true, JSON.stringify(uploadRes.json));
      assert.equal(uploadRes.json?.status, 'running', JSON.stringify(uploadRes.json));
      assert.ok(uploadRes.json?.jobId, JSON.stringify(uploadRes.json));

      const statusRes = await requestJson(
        server.baseUrl,
        `/api/cloud/upload-jobs/${uploadRes.json.jobId}`,
        token
      );
      assert.equal(statusRes.status, 200, JSON.stringify(statusRes.json));
      assert.equal(statusRes.json?.job?.status, 'running', JSON.stringify(statusRes.json));
      assert.equal(statusRes.json?.job?.remote, 'remote1', JSON.stringify(statusRes.json));
      assert.equal(statusRes.json?.job?.path, 'folder/demo.txt', JSON.stringify(statusRes.json));

      const cancelRes = await requestJson(
        server.baseUrl,
        `/api/cloud/upload-jobs/${uploadRes.json.jobId}/cancel`,
        token,
        { method: 'POST', body: {} }
      );
      assert.equal(cancelRes.status, 200, JSON.stringify(cancelRes.json));
      assert.equal(cancelRes.json?.accepted, true, JSON.stringify(cancelRes.json));

      const canceled = await waitForJob(
        server.baseUrl,
        token,
        uploadRes.json.jobId,
        (job) => job?.status === 'canceled'
      );
      assert.ok(canceled, 'expected upload job to become canceled');
      assert.equal(canceled.error?.code, 'CLOUD_UPLOAD_CANCELED', JSON.stringify(canceled));
    } finally {
      await server.close();
    }
  });
});

test('cloud upload failed rclone command maps to failed job status', async () => {
  const fakeRclone = `#!/usr/bin/env bash
set -e
if [[ "$*" == *"listremotes"* ]]; then
  echo "remote1:"
  exit 0
fi
if [[ "$*" == *"rcat"* ]]; then
  cat >/dev/null || true
  echo "upload failed" >&2
  exit 7
fi
exit 0
`;

  await withFakeRclone(fakeRclone, async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-upload-failed-test-'));
    const filePath = path.join(tmpRoot, 'demo.txt');
    try {
      await fs.writeFile(filePath, 'hello cloud');
      const err = await cloudService
        .uploadRemoteFileFromPath('remote1', '', 'demo.txt', filePath)
        .catch((caught) => caught);
      assert.equal(err?.code, 'CLOUD_RCLONE_COMMAND_FAILED', JSON.stringify(err));

      const jobs = cloudService.listUploadJobs();
      const failed = jobs.find((job) => job.path === 'demo.txt' && job.status === 'failed');
      assert.ok(failed, JSON.stringify(jobs));
      assert.equal(failed.error?.code, 'CLOUD_RCLONE_COMMAND_FAILED', JSON.stringify(failed));
    } finally {
      await fs.remove(tmpRoot).catch(() => {});
    }
  });
});

test('cloud upload maps Google Drive quota and rate-limit errors to provider backoff state', async () => {
  const fakeRclone = `#!/usr/bin/env bash
set -e
if [[ "$*" == *"listremotes"* ]]; then
  echo "gdrive:"
  exit 0
fi
if [[ "$*" == *"config dump"* ]]; then
  echo '{"gdrive":{"type":"drive"}}'
  exit 0
fi
if [[ "$*" == *"config show gdrive"* ]]; then
  echo "[gdrive]"
  echo "type = drive"
  exit 0
fi
if [[ "$*" == *"rcat"* ]]; then
  cat >/dev/null || true
  echo "googleapi: Error 403: User rate limit exceeded / storageQuotaExceeded" >&2
  exit 7
fi
exit 0
`;

  await withFakeRclone(fakeRclone, async () => {
    const server = await createServer();
    const token = signToken();
    try {
      const form = new FormData();
      form.append('remote', 'gdrive');
      form.append('path', 'backup');
      form.append('fileName', 'quota.txt');
      form.append('async', 'true');
      form.append('file', new Blob(['quota trigger']), 'quota.txt');

      const uploadRes = await requestJson(server.baseUrl, '/api/cloud/upload', token, {
        method: 'POST',
        body: form
      });
      assert.equal(uploadRes.status, 202, JSON.stringify(uploadRes.json));

      const job = await waitForJob(
        server.baseUrl,
        token,
        uploadRes.json.jobId,
        (candidate) => ['paused_by_quota', 'backoff'].includes(candidate?.status)
      );
      assert.ok(job, 'expected Google Drive quota failure to become paused_by_quota or backoff');
      assert.ok(['paused_by_quota', 'backoff'].includes(job.status), JSON.stringify(job));
      assert.equal(getJobProvider(job), 'drive', JSON.stringify(job));
      assertRetryDate(getJobNextRetryAt(job), JSON.stringify(job));
      assert.match(getJobStderrSummary(job), /403|rate limit|quota/i, JSON.stringify(job));
      assert.notEqual(job.error?.code, 'CLOUD_RCLONE_COMMAND_FAILED', JSON.stringify(job));
    } finally {
      await server.close();
    }
  });
});

test('cloud upload maps WebDAV timeout and rate-like errors to retryable provider state', async () => {
  const fakeRclone = `#!/usr/bin/env bash
set -e
if [[ "$*" == *"listremotes"* ]]; then
  echo "webdav_remote:"
  exit 0
fi
if [[ "$*" == *"config dump"* ]]; then
  echo '{"webdav_remote":{"type":"webdav"}}'
  exit 0
fi
if [[ "$*" == *"config show webdav_remote"* ]]; then
  echo "[webdav_remote]"
  echo "type = webdav"
  exit 0
fi
if [[ "$*" == *"rcat"* ]]; then
  cat >/dev/null || true
  echo "WebDAV request timeout: 429 Too Many Requests, retry later" >&2
  exit 7
fi
exit 0
`;

  await withFakeRclone(fakeRclone, async () => {
    const server = await createServer();
    const token = signToken();
    try {
      const form = new FormData();
      form.append('remote', 'webdav_remote');
      form.append('path', 'backup');
      form.append('fileName', 'retry.txt');
      form.append('async', 'true');
      form.append('file', new Blob(['retry trigger']), 'retry.txt');

      const uploadRes = await requestJson(server.baseUrl, '/api/cloud/upload', token, {
        method: 'POST',
        body: form
      });
      assert.equal(uploadRes.status, 202, JSON.stringify(uploadRes.json));

      const job = await waitForJob(
        server.baseUrl,
        token,
        uploadRes.json.jobId,
        (candidate) => ['retryable_failed', 'backoff'].includes(candidate?.status)
      );
      assert.ok(job, 'expected WebDAV timeout/rate failure to become retryable_failed or backoff');
      assert.ok(['retryable_failed', 'backoff'].includes(job.status), JSON.stringify(job));
      assert.equal(getJobProvider(job), 'webdav', JSON.stringify(job));
      assertRetryDate(getJobNextRetryAt(job), JSON.stringify(job));
      assert.match(getJobStderrSummary(job), /timeout|429|too many requests|retry/i, JSON.stringify(job));
      assert.notEqual(job.error?.code, 'CLOUD_RCLONE_COMMAND_FAILED', JSON.stringify(job));
    } finally {
      await server.close();
    }
  });
});

test('cloud upload rclone invocation includes explicit retry policy flags', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-rclone-args-test-'));
  const argsPath = path.join(tmpRoot, 'args.jsonl');
  const fakeRclone = `#!/usr/bin/env bash
set -e
printf '%s\\n' "$*" >> "${argsPath}"
if [[ "$*" == *"listremotes"* ]]; then
  echo "remote1:"
  exit 0
fi
if [[ "$*" == *"rcat"* ]]; then
  cat >/dev/null || true
  exit 0
fi
exit 0
`;

  try {
    await withFakeRclone(fakeRclone, async () => {
      const server = await createServer();
      const token = signToken();
      try {
        const form = new FormData();
        form.append('remote', 'remote1');
        form.append('path', 'folder');
        form.append('fileName', 'demo.txt');
        form.append('file', new Blob(['hello cloud']), 'demo.txt');

        const uploadRes = await requestJson(server.baseUrl, '/api/cloud/upload', token, {
          method: 'POST',
          body: form
        });
        assert.equal(uploadRes.status, 200, JSON.stringify(uploadRes.json));

        const argsLog = await fs.readFile(argsPath, 'utf8');
        const rcatLine = argsLog.split('\n').find((line) => line.includes('rcat'));
        assert.ok(rcatLine, argsLog);
        assert.match(rcatLine, /--retries(=| )\d+/);
        assert.match(rcatLine, /--low-level-retries(=| )\d+/);
        assert.match(rcatLine, /--retries-sleep(=| )\S+/);
      } finally {
        await server.close();
      }
    });
  } finally {
    await fs.remove(tmpRoot).catch(() => {});
  }
});

test('cloud upload reports missing rclone as a clear setup error', async () => {
  const fakeRclone = `#!/usr/bin/env bash
set -e
if [[ "$*" == *"listremotes"* ]]; then
  echo "remote1:"
  rm -f "$0"
  exit 0
fi
exit 0
`;

  await withFakeRclone(fakeRclone, async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-rclone-missing-test-'));
    try {
      const filePath = path.join(tmpRoot, 'demo.txt');
      await fs.writeFile(filePath, 'hello cloud');
      const err = await cloudService
        .uploadRemoteFileFromPath('remote1', '', 'demo.txt', filePath)
        .catch((caught) => caught);
      assert.equal(err?.code, 'CLOUD_RCLONE_NOT_FOUND', JSON.stringify(err));
      assert.match(err?.message || '', /install rclone|rclone.*not found/i);
    } finally {
      await fs.remove(tmpRoot).catch(() => {});
    }
  });
});

test('cloud WebDAV setup passes user input as argv and rejects unsafe credential bytes', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-webdav-argv-test-'));
  const argsPath = path.join(tmpRoot, 'args.jsonl');
  const markerPath = path.join(tmpRoot, 'shell-injected');
  const fakeRclone = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(argsPath)}, JSON.stringify(args) + '\\n');
if (args.includes('obscure')) {
  console.log('obscured-password');
  process.exit(0);
}
process.exit(0);
`;

  try {
    await withFakeRclone(fakeRclone, async () => {
      await cloudService.addWebDAV(
        'webdav_safe',
        `https://example.test/dav?next=$(touch ${markerPath})`,
        'user;echo unsafe',
        `pass$(touch ${markerPath})`
      );

      assert.equal(await fs.pathExists(markerPath), false);
      const records = (await fs.readFile(argsPath, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const createArgs = records.find((args) => args.includes('config') && args.includes('create'));
      assert.ok(createArgs, JSON.stringify(records));
      assert.ok(createArgs.includes('webdav_safe'), JSON.stringify(createArgs));
      assert.ok(createArgs.some((arg) => String(arg).startsWith('url=https://example.test/')), JSON.stringify(createArgs));
      assert.ok(createArgs.includes('user=user;echo unsafe'), JSON.stringify(createArgs));
      assert.ok(createArgs.includes('pass=obscured-password'), JSON.stringify(createArgs));

      const invalidCredentials = await cloudService
        .addWebDAV('webdav_safe_2', 'https://example.test/dav', 'bad\nuser', '')
        .catch((err) => err);
      assert.equal(invalidCredentials?.code, 'CLOUD_ADD_WEBDAV_INVALID_CREDENTIALS');
    });
  } finally {
    await fs.remove(tmpRoot).catch(() => {});
  }
});

test('cloud upload rclone stderr summaries redact sensitive fields', async () => {
  const fakeRclone = `#!/usr/bin/env bash
set -e
if [[ "$*" == *"listremotes"* ]]; then
  echo "remote1:"
  exit 0
fi
if [[ "$*" == *"rcat"* ]]; then
  cat >/dev/null || true
  echo "password=hunter2 token=abc123 authorization=Bearer secret-value" >&2
  exit 7
fi
exit 0
`;

  await withFakeRclone(fakeRclone, async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-redaction-test-'));
    const filePath = path.join(tmpRoot, 'demo.txt');
    try {
      await fs.writeFile(filePath, 'hello cloud');
      await cloudService.uploadRemoteFileFromPath('remote1', '', 'demo.txt', filePath).catch(() => {});
      const redacted = cloudService
        .listUploadJobs()
        .find((job) => job.path === 'demo.txt' && job.error?.details?.stderrSummary);
      assert.ok(redacted, JSON.stringify(cloudService.listUploadJobs()));
      const summary = redacted.error.details.stderrSummary;
      assert.match(summary, /password=\[REDACTED\]/);
      assert.match(summary, /token=\[REDACTED\]/);
      assert.match(summary, /authorization=\[REDACTED\]/);
      assert.doesNotMatch(summary, /hunter2|abc123|secret-value/);
    } finally {
      await fs.remove(tmpRoot).catch(() => {});
    }
  });
});

test('A-owned cloud transfer preflight rejects symlink source escaping allowed roots', async () => {
  const store = await createCloudTransferTestStore();
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webos-cloud-transfer-root-'));
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webos-cloud-transfer-outside-'));
  const outsideFile = path.join(outsideRoot, 'secret.txt');
  const symlinkPath = path.join(fixtureRoot, 'linked-secret.txt');
  const fakeRclone = `#!/usr/bin/env bash
set -e
if [[ "$*" == *"listremotes"* ]]; then
  echo "remote1:"
  exit 0
fi
if [[ "$*" == *"lsjson"* ]]; then
  echo "Failed to lsjson: object not found" >&2
  exit 3
fi
exit 0
`;

  try {
    await fs.writeFile(outsideFile, 'outside allowed root', 'utf8');
    await fs.symlink(outsideFile, symlinkPath);
    await withAllowedRoot(fixtureRoot, async () => withFakeRclone(fakeRclone, async () => {
      const server = await createServer();
      const token = signToken();
      try {
        const res = await requestJson(server.baseUrl, '/api/cloud/transfer/preflight', token, {
          method: 'POST',
          body: {
            sourcePath: symlinkPath,
            remote: 'remote1',
            remotePath: 'backup/secret.txt'
          }
        });
        assert.equal(res.status, 403, JSON.stringify(res.json));
        assert.equal(res.json?.code, 'CLOUD_TRANSFER_SOURCE_NOT_ALLOWED', JSON.stringify(res.json));
      } finally {
        await server.close();
      }
    }));
  } finally {
    await fs.remove(fixtureRoot).catch(() => {});
    await fs.remove(outsideRoot).catch(() => {});
    await store.cleanup();
  }
});

test('A-owned cloud transfer blocks overwrite without backend approval and accepts scoped approval', async () => {
  const store = await createCloudTransferTestStore();
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webos-cloud-transfer-approval-'));
  const sourcePath = path.join(fixtureRoot, 'asset.bin');
  const argsPath = path.join(fixtureRoot, 'rclone-args.jsonl');
  const fakeRclone = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(argsPath)}, JSON.stringify(args) + '\\n');
if (args.includes('listremotes')) {
  console.log('remote1:');
  process.exit(0);
}
if (args.includes('lsjson')) {
  console.log(JSON.stringify([{ Name: 'asset.bin', Path: 'backup/asset.bin', Size: 12, ModTime: '2026-04-26T00:00:00Z', IsDir: false }]));
  process.exit(0);
}
if (args.includes('copyto')) {
  process.exit(0);
}
process.exit(0);
`;

  try {
    await fs.writeFile(sourcePath, Buffer.alloc(1024, 1));
    await withAllowedRoot(fixtureRoot, async () => withFakeRclone(fakeRclone, async () => {
      const server = await createServer();
      const token = signToken('alice');
      const payload = {
        sourcePath,
        remote: 'remote1',
        remotePath: 'backup/asset.bin',
        overwrite: true
      };
      try {
        const preflight = await requestJson(server.baseUrl, '/api/cloud/transfer/preflight', token, {
          method: 'POST',
          body: payload
        });
        assert.equal(preflight.status, 200, JSON.stringify(preflight.json));
        assert.equal(preflight.json?.requiresApproval, true, JSON.stringify(preflight.json));
        assert.ok(preflight.json?.approval?.operationId, JSON.stringify(preflight.json));

        const blocked = await requestJson(server.baseUrl, '/api/cloud/transfer', token, {
          method: 'POST',
          body: payload
        });
        assert.equal(blocked.status, 409, JSON.stringify(blocked.json));
        assert.equal(blocked.json?.code, 'CLOUD_TRANSFER_APPROVAL_REQUIRED', JSON.stringify(blocked.json));

        const approved = await requestJson(server.baseUrl, '/api/cloud/transfer/approve', token, {
          method: 'POST',
          body: {
            operationId: preflight.json.approval.operationId,
            typedConfirmation: 'asset.bin'
          }
        });
        assert.equal(approved.status, 200, JSON.stringify(approved.json));
        assert.ok(approved.json?.approval?.nonce, JSON.stringify(approved.json));

        const created = await requestJson(server.baseUrl, '/api/cloud/transfer', token, {
          method: 'POST',
          body: {
            ...payload,
            approval: approved.json.approval
          }
        });
        assert.equal(created.status, 202, JSON.stringify(created.json));
        assert.ok(created.json?.jobId, JSON.stringify(created.json));

        const completed = await waitForCloudTransferJob(
          server.baseUrl,
          token,
          created.json.jobId,
          (job) => job?.status === 'completed'
        );
        assert.ok(completed, JSON.stringify(created.json));
        assert.equal(completed.overwrite, true, JSON.stringify(completed));
        const argsLog = await fs.readFile(argsPath, 'utf8');
        assert.match(argsLog, /copyto/);
      } finally {
        await server.close();
      }
    }));
  } finally {
    await fs.remove(fixtureRoot).catch(() => {});
    await store.cleanup();
  }
});

test('A-owned cloud transfer job store reloads running jobs as interrupted and prunes finished jobs', async () => {
  const store = await createCloudTransferTestStore();
  const runningJob = {
    id: 'cloud-transfer-test-running',
    type: 'cloud-transfer',
    scope: 'cloud-transfer',
    status: 'running',
    sourcePath: path.join(os.tmpdir(), 'source.bin'),
    sourceRealPath: path.join(os.tmpdir(), 'source.bin'),
    remote: 'remote1',
    remotePath: 'backup/source.bin',
    fileName: 'source.bin',
    provider: 'remote1',
    overwrite: false,
    createdAt: new Date('2026-04-26T00:00:00.000Z').toISOString(),
    startedAt: new Date('2026-04-26T00:00:01.000Z').toISOString(),
    endedAt: null,
    progress: {
      transferredBytes: 1,
      totalBytes: 10,
      percent: 10,
      updatedAt: new Date('2026-04-26T00:00:02.000Z').toISOString()
    },
    error: null
  };

  try {
    await fs.writeJson(store.jobStoreFile, {
      version: 1,
      updatedAt: new Date('2026-04-26T00:00:03.000Z').toISOString(),
      jobs: [runningJob]
    }, { spaces: 2 });
    cloudTransferJobService._reloadForTests({ jobStoreFile: store.jobStoreFile });

    const interrupted = cloudTransferJobService.getJob(runningJob.id);
    assert.equal(interrupted?.status, 'interrupted', JSON.stringify(interrupted));
    assert.equal(interrupted?.error?.code, 'CLOUD_TRANSFER_INTERRUPTED', JSON.stringify(interrupted));

    const pruned = cloudTransferJobService.clearJobs({ statuses: ['interrupted'] });
    assert.deepEqual(pruned, { removed: 1, remaining: 0 });
    const persisted = await fs.readJson(store.jobStoreFile);
    assert.equal(persisted.jobs.length, 0);
  } finally {
    await store.cleanup();
  }
});

test('A-owned cloud transfer cancel and retry use explicit APIs', async () => {
  const store = await createCloudTransferTestStore();
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webos-cloud-transfer-cancel-'));
  const sourcePath = path.join(fixtureRoot, 'asset.bin');
  const copyCountPath = path.join(fixtureRoot, 'copy-count.txt');
  const fakeRclone = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
if (args.includes('listremotes')) {
  console.log('remote1:');
  process.exit(0);
}
if (args.includes('lsjson')) {
  console.error('object not found');
  process.exit(3);
}
if (args.includes('copyto')) {
  const countPath = ${JSON.stringify(copyCountPath)};
  const previous = Number(fs.existsSync(countPath) ? fs.readFileSync(countPath, 'utf8') : '0');
  fs.writeFileSync(countPath, String(previous + 1));
  if (previous > 0) {
    process.exit(0);
  }
  process.on('SIGTERM', () => process.exit(143));
  setInterval(() => {}, 1000);
  return;
}
process.exit(0);
`;

  try {
    await fs.writeFile(sourcePath, Buffer.alloc(1024, 2));
    await withAllowedRoot(fixtureRoot, async () => withFakeRclone(fakeRclone, async () => {
      const server = await createServer();
      const token = signToken();
      try {
        const created = await requestJson(server.baseUrl, '/api/cloud/transfer', token, {
          method: 'POST',
          body: {
            sourcePath,
            remote: 'remote1',
            remotePath: 'backup/asset.bin'
          }
        });
        assert.equal(created.status, 202, JSON.stringify(created.json));
        const jobId = created.json.jobId;

        const running = await waitForCloudTransferJob(
          server.baseUrl,
          token,
          jobId,
          (job) => job?.status === 'running'
        );
        assert.ok(running, JSON.stringify(created.json));

        const cancel = await requestJson(server.baseUrl, `/api/cloud/transfer-jobs/${jobId}/cancel`, token, {
          method: 'POST',
          body: {}
        });
        assert.equal(cancel.status, 200, JSON.stringify(cancel.json));

        const canceled = await waitForCloudTransferJob(
          server.baseUrl,
          token,
          jobId,
          (job) => job?.status === 'canceled'
        );
        assert.ok(canceled, JSON.stringify(cancel.json));

        const retry = await requestJson(server.baseUrl, `/api/cloud/transfer-jobs/${jobId}/retry`, token, {
          method: 'POST',
          body: {}
        });
        assert.equal(retry.status, 202, JSON.stringify(retry.json));
        assert.ok(retry.json?.job?.id, JSON.stringify(retry.json));
        assert.notEqual(retry.json.job.id, jobId);
      } finally {
        await server.close();
      }
    }));
  } finally {
    await fs.remove(fixtureRoot).catch(() => {});
    await store.cleanup();
  }
});
