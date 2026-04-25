export function getModelExtension(path) {
  return String(path || '').split('.').pop()?.toLowerCase() || '';
}

export function buildModelFileUrl(path) {
  return `/api/fs/raw?path=${encodeURIComponent(String(path || ''))}`;
}

export function buildAuthHeaders() {
  const token = localStorage.getItem('web_os_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}
