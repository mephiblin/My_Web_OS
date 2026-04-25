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

test('file context contributions expose manifest-declared menu actions', async () => {
  const {
    findAssociationMatches,
    findFileContextContributions
  } = await loadModule();

  const apps = [
    {
      id: 'model-viewer',
      title: 'Model Viewer',
      fileAssociations: [
        { extensions: ['fbx', 'glb'], actions: ['open', 'preview'], defaultAction: 'open' }
      ],
      contributes: {
        fileContextMenu: [
          { label: 'Open in Model Viewer', action: 'open', extensions: ['fbx', 'glb'] }
        ]
      }
    },
    {
      id: 'editor',
      title: 'Code Editor',
      fileAssociations: [
        { extensions: ['fbx'], actions: ['edit'], defaultAction: 'edit' }
      ],
      contributes: {
        fileContextMenu: [
          { label: 'Inspect FBX Text', action: 'edit' }
        ]
      }
    }
  ];

  const contributions = findFileContextContributions(apps, 'fbx');
  assert.deepEqual(contributions.map((item) => item.label), ['Inspect FBX Text', 'Open in Model Viewer']);
  assert.deepEqual(contributions.map((item) => `${item.appId}:${item.action}`), ['editor:edit', 'model-viewer:open']);

  const associationMatches = findAssociationMatches(apps, 'fbx');
  assert.deepEqual(associationMatches.map((item) => item.appId), ['editor', 'model-viewer']);
});

test('file create templates expose manifest-declared new file actions', async () => {
  const {
    findFileCreateTemplates
  } = await loadModule();

  const apps = [
    {
      id: 'editor',
      title: 'Code Editor',
      contributes: {
        fileCreateTemplates: [
          {
            label: 'Markdown File',
            name: 'Untitled.md',
            content: '# Untitled\n\n',
            action: 'edit',
            openAfterCreate: true
          }
        ]
      }
    },
    {
      id: 'viewer',
      title: 'Viewer',
      contributes: {
        fileCreateTemplates: [
          { label: '', name: 'Ignored.txt' }
        ]
      }
    }
  ];

  const templates = findFileCreateTemplates(apps);
  assert.equal(templates.length, 1);
  assert.deepEqual(
    templates.map((item) => ({
      appId: item.appId,
      label: item.label,
      name: item.name,
      extension: item.extension,
      action: item.action,
      openAfterCreate: item.openAfterCreate
    })),
    [
      {
        appId: 'editor',
        label: 'Markdown File',
        name: 'Untitled.md',
        extension: 'md',
        action: 'edit',
        openAfterCreate: true
      }
    ]
  );
});

test('preview and thumbnail providers expose manifest-declared File Station matches', async () => {
  const {
    findPreviewProviderMatches,
    findThumbnailProviderMatches
  } = await loadModule();

  const apps = [
    {
      id: 'doc-viewer',
      title: 'Document Viewer',
      fileAssociations: [
        { extensions: ['md', 'pdf'], actions: ['preview', 'open'], defaultAction: 'open' }
      ],
      contributes: {
        previewProviders: [
          { label: 'Document Preview' }
        ],
        thumbnailProviders: [
          { label: 'Document Thumbnail' }
        ]
      }
    },
    {
      id: 'model-viewer',
      title: 'Model Viewer',
      contributes: {
        previewProviders: [
          { label: '3D Model Preview', extensions: ['fbx'] }
        ],
        thumbnailProviders: [
          { label: '3D Model Thumbnail', extensions: ['fbx'] }
        ]
      }
    }
  ];

  const markdownProviders = findPreviewProviderMatches(apps, 'md');
  assert.deepEqual(markdownProviders.map((item) => `${item.appId}:${item.label}`), ['doc-viewer:Document Preview']);

  const modelProviders = findPreviewProviderMatches(apps, 'fbx');
  assert.deepEqual(modelProviders.map((item) => `${item.appId}:${item.label}`), ['model-viewer:3D Model Preview']);

  const markdownThumbnails = findThumbnailProviderMatches(apps, 'md');
  assert.deepEqual(markdownThumbnails.map((item) => `${item.appId}:${item.label}:${item.source}`), ['doc-viewer:Document Thumbnail:manifest-thumbnail-provider']);

  const modelThumbnails = findThumbnailProviderMatches(apps, 'fbx');
  assert.deepEqual(modelThumbnails.map((item) => `${item.appId}:${item.label}`), ['model-viewer:3D Model Thumbnail']);
});
