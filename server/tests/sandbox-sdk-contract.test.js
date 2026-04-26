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

  assert.equal(WebOS.files.rawUrl({ path: '/tmp/a.txt', grantId: 'fg_1' }), '');
  assert.equal(WebOS.files.rawUrl({ url: '/api/fs/raw?ticket=wos_tkt_safe' }), '/api/fs/raw?ticket=wos_tkt_safe');

  const rawTicketRequest = await requestAndRespond(() => WebOS.files.rawTicket({
    path: '/tmp/a.txt',
    grantId: 'fg_1',
    profile: 'preview'
  }));
  assert.equal(rawTicketRequest.method, 'host.file.rawTicket');
  assert.deepEqual(plain(rawTicketRequest.params), {
    path: '/tmp/a.txt',
    grantId: 'fg_1',
    profile: 'preview'
  });

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

  const writePreflightRequest = await requestAndRespond(() => WebOS.files.writePreflight({
    path: '/tmp/a.txt',
    grantId: 'fg_1'
  }));
  assert.equal(writePreflightRequest.method, 'host.file.writePreflight');
  assert.deepEqual(plain(writePreflightRequest.params), {
    path: '/tmp/a.txt',
    grantId: 'fg_1'
  });

  const writeApproveRequest = await requestAndRespond(() => WebOS.files.approveWrite({
    path: '/tmp/a.txt',
    operationId: 'op_1',
    typedConfirmation: 'a.txt'
  }));
  assert.equal(writeApproveRequest.method, 'host.file.writeApprove');
  assert.deepEqual(plain(writeApproveRequest.params), {
    path: '/tmp/a.txt',
    operationId: 'op_1',
    typedConfirmation: 'a.txt'
  });
});

test('built-in sandbox package entries use raw tickets and scoped overwrite approval', () => {
  const packageEntries = [
    'client/src/apps/addons/document-viewer/package/index.html',
    'client/src/apps/addons/model-viewer/package/index.html',
    'client/src/apps/addons/code-editor/package/index.html'
  ];

  for (const relativePath of packageEntries) {
    const source = fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');
    assert.doesNotMatch(source, /rawUrl\s*\(\s*\{\s*path\s*,\s*grantId\s*\}/, `${relativePath} must not use raw grant URLs`);
    assert.doesNotMatch(source, /approved\s*:\s*true/, `${relativePath} must not send legacy approval flags`);
  }

  const documentViewer = fs.readFileSync(
    path.join(__dirname, '../../client/src/apps/addons/document-viewer/package/index.html'),
    'utf8'
  );
  const modelViewer = fs.readFileSync(
    path.join(__dirname, '../../client/src/apps/addons/model-viewer/package/index.html'),
    'utf8'
  );
  const codeEditor = fs.readFileSync(
    path.join(__dirname, '../../client/src/apps/addons/code-editor/package/index.html'),
    'utf8'
  );

  assert.match(documentViewer, /WebOS\.files\.rawTicket\(\{\s*path,\s*grantId,\s*profile:\s*'preview'/s);
  assert.match(modelViewer, /WebOS\.files\.rawTicket\(\{[\s\S]*profile:\s*'media'/);
  assert.match(codeEditor, /WebOS\.files\.writePreflight\(\{/);
  assert.match(codeEditor, /WebOS\.files\.approveWrite\(\{/);
});

test('generated package templates use scoped host overwrite approval', () => {
  const packagesRoute = fs.readFileSync(
    path.join(__dirname, '../routes/packages.js'),
    'utf8'
  );
  const start = packagesRoute.indexOf("if (key === 'json-formatter')");
  const end = packagesRoute.indexOf("if (key === 'api-tester')", start);
  assert.ok(start >= 0 && end > start, 'json-formatter template should be present');

  const jsonFormatterTemplate = packagesRoute.slice(start, end);
  assert.doesNotMatch(jsonFormatterTemplate, /buildWriteApproval/);
  assert.doesNotMatch(jsonFormatterTemplate, /approved\s*:\s*true/);
  assert.match(jsonFormatterTemplate, /files\.writePreflight\(\{/);
  assert.match(jsonFormatterTemplate, /files\.approveWrite\(\{/);
  assert.match(jsonFormatterTemplate, /targetHash:\s*preflight\?\.targetHash/);
});
