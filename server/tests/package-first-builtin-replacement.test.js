const test = require('node:test');
const assert = require('node:assert/strict');

const packageRegistryService = require('../services/packageRegistryService');
const builtinAppsSeed = require('../config/builtinAppsSeed');
const packageDoctor = require('../../tools/package-doctor');

test('primary viewer addons resolve to sandbox package apps when inventory package exists', async () => {
  const apps = await packageRegistryService.listDesktopApps();
  const byId = new Map(apps.map((app) => [app.id, app]));

  for (const appId of ['doc-viewer', 'model-viewer', 'editor']) {
    const app = byId.get(appId);
    assert.ok(app, `${appId} should be registered`);
    assert.equal(app.appModel, 'package', `${appId} should use package ownership`);
    assert.equal(app.source, 'inventory-package', `${appId} should come from inventory package`);
    assert.equal(app.launch?.mode, 'sandbox', `${appId} should launch as sandbox`);
    assert.equal(app.replacesBuiltin, true, `${appId} should explicitly replace builtin standard addon`);
    assert.ok(Array.isArray(app.fileAssociations) && app.fileAssociations.length > 0, `${appId} should keep file associations`);
    assert.ok(Array.isArray(app.contributes?.fileContextMenu), `${appId} should expose contribution contract`);
    assert.ok(Array.isArray(app.contributes?.fileCreateTemplates), `${appId} should expose file template contribution contract`);
    assert.ok(Array.isArray(app.contributes?.previewProviders), `${appId} should expose preview provider contribution contract`);
    assert.ok(Array.isArray(app.contributes?.thumbnailProviders), `${appId} should expose thumbnail provider contribution contract`);
    assert.ok(Array.isArray(app.contributes?.widgets), `${appId} should expose widget contribution contract`);
  }
});

test('package doctor accepts current built-in registry seed without warning debt', async () => {
  const report = packageDoctor.runBuiltinRegistryChecks(builtinAppsSeed);
  assert.equal(report.failCount, 0);
  assert.equal(report.warnCount, 0);
});

test('package doctor derives station system allowlist from built-in seed', async () => {
  const systemIds = packageDoctor.collectBuiltinSystemAppIds(builtinAppsSeed);

  for (const appId of ['download-station', 'photo-station', 'music-station', 'document-station', 'video-station']) {
    assert.equal(systemIds.has(appId), true, `${appId} should be recognized as a built-in system app`);
  }
});

test('manifest contributes are normalized into file context menu contract', async () => {
  const normalized = packageRegistryService.normalizeManifestContributes(
    {
      fileContextMenu: [
        { label: 'Open in Sample App', action: 'open' },
        { label: 'Edit in Sample App', action: 'edit', extensions: ['.txt', 'md'] }
      ]
    },
    [
      { extensions: ['sample'], actions: ['open'], defaultAction: 'open' }
    ]
  );

  assert.deepEqual(normalized.fileContextMenu, [
    { label: 'Open in Sample App', action: 'open', extensions: ['sample'] },
    { label: 'Edit in Sample App', action: 'edit', extensions: ['txt', 'md'] }
  ]);
  assert.deepEqual(normalized.fileCreateTemplates, []);
  assert.deepEqual(normalized.previewProviders, []);
  assert.deepEqual(normalized.thumbnailProviders, []);
  assert.deepEqual(normalized.settingsPanels, []);
  assert.deepEqual(normalized.backgroundServices, []);
  assert.deepEqual(normalized.widgets, []);
});

test('manifest contributes normalize native extension point contract v2', async () => {
  const normalized = packageRegistryService.normalizeManifestContributes(
    {
      fileCreateTemplates: [
        {
          label: 'Markdown File',
          name: 'Untitled.md',
          content: '# Untitled\n\n',
          action: 'edit'
        }
      ],
      previewProviders: [
        { label: 'Sample Preview' }
      ],
      thumbnailProviders: [
        { label: 'Sample Thumbnail', extensions: ['.sample'] }
      ],
      settingsPanels: [
        { label: 'Sample Settings', entry: 'settings.html' }
      ],
      backgroundServices: [
        { id: 'sample-indexer', label: 'Sample Indexer', entry: 'service.js', autoStart: true }
      ],
      widgets: [
        { id: 'sample-widget', label: 'Sample Widget', entry: 'widget.html', defaultSize: { w: 360, h: 240 } }
      ]
    },
    [
      { extensions: ['sample'], actions: ['preview', 'open'], defaultAction: 'open' }
    ]
  );

  assert.deepEqual(normalized.fileCreateTemplates, [
    {
      label: 'Markdown File',
      name: 'Untitled.md',
      extension: 'md',
      content: '# Untitled\n\n',
      action: 'edit',
      openAfterCreate: true
    }
  ]);
  assert.deepEqual(normalized.previewProviders, [
    { label: 'Sample Preview', extensions: ['sample'] }
  ]);
  assert.deepEqual(normalized.thumbnailProviders, [
    { label: 'Sample Thumbnail', extensions: ['sample'] }
  ]);
  assert.deepEqual(normalized.settingsPanels, [
    { label: 'Sample Settings', entry: 'settings.html' }
  ]);
  assert.deepEqual(normalized.backgroundServices, [
    { id: 'sample-indexer', label: 'Sample Indexer', entry: 'service.js', autoStart: false, requestedAutoStart: true }
  ]);
  assert.deepEqual(normalized.widgets, [
    {
      id: 'sample-widget',
      label: 'Sample Widget',
      title: 'Sample Widget',
      entry: 'widget.html',
      defaultSize: { w: 360, h: 240 },
      minSize: { w: 180, h: 120 }
    }
  ]);
});

