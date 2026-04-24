import { apiFetch } from '../../../utils/api.js';

export async function readFile(path) {
  return apiFetch(`/api/fs/read?path=${encodeURIComponent(path)}`);
}

export async function saveFile(path, content) {
  return apiFetch('/api/fs/write', {
    method: 'POST',
    body: JSON.stringify({ path, content })
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

