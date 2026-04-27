const test = require('node:test');
const assert = require('node:assert/strict');

const { runChecks } = require('../../tools/package-doctor');

test('package doctor accepts hybrid tool package contract', () => {
  const report = runChecks({
    id: 'media-tool',
    title: 'Media Tool',
    version: '0.1.0',
    type: 'hybrid',
    runtime: {
      type: 'process-node',
      entry: 'service/index.js'
    },
    ui: {
      type: 'sandbox-html',
      entry: 'ui/index.html'
    },
    permissions: [
      'runtime.process',
      'service.bridge',
      'host.allowedRoots.read',
      'app.data.read',
      'app.data.write'
    ],
    healthcheck: {
      type: 'http',
      path: '/health'
    }
  });

  assert.equal(report.failCount, 0);
  assert.equal(report.checks.some((item) => item.id === 'manifest.ui.entry' && item.status === 'pass'), true);
});

test('package doctor rejects hybrid packages without managed runtime contract', () => {
  const report = runChecks({
    id: 'broken-hybrid',
    title: 'Broken Hybrid',
    version: '0.1.0',
    type: 'hybrid',
    runtime: {
      type: 'sandbox-html',
      entry: 'index.html'
    },
    ui: {
      type: 'sandbox-html',
      entry: 'ui/index.html'
    },
    permissions: [
      'runtime.process',
      'service.bridge'
    ]
  });

  assert.equal(report.status, 'fail');
  assert.equal(
    report.checks.some((item) => item.id === 'manifest.runtime.type' && item.status === 'fail'),
    true
  );
});

test('package doctor rejects unsupported runtime types before normalization fallback', () => {
  const report = runChecks({
    id: 'unknown-runtime',
    title: 'Unknown Runtime',
    version: '0.1.0',
    type: 'service',
    runtime: {
      type: 'process-go',
      entry: 'service/main.go'
    },
    permissions: ['runtime.process']
  });

  assert.equal(report.status, 'fail');
  assert.equal(
    report.checks.some((item) => item.id === 'manifest.runtime.type' && item.status === 'fail' && item.detail === 'process-go'),
    true
  );
});

test('package doctor requires hybrid bridge and process permissions', () => {
  const report = runChecks({
    id: 'missing-hybrid-permissions',
    title: 'Missing Hybrid Permissions',
    version: '0.1.0',
    type: 'hybrid',
    runtime: {
      type: 'process-node',
      entry: 'service/index.js'
    },
    ui: {
      type: 'sandbox-html',
      entry: 'ui/index.html'
    },
    permissions: []
  });

  assert.equal(report.status, 'fail');
  assert.equal(report.checks.some((item) => item.id === 'permissions.runtime.process' && item.status === 'fail'), true);
  assert.equal(report.checks.some((item) => item.id === 'permissions.service.bridge' && item.status === 'fail'), true);
});