test('manifest contribution strict validation rejects unsafe template shapes', async () => {
  assert.throws(
    () => packageRegistryService.normalizeManifestContributes(
      {
        fileCreateTemplates: [
          { label: 'Bad Template', name: 'bad.txt', content: { not: 'text' } }
        ]
      },
      [],
      { strict: true }
    ),
    /content must be a string/
  );

  assert.throws(
    () => packageRegistryService.normalizeManifestContributes(
      {
        previewProviders: [
          { label: 'Bad Preview', extensions: 'txt' }
        ]
      },
      [],
      { strict: true }
    ),
    /extensions must be an array/
  );

  assert.throws(
    () => packageRegistryService.normalizeManifestContributes(
      {
        widgets: [
          { id: 'bad-widget', label: 'Bad Widget', entry: '../widget.html' }
        ]
      },
      [],
      { strict: true }
    ),
    /safe relative entry path/
  );
});

test('package doctor accepts widget package contribution contract', () => {
  const report = packageDoctor.runChecks({
    id: 'desktop-calendar',
    title: 'Desktop Calendar',
    type: 'widget',
    runtime: { type: 'sandbox-html', entry: 'widget.html' },
    permissions: ['calendar.read'],
    contributes: {
      widgets: [
        {
          id: 'glass-calendar',
          label: 'Glass Calendar',
          entry: 'widget.html',
          defaultSize: { w: 900, h: 520 },
          minSize: { w: 320, h: 220 }
        }
      ]
    }
  });

  assert.equal(report.failCount, 0);
  assert.equal(report.checks.some((check) => check.id === 'manifest.contributes.widgets[0].entry' && check.status === 'fail'), false);
});

test('preview and thumbnail provider contracts require host.file.read during strict validation and doctor checks', async () => {
  assert.throws(
    () => packageRegistryService.normalizeManifestContributes(
      {
        previewProviders: [
          { label: 'Text Preview', extensions: ['txt'] }
        ]
      },
      [],
      { strict: true, permissions: [] }
    ),
    /requires permission "host\.file\.read"/
  );

  assert.throws(
    () => packageRegistryService.normalizeManifestContributes(
      {
        thumbnailProviders: [
          { label: 'Text Thumbnail', extensions: ['txt'] }
        ]
      },
      [],
      { strict: true, permissions: [] }
    ),
    /requires permission "host\.file\.read"/
  );

  const normalized = packageRegistryService.normalizeManifestContributes(
    {
      previewProviders: [
        { label: 'Text Preview', extensions: ['txt'] }
      ],
      thumbnailProviders: [
        { label: 'Text Thumbnail', extensions: ['txt'] }
      ]
    },
    [],
    { strict: true, permissions: ['host.file.read'] }
  );
  assert.deepEqual(normalized.previewProviders, [
    { label: 'Text Preview', extensions: ['txt'] }
  ]);
  assert.deepEqual(normalized.thumbnailProviders, [
    { label: 'Text Thumbnail', extensions: ['txt'] }
  ]);

  const report = packageDoctor.runChecks({
    id: 'bad-preview',
    title: 'Bad Preview',
    type: 'app',
    runtime: { type: 'sandbox-html', entry: 'index.html' },
    permissions: [],
    fileAssociations: [
      { extensions: ['txt'], actions: ['preview'], defaultAction: 'preview' }
    ],
    contributes: {
      previewProviders: [
        { label: 'Text Preview' }
      ],
      thumbnailProviders: [
        { label: 'Text Thumbnail' }
      ]
    }
  });

  assert.equal(report.status, 'fail');
  assert.equal(report.checks.some((check) => check.id === 'manifest.permissions' && check.status === 'fail'), true);
});

test('package doctor rejects non-boolean openAfterCreate templates', async () => {
  const report = packageDoctor.runChecks({
    id: 'bad-template',
    title: 'Bad Template',
    type: 'app',
    runtime: { type: 'sandbox-html', entry: 'index.html' },
    permissions: ['host.file.read', 'host.file.write'],
    fileAssociations: [],
    contributes: {
      fileCreateTemplates: [
        {
          label: 'Text File',
          name: 'Untitled.txt',
          openAfterCreate: 'yes'
        }
      ]
    }
  });

  assert.equal(report.status, 'fail');
  assert.equal(
    report.checks.some((check) => check.id === 'manifest.contributes.fileCreateTemplates[0].openAfterCreate' && check.status === 'fail'),
    true
  );
});
