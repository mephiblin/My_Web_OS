const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';

const fsRouter = require('../routes/fs');
const serverConfig = require('../config/serverConfig');
const operationApprovalService = require('../services/operationApprovalService');

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

test('fs delete requires backend approval and consumes nonce once', async () => {
  operationApprovalService._resetForTests();
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webos-fs-approval-'));
  const previousAllowedRoots = process.env.ALLOWED_ROOTS;
  const previousInitialPath = process.env.INITIAL_PATH;
  process.env.ALLOWED_ROOTS = fixtureRoot;
  process.env.INITIAL_PATH = fixtureRoot;
  await serverConfig.reload();

  const server = await createServer();
  const token = signToken('fs-owner');
  const filePath = path.join(fixtureRoot, 'delete-me.txt');

  try {
    await fs.writeFile(filePath, 'delete target', 'utf8');

    const blocked = await requestJson(server.baseUrl, '/api/fs/delete', token, {
      method: 'DELETE',
      body: { path: filePath }
    });
    assert.equal(blocked.status, 428, JSON.stringify(blocked.json));
    assert.equal(blocked.json?.code, 'FS_DELETE_APPROVAL_REQUIRED', JSON.stringify(blocked.json));
    assert.equal(blocked.json?.preflight?.action, 'fs.delete', JSON.stringify(blocked.json));
    assert.equal(await fs.pathExists(filePath), true);

    const preflight = await requestJson(server.baseUrl, '/api/fs/delete/preflight', token, {
      method: 'POST',
      body: { path: filePath }
    });
    assert.equal(preflight.status, 200, JSON.stringify(preflight.json));

    const approve = await requestJson(server.baseUrl, '/api/fs/delete/approve', token, {
      method: 'POST',
      body: {
        path: filePath,
        operationId: preflight.json.preflight.operationId,
        typedConfirmation: 'delete-me.txt'
      }
    });
    assert.equal(approve.status, 200, JSON.stringify(approve.json));
    assert.ok(approve.json?.approval?.nonce, JSON.stringify(approve.json));

    const deleted = await requestJson(server.baseUrl, '/api/fs/delete', token, {
      method: 'DELETE',
      body: {
        path: filePath,
        approval: {
          operationId: preflight.json.preflight.operationId,
          targetHash: preflight.json.preflight.targetHash,
          nonce: approve.json.approval.nonce
        }
      }
    });
    assert.equal(deleted.status, 200, JSON.stringify(deleted.json));
    assert.equal(await fs.pathExists(filePath), false);

    await fs.writeFile(filePath, 'second target', 'utf8');
    const reused = await requestJson(server.baseUrl, '/api/fs/delete', token, {
      method: 'DELETE',
      body: {
        path: filePath,
        approval: {
          operationId: preflight.json.preflight.operationId,
          targetHash: preflight.json.preflight.targetHash,
          nonce: approve.json.approval.nonce
        }
      }
    });
    assert.equal(reused.status, 428, JSON.stringify(reused.json));
    assert.equal(await fs.pathExists(filePath), true);
  } finally {
    await server.close();
    await fs.remove(fixtureRoot);
    if (previousAllowedRoots === undefined) delete process.env.ALLOWED_ROOTS;
    else process.env.ALLOWED_ROOTS = previousAllowedRoots;
    if (previousInitialPath === undefined) delete process.env.INITIAL_PATH;
    else process.env.INITIAL_PATH = previousInitialPath;
    await serverConfig.reload();
  }
});

