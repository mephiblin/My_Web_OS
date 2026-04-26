const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';
process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';

const packagesRouter = require('../routes/packages');
const appPaths = require('../utils/appPaths');
const inventoryPaths = require('../utils/inventoryPaths');
const serverConfig = require('../config/serverConfig');
const packageLifecycleService = require('../services/packageLifecycleService');
const operationApprovalService = require('../services/operationApprovalService');
const auditService = require('../services/auditService');

function signToken(username) {
  return jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/packages', packagesRouter);

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
  let json = null;
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

async function cleanupAppArtifacts(appId) {
  const roots = await inventoryPaths.ensureInventoryStructure();
  const appRoot = await appPaths.getAppRoot(appId).catch(() => null);
  if (appRoot) {
    await fs.remove(appRoot).catch(() => {});
  }

  const backupRoot = path.join(roots.systemDir, 'package-backups', appId);
  await fs.remove(backupRoot).catch(() => {});
  await packageLifecycleService.deleteLifecycle(appId).catch(() => {});
}

async function createPackage(baseUrl, token, appId) {
  return requestJson(baseUrl, '/api/packages', token, {
    method: 'POST',
    body: {
      id: appId,
      title: `Delete Approval ${appId}`,
      description: 'package delete approval contract test package',
      version: '1.0.0',
      runtime: 'sandbox',
      entry: 'index.html'
    }
  });
}

async function preflightDelete(baseUrl, token, appId) {
  return requestJson(baseUrl, `/api/packages/${appId}/delete/preflight`, token, {
    method: 'POST',
    body: {}
  });
}

async function approveDelete(baseUrl, token, appId, operationId, typedConfirmation) {
  return requestJson(baseUrl, `/api/packages/${appId}/delete/approve`, token, {
    method: 'POST',
    body: {
      operationId,
      typedConfirmation
    }
  });
}

test('package delete without approval is blocked with preflight details', async () => {
  operationApprovalService._resetForTests();
  const server = await createServer();
  const adminUsername = await serverConfig.get('auth.adminUsername').catch(() => process.env.ADMIN_USERNAME || 'admin');
  const token = signToken(adminUsername);
  const appId = `it-delete-block-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const createRes = await createPackage(server.baseUrl, token, appId);
    assert.equal(createRes.status, 201, JSON.stringify(createRes.json));

    const deleteRes = await requestJson(server.baseUrl, `/api/packages/${appId}`, token, {
      method: 'DELETE'
    });
    assert.equal(deleteRes.status, 428, JSON.stringify(deleteRes.json));
    assert.equal(deleteRes.json?.code, 'PACKAGE_DELETE_APPROVAL_REQUIRED', JSON.stringify(deleteRes.json));
    assert.equal(deleteRes.json?.preflight?.action, 'package.delete', JSON.stringify(deleteRes.json));
    assert.equal(deleteRes.json?.preflight?.target?.id, appId, JSON.stringify(deleteRes.json));
    assert.equal(deleteRes.json?.preflight?.approval?.required, true, JSON.stringify(deleteRes.json));
    assert.equal(deleteRes.json?.preflight?.approval?.typedConfirmation, appId, JSON.stringify(deleteRes.json));
    assert.ok(deleteRes.json?.preflight?.operationId, JSON.stringify(deleteRes.json));
    assert.ok(deleteRes.json?.preflight?.targetHash, JSON.stringify(deleteRes.json));

    const appRoot = await appPaths.getAppRoot(appId);
    assert.equal(await fs.pathExists(appRoot), true);
  } finally {
    await cleanupAppArtifacts(appId);
    await server.close();
  }
});

test('package delete preflight approve execute succeeds and consumes nonce', async () => {
  operationApprovalService._resetForTests();
  const server = await createServer();
  const adminUsername = await serverConfig.get('auth.adminUsername').catch(() => process.env.ADMIN_USERNAME || 'admin');
  const token = signToken(adminUsername);
  const appId = `it-delete-ok-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const createRes = await createPackage(server.baseUrl, token, appId);
    assert.equal(createRes.status, 201, JSON.stringify(createRes.json));

    const preflightRes = await preflightDelete(server.baseUrl, token, appId);
    assert.equal(preflightRes.status, 200, JSON.stringify(preflightRes.json));
    assert.equal(preflightRes.json?.preflight?.target?.id, appId, JSON.stringify(preflightRes.json));

    const operationId = preflightRes.json.preflight.operationId;
    const targetHash = preflightRes.json.preflight.targetHash;
    const approveRes = await approveDelete(server.baseUrl, token, appId, operationId, appId);
    assert.equal(approveRes.status, 200, JSON.stringify(approveRes.json));
    assert.equal(approveRes.json?.approval?.operationId, operationId, JSON.stringify(approveRes.json));
    assert.ok(approveRes.json?.approval?.nonce, JSON.stringify(approveRes.json));

    const deleteRes = await requestJson(server.baseUrl, `/api/packages/${appId}`, token, {
      method: 'DELETE',
      body: {
        approval: {
          operationId,
          nonce: approveRes.json.approval.nonce,
          targetHash
        },
        reason: 'contract-test'
      }
    });
    assert.equal(deleteRes.status, 200, JSON.stringify(deleteRes.json));
    assert.equal(deleteRes.json?.success, true, JSON.stringify(deleteRes.json));

    const appRoot = await appPaths.getAppRoot(appId);
    assert.equal(await fs.pathExists(appRoot), false);

    const auditLogs = await auditService.getLogs({ limit: 5000, category: 'PACKAGES' });
    const deleteAudit = auditLogs.find((entry) => entry.operationId === operationId);
    assert.equal(deleteAudit?.action, 'package.delete', JSON.stringify(deleteAudit));
    assert.equal(deleteAudit?.riskLevel, 'high', JSON.stringify(deleteAudit));
    assert.equal(deleteAudit?.approval?.nonceConsumed, true, JSON.stringify(deleteAudit));
    assert.equal(deleteAudit?.result?.status, 'success', JSON.stringify(deleteAudit));

    const recreateRes = await createPackage(server.baseUrl, token, appId);
    assert.equal(recreateRes.status, 201, JSON.stringify(recreateRes.json));

    const reuseRes = await requestJson(server.baseUrl, `/api/packages/${appId}`, token, {
      method: 'DELETE',
      body: {
        approval: {
          operationId,
          nonce: approveRes.json.approval.nonce
        }
      }
    });
    assert.equal(reuseRes.status, 428, JSON.stringify(reuseRes.json));
    assert.equal(reuseRes.json?.code, 'PACKAGE_DELETE_APPROVAL_INVALID', JSON.stringify(reuseRes.json));
    assert.equal(await fs.pathExists(appRoot), true);
  } finally {
    await cleanupAppArtifacts(appId);
    await server.close();
  }
});

