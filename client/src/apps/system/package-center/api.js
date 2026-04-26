import { apiFetch, apiFetchTicketUrl } from '../../../utils/api.js';

function encodeAppId(appId) {
  return encodeURIComponent(String(appId || ''));
}

function buildManifestApprovalEnvelope(manifest, options = {}) {
  const approvals =
    options.approvals && typeof options.approvals === 'object'
      ? options.approvals
      : {
          mediaScopesAccepted: options.mediaScopesAccepted === true
        };

  return {
    manifest: manifest || {},
    approvals: {
      ...approvals,
      mediaScopesAccepted: approvals.mediaScopesAccepted === true
    }
  };
}

export async function fetchInstalledPackages() {
  return apiFetch('/api/packages');
}

export async function fetchRuntimeApps() {
  return apiFetch('/api/runtime/apps');
}

export async function fetchDesktopApps() {
  return apiFetch('/api/system/apps');
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

export async function fetchPackageBackupPolicy(appId) {
  return apiFetch(`/api/packages/${encodeAppId(appId)}/backup-policy`);
}

export async function updatePackageBackupPolicy(appId, policy) {
  return apiFetch(`/api/packages/${encodeAppId(appId)}/backup-policy`, {
    method: 'PUT',
    body: JSON.stringify(policy)
  });
}

export async function fetchPackageManifest(appId) {
  return apiFetch(`/api/packages/${encodeAppId(appId)}/manifest`);
}

export async function fetchPackageFileEntries(appId, relativePath = '') {
  const params = new URLSearchParams();
  if (relativePath) {
    params.set('path', String(relativePath));
  }
  const query = params.toString();
  return apiFetch(`/api/packages/${encodeAppId(appId)}/files${query ? `?${query}` : ''}`);
}

export async function preflightPackageManifestUpdate(appId, manifest, options = {}) {
  return apiFetch(`/api/packages/${encodeAppId(appId)}/manifest/preflight`, {
    method: 'POST',
    body: JSON.stringify(buildManifestApprovalEnvelope(manifest, options))
  });
}

export async function updatePackageManifest(appId, manifest, options = {}) {
  return apiFetch(`/api/packages/${encodeAppId(appId)}/manifest`, {
    method: 'PUT',
    body: JSON.stringify(buildManifestApprovalEnvelope(manifest, options))
  });
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

export async function fetchPackageBackupJobs(appId, limit = 50) {
  return apiFetch(
    `/api/packages/${encodeAppId(appId)}/backup-jobs?limit=${encodeURIComponent(limit)}`
  );
}

export async function createPackageBackupJob(appId, note) {
  return apiFetch(`/api/packages/${encodeAppId(appId)}/backup-jobs`, {
    method: 'POST',
    body: JSON.stringify({ note })
  });
}

export async function cancelPackageBackupJob(appId, jobId) {
  return apiFetch(`/api/packages/${encodeAppId(appId)}/backup-jobs/${encodeURIComponent(String(jobId || ''))}/cancel`, {
    method: 'POST'
  });
}

export async function rollbackPackageBackup(appId, backupId) {
  return apiFetch(`/api/packages/${encodeAppId(appId)}/rollback`, {
    method: 'POST',
    body: JSON.stringify({ backupId })
  });
}

export async function preflightPackageRollback(appId, backupId) {
  return apiFetch(`/api/packages/${encodeAppId(appId)}/rollback/preflight`, {
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

export async function preflightPackageDelete(appId) {
  return apiFetch(`/api/packages/${encodeAppId(appId)}/delete/preflight`, {
    method: 'POST'
  });
}

export async function approvePackageDelete(appId, approval = {}) {
  return apiFetch(`/api/packages/${encodeAppId(appId)}/delete/approve`, {
    method: 'POST',
    body: JSON.stringify({
      operationId: String(approval.operationId || ''),
      typedConfirmation: String(approval.typedConfirmation || '')
    })
  });
}

export async function removeInstalledPackage(appId, options = {}) {
  const payload = {};
  if (options.approval && typeof options.approval === 'object') {
    payload.approval = options.approval;
  }
  if (options.reason) {
    payload.reason = String(options.reason);
  }

  const requestOptions = {
    method: 'DELETE'
  };
  if (Object.keys(payload).length > 0) {
    requestOptions.body = JSON.stringify(payload);
  }

  return apiFetch(`/api/packages/${encodeAppId(appId)}`, requestOptions);
}

export async function fetchPackageExportTicketUrl(appId) {
  return apiFetchTicketUrl(`/api/packages/${encodeAppId(appId)}/export-ticket`, {});
}

export async function cloneInstalledPackage(appId, targetId, title = '') {
  return apiFetch(`/api/packages/${encodeAppId(appId)}/clone`, {
    method: 'POST',
    body: JSON.stringify({
      targetId: String(targetId || '').trim(),
      title: String(title || '').trim()
    })
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
      overwrite: payload.overwrite === true,
      localWorkspace: payload.localWorkspace && typeof payload.localWorkspace === 'object'
        ? payload.localWorkspace
        : undefined
    })
  });
}

export async function installRegistryPackage(payload = {}) {
  return apiFetch('/api/packages/registry/install', {
    method: 'POST',
    body: JSON.stringify({
      sourceId: payload.sourceId || '',
      packageId: payload.packageId || '',
      zipUrl: payload.zipUrl || '',
      overwrite: payload.overwrite === true,
      forcePolicyBypass: payload.forcePolicyBypass === true,
      localWorkspace: payload.localWorkspace && typeof payload.localWorkspace === 'object'
        ? payload.localWorkspace
        : undefined
    })
  });
}

function buildZipImportFormData(file, options = {}) {
  const formData = new FormData();
  formData.append('package', file);
  formData.append('overwrite', options.overwrite === true ? 'true' : 'false');
  if (options.localWorkspace && typeof options.localWorkspace === 'object') {
    formData.append('localWorkspace', JSON.stringify(options.localWorkspace));
  }
  return formData;
}

export async function preflightZipPackageImport(file, options = {}) {
  return apiFetch('/api/packages/import/preflight', {
    method: 'POST',
    body: buildZipImportFormData(file, options)
  });
}

export async function importZipPackage(file, options = {}) {
  return apiFetch('/api/packages/import', {
    method: 'POST',
    body: buildZipImportFormData(file, options)
  });
}

export async function wizardPreflightPackage(manifest, templateId, localWorkspace = null) {
  return apiFetch('/api/packages/wizard/preflight', {
    method: 'POST',
    body: JSON.stringify({
      manifest: manifest || {},
      ...(templateId ? { templateId: String(templateId) } : {}),
      ...(localWorkspace && typeof localWorkspace === 'object'
        ? { localWorkspace }
        : {})
    })
  });
}

export async function wizardCreatePackage(manifest, templateId = '', localWorkspace = null) {
  return apiFetch('/api/packages/wizard/create', {
    method: 'POST',
    body: JSON.stringify({
      manifest: manifest || {},
      ...(templateId ? { templateId: String(templateId) } : {}),
      ...(localWorkspace && typeof localWorkspace === 'object'
        ? { localWorkspace }
        : {})
    })
  });
}
