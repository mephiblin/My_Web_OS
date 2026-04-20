import { API_BASE } from './constants.js';

function getToken() {
  return localStorage.getItem('web_os_token');
}

/**
 * Authenticated fetch wrapper. Automatically injects JWT token.
 */
export async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = {
    ...options.headers,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (options.body && typeof options.body === 'string') {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload.message || `HTTP Error: ${res.status}`);
  }
  return payload;
}
