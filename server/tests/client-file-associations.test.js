const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadModule() {
  const modulePath = path.resolve(__dirname, '../../client/src/apps/system/file-explorer/services/fileAssociations.js');
  return import(pathToFileURL(modulePath).href);
}

test('file association resolver prefers user default installed package over builtin app', async () => {
  const {
    findAssociationMatches,
    resolveOpenPlan
  } = await loadModule();

  const apps = [
    {
      id: 'player',
      title: 'Media Player',
      fileAssociations: [
        { extensions: ['png', 'jpg'], actions: ['open'], defaultAction: 'open' }
      ]
    },
    {
      id: 'better-image-viewer',
      title: 'Better Image Viewer',
      launch: { mode: 'sandbox', entryUrl: '/api/sandbox/better-image-viewer/index.html' },
      runtime: 'sandbox',
      fileAssociations: [
        { extensions: ['png', 'webp'], actions: ['open', 'preview'], defaultAction: 'open' }
      ]
    }
  ];

  const matches = findAssociationMatches(apps, 'png');
  assert.deepEqual(matches.map((item) => item.appId), ['better-image-viewer', 'player']);

  const plan = resolveOpenPlan(apps, 'png', 'better-image-viewer');
  assert.equal(plan.appId, 'better-image-viewer');
  assert.equal(plan.app.launch.mode, 'sandbox');
  assert.equal(plan.action, 'open');
  assert.equal(plan.source, 'user-default');
});

test('file association resolver chooses editor-style action for text files and falls back for unknown files', async () => {
  const {
    inferPreferredActionByExtension,
    resolveOpenPlan
  } = await loadModule();

  const apps = [
    {
      id: 'doc-viewer',
      title: 'Document Viewer',
      fileAssociations: [
        { extensions: ['md'], actions: ['open', 'preview'], defaultAction: 'open' }
      ]
    },
    {
      id: 'editor',
      title: 'Code Editor',
      fileAssociations: [
        { extensions: ['md'], actions: ['open', 'edit'], defaultAction: 'edit' }
      ]
    }
  ];

  assert.equal(inferPreferredActionByExtension('md'), 'edit');

  const markdownPlan = resolveOpenPlan(apps, 'md');
  assert.equal(markdownPlan.appId, 'editor');
  assert.equal(markdownPlan.action, 'edit');

  const unknownPlan = resolveOpenPlan(apps, 'unknown-ext');
  assert.equal(unknownPlan.appId, 'editor');
  assert.equal(unknownPlan.source, 'legacy-fallback');
});
