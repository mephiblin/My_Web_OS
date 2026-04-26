export function getModelExtension(path) {
  return String(path || '').split('.').pop()?.toLowerCase() || '';
}

function isCloudPath(path) {
  return String(path || '').trim().startsWith('cloud://');
}

export function buildModelFileUrl(path) {
  if (isCloudPath(path)) {
    return `/api/cloud/raw?path=${encodeURIComponent(String(path || ''))}`;
  }
  return `/api/fs/raw?path=${encodeURIComponent(String(path || ''))}`;
}

export function buildAuthHeaders() {
  const token = localStorage.getItem('web_os_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}
