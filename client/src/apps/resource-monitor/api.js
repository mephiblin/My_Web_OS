import { apiFetch } from '../../utils/api.js';

export async function fetchSystemOverview() {
  return apiFetch('/api/system/overview');
}

export async function fetchServiceStatus() {
  return apiFetch('/api/services');
}

export async function fetchRuntimeApps() {
  return apiFetch('/api/runtime/apps');
}

export async function fetchInstalledPackages() {
  return apiFetch('/api/packages');
}
