<script>
  import { onDestroy, onMount } from 'svelte';
  import { Shield, Monitor, Files, Terminal as TerminalIcon, Settings, Container, LayoutGrid, Video, Send, AlertTriangle, Check } from 'lucide-svelte';
  import { openWindow } from '../stores/windowStore.js';
  import { addToast } from '../stores/toastStore.js';
  import { notifications } from '../stores/notificationStore.js';
  import { apiFetch } from '../../utils/api.js';
  import { cloneMessagePayload } from '../../utils/messagePayload.js';

  let { app } = $props();

  const iconMap = {
    Shield,
    Monitor,
    Files,
    TerminalIcon,
    Settings,
    Container,
    LayoutGrid,
    Video,
    Send
  };

  let frameEl;
  let loading = $state(true);
  let lastError = $state('');
  let lastErrorCode = $state('');
  let bridgeReady = $state(false);
  let capabilityCatalog = $state([]);
  let apiPolicy = $state(null);
  let capabilityById = $state({});
  let approvalMemory = $state({});
  let pendingApproval = $state(null);
  let lastLaunchDataKey = '';
  let bridgeTimeout = null;

  const appId = $derived(app?.appId || app?.id || '');
  const declaredPermissions = $derived(new Set(Array.isArray(app?.permissions) ? app.permissions : []));
  const iframeSrc = $derived.by(() => {
    const baseEntry = app?.sandbox?.entryUrl || '';
    if (!baseEntry) return '';
    if (typeof window === 'undefined') return baseEntry;

    const url = new URL(baseEntry, window.location.origin);
    url.searchParams.set('parentOrigin', window.location.origin);
    url.searchParams.set('instanceId', app?.id || appId || String(Date.now()));
    return `${url.pathname}${url.search}`;
  });

  const METHOD_PERMISSION_MAP = {
    'ui.notification': 'ui.notification',
    'window.open': 'window.open',
    'system.info': 'system.info',
    'app.data.list': 'app.data.list',
    'app.data.read': 'app.data.read',
    'app.data.write': 'app.data.write',
    'host.file.read': 'host.file.read',
    'host.file.rawTicket': 'host.file.read',
    'host.file.writePreflight': 'host.file.write',
    'host.file.writeApprove': 'host.file.write',
    'host.file.write': 'host.file.write'
  };

  const SENSITIVE_RISK_LEVELS = new Set(['medium', 'high']);

  function postToFrame(payload) {
    if (!frameEl?.contentWindow || typeof window === 'undefined') return;
    const safePayload = cloneMessagePayload(payload, null);
    // With iframe sandboxed without allow-same-origin, the child has an opaque origin.
    frameEl.contentWindow.postMessage(safePayload, '*');
  }

  function getLaunchDataKey(launchData) {
    try {
      return JSON.stringify(cloneMessagePayload(launchData || null, null));
    } catch (_err) {
      return String(Date.now());
    }
  }

  function disposeFrame() {
    if (!frameEl) return;
    const targetFrame = frameEl;
    postToFrame({ type: 'webos:dispose' });
    setTimeout(() => {
      if (targetFrame) {
        targetFrame.src = 'about:blank';
      }
    }, 50);
  }

  function normalizeAppForWindow(targetApp) {
    const iconType = targetApp?.iconType === 'image' && targetApp?.iconUrl ? 'image' : 'lucide';
    return {
      ...targetApp,
      iconType,
      iconComponent: iconMap[targetApp.icon] || LayoutGrid
    };
  }

  async function sandboxApi(path, body) {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('web_os_token') : '';
    const response = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(body || {})
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(payload.message || `HTTP ${response.status}`);
      err.code = payload.code || 'SANDBOX_API_FAILED';
      throw err;
    }

    return payload;
  }

  async function executeRequest(request) {
    if (!appId) {
      const err = new Error('Sandbox app context is not initialized.');
      err.code = 'SANDBOX_APP_CONTEXT_INVALID';
      throw err;
    }

    const requiredPermission = METHOD_PERMISSION_MAP[request.method];
    if (!requiredPermission) {
      const err = new Error(`Unsupported sandbox method: ${request.method}`);
      err.code = 'SANDBOX_METHOD_UNSUPPORTED';
      throw err;
    }

    if (!declaredPermissions.has(requiredPermission)) {
      const err = new Error(`Permission not granted: ${requiredPermission}`);
      err.code = 'APP_PERMISSION_DENIED';
      throw err;
    }

    await ensureRequestApproval(request, requiredPermission);

    const params = request.params || {};

    switch (request.method) {
      case 'ui.notification': {
        const title = params.title || app.title;
        const message = String(params.message || '').trim();
        const type = params.type || 'info';
        if (!message) {
          const err = new Error('Notification message is required.');
          err.code = 'SANDBOX_NOTIFICATION_INVALID';
          throw err;
        }

        notifications.add({
          title,
          message,
          type,
          appId
        });
        addToast(message, type, 3000);
        return { delivered: true };
      }

      case 'window.open': {
        const targetAppId = String(params.appId || '').trim();
        if (!targetAppId) {
          const err = new Error('Target app id is required.');
          err.code = 'SANDBOX_WINDOW_INVALID';
          throw err;
        }

        const apps = await apiFetch('/api/system/apps');
        const targetApp = Array.isArray(apps) ? apps.find((item) => item.id === targetAppId) : null;
        if (!targetApp) {
          const err = new Error(`App "${targetAppId}" not found.`);
          err.code = 'SANDBOX_WINDOW_TARGET_NOT_FOUND';
          throw err;
        }

        openWindow(normalizeAppForWindow(targetApp), params.data || null);
        return { opened: true, appId: targetAppId };
      }

      case 'system.info': {
        return apiFetch('/api/system/overview');
      }

      case 'app.data.list': {
        const result = await sandboxApi(`/api/sandbox/${encodeURIComponent(appId)}/data/list`, params);
        return result.result;
      }

      case 'app.data.read': {
        const result = await sandboxApi(`/api/sandbox/${encodeURIComponent(appId)}/data/read`, params);
        return result.result;
      }

      case 'app.data.write': {
        const result = await sandboxApi(`/api/sandbox/${encodeURIComponent(appId)}/data/write`, params);
        return result.result;
      }

      case 'host.file.read': {
        const result = await sandboxApi(`/api/sandbox/${encodeURIComponent(appId)}/file/read`, params);
        return result.result;
      }

      case 'host.file.rawTicket': {
        const result = await sandboxApi(`/api/sandbox/${encodeURIComponent(appId)}/file/raw-ticket`, params);
        return result.result;
      }

      case 'host.file.writePreflight': {
        const result = await sandboxApi(`/api/sandbox/${encodeURIComponent(appId)}/file/write/preflight`, params);
        return result.preflight;
      }

      case 'host.file.writeApprove': {
        const result = await sandboxApi(`/api/sandbox/${encodeURIComponent(appId)}/file/write/approve`, params);
        return result.approval;
      }

      case 'host.file.write': {
        const result = await sandboxApi(`/api/sandbox/${encodeURIComponent(appId)}/file/write`, params);
        return result.result;
      }

      default:
        return null;
    }
  }

  function buildContextPayload(launchData = app.data || null) {
    return {
      type: 'webos:context',
      app: {
        id: appId,
        title: app.title,
        description: app.description || '',
        permissions: Array.isArray(app.permissions) ? app.permissions : [],
        runtime: app.runtime,
        sdkUrl: '/api/sandbox/sdk.js',
        launchData
      },
      capabilities: capabilityCatalog,
      apiPolicy
    };
  }

  function sendContextToFrame(launchData = app.data || null) {
    postToFrame(buildContextPayload(launchData));
  }

  function clearBridgeTimeout() {
    if (!bridgeTimeout) return;
    clearTimeout(bridgeTimeout);
    bridgeTimeout = null;
  }

  function armBridgeTimeout() {
    clearBridgeTimeout();
    bridgeTimeout = setTimeout(() => {
      if (bridgeReady) return;
      loading = false;
      lastError = 'Sandbox app did not report ready. Close and reopen the app, or check the package entry script.';
      lastErrorCode = 'SANDBOX_BRIDGE_READY_TIMEOUT';
    }, 9000);
  }

  function getCapability(permission) {
    if (!permission) return null;
    return capabilityById[permission] || null;
  }

  function getRiskLabel(permission) {
    const capability = getCapability(permission);
    return String(capability?.risk || 'low').toUpperCase();
  }

  function shouldRequireApproval(permission) {
    const capability = getCapability(permission);
    const risk = String(capability?.risk || '').toLowerCase();
    if (SENSITIVE_RISK_LEVELS.has(risk)) return true;
    return permission === 'window.open' || permission === 'app.data.write' || permission === 'host.file.read' || permission === 'host.file.write';
  }

  function describeRequest(request, permission) {
    const params = request?.params || {};
    if (permission === 'window.open') {
      return `Open window "${String(params.appId || 'unknown')}".`;
    }
    if (permission === 'app.data.write') {
      return `Write app data path "${String(params.path || '/').trim() || '/'}".`;
    }
    if (request?.method === 'host.file.write') {
      return `Write host file "${String(params.path || '').trim()}".`;
    }
    if (request?.method === 'host.file.read') {
      return `Read host file "${String(params.path || '').trim()}".`;
    }
    if (permission === 'system.info') {
      return 'Read current host system overview metrics.';
    }
    return `Execute "${request?.method || 'unknown'}".`;
  }

  async function ensureRequestApproval(request, permission) {
    if (!shouldRequireApproval(permission)) return;
    if (approvalMemory[permission] === true) return;

    if (pendingApproval) {
      const err = new Error('Another approval is already pending.');
      err.code = 'SANDBOX_APPROVAL_BUSY';
      throw err;
    }

    await new Promise((resolve, reject) => {
      pendingApproval = {
        permission,
        method: request.method,
        risk: getRiskLabel(permission),
        description: describeRequest(request, permission),
        resolve,
        reject
      };
    });
  }

  function denyPendingApproval() {
    if (!pendingApproval) return;
    const reject = pendingApproval.reject;
    pendingApproval = null;
    const err = new Error('User denied sandbox request approval.');
    err.code = 'SANDBOX_APPROVAL_DENIED';
    reject(err);
  }

  function approvePendingApproval(remember = false) {
    if (!pendingApproval) return;
    const permission = pendingApproval.permission;
    const resolve = pendingApproval.resolve;
    pendingApproval = null;
    if (remember) {
      approvalMemory = {
        ...approvalMemory,
        [permission]: true
      };
    }
    resolve(true);
  }

  async function loadCapabilityCatalog() {
    try {
      const payload = await apiFetch('/api/packages/runtime/capabilities');
      const capabilities = Array.isArray(payload?.capabilities) ? payload.capabilities : [];
      capabilityCatalog = capabilities;
      const next = {};
      for (const item of capabilities) {
        if (!item?.id) continue;
        next[item.id] = item;
      }
      capabilityById = next;
      if (bridgeReady) {
        postToFrame({
          type: 'webos:capabilities',
          capabilities
        });
      }
    } catch (_err) {
      capabilityCatalog = [];
      capabilityById = {};
    }
  }

  async function loadApiPolicy() {
    try {
      const payload = await apiFetch('/api/system/app-api-policy?clientVersion=0.1.0');
      apiPolicy = payload?.policy || null;
      if (bridgeReady && apiPolicy) {
        postToFrame({
          type: 'webos:api-policy',
          policy: apiPolicy
        });
      }
    } catch (_err) {
      apiPolicy = null;
    }
  }

  onMount(() => {
    loadCapabilityCatalog().catch(() => {});
    loadApiPolicy().catch(() => {});

    async function handleMessage(event) {
      if (typeof window === 'undefined') return;
      if (event.source !== frameEl?.contentWindow) return;
      // Opaque iframe origin is expected when `allow-same-origin` is removed.
      if (event.origin !== 'null' && event.origin !== window.location.origin) return;

      const payload = cloneMessagePayload(event.data, {});
      if (!payload || typeof payload !== 'object') return;

      if (payload.type === 'webos:ready') {
        const launchData = app.data || null;
        lastLaunchDataKey = getLaunchDataKey(launchData);
        bridgeReady = true;
        loading = false;
        clearBridgeTimeout();
        sendContextToFrame(launchData);
        return;
      }

      if (payload.type !== 'webos:request') return;

      try {
        const result = await executeRequest(payload);
        postToFrame({
          type: 'webos:response',
          requestId: payload.requestId,
          ok: true,
          result
        });
      } catch (err) {
        lastError = err.message || 'Sandbox request failed.';
        lastErrorCode = err.code || 'SANDBOX_REQUEST_FAILED';
        postToFrame({
          type: 'webos:response',
          requestId: payload.requestId,
          ok: false,
          error: {
            code: err.code || 'SANDBOX_REQUEST_FAILED',
            message: lastError
          }
        });
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  });

  $effect(() => {
    if (!bridgeReady) return;
    const launchData = app.data || null;
    const launchDataKey = getLaunchDataKey(launchData);
    if (launchDataKey === lastLaunchDataKey) return;
    lastLaunchDataKey = launchDataKey;
    postToFrame({
      type: 'webos:launch-data',
      launchData
    });
  });

  function handleLoad() {
    if (!bridgeReady) armBridgeTimeout();
  }

  function handleFrameError() {
    clearBridgeTimeout();
    loading = false;
    lastError = 'Failed to load sandbox app.';
    lastErrorCode = 'SANDBOX_FRAME_LOAD_FAILED';
  }

  onDestroy(() => {
    clearBridgeTimeout();
    disposeFrame();
  });
</script>

<div class="sandbox-shell">
  {#if loading}
    <div class="overlay status">Loading sandbox app...</div>
  {/if}

  {#if lastError}
    <div class="overlay error">
      <strong>{lastErrorCode || 'ERROR'}</strong>
      <span>{lastError}</span>
    </div>
  {/if}

  {#if pendingApproval}
    <div class="approval-overlay">
      <div class="approval-card glass-effect">
        <div class="approval-head">
          <AlertTriangle size={14} />
          <strong>Sandbox Approval Required</strong>
        </div>
        <div class="approval-body">
          <div><b>Method:</b> {pendingApproval.method}</div>
          <div><b>Permission:</b> {pendingApproval.permission}</div>
          <div><b>Risk:</b> {pendingApproval.risk}</div>
          <p>{pendingApproval.description}</p>
        </div>
        <div class="approval-actions">
          <button class="btn ghost" onclick={denyPendingApproval}>Deny</button>
          <button class="btn ghost" onclick={() => approvePendingApproval(false)}>
            <Check size={13} />
            Allow Once
          </button>
          <button class="btn primary" onclick={() => approvePendingApproval(true)}>
            <Check size={13} />
            Always Allow
          </button>
        </div>
      </div>
    </div>
  {/if}

  <iframe
    bind:this={frameEl}
    title={app.title}
    src={iframeSrc}
    sandbox="allow-scripts"
    onload={handleLoad}
    onerror={handleFrameError}
  ></iframe>
</div>

<style>
  .sandbox-shell {
    position: relative;
    width: 100%;
    height: 100%;
    background: rgba(8, 12, 18, 0.9);
  }

  iframe {
    width: 100%;
    height: 100%;
    border: none;
    background: #0f1720;
  }

  .overlay {
    position: absolute;
    top: 16px;
    right: 16px;
    z-index: 2;
    padding: 8px 12px;
    border-radius: 999px;
    font-size: 12px;
    letter-spacing: 0.02em;
    backdrop-filter: blur(12px);
  }

  .status {
    color: #dbeafe;
    background: rgba(30, 64, 175, 0.45);
    border: 1px solid rgba(147, 197, 253, 0.35);
  }

  .error {
    color: #fee2e2;
    background: rgba(127, 29, 29, 0.72);
    border: 1px solid rgba(248, 113, 113, 0.45);
    display: grid;
    gap: 2px;
    max-width: min(520px, calc(100% - 32px));
    border-radius: 12px;
  }

  .approval-overlay {
    position: absolute;
    inset: 0;
    z-index: 5;
    background: rgba(2, 6, 23, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .approval-card {
    width: min(460px, 100%);
    border: 1px solid rgba(251, 191, 36, 0.35);
    border-radius: 12px;
    background: rgba(15, 23, 36, 0.85);
    padding: 12px;
    display: grid;
    gap: 10px;
    color: #e2e8f0;
  }

  .approval-head {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #fde68a;
  }

  .approval-body {
    display: grid;
    gap: 6px;
    font-size: 13px;
  }

  .approval-body p {
    margin: 0;
    color: #cbd5e1;
  }

  .approval-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .btn {
    border: 1px solid rgba(148, 163, 184, 0.25);
    background: rgba(15, 23, 36, 0.8);
    color: #e2e8f0;
    border-radius: 8px;
    padding: 6px 10px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }

  .btn.ghost:hover {
    background: rgba(30, 41, 59, 0.9);
  }

  .btn.primary {
    border-color: rgba(56, 189, 248, 0.45);
    background: rgba(3, 105, 161, 0.5);
    color: #dbeafe;
  }
</style>
