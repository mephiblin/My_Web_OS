const test = require('node:test');
const assert = require('node:assert/strict');

const packageRegistryService = require('../services/packageRegistryService');

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
  }
});
