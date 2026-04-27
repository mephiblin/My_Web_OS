const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('fs-extra');

const templateCatalogService = require('../services/templateCatalogService');

const DOC_PRESET_PATH = path.join(__dirname, '../../doc/presets/ecosystem-template-catalog.preset.json');

test('template catalog service loads built-in preset contract from tracked server path', async () => {
  const catalog = await templateCatalogService.loadCatalogFromFile(templateCatalogService.BUILTIN_CATALOG_FILE);

  assert.equal(catalog.version, 1);
  assert.equal(catalog.namespace, 'official');
  assert.equal(catalog.path, templateCatalogService.BUILTIN_CATALOG_FILE);

  const templateIds = new Set(catalog.templates.map((item) => item.id));
  const expectedIds = [
    'empty-html',
    'memo-app',
    'todo-app',
    'bookmark-manager',
    'calculator',
    'clipboard-history',
    'widget-basic',
    'server-monitor',
    'markdown-editor',
    'json-formatter',
    'api-tester',
    'snippet-vault',
    'markdown-preview',
    'csv-viewer',
    'text-processor',
    'python-experimental',
    'node-hybrid-tool',
    'python-hybrid-tool',
    'media-library-service-stub',
    'download-worker-stub'
  ];

  assert.equal(templateIds.size, expectedIds.length, 'Template catalog should contain expected template count.');
  for (const templateId of expectedIds) {
    assert.equal(templateIds.has(templateId), true, `Missing template id "${templateId}"`);
  }

  for (const template of catalog.templates.filter((item) => item.defaults.appType === 'hybrid')) {
    assert.equal(template.defaults.uiEntry, 'ui/index.html', `Hybrid template "${template.id}" should preserve uiEntry.`);
  }
});

test('template catalog service keeps doc preset and server preset in sync', async () => {
  const docPreset = await fs.readJson(DOC_PRESET_PATH);
  const serverPreset = await fs.readJson(templateCatalogService.BUILTIN_CATALOG_FILE);
  assert.deepEqual(serverPreset, docPreset);
});

test('template catalog loader rejects duplicate template ids with explicit code/message', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'webos-template-catalog-'));
  const filePath = path.join(tmpDir, 'catalog.json');

  await fs.writeJson(
    filePath,
    {
      version: 1,
      namespace: 'official',
      templates: [
        {
          id: 'dup-template',
          title: 'First',
          category: 'utility',
          description: 'first',
          defaults: { runtimeType: 'sandbox-html', appType: 'app', entry: 'index.html', permissions: [] }
        },
        {
          id: 'dup-template',
          title: 'Second',
          category: 'utility',
          description: 'second',
          defaults: { runtimeType: 'sandbox-html', appType: 'app', entry: 'index.html', permissions: [] }
        }
      ]
    },
    { spaces: 2 }
  );

  try {
    await assert.rejects(
      () => templateCatalogService.loadCatalogFromFile(filePath),
      (err) => {
        assert.equal(err?.code, templateCatalogService.CATALOG_LOAD_ERROR_CODE);
        assert.match(String(err?.message || ''), /duplicated in catalog/i);
        return true;
      }
    );
  } finally {
    await fs.remove(tmpDir);
  }
});

test('template catalog loader rejects invalid permissions contract', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'webos-template-catalog-'));
  const filePath = path.join(tmpDir, 'catalog.json');

  await fs.writeJson(
    filePath,
    {
      version: 1,
      namespace: 'official',
      templates: [
        {
          id: 'invalid-permissions',
          title: 'Invalid Permissions',
          category: 'utility',
          description: 'invalid',
          defaults: { runtimeType: 'sandbox-html', appType: 'app', entry: 'index.html', permissions: 'app.data.read' }
        }
      ]
    },
    { spaces: 2 }
  );

  try {
    await assert.rejects(
      () => templateCatalogService.loadCatalogFromFile(filePath),
      (err) => {
        assert.equal(err?.code, templateCatalogService.CATALOG_LOAD_ERROR_CODE);
        assert.match(String(err?.message || ''), /permissions must be an array/i);
        return true;
      }
    );
  } finally {
    await fs.remove(tmpDir);
  }
});

test('template catalog loader rejects hybrid template without uiEntry', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'webos-template-catalog-'));
  const filePath = path.join(tmpDir, 'catalog.json');

  await fs.writeJson(
    filePath,
    {
      version: 1,
      namespace: 'official',
      templates: [
        {
          id: 'hybrid-without-ui',
          title: 'Hybrid Without UI',
          category: 'runtime',
          description: 'invalid',
          defaults: {
            runtimeType: 'process-node',
            appType: 'hybrid',
            entry: 'service/index.js',
            permissions: ['runtime.process', 'service.bridge']
          }
        }
      ]
    },
    { spaces: 2 }
  );

  try {
    await assert.rejects(
      () => templateCatalogService.loadCatalogFromFile(filePath),
      (err) => {
        assert.equal(err?.code, templateCatalogService.CATALOG_LOAD_ERROR_CODE);
        assert.match(String(err?.message || ''), /uiEntry is required for hybrid templates/i);
        return true;
      }
    );
  } finally {
    await fs.remove(tmpDir);
  }
});

test('template catalog loader rejects invalid top-level payload', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'webos-template-catalog-'));
  const filePath = path.join(tmpDir, 'catalog.json');

  await fs.writeJson(filePath, 'invalid-payload', { spaces: 2 });

  try {
    await assert.rejects(
      () => templateCatalogService.loadCatalogFromFile(filePath),
      (err) => {
        assert.equal(err?.code, templateCatalogService.CATALOG_LOAD_ERROR_CODE);
        assert.match(String(err?.message || ''), /must be an object or array/i);
        return true;
      }
    );
  } finally {
    await fs.remove(tmpDir);
  }
});
