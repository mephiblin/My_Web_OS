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

  await assert.rejects(() => WebOS.files.approveWrite({
    path: '/tmp/a.txt',
    operationId: 'op_1',
    typedConfirmation: 'a.txt'
  }), {
    code: 'WEBOS_APPROVAL_PARENT_ONLY'
  });
});

test('sandbox SDK exposes service bridge requests for hybrid tool packages', async () => {
  const { WebOS, requestAndRespond } = loadSdkHarness(['service.bridge']);

  const serviceRequest = await requestAndRespond(() => WebOS.service.request({
    method: 'GET',
    path: '/library/status'
  }));

  assert.equal(serviceRequest.method, 'service.request');
  assert.deepEqual(plain(serviceRequest.params), {
    method: 'GET',
    path: '/library/status'
  });

  await assert.rejects(() => loadSdkHarness([]).WebOS.service.request({ path: '/health' }), {
    code: 'APP_PERMISSION_DENIED'
  });
});

test('sandbox SDK exposes calendar APIs for shared calendar sync', async () => {
  const { WebOS, requestAndRespond } = loadSdkHarness(['calendar.read', 'calendar.write']);

  const listRequest = await requestAndRespond(() => WebOS.calendar.list({
    from: '2026-04-01T00:00:00.000Z',
    to: '2026-04-30T23:59:59.999Z'
  }));
  assert.equal(listRequest.method, 'calendar.events.list');
  assert.deepEqual(plain(listRequest.params), {
    from: '2026-04-01T00:00:00.000Z',
    to: '2026-04-30T23:59:59.999Z'
  });

  const monthRequest = await requestAndRespond(() => WebOS.calendar.month({
    year: 2026,
    month: 4
  }));
  assert.equal(monthRequest.method, 'calendar.events.month');
  assert.deepEqual(plain(monthRequest.params), { year: 2026, month: 4 });

  const createRequest = await requestAndRespond(() => WebOS.calendar.create({
    title: 'Deploy window',
    startAt: '2026-04-28T10:00:00.000Z'
  }));
  assert.equal(createRequest.method, 'calendar.events.create');

  const updateRequest = await requestAndRespond(() => WebOS.calendar.update('event-1', {
    title: 'Updated title'
  }));
  assert.equal(updateRequest.method, 'calendar.events.update');
  assert.deepEqual(plain(updateRequest.params), {
    eventId: 'event-1',
    patch: { title: 'Updated title' }
  });

  const deleteRequest = await requestAndRespond(() => WebOS.calendar.remove('event-1'));
  assert.equal(deleteRequest.method, 'calendar.events.delete');
  assert.deepEqual(plain(deleteRequest.params), { eventId: 'event-1' });

  await assert.rejects(() => loadSdkHarness([]).WebOS.calendar.list({}), {
    code: 'APP_PERMISSION_DENIED'
  });
});

test('sandbox service bridge is parent-mediated and permission-gated', () => {
  const bridgeSource = fs.readFileSync(
    path.join(__dirname, '../../client/src/core/components/SandboxAppFrame.svelte'),
    'utf8'
  );
  const sandboxRouteSource = fs.readFileSync(
    path.join(__dirname, '../routes/sandbox.js'),
    'utf8'
  );

  assert.match(bridgeSource, /'service\.request': 'service\.bridge'/);
  assert.match(bridgeSource, /'calendar\.events\.list': 'calendar\.read'/);
  assert.match(bridgeSource, /'calendar\.events\.create': 'calendar\.write'/);
  assert.match(bridgeSource, /\/service\/request/);
  assert.match(bridgeSource, /\/api\/system\/calendar\/events/);
  assert.match(sandboxRouteSource, /decodeURIComponent\(pathname\)/);
  assert.match(sandboxRouteSource, /requestPath\.startsWith\('\/\/'\)/);
  assert.match(sandboxRouteSource, /127\.0\.0\.1/);
});

test('built-in sandbox package entries use raw tickets and parent-owned overwrite approval', () => {
  const packageEntries = [
    'client/src/apps/addons/document-viewer/package/index.html',
    'client/src/apps/addons/model-viewer/package/index.html',
    'client/src/apps/addons/code-editor/package/index.html'
  ];

  for (const relativePath of packageEntries) {
    const source = fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');
    assert.doesNotMatch(source, /rawUrl\s*\(\s*\{\s*path\s*,\s*grantId\s*\}/, `${relativePath} must not use raw grant URLs`);
    assert.doesNotMatch(source, /approved\s*:\s*true/, `${relativePath} must not send legacy approval flags`);
    assert.doesNotMatch(source, /approveWrite\s*\(/, `${relativePath} must not mint overwrite approval from sandbox code`);
    assert.doesNotMatch(source, /typedConfirmation:\s*preflight\?\.approval\?\.typedConfirmation/, `${relativePath} must not echo preflight typed confirmation`);
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
  assert.match(codeEditor, /WebOS\.files\.write\(\{[\s\S]*overwrite:\s*true/);
});

test('generated package templates use parent-owned host overwrite approval', () => {
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
  assert.doesNotMatch(jsonFormatterTemplate, /files\.approveWrite\s*\(/);
  assert.doesNotMatch(jsonFormatterTemplate, /typedConfirmation:\s*preflight\?\.approval\?\.typedConfirmation/);
  assert.match(jsonFormatterTemplate, /files\.write\(\{[\s\S]*overwrite/);
});

test('sandbox parent bridge does not expose write approval minting to child frames', () => {
  const bridgeSource = fs.readFileSync(
    path.join(__dirname, '../../client/src/core/components/SandboxAppFrame.svelte'),
    'utf8'
  );

  assert.doesNotMatch(bridgeSource, /'host\.file\.writeApprove'\s*:/);
  assert.doesNotMatch(bridgeSource, /case 'host\.file\.writeApprove'/);
  assert.match(bridgeSource, /file\/write\/approve/);
  assert.match(bridgeSource, /bind:value=\{writeApprovalInput\}/);
  assert.match(bridgeSource, /writeApprovalSubmitting/);
  assert.match(bridgeSource, /SANDBOX_APPROVAL_CONFIRMATION_MISSING/);
  assert.match(bridgeSource, /rejectPendingWriteApproval\('Sandbox frame was closed before overwrite approval completed\.'/);
});