test('fs overwrite rejects legacy flag-only approval', async () => {
  operationApprovalService._resetForTests();
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webos-fs-overwrite-'));
  const previousAllowedRoots = process.env.ALLOWED_ROOTS;
  const previousInitialPath = process.env.INITIAL_PATH;
  process.env.ALLOWED_ROOTS = fixtureRoot;
  process.env.INITIAL_PATH = fixtureRoot;
  await serverConfig.reload();

  const server = await createServer();
  const token = signToken('fs-owner');
  const filePath = path.join(fixtureRoot, 'overwrite-me.txt');

  try {
    await fs.writeFile(filePath, 'original', 'utf8');

    const blocked = await requestJson(server.baseUrl, '/api/fs/write', token, {
      method: 'POST',
      body: {
        path: filePath,
        content: 'changed',
        overwrite: true,
        approval: { approved: true, reason: 'legacy-flag' }
      }
    });
    assert.equal(blocked.status, 428, JSON.stringify(blocked.json));
    assert.equal(blocked.json?.code, 'FS_WRITE_APPROVAL_REQUIRED', JSON.stringify(blocked.json));
    assert.equal(blocked.json?.preflight?.action, 'fs.write.overwrite', JSON.stringify(blocked.json));
    assert.equal(await fs.readFile(filePath, 'utf8'), 'original');
  } finally {
    await server.close();
    await fs.remove(fixtureRoot);
    if (previousAllowedRoots === undefined) delete process.env.ALLOWED_ROOTS;
    else process.env.ALLOWED_ROOTS = previousAllowedRoots;
    if (previousInitialPath === undefined) delete process.env.INITIAL_PATH;
    else process.env.INITIAL_PATH = previousInitialPath;
    await serverConfig.reload();
  }
});

test('fs overwrite succeeds only with scoped approval evidence', async () => {
  operationApprovalService._resetForTests();
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webos-fs-overwrite-approved-'));
  const previousAllowedRoots = process.env.ALLOWED_ROOTS;
  const previousInitialPath = process.env.INITIAL_PATH;
  process.env.ALLOWED_ROOTS = fixtureRoot;
  process.env.INITIAL_PATH = fixtureRoot;
  await serverConfig.reload();

  const server = await createServer();
  const token = signToken('fs-owner');
  const filePath = path.join(fixtureRoot, 'overwrite-approved.txt');

  try {
    await fs.writeFile(filePath, 'original', 'utf8');

    const blocked = await requestJson(server.baseUrl, '/api/fs/write', token, {
      method: 'POST',
      body: {
        path: filePath,
        content: 'changed'
      }
    });
    assert.equal(blocked.status, 428, JSON.stringify(blocked.json));
    assert.equal(blocked.json?.code, 'FS_WRITE_APPROVAL_REQUIRED', JSON.stringify(blocked.json));
    assert.equal(await fs.readFile(filePath, 'utf8'), 'original');

    const preflight = await requestJson(server.baseUrl, '/api/fs/write/preflight', token, {
      method: 'POST',
      body: { path: filePath }
    });
    assert.equal(preflight.status, 200, JSON.stringify(preflight.json));

    const approve = await requestJson(server.baseUrl, '/api/fs/write/approve', token, {
      method: 'POST',
      body: {
        path: filePath,
        operationId: preflight.json.preflight.operationId,
        typedConfirmation: 'overwrite-approved.txt'
      }
    });
    assert.equal(approve.status, 200, JSON.stringify(approve.json));

    const missingHash = await requestJson(server.baseUrl, '/api/fs/write', token, {
      method: 'POST',
      body: {
        path: filePath,
        content: 'missing hash',
        approval: {
          operationId: preflight.json.preflight.operationId,
          nonce: approve.json.approval.nonce
        }
      }
    });
    assert.equal(missingHash.status, 428, JSON.stringify(missingHash.json));
    assert.equal(missingHash.json?.code, 'FS_WRITE_APPROVAL_REQUIRED', JSON.stringify(missingHash.json));
    assert.equal(await fs.readFile(filePath, 'utf8'), 'original');

    const written = await requestJson(server.baseUrl, '/api/fs/write', token, {
      method: 'POST',
      body: {
        path: filePath,
        content: 'changed',
        approval: {
          operationId: preflight.json.preflight.operationId,
          targetHash: preflight.json.preflight.targetHash,
          nonce: approve.json.approval.nonce
        }
      }
    });
    assert.equal(written.status, 200, JSON.stringify(written.json));
    assert.equal(await fs.readFile(filePath, 'utf8'), 'changed');

    const replay = await requestJson(server.baseUrl, '/api/fs/write', token, {
      method: 'POST',
      body: {
        path: filePath,
        content: 'replayed',
        approval: {
          operationId: preflight.json.preflight.operationId,
          targetHash: preflight.json.preflight.targetHash,
          nonce: approve.json.approval.nonce
        }
      }
    });
    assert.equal(replay.status, 428, JSON.stringify(replay.json));
    assert.equal(await fs.readFile(filePath, 'utf8'), 'changed');
  } finally {
    await server.close();
    await fs.remove(fixtureRoot);
    if (previousAllowedRoots === undefined) delete process.env.ALLOWED_ROOTS;
    else process.env.ALLOWED_ROOTS = previousAllowedRoots;
    if (previousInitialPath === undefined) delete process.env.INITIAL_PATH;
    else process.env.INITIAL_PATH = previousInitialPath;
    await serverConfig.reload();
  }
});

