import { apiFetch } from '../../../../utils/api.js';

function isCloudPath(path) {
  return String(path || '').trim().startsWith('cloud://');
}

function parseCloudPath(path) {
  const normalized = String(path || '').trim().replace(/^cloud:\/\//, '');
  const segments = normalized.split('/');
  const remote = String(segments.shift() || '').trim();
  const remotePath = segments.join('/');
  return { remote, remotePath };
}

export async function readFile(path, options = {}) {
  if (isCloudPath(path)) {
    const { remote, remotePath } = parseCloudPath(path);
    const cloudParams = new URLSearchParams({
      remote,
      path: remotePath
    });
    return apiFetch(`/api/cloud/read?${cloudParams.toString()}`);
  }

  const params = new URLSearchParams({
    path: String(path || '')
  });
  if (options.grantId) {
    params.set('grantId', String(options.grantId));
  }
  if (options.appId) {
    params.set('appId', String(options.appId));
  }
  return apiFetch(`/api/fs/read?${params.toString()}`);
}

export async function saveFile(path, content, options = {}) {
  if (isCloudPath(path)) {
    const err = new Error('Cloud/WebDAV files are opened read-only from File Station.');
    err.code = 'CLOUD_FILE_READ_ONLY';
    throw err;
  }

  const payload = {
    path,
    content,
    grantId: options.grantId || '',
    appId: options.appId || '',
    operationSource: options.operationSource || '',
    overwrite: options.overwrite === true,
    approval: options.approval && typeof options.approval === 'object' ? options.approval : undefined
  };
  return apiFetch('/api/fs/write', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function preflightOverwrite(path, options = {}) {
  return apiFetch('/api/fs/write/preflight', {
    method: 'POST',
    body: JSON.stringify({
      path,
      grantId: options.grantId || '',
      appId: options.appId || '',
      operationSource: options.operationSource || ''
    })
  });
}

export async function approveOverwrite(path, preflight, options = {}) {
  return apiFetch('/api/fs/write/approve', {
    method: 'POST',
    body: JSON.stringify({
      path,
      grantId: options.grantId || '',
      appId: options.appId || '',
      operationSource: options.operationSource || '',
      operationId: preflight?.operationId || '',
      typedConfirmation: String(options.typedConfirmation || '')
    })
  });
}

function encodeAppId(appId) {
  return encodeURIComponent(String(appId || ''));
}

export async function readPackageFile(appId, path) {
  const params = new URLSearchParams({
    path: String(path || '')
  });
  return apiFetch(`/api/packages/${encodeAppId(appId)}/file?${params.toString()}`);
}

export async function savePackageFile(appId, path, content) {
  return apiFetch(`/api/packages/${encodeAppId(appId)}/file`, {
    method: 'PUT',
    body: JSON.stringify({
      path: String(path || ''),
      content: String(content || '')
    })
  });
}
