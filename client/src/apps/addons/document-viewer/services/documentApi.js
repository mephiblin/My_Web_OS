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

export async function fetchDocumentText(path) {
  if (isCloudPath(path)) {
    const { remote, remotePath } = parseCloudPath(path);
    const params = new URLSearchParams({
      remote,
      path: remotePath
    });
    return apiFetch(`/api/cloud/read?${params.toString()}`);
  }
  return apiFetch(`/api/fs/read?path=${encodeURIComponent(String(path || ''))}`);
}