test('fs empty trash requires approval and consumes nonce once', async () => {
  operationApprovalService._resetForTests();
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webos-fs-empty-trash-'));
  const previousAllowedRoots = process.env.ALLOWED_ROOTS;
  const previousInitialPath = process.env.INITIAL_PATH;
  process.env.ALLOWED_ROOTS = fixtureRoot;
  process.env.INITIAL_PATH = fixtureRoot;
  await serverConfig.reload();

  const trashService = require('../services/trashService');
  await trashService.init();
  const server = await createServer();
  const token = signToken('fs-owner');
  const filePath = path.join(fixtureRoot, 'trash-me.txt');

  try {
    await trashService.emptyTrash();
    await fs.writeFile(filePath, 'trash target', 'utf8');
    await trashService.moveToTrash(filePath);

    const blocked = await requestJson(server.baseUrl, '/api/fs/empty-trash', token, {
      method: 'DELETE',
      body: {}
    });
    assert.equal(blocked.status, 428, JSON.stringify(blocked.json));
    assert.equal(blocked.json?.code, 'FS_TRASH_EMPTY_APPROVAL_REQUIRED', JSON.stringify(blocked.json));
    assert.equal(blocked.json?.preflight?.action, 'fs.empty-trash', JSON.stringify(blocked.json));

    const preflight = await requestJson(server.baseUrl, '/api/fs/empty-trash/preflight', token, {
      method: 'POST',
      body: {}
    });
    assert.equal(preflight.status, 200, JSON.stringify(preflight.json));

    const approve = await requestJson(server.baseUrl, '/api/fs/empty-trash/approve', token, {
      method: 'POST',
      body: {
        operationId: preflight.json.preflight.operationId
      }
    });
    assert.equal(approve.status, 200, JSON.stringify(approve.json));

    const emptied = await requestJson(server.baseUrl, '/api/fs/empty-trash', token, {
      method: 'DELETE',
      body: {
        approval: {
          operationId: preflight.json.preflight.operationId,
          targetHash: preflight.json.preflight.targetHash,
          nonce: approve.json.approval.nonce
        }
      }
    });
    assert.equal(emptied.status, 200, JSON.stringify(emptied.json));
    assert.equal((await trashService.getTrashItems()).length, 0);

    const replay = await requestJson(server.baseUrl, '/api/fs/empty-trash', token, {
      method: 'DELETE',
      body: {
        approval: {
          operationId: preflight.json.preflight.operationId,
          targetHash: preflight.json.preflight.targetHash,
          nonce: approve.json.approval.nonce
        }
      }
    });
    assert.equal(replay.status, 428, JSON.stringify(replay.json));
  } finally {
    await server.close();
    await fs.remove(fixtureRoot);
    await trashService.emptyTrash().catch(() => {});
    if (previousAllowedRoots === undefined) delete process.env.ALLOWED_ROOTS;
    else process.env.ALLOWED_ROOTS = previousAllowedRoots;
    if (previousInitialPath === undefined) delete process.env.INITIAL_PATH;
    else process.env.INITIAL_PATH = previousInitialPath;
    await serverConfig.reload();
  }
});

