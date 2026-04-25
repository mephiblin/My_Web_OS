const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';

const cloudRouter = require('../routes/cloud');
const cloudService = require('../services/cloudService');

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
