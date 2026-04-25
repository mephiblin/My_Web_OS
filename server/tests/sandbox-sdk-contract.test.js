const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadSdkHarness(permissions = []) {
  const code = fs.readFileSync(path.join(__dirname, '../static/webos-sandbox-sdk.js'), 'utf8');
  const posted = [];
  const listeners = [];
  const parent = {
    postMessage(payload) {
      posted.push(payload);
    }
  };
  const window = {
    parent,
    postMessage() {},
    addEventListener(type, handler) {
      if (type === 'message') listeners.push(handler);
    }
  };

  vm.runInNewContext(code, {
    window,
    setTimeout: () => 0,
    clearTimeout: () => {}
  });

  assert.equal(posted[0]?.type, 'webos:ready');
  for (const handler of listeners) {
    handler({
      source: parent,
      data: {
        type: 'webos:context',
        app: {
          id: 'sdk-test',
          permissions
        }
      }
    });
  }

  async function requestAndRespond(action) {
    const start = posted.length;
    const pending = action();
    const request = posted.slice(start).find((item) => item?.type === 'webos:request');
    assert.ok(request, 'SDK request should be posted to parent frame');
    for (const handler of listeners) {
      handler({
        source: parent,
        data: {
          type: 'webos:response',
          requestId: request.requestId,
          ok: true,
          result: { ok: true }
        }
      });
    }
    await pending;
    return request;
  }

  return {
    WebOS: window.WebOS,
    requestAndRespond
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('sandbox SDK exposes app data alias and object-style app.data calls', async () => {
  const { WebOS, requestAndRespond } = loadSdkHarness(['app.data.read', 'app.data.write']);

  assert.equal(WebOS.app.data, WebOS.appData);

  const readRequest = await requestAndRespond(() => WebOS.app.data.read({ path: 'memo.txt' }));
  assert.equal(readRequest.method, 'app.data.read');
  assert.deepEqual(plain(readRequest.params), { path: 'memo.txt' });

  const writeRequest = await requestAndRespond(() => WebOS.app.data.write({ path: 'memo.txt', content: 'hello' }));
  assert.equal(writeRequest.method, 'app.data.write');
  assert.deepEqual(plain(writeRequest.params), { path: 'memo.txt', content: 'hello' });
});

test('sandbox SDK host file helpers request host.file permissions', async () => {
  const { WebOS, requestAndRespond } = loadSdkHarness(['host.file.read', 'host.file.write']);

  const readRequest = await requestAndRespond(() => WebOS.files.read({ path: '/tmp/a.txt', grantId: 'fg_1' }));
  assert.equal(readRequest.method, 'host.file.read');
  assert.deepEqual(plain(readRequest.params), { path: '/tmp/a.txt', grantId: 'fg_1' });

  const writeRequest = await requestAndRespond(() => WebOS.files.write({
    path: '/tmp/a.txt',
    grantId: 'fg_1',
    content: 'next',
    overwrite: true
  }));
  assert.equal(writeRequest.method, 'host.file.write');
  assert.deepEqual(plain(writeRequest.params), {
    path: '/tmp/a.txt',
    grantId: 'fg_1',
    content: 'next',
    overwrite: true
  });
});