test('fs restore requires approval and rejects nonce replay', async () => {
  operationApprovalService._resetForTests();
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webos-fs-restore-'));
  const previousAllowedRoots = process.env.ALLOWED_ROOTS;
  const previousInitialPath = process.env.INITIAL_PATH;
  process.env.ALLOWED_ROOTS = fixtureRoot;
  process.env.INITIAL_PATH = fixtureRoot;
  await serverConfig.reload();

  const trashService = require('../services/trashService');
  await trashService.init();
  const server = await createServer();
  const token = signToken('fs-owner');
  const filePath = path.join(fixtureRoot, 'restore-me.txt');

  try {
    await fs.writeFile(filePath, 'restore target', 'utf8');
    const id = await trashService.moveToTrash(filePath);
    assert.equal(await fs.pathExists(filePath), false);

    const blocked = await requestJson(server.baseUrl, '/api/fs/restore', token, {
      method: 'POST',
      body: { id }
    });
    assert.equal(blocked.status, 428, JSON.stringify(blocked.json));
    assert.equal(blocked.json?.code, 'FS_TRASH_RESTORE_APPROVAL_REQUIRED', JSON.stringify(blocked.json));
    assert.equal(blocked.json?.preflight?.action, 'fs.restore', JSON.stringify(blocked.json));

    const preflight = await requestJson(server.baseUrl, '/api/fs/restore/preflight', token, {
      method: 'POST',
      body: { id }
    });
    assert.equal(preflight.status, 200, JSON.stringify(preflight.json));

    const approve = await requestJson(server.baseUrl, '/api/fs/restore/approve', token, {
      method: 'POST',
      body: {
        id,
        operationId: preflight.json.preflight.operationId,
        typedConfirmation: 'restore-me.txt'
      }
    });
    assert.equal(approve.status, 200, JSON.stringify(approve.json));

    const restored = await requestJson(server.baseUrl, '/api/fs/restore', token, {
      method: 'POST',
      body: {
        id,
        approval: {
          operationId: preflight.json.preflight.operationId,
          targetHash: preflight.json.preflight.targetHash,
          nonce: approve.json.approval.nonce
        }
      }
    });
    assert.equal(restored.status, 200, JSON.stringify(restored.json));
    assert.equal(await fs.readFile(filePath, 'utf8'), 'restore target');

    const replay = await requestJson(server.baseUrl, '/api/fs/restore', token, {
      method: 'POST',
      body: {
        id,
        approval: {
          operationId: preflight.json.preflight.operationId,
          targetHash: preflight.json.preflight.targetHash,
          nonce: approve.json.approval.nonce
        }
      }
    });
    assert.notEqual(replay.status, 200, JSON.stringify(replay.json));
  } finally {
    await server.close();
    await fs.remove(fixtureRoot);
    if (previousAllowedRoots === undefined) delete process.env.ALLOWED_ROOTS;
    else process.env.ALLOWED_ROOTS = previousAllowedRoots;
    if (previousInitialPath === undefined) delete process.env.INITIAL_PATH;
    else process.env.INITIAL_PATH = previousInitialPath;
    await serverConfig.reload();
  }
});