test('package delete approval rejects wrong typed confirmation without issuing nonce', async () => {
  operationApprovalService._resetForTests();
  const server = await createServer();
  const adminUsername = await serverConfig.get('auth.adminUsername').catch(() => process.env.ADMIN_USERNAME || 'admin');
  const token = signToken(adminUsername);
  const appId = `it-delete-wrong-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const createRes = await createPackage(server.baseUrl, token, appId);
    assert.equal(createRes.status, 201, JSON.stringify(createRes.json));

    const preflightRes = await preflightDelete(server.baseUrl, token, appId);
    assert.equal(preflightRes.status, 200, JSON.stringify(preflightRes.json));

    const approveRes = await approveDelete(
      server.baseUrl,
      token,
      appId,
      preflightRes.json.preflight.operationId,
      `${appId}-wrong`
    );
    assert.equal(approveRes.status, 400, JSON.stringify(approveRes.json));
    assert.equal(approveRes.json?.code, 'PACKAGE_DELETE_APPROVAL_INVALID', JSON.stringify(approveRes.json));
    assert.equal(Boolean(approveRes.json?.approval?.nonce), false, JSON.stringify(approveRes.json));

    const appRoot = await appPaths.getAppRoot(appId);
    assert.equal(await fs.pathExists(appRoot), true);
  } finally {
    await cleanupAppArtifacts(appId);
    await server.close();
  }
});

test('package delete approval rejects duplicate approval without reissuing nonce', async () => {
  operationApprovalService._resetForTests();
  const server = await createServer();
  const adminUsername = await serverConfig.get('auth.adminUsername').catch(() => process.env.ADMIN_USERNAME || 'admin');
  const token = signToken(adminUsername);
  const appId = `it-delete-dupe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const createRes = await createPackage(server.baseUrl, token, appId);
    assert.equal(createRes.status, 201, JSON.stringify(createRes.json));

    const preflightRes = await preflightDelete(server.baseUrl, token, appId);
    assert.equal(preflightRes.status, 200, JSON.stringify(preflightRes.json));

    const operationId = preflightRes.json.preflight.operationId;
    const firstApproveRes = await approveDelete(server.baseUrl, token, appId, operationId, appId);
    assert.equal(firstApproveRes.status, 200, JSON.stringify(firstApproveRes.json));
    assert.ok(firstApproveRes.json?.approval?.nonce, JSON.stringify(firstApproveRes.json));

    const duplicateApproveRes = await approveDelete(server.baseUrl, token, appId, operationId, appId);
    assert.equal(duplicateApproveRes.status, 409, JSON.stringify(duplicateApproveRes.json));
    assert.equal(
      duplicateApproveRes.json?.code,
      'PACKAGE_DELETE_APPROVAL_ALREADY_APPROVED',
      JSON.stringify(duplicateApproveRes.json)
    );
    assert.equal(Boolean(duplicateApproveRes.json?.approval?.nonce), false, JSON.stringify(duplicateApproveRes.json));

    const deleteRes = await requestJson(server.baseUrl, `/api/packages/${appId}`, token, {
      method: 'DELETE',
      body: {
        approval: {
          operationId,
          nonce: firstApproveRes.json.approval.nonce,
          targetHash: preflightRes.json.preflight.targetHash
        },
        reason: 'duplicate-approval-contract-test'
      }
    });
    assert.equal(deleteRes.status, 200, JSON.stringify(deleteRes.json));
    assert.equal(deleteRes.json?.success, true, JSON.stringify(deleteRes.json));
  } finally {
    await cleanupAppArtifacts(appId);
    await server.close();
  }
});

