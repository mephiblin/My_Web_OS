<script>
  import { onMount } from 'svelte';
  import { Shield, Monitor, Files, Terminal as TerminalIcon, Settings, Container, LayoutGrid, Video, Send } from 'lucide-svelte';
  import { openWindow } from '../stores/windowStore.js';
  import { addToast } from '../stores/toastStore.js';
  import { notifications } from '../stores/notificationStore.js';
  import { apiFetch } from '../../utils/api.js';

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
  let bridgeReady = $state(false);

  const appId = $derived(app?.appId || app?.id || '');
  const declaredPermissions = $derived(new Set(Array.isArray(app?.permissions) ? app.permissions : []));
  const iframeSrc = $derived.by(() => {
    const baseEntry = app?.sandbox?.entryUrl || '';
    if (!baseEntry) return '';
    if (typeof window === 'undefined') return baseEntry;

    const url = new URL(baseEntry, window.location.origin);
    url.searchParams.set('parentOrigin', window.location.origin);
    return `${url.pathname}${url.search}`;
  });

  const METHOD_PERMISSION_MAP = {
    'ui.notification': 'ui.notification',
    'window.open': 'window.open',
    'system.info': 'system.info',
    'app.data.list': 'app.data.list',
    'app.data.read': 'app.data.read',
    'app.data.write': 'app.data.write'
  };

  function postToFrame(payload) {
    if (!frameEl?.contentWindow || typeof window === 'undefined') return;
    // With iframe sandboxed without allow-same-origin, the child has an opaque origin.
    frameEl.contentWindow.postMessage(payload, '*');
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

      default:
        return null;
    }
  }

  onMount(() => {
    async function handleMessage(event) {
      if (typeof window === 'undefined') return;
      if (event.source !== frameEl?.contentWindow) return;
      // Opaque iframe origin is expected when `allow-same-origin` is removed.
      if (event.origin !== 'null' && event.origin !== window.location.origin) return;

      const payload = event.data || {};

      if (payload.type === 'webos:ready') {
        bridgeReady = true;
        loading = false;
        postToFrame({
          type: 'webos:context',
          app: {
            id: appId,
            title: app.title,
            description: app.description || '',
            permissions: Array.isArray(app.permissions) ? app.permissions : [],
            runtime: app.runtime
          }
        });
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

  function handleLoad() {
    if (!bridgeReady) {
      loading = false;
    }
  }

  function handleFrameError() {
    loading = false;
    lastError = 'Failed to load sandbox app.';
  }
</script>

<div class="sandbox-shell">
  {#if loading}
    <div class="overlay status">Loading sandbox app...</div>
  {/if}

  {#if lastError}
    <div class="overlay error">{lastError}</div>
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
  }
</style>
