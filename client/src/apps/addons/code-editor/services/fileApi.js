import { apiFetch } from '../../../../utils/api.js';

export async function readFile(path, options = {}) {
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