test('package delete approval target hash detects package file changes after preflight', async () => {
  operationApprovalService._resetForTests();
  const server = await createServer();
  const adminUsername = await serverConfig.get('auth.adminUsername').catch(() => process.env.ADMIN_USERNAME || 'admin');
  const token = signToken(adminUsername);
  const appId = `it-delete-hash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const createRes = await createPackage(server.baseUrl, token, appId);
    assert.equal(createRes.status, 201, JSON.stringify(createRes.json));

    const preflightRes = await preflightDelete(server.baseUrl, token, appId);
    assert.equal(preflightRes.status, 200, JSON.stringify(preflightRes.json));

    const operationId = preflightRes.json.preflight.operationId;
    const originalTargetHash = preflightRes.json.preflight.targetHash;
    const appRoot = await appPaths.getAppRoot(appId);
    await fs.writeFile(path.join(appRoot, 'post-preflight-change.txt'), 'changed after preflight');

    const approveRes = await approveDelete(server.baseUrl, token, appId, operationId, appId);
    assert.equal(approveRes.status, 200, JSON.stringify(approveRes.json));

    const deleteRes = await requestJson(server.baseUrl, `/api/packages/${appId}`, token, {
      method: 'DELETE',
      body: {
        approval: {
          operationId,
          nonce: approveRes.json.approval.nonce,
          targetHash: originalTargetHash
        },
        reason: 'target-hash-contract-test'
      }
    });
    assert.equal(deleteRes.status, 428, JSON.stringify(deleteRes.json));
    assert.equal(deleteRes.json?.code, 'PACKAGE_DELETE_APPROVAL_INVALID', JSON.stringify(deleteRes.json));
    assert.ok(deleteRes.json?.preflight?.targetHash, JSON.stringify(deleteRes.json));
    assert.notEqual(deleteRes.json.preflight.targetHash, originalTargetHash, JSON.stringify(deleteRes.json));
    assert.equal(await fs.pathExists(appRoot), true);
  } finally {
    await cleanupAppArtifacts(appId);
    await server.close();
  }
});
