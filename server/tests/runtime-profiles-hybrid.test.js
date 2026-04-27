const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeRuntimeProfile,
  assertValidRuntimeProfile,
  toManifestRuntimeFields
} = require('../services/runtimeProfiles');

test('normalizes hybrid packages with managed service entry and sandbox UI entry', () => {
  const manifest = {
    id: 'media-tool',
    type: 'hybrid',
    runtime: {
      type: 'process-node',
      entry: 'service/index.js',
      cwd: '.'
    },
    ui: {
      type: 'sandbox-html',
      entry: 'ui/index.html'
    },
    service: {
      restartPolicy: 'on-failure',
      http: { enabled: true }
    },
    healthcheck: {
      type: 'http',
      path: '/health'
    }
  };

  const profile = normalizeRuntimeProfile(manifest);
  assert.equal(profile.appType, 'hybrid');
  assert.equal(profile.runtimeType, 'process-node');
  assert.equal(profile.entry, 'service/index.js');
  assert.deepEqual(profile.ui, {
    runtimeType: 'sandbox-html',
    entry: 'ui/index.html'
  });
  assert.equal(profile.service.http.enabled, true);
  assert.equal(assertValidRuntimeProfile(manifest, profile), profile);

  const runtimeFields = toManifestRuntimeFields(profile);
  assert.equal(runtimeFields.type, 'hybrid');
  assert.deepEqual(runtimeFields.ui, {
    type: 'sandbox-html',
    entry: 'ui/index.html'
  });
});

test('rejects hybrid package without sandbox UI entry', () => {
  const manifest = {
    id: 'bad-tool',
    type: 'hybrid',
    runtime: {
      type: 'process-node',
      entry: 'service/index.js'
    }
  };

  assert.throws(() => assertValidRuntimeProfile(manifest), {
    code: 'RUNTIME_PROFILE_INVALID',
    message: /ui\.entry/
  });
});

test('rejects absolute or unsafe http healthcheck paths', () => {
  const baseManifest = {
    id: 'unsafe-health-tool',
    type: 'hybrid',
    runtime: {
      type: 'process-node',
      entry: 'service/index.js'
    },
    ui: {
      type: 'sandbox-html',
      entry: 'ui/index.html'
    },
    healthcheck: {
      type: 'http',
      path: '/health'
    }
  };

  for (const unsafePath of [
    'http://169.254.169.254/latest/meta-data',
    '//169.254.169.254/latest/meta-data',
    '/safe/../admin',
    '/health\\admin',
    '/health\r\nx-webos-test: bad'
  ]) {
    assert.throws(
      () => assertValidRuntimeProfile({
        ...baseManifest,
        healthcheck: {
          type: 'http',
          path: unsafePath
        }
      }),
      {
        code: 'RUNTIME_PROFILE_INVALID'
      },
      `expected unsafe healthcheck path to be rejected: ${JSON.stringify(unsafePath)}`
    );
  }
});

test('keeps widget and developer package types valid in runtime profile contract', () => {
  for (const appType of ['widget', 'developer']) {
    const manifest = {
      id: `${appType}-sample`,
      type: appType,
      runtime: 'sandbox-html',
      entry: 'index.html'
    };
    const profile = normalizeRuntimeProfile(manifest);

    assert.equal(profile.appType, appType);
    assert.equal(profile.runtimeType, 'sandbox-html');
    assert.equal(assertValidRuntimeProfile(manifest, profile), profile);
  }
});
