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

export async function fetchServices() {
  return apiFetch('/api/services');
}

export async function restartService(name) {
  return apiFetch(`/api/services/${encodeURIComponent(name)}/restart`, {
    method: 'POST'
  });
}
