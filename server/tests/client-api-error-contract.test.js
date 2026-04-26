const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function toFileUrl(relativePath) {
  return pathToFileURL(path.resolve(__dirname, '..', '..', relativePath)).href;
}

function makeHeaders(values = {}) {
  const normalized = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), String(value)])
  );
  return {
    get(name) {
      return normalized.get(String(name).toLowerCase()) || null;
    }
  };
}

function makeResponse({ status = 200, body = '', headers = {} } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: makeHeaders(headers),
    async text() {
      return body;
    }
  };
}

async function loadApiModule() {
  return import(toFileUrl('client/src/utils/api.js'));
}

test.beforeEach(() => {
  global.localStorage = {
    getItem(key) {
      return key === 'web_os_token' ? 'test-token' : null;
    }
  };
});

test.afterEach(() => {
  delete global.fetch;
  delete global.localStorage;
});

test('apiFetch preserves structured JSON error fields while remaining Error-compatible', async () => {
  const { apiFetch, isApiError, getErrorCode, getUserFacingMessage } = await loadApiModule();
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return makeResponse({
      status: 400,
      headers: {
        'retry-after': '30',
        'x-request-id': 'req-json-1'
      },
      body: JSON.stringify({
        code: 'VALIDATION_FAILED',
        message: 'Invalid package manifest.',
        details: { field: 'manifest.name' },
        validation: [{ path: 'name', message: 'Required.' }]
      })
    });
  };

  await assert.rejects(
    () => apiFetch('/api/packages/import', { method: 'POST', body: '{"name":""}' }),
    (err) => {
      assert.ok(err instanceof Error);
      assert.equal(err.name, 'ApiError');
      assert.equal(isApiError(err), true);
      assert.equal(err.status, 400);
      assert.equal(err.code, 'VALIDATION_FAILED');
      assert.deepEqual(err.details, { field: 'manifest.name' });
      assert.deepEqual(err.validation, [{ path: 'name', message: 'Required.' }]);
      assert.equal(err.retryAfter, '30');
      assert.equal(err.requestId, 'req-json-1');
      assert.equal(err.payload.message, 'Invalid package manifest.');
      assert.equal(getErrorCode(err), 'VALIDATION_FAILED');
      assert.equal(getUserFacingMessage(err), 'Invalid package manifest.');
      return true;
    }
  );

  assert.equal(request.url, '/api/packages/import');
  assert.equal(request.options.headers.Authorization, 'Bearer test-token');
  assert.equal(request.options.headers['Content-Type'], 'application/json');
});

test('apiFetch maps RFC9457 title/detail payloads into ApiError fields', async () => {
  const { apiFetch, getErrorCode, getUserFacingMessage } = await loadApiModule();
  global.fetch = async () => makeResponse({
    status: 400,
    body: JSON.stringify({
      type: 'https://example.test/problems/path-outside-root',
      title: 'Path outside allowed root',
      status: 400,
      detail: 'The requested path escapes the configured workspace.'
    })
  });

  await assert.rejects(
    () => apiFetch('/api/fs/read?path=../secret'),
    (err) => {
      assert.equal(err.status, 400);
      assert.equal(err.code, 'https://example.test/problems/path-outside-root');
      assert.equal(err.message, 'The requested path escapes the configured workspace.');
      assert.equal(err.details, 'The requested path escapes the configured workspace.');
      assert.equal(getErrorCode(err), 'https://example.test/problems/path-outside-root');
      assert.equal(getUserFacingMessage(err), 'The requested path escapes the configured workspace.');
      return true;
    }
  );
});

test('apiFetch keeps 204 and empty success responses compatible', async () => {
  const { apiFetch } = await loadApiModule();
  global.fetch = async () => makeResponse({ status: 204 });

  assert.deepEqual(await apiFetch('/api/fs/grants/grant-1', { method: 'DELETE' }), {});
});

test('apiFetch handles invalid JSON response bodies safely', async () => {
  const { apiFetch } = await loadApiModule();
  global.fetch = async () => makeResponse({ status: 500, body: '<html>failed</html>' });

  await assert.rejects(
    () => apiFetch('/api/system/apps'),
    (err) => {
      assert.equal(err.status, 500);
      assert.equal(err.code, 'HTTP_500');
      assert.equal(err.message, 'HTTP Error: 500');
      assert.deepEqual(err.payload, {});
      return true;
    }
  );
});
