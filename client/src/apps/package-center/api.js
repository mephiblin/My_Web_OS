import { apiFetch } from '../../utils/api.js';

function encodeAppId(appId) {
  return encodeURIComponent(String(appId || ''));
}

export async function fetchInstalledPackages() {
  return apiFetch('/api/packages');
}

export async function fetchRuntimeApps() {
  return apiFetch('/api/runtime/apps');
}

export async function controlRuntimeApp(appId, action) {
  return apiFetch(`/api/runtime/apps/${encodeAppId(appId)}/${action}`, {
    method: 'POST'
  });
}

export async function fetchRuntimeLogs(appId, limit = 200) {
  return apiFetch(`/api/runtime/apps/${encodeAppId(appId)}/logs?limit=${encodeURIComponent(limit)}`);
}

export async function fetchRuntimeEvents(appId, limit = 120) {
  return apiFetch(`/api/runtime/apps/${encodeAppId(appId)}/events?limit=${encodeURIComponent(limit)}`);
}

export async function fetchPackageLifecycle(appId) {
  return apiFetch(`/api/packages/${encodeAppId(appId)}/lifecycle`);
}

export async function runPackageHealth(appId) {
  return apiFetch(`/api/packages/${encodeAppId(appId)}/health`);
}

export async function updatePackageChannel(appId, channel) {
  return apiFetch(`/api/packages/${encodeAppId(appId)}/channel`, {
    method: 'PUT',
    body: JSON.stringify({ channel })
  });
}

export async function createPackageBackup(appId, note) {
  return apiFetch(`/api/packages/${encodeAppId(appId)}/backup`, {
    method: 'POST',
    body: JSON.stringify({ note })
  });
}

export async function rollbackPackageBackup(appId, backupId) {
  return apiFetch(`/api/packages/${encodeAppId(appId)}/rollback`, {
    method: 'POST',
    body: JSON.stringify({ backupId })
  });
}

export async function recoverRuntimeApp(appId) {
  return apiFetch(`/api/runtime/apps/${encodeAppId(appId)}/recover`, {
    method: 'POST'
  });
}

export async function stopRuntimeApp(appId) {
  return apiFetch(`/api/runtime/apps/${encodeAppId(appId)}/stop`, {
    method: 'POST'
  });
}

export async function removeInstalledPackage(appId) {
  return apiFetch(`/api/packages/${encodeAppId(appId)}`, {
    method: 'DELETE'
  });
}

export async function fetchInstalledOpsSummary(appId, options = {}) {
  const eventsLimit = Number.isFinite(Number(options.eventsLimit))
    ? Math.max(1, Number(options.eventsLimit))
    : 120;
  const refreshHealth = options.refreshHealth === true;

  try {
    const params = new URLSearchParams({
      eventsLimit: String(eventsLimit)
    });
    if (refreshHealth) {
      params.set('refreshHealth', 'true');
    }

    const payload = await apiFetch(
      `/api/packages/${encodeAppId(appId)}/ops-summary?${params.toString()}`
    );
    const summary = payload?.summary || null;
    if (!summary || typeof summary !== 'object') {
      throw new Error('Invalid ops summary response.');
    }

    return {
      lifecycle: summary.lifecycle || null,
      events: Array.isArray(summary.recentRuntimeEvents) ? summary.recentRuntimeEvents : [],
      healthReport: summary.lastHealthReport || summary.lifecycle?.lastQaReport || null,
      runtimeStatus: summary.runtimeStatus || null,
      source: 'summary-endpoint'
    };
  } catch (_err) {
    const [lifecycleResponse, eventsResponse] = await Promise.all([
      fetchPackageLifecycle(appId),
      fetchRuntimeEvents(appId, eventsLimit)
    ]);

    return {
      lifecycle: lifecycleResponse.lifecycle || null,
      events: Array.isArray(eventsResponse.events) ? eventsResponse.events : [],
      healthReport: lifecycleResponse.lifecycle?.lastQaReport || null,
      runtimeStatus: null,
      source: 'fallback'
    };
  }
}

export async function fetchRegistryInstallPreflight(payload = {}) {
  return apiFetch('/api/packages/registry/preflight', {
    method: 'POST',
    body: JSON.stringify({
      sourceId: payload.sourceId || '',
      packageId: payload.packageId || '',
      zipUrl: payload.zipUrl || '',
      overwrite: payload.overwrite === true
    })
  });
}