test('fs extract blocks traversal and requires approval for overwrite conflicts', async () => {
  operationApprovalService._resetForTests();
  const AdmZip = require('adm-zip');
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webos-fs-extract-'));
  const previousAllowedRoots = process.env.ALLOWED_ROOTS;
  const previousInitialPath = process.env.INITIAL_PATH;
  process.env.ALLOWED_ROOTS = fixtureRoot;
  process.env.INITIAL_PATH = fixtureRoot;
  await serverConfig.reload();

  const server = await createServer();
  const token = signToken('fs-owner');
  const safeZipPath = path.join(fixtureRoot, 'safe.zip');
  const traversalZipPath = path.join(fixtureRoot, 'bad.zip');
  const conflictPath = path.join(fixtureRoot, 'out.txt');

  try {
    await fs.writeFile(conflictPath, 'existing', 'utf8');
    const safeZip = new AdmZip();
    safeZip.addFile('out.txt', Buffer.from('from zip'));
    safeZip.writeZip(safeZipPath);

    const traversalZip = new AdmZip();
    traversalZip.addFile('safe-name.txt', Buffer.from('escape'));
    traversalZip.getEntries()[0].entryName = '../escape.txt';
    traversalZip.writeZip(traversalZipPath);

    const traversal = await requestJson(server.baseUrl, '/api/fs/extract/preflight', token, {
      method: 'POST',
      body: { path: traversalZipPath }
    });
    assert.equal(traversal.status, 400, JSON.stringify(traversal.json));
    assert.equal(traversal.json?.code, 'FS_ARCHIVE_ENTRY_TRAVERSAL', JSON.stringify(traversal.json));

    const blocked = await requestJson(server.baseUrl, '/api/fs/extract', token, {
      method: 'POST',
      body: { path: safeZipPath }
    });
    assert.equal(blocked.status, 428, JSON.stringify(blocked.json));
    assert.equal(blocked.json?.code, 'FS_ARCHIVE_EXTRACT_APPROVAL_REQUIRED', JSON.stringify(blocked.json));
    assert.equal(blocked.json?.preflight?.evidence?.conflicts?.length, 1, JSON.stringify(blocked.json));
    assert.equal(await fs.readFile(conflictPath, 'utf8'), 'existing');

    const preflight = await requestJson(server.baseUrl, '/api/fs/extract/preflight', token, {
      method: 'POST',
      body: { path: safeZipPath }
    });
    assert.equal(preflight.status, 200, JSON.stringify(preflight.json));
    assert.equal(preflight.json?.preflight?.evidence?.overwriteRequired, true, JSON.stringify(preflight.json));

    const approve = await requestJson(server.baseUrl, '/api/fs/extract/approve', token, {
      method: 'POST',
      body: {
        path: safeZipPath,
        operationId: preflight.json.preflight.operationId,
        typedConfirmation: 'safe.zip'
      }
    });
    assert.equal(approve.status, 200, JSON.stringify(approve.json));

    const extracted = await requestJson(server.baseUrl, '/api/fs/extract', token, {
      method: 'POST',
      body: {
        path: safeZipPath,
        approval: {
          operationId: preflight.json.preflight.operationId,
          targetHash: preflight.json.preflight.targetHash,
          nonce: approve.json.approval.nonce
        }
      }
    });
    assert.equal(extracted.status, 200, JSON.stringify(extracted.json));
    assert.equal(await fs.readFile(conflictPath, 'utf8'), 'from zip');

    const replay = await requestJson(server.baseUrl, '/api/fs/extract', token, {
      method: 'POST',
      body: {
        path: safeZipPath,
        approval: {
          operationId: preflight.json.preflight.operationId,
          targetHash: preflight.json.preflight.targetHash,
          nonce: approve.json.approval.nonce
        }
      }
    });
    assert.equal(replay.status, 428, JSON.stringify(replay.json));
  } finally {
    await server.close();
    await fs.remove(fixtureRoot);
    if (previousAllowedRoots === undefined) delete process.env.ALLOWED_ROOTS;
    else process.env.ALLOWED_ROOTS = previousAllowedRoots;
    if (previousInitialPath === undefined) delete process.env.INITIAL_PATH;
    else process.env.INITIAL_PATH = previousInitialPath;
    await serverConfig.reload();
  }
});

