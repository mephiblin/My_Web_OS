(function bootstrapWebOSSandboxSdk(global) {
  'use strict';

  if (!global || typeof global.postMessage !== 'function') {
    return;
  }

  var pending = new Map();
  var context = null;
  var capabilities = [];
  var apiPolicy = null;
  var readyResolvers = [];
  var readyAnnounceTimer = null;
  var readyAnnounceCount = 0;
  var requestSeq = 0;

  function createError(code, message) {
    var err = new Error(String(message || 'WebOS SDK request failed.'));
    err.code = String(code || 'WEBOS_SDK_ERROR');
    return err;
  }

  function isReady() {
    return Boolean(context);
  }

  function waitUntilReady(timeoutMs) {
    if (isReady()) return Promise.resolve(context);
    var timeout = Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : 7000;
    return new Promise(function onWait(resolve, reject) {
      var timer = setTimeout(function onTimeout() {
        reject(createError('WEBOS_SDK_READY_TIMEOUT', 'Timed out waiting for WebOS context.'));
      }, timeout);
      readyResolvers.push(function onReady(payload) {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  function markReady(payload) {
    context = payload && typeof payload === 'object' ? payload : {};
    if (readyAnnounceTimer && typeof clearTimeout === 'function') {
      clearTimeout(readyAnnounceTimer);
    }
    readyAnnounceTimer = null;
    var nextResolvers = readyResolvers.slice();
    readyResolvers.length = 0;
    for (var i = 0; i < nextResolvers.length; i += 1) {
      try {
        nextResolvers[i](context);
      } catch (_err) {}
    }
  }

  function hasPermission(permission) {
    if (!context || !context.app || !Array.isArray(context.app.permissions)) return false;
    return context.app.permissions.indexOf(permission) >= 0;
  }

  function request(method, params) {
    requestSeq += 1;
    var requestId = 'webos-sdk-' + Date.now() + '-' + requestSeq;
    return new Promise(function onRequest(resolve, reject) {
      pending.set(requestId, { resolve: resolve, reject: reject });
      global.parent.postMessage({
        type: 'webos:request',
        requestId: requestId,
        method: method,
        params: params || {}
      }, '*');

      setTimeout(function onExpire() {
        var ticket = pending.get(requestId);
        if (!ticket) return;
        pending.delete(requestId);
        ticket.reject(createError('WEBOS_SDK_REQUEST_TIMEOUT', 'SDK request timed out.'));
      }, 12000);
    });
  }

  function announceReady() {
    if (isReady()) return;
    readyAnnounceCount += 1;
    global.parent.postMessage({ type: 'webos:ready' }, '*');
  }

  function scheduleReadyAnnouncement() {
    if (isReady() || readyAnnounceCount >= 20 || typeof setTimeout !== 'function') return;
    readyAnnounceTimer = setTimeout(function onReadyRetry() {
      readyAnnounceTimer = null;
      announceReady();
      scheduleReadyAnnouncement();
    }, 500);
  }

  function requestWithPermission(permission, method, params) {
    if (!hasPermission(permission)) {
      return Promise.reject(
        createError(
          'APP_PERMISSION_DENIED',
          'Permission not granted for "' + permission + '".'
        )
      );
    }
    return request(method, params);
  }

  function normalizeDataPathInput(input) {
    if (input && typeof input === 'object') return input;
    return { path: input || '' };
  }

  var appDataApi = {
    list: function list(input) {
      var payload = normalizeDataPathInput(input);
      return requestWithPermission('app.data.list', 'app.data.list', { path: payload.path || '' });
    },
    read: function read(input) {
      var payload = normalizeDataPathInput(input);
      return requestWithPermission('app.data.read', 'app.data.read', { path: payload.path || '' });
    },
    write: function write(input, content) {
      var payload = normalizeDataPathInput(input);
      return requestWithPermission('app.data.write', 'app.data.write', {
        path: payload.path || '',
        content: payload.content == null ? (content == null ? '' : content) : payload.content
      });
    }
  };

  function handleMessage(event) {
    if (event.source !== global.parent) return;
    var payload = event.data || {};
    if (!payload || typeof payload !== 'object') return;

    if (payload.type === 'webos:context') {
      capabilities = Array.isArray(payload.capabilities) ? payload.capabilities : [];
      apiPolicy = payload.apiPolicy || null;
      markReady(payload);
      return;
    }

    if (payload.type === 'webos:capabilities') {
      capabilities = Array.isArray(payload.capabilities) ? payload.capabilities : [];
      return;
    }

    if (payload.type === 'webos:api-policy') {
      apiPolicy = payload.policy || null;
      return;
    }

    if (payload.type !== 'webos:response') return;
    var ticket = pending.get(payload.requestId);
    if (!ticket) return;
    pending.delete(payload.requestId);
    if (payload.ok) {
      ticket.resolve(payload.result);
      return;
    }
    ticket.reject(createError(payload.error && payload.error.code, payload.error && payload.error.message));
  }

  global.addEventListener('message', handleMessage);
  announceReady();
  scheduleReadyAnnouncement();

  var sdk = {
    version: '1.0.0',
    ready: function ready(timeoutMs) {
      return waitUntilReady(timeoutMs);
    },
    getContext: function getContext() {
      return context;
    },
    getCapabilities: function getCapabilities() {
      return capabilities.slice();
    },
    getApiPolicy: function getApiPolicy() {
      return apiPolicy;
    },
    request: request,
    ui: {
      notification: function notification(input) {
        var payload = input && typeof input === 'object' ? input : { message: String(input || '') };
        return requestWithPermission('ui.notification', 'ui.notification', payload);
      }
    },
    window: {
      open: function open(appId, data) {
        return requestWithPermission('window.open', 'window.open', {
          appId: appId,
          data: data || null
        });
      }
    },
    system: {
      info: function info() {
        return requestWithPermission('system.info', 'system.info', {});
      }
    },
    app: {
      data: appDataApi
    },
    appData: appDataApi,
    service: {
      request: function serviceRequest(input) {
        var payload = input && typeof input === 'object' ? input : {};
        return requestWithPermission('service.bridge', 'service.request', {
          method: payload.method || 'GET',
          path: payload.path || '/',
          headers: payload.headers && typeof payload.headers === 'object' ? payload.headers : undefined,
          body: payload.body
        });
      }
    },
    files: {
      rawUrl: function rawUrl(input) {
        var payload = input && typeof input === 'object' ? input : {};
        return payload.url || '';
      },
      rawTicket: function rawTicket(input) {
        var payload = input && typeof input === 'object' ? input : {};
        return requestWithPermission('host.file.read', 'host.file.rawTicket', {
          path: payload.path || '',
          grantId: payload.grantId || '',
          profile: payload.profile || payload.purpose || 'preview',
          ttlMs: payload.ttlMs,
          absoluteTtlMs: payload.absoluteTtlMs,
          idleTimeoutMs: payload.idleTimeoutMs
        });
      },
      read: function read(input) {
        var payload = input && typeof input === 'object' ? input : {};
        return requestWithPermission('host.file.read', 'host.file.read', {
          path: payload.path || '',
          grantId: payload.grantId || ''
        });
      },
      write: function write(input) {
        var payload = input && typeof input === 'object' ? input : {};
        return requestWithPermission('host.file.write', 'host.file.write', {
          path: payload.path || '',
          grantId: payload.grantId || '',
          content: payload.content == null ? '' : payload.content,
          overwrite: payload.overwrite === true,
          approval: payload.approval && typeof payload.approval === 'object' ? payload.approval : undefined
        });
      },
      writePreflight: function writePreflight(input) {
        var payload = input && typeof input === 'object' ? input : {};
        return requestWithPermission('host.file.write', 'host.file.writePreflight', {
          path: payload.path || '',
          grantId: payload.grantId || ''
        });
      },
      approveWrite: function approveWrite() {
        return Promise.reject(createError(
          'WEBOS_APPROVAL_PARENT_ONLY',
          'Sandbox overwrite approval is owned by the Web OS parent frame.'
        ));
      }
    }
  };

  global.WebOS = sdk;
})(window);
