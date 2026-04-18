import { apiFetch } from '../../utils/api.js';

export async function fetchSettings() {
  return apiFetch('/api/settings');
}

export async function updateSettings(settings) {
  return apiFetch('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(settings)
  });
}
