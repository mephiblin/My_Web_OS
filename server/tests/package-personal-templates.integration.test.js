const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const jwt = require('jsonwebtoken');
const AdmZip = require('adm-zip');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';
process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';

const packagesRouter = require('../routes/packages');
const appPaths = require('../utils/appPaths');
const inventoryPaths = require('../utils/inventoryPaths');
const serverConfig = require('../config/serverConfig');
const packageLifecycleService = require('../services/packageLifecycleService');

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
      'content-type': 'application/json',
      ...(options.headers || {})
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
    headers: response.headers,
    json
  };
}

async function requestBinary(baseUrl, endpoint, token) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${token}`
    }
  });
  const data = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    headers: response.headers,
    data
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

test('personal ecosystem templates listing/scaffold and lifecycle backup+export flow', async () => {
  assert.equal(typeof fetch, 'function', 'Global fetch must be available for integration tests.');

  const server = await createServer();
  const adminUsername = await serverConfig.get('auth.adminUsername').catch(() => process.env.ADMIN_USERNAME || 'admin');
  const token = signToken(adminUsername);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const memoAppId = `it-memo-template-${suffix}`;
  const todoAppId = `it-todo-template-${suffix}`;
  const apiTesterAppId = `it-api-tester-template-${suffix}`;
  const jsonFormatterAppId = `it-json-formatter-template-${suffix}`;
  const markdownPreviewAppId = `it-markdown-preview-template-${suffix}`;
  const csvViewerAppId = `it-csv-viewer-template-${suffix}`;
  const textProcessorAppId = `it-text-processor-template-${suffix}`;

  try {
    const templatesRes = await requestJson(server.baseUrl, '/api/packages/ecosystem/templates', token);
    assert.equal(templatesRes.status, 200, JSON.stringify(templatesRes.json));

    const templateIds = new Set((templatesRes.json?.templates || []).map((item) => String(item?.id || '')));
    assert.equal(templateIds.has('todo-app'), true, JSON.stringify(templatesRes.json));
    assert.equal(templateIds.has('bookmark-manager'), true, JSON.stringify(templatesRes.json));
    assert.equal(templateIds.has('calculator'), true, JSON.stringify(templatesRes.json));
    assert.equal(templateIds.has('clipboard-history'), true, JSON.stringify(templatesRes.json));
    assert.equal(templateIds.has('json-formatter'), true, JSON.stringify(templatesRes.json));
    assert.equal(templateIds.has('api-tester'), true, JSON.stringify(templatesRes.json));
    assert.equal(templateIds.has('snippet-vault'), true, JSON.stringify(templatesRes.json));
    assert.equal(templateIds.has('markdown-preview'), true, JSON.stringify(templatesRes.json));
    assert.equal(templateIds.has('csv-viewer'), true, JSON.stringify(templatesRes.json));
    assert.equal(templateIds.has('text-processor'), true, JSON.stringify(templatesRes.json));

    const memoScaffold = await requestJson(
      server.baseUrl,
      '/api/packages/ecosystem/templates/memo-app/scaffold',
      token,
      {
        method: 'POST',
        body: { appId: memoAppId }
      }
    );
    assert.equal(memoScaffold.status, 201, JSON.stringify(memoScaffold.json));
    assert.equal(memoScaffold.json?.package?.id, memoAppId, JSON.stringify(memoScaffold.json));

    const todoScaffold = await requestJson(
      server.baseUrl,
      '/api/packages/ecosystem/templates/todo-app/scaffold',
      token,
      {
        method: 'POST',
        body: { appId: todoAppId }
      }
    );
    assert.equal(todoScaffold.status, 201, JSON.stringify(todoScaffold.json));
    assert.equal(todoScaffold.json?.package?.id, todoAppId, JSON.stringify(todoScaffold.json));

    const apiTesterScaffold = await requestJson(
      server.baseUrl,
      '/api/packages/ecosystem/templates/api-tester/scaffold',
      token,
      {
        method: 'POST',
        body: { appId: apiTesterAppId }
      }
    );
    assert.equal(apiTesterScaffold.status, 201, JSON.stringify(apiTesterScaffold.json));
    assert.equal(apiTesterScaffold.json?.package?.id, apiTesterAppId, JSON.stringify(apiTesterScaffold.json));

    const apiTesterRoot = await appPaths.getAppRoot(apiTesterAppId);
    const apiTesterEntryPath = path.join(apiTesterRoot, 'index.html');
    const apiTesterEntry = await fs.readFile(apiTesterEntryPath, 'utf8');
    assert.match(apiTesterEntry, /id="request-folder"/, 'api-tester scaffold must include request folder input');
    assert.match(apiTesterEntry, /id="request-tags"/, 'api-tester scaffold must include request tags input');
    assert.match(apiTesterEntry, /id="folder-filter"/, 'api-tester scaffold must include folder filter');
    assert.match(apiTesterEntry, /id="tag-filter"/, 'api-tester scaffold must include tag filter');

    const jsonFormatterScaffold = await requestJson(
      server.baseUrl,
      '/api/packages/ecosystem/templates/json-formatter/scaffold',
      token,
      {
        method: 'POST',
        body: { appId: jsonFormatterAppId }
      }
    );
    assert.equal(jsonFormatterScaffold.status, 201, JSON.stringify(jsonFormatterScaffold.json));
    assert.equal(jsonFormatterScaffold.json?.package?.id, jsonFormatterAppId, JSON.stringify(jsonFormatterScaffold.json));

    const jsonFormatterRoot = await appPaths.getAppRoot(jsonFormatterAppId);
    const jsonFormatterEntryPath = path.join(jsonFormatterRoot, 'index.html');
    const jsonFormatterEntry = await fs.readFile(jsonFormatterEntryPath, 'utf8');
    assert.match(jsonFormatterEntry, /id="overwrite-host"/, 'json-formatter scaffold must include overwrite toggle');
    assert.match(jsonFormatterEntry, /id="approve-overwrite"/, 'json-formatter scaffold must include overwrite approval toggle');
    assert.match(jsonFormatterEntry, /id="validate-json"/, 'json-formatter scaffold must include JSON validation toggle');
    assert.match(jsonFormatterEntry, /FS_WRITE_OVERWRITE_APPROVAL_REQUIRED/, 'json-formatter scaffold must include overwrite-required error mapping');

    const markdownPreviewScaffold = await requestJson(
      server.baseUrl,
      '/api/packages/ecosystem/templates/markdown-preview/scaffold',
      token,
      {
        method: 'POST',
        body: { appId: markdownPreviewAppId }
      }
    );
    assert.equal(markdownPreviewScaffold.status, 201, JSON.stringify(markdownPreviewScaffold.json));
    assert.equal(markdownPreviewScaffold.json?.package?.id, markdownPreviewAppId, JSON.stringify(markdownPreviewScaffold.json));

    const markdownPreviewRoot = await appPaths.getAppRoot(markdownPreviewAppId);
    const markdownPreviewEntryPath = path.join(markdownPreviewRoot, 'index.html');
    const markdownPreviewEntry = await fs.readFile(markdownPreviewEntryPath, 'utf8');
    assert.match(markdownPreviewEntry, /id="load-app-data"/, 'markdown-preview scaffold must include app-data load control');
    assert.match(markdownPreviewEntry, /id="save-app-data"/, 'markdown-preview scaffold must include app-data save control');

    const csvViewerScaffold = await requestJson(
      server.baseUrl,
      '/api/packages/ecosystem/templates/csv-viewer/scaffold',
      token,
      {
        method: 'POST',
        body: { appId: csvViewerAppId }
      }
    );
    assert.equal(csvViewerScaffold.status, 201, JSON.stringify(csvViewerScaffold.json));
    assert.equal(csvViewerScaffold.json?.package?.id, csvViewerAppId, JSON.stringify(csvViewerScaffold.json));

    const csvViewerRoot = await appPaths.getAppRoot(csvViewerAppId);
    const csvViewerEntryPath = path.join(csvViewerRoot, 'index.html');
    const csvViewerEntry = await fs.readFile(csvViewerEntryPath, 'utf8');
    assert.match(csvViewerEntry, /id="csv-input"/, 'csv-viewer scaffold must include csv input');
    assert.match(csvViewerEntry, /id="render-csv"/, 'csv-viewer scaffold must include render control');

    const textProcessorScaffold = await requestJson(
      server.baseUrl,
      '/api/packages/ecosystem/templates/text-processor/scaffold',
      token,
      {
        method: 'POST',
        body: { appId: textProcessorAppId }
      }
    );
    assert.equal(textProcessorScaffold.status, 201, JSON.stringify(textProcessorScaffold.json));
    assert.equal(textProcessorScaffold.json?.package?.id, textProcessorAppId, JSON.stringify(textProcessorScaffold.json));

    const textProcessorRoot = await appPaths.getAppRoot(textProcessorAppId);
    const textProcessorEntryPath = path.join(textProcessorRoot, 'index.html');
    const textProcessorEntry = await fs.readFile(textProcessorEntryPath, 'utf8');
    assert.match(textProcessorEntry, /id="replace-all"/, 'text-processor scaffold must include replace-all control');
    assert.match(textProcessorEntry, /id="trim-lines"/, 'text-processor scaffold must include trim-lines control');

    const backupRes = await requestJson(server.baseUrl, `/api/packages/${todoAppId}/backup`, token, {
      method: 'POST',
      body: { note: 'template lifecycle backup test' }
    });
    assert.equal(backupRes.status, 201, JSON.stringify(backupRes.json));
    assert.ok(String(backupRes.json?.backup?.id || '').trim().length > 0, JSON.stringify(backupRes.json));

    const exportRes = await requestBinary(server.baseUrl, `/api/packages/${todoAppId}/export`, token);
    assert.equal(exportRes.status, 200);
    assert.match(String(exportRes.headers.get('content-type') || ''), /application\/zip/i);

    const exportedZip = new AdmZip(exportRes.data);
    const entryNames = new Set(exportedZip.getEntries().map((entry) => entry.entryName));
    assert.equal(entryNames.has('manifest.json'), true, `manifest.json missing from export for ${todoAppId}`);
    assert.equal(entryNames.has('index.html'), true, `index.html missing from export for ${todoAppId}`);
  } finally {
    await cleanupAppArtifacts(memoAppId);
    await cleanupAppArtifacts(todoAppId);
    await cleanupAppArtifacts(apiTesterAppId);
    await cleanupAppArtifacts(jsonFormatterAppId);
    await cleanupAppArtifacts(markdownPreviewAppId);
    await cleanupAppArtifacts(csvViewerAppId);
    await cleanupAppArtifacts(textProcessorAppId);
    await server.close();
  }
});