test('fs directory copy and move require scoped approval', async () => {
  operationApprovalService._resetForTests();
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webos-fs-copy-move-'));
  const previousAllowedRoots = process.env.ALLOWED_ROOTS;
  const previousInitialPath = process.env.INITIAL_PATH;
  process.env.ALLOWED_ROOTS = fixtureRoot;
  process.env.INITIAL_PATH = fixtureRoot;
  await serverConfig.reload();

  const server = await createServer();
  const token = signToken('fs-owner');
  const sourceDir = path.join(fixtureRoot, 'source-dir');
  const copyDir = path.join(fixtureRoot, 'source-copy');
  const movedDir = path.join(fixtureRoot, 'moved-dir');

  try {
    await fs.ensureDir(path.join(sourceDir, 'nested'));
    await fs.writeFile(path.join(sourceDir, 'nested', 'file.txt'), 'tree payload', 'utf8');

    const blockedCopy = await requestJson(server.baseUrl, '/api/fs/copy', token, {
      method: 'POST',
      body: { path: sourceDir, destinationPath: copyDir }
    });
    assert.equal(blockedCopy.status, 428, JSON.stringify(blockedCopy.json));
    assert.equal(blockedCopy.json?.code, 'FS_COPY_APPROVAL_REQUIRED', JSON.stringify(blockedCopy.json));
    assert.equal(await fs.pathExists(copyDir), false);

    const copyPreflight = await requestJson(server.baseUrl, '/api/fs/copy/preflight', token, {
      method: 'POST',
      body: { path: sourceDir, destinationPath: copyDir }
    });
    assert.equal(copyPreflight.status, 200, JSON.stringify(copyPreflight.json));
    assert.equal(copyPreflight.json?.preflight?.action, 'fs.copy', JSON.stringify(copyPreflight.json));
    assert.equal(copyPreflight.json?.preflight?.evidence?.sourceType, 'directory', JSON.stringify(copyPreflight.json));

    const copyApprove = await requestJson(server.baseUrl, '/api/fs/copy/approve', token, {
      method: 'POST',
      body: {
        path: sourceDir,
        destinationPath: copyDir,
        operationId: copyPreflight.json.preflight.operationId,
        typedConfirmation: 'source-dir'
      }
    });
    assert.equal(copyApprove.status, 200, JSON.stringify(copyApprove.json));

    const copied = await requestJson(server.baseUrl, '/api/fs/copy', token, {
      method: 'POST',
      body: {
        path: sourceDir,
        destinationPath: copyDir,
        approval: {
          operationId: copyPreflight.json.preflight.operationId,
          targetHash: copyPreflight.json.preflight.targetHash,
          nonce: copyApprove.json.approval.nonce
        }
      }
    });
    assert.equal(copied.status, 200, JSON.stringify(copied.json));
    assert.equal(await fs.readFile(path.join(copyDir, 'nested', 'file.txt'), 'utf8'), 'tree payload');

    await fs.remove(copyDir);
    const copyReplay = await requestJson(server.baseUrl, '/api/fs/copy', token, {
      method: 'POST',
      body: {
        path: sourceDir,
        destinationPath: copyDir,
        approval: {
          operationId: copyPreflight.json.preflight.operationId,
          targetHash: copyPreflight.json.preflight.targetHash,
          nonce: copyApprove.json.approval.nonce
        }
      }
    });
    assert.equal(copyReplay.status, 428, JSON.stringify(copyReplay.json));

    const blockedMove = await requestJson(server.baseUrl, '/api/fs/move', token, {
      method: 'POST',
      body: { path: sourceDir, destinationPath: movedDir }
    });
    assert.equal(blockedMove.status, 428, JSON.stringify(blockedMove.json));
    assert.equal(blockedMove.json?.code, 'FS_MOVE_APPROVAL_REQUIRED', JSON.stringify(blockedMove.json));
    assert.equal(await fs.pathExists(sourceDir), true);

    const movePreflight = await requestJson(server.baseUrl, '/api/fs/move/preflight', token, {
      method: 'POST',
      body: { path: sourceDir, destinationPath: movedDir }
    });
    assert.equal(movePreflight.status, 200, JSON.stringify(movePreflight.json));
    assert.equal(movePreflight.json?.preflight?.action, 'fs.move', JSON.stringify(movePreflight.json));

    const moveApprove = await requestJson(server.baseUrl, '/api/fs/move/approve', token, {
      method: 'POST',
      body: {
        path: sourceDir,
        destinationPath: movedDir,
        operationId: movePreflight.json.preflight.operationId,
        typedConfirmation: 'source-dir'
      }
    });
    assert.equal(moveApprove.status, 200, JSON.stringify(moveApprove.json));

    const moved = await requestJson(server.baseUrl, '/api/fs/move', token, {
      method: 'POST',
      body: {
        path: sourceDir,
        destinationPath: movedDir,
        approval: {
          operationId: movePreflight.json.preflight.operationId,
          targetHash: movePreflight.json.preflight.targetHash,
          nonce: moveApprove.json.approval.nonce
        }
      }
    });
    assert.equal(moved.status, 200, JSON.stringify(moved.json));
    assert.equal(await fs.pathExists(sourceDir), false);
    assert.equal(await fs.readFile(path.join(movedDir, 'nested', 'file.txt'), 'utf8'), 'tree payload');
  } finally {
    await server.close();
    await fs.remove(fixtureRoot);
    if (previousAllowedRoots === undefined) delete process.env.ALLOWED_ROOTS;
    else process.env.ALLOWED_ROOTS = previousAllowedRoots;
    if (previousInitialPath === undefined) delete process.env.INITIAL_PATH;
    else process.env.INITIAL_PATH = previousInitialPath;
    await serverConfig.reload();
  }
});
