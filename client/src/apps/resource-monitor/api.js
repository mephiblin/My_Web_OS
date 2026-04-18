import { apiFetch } from '../../utils/api.js';

export async function fetchSystemOverview() {
  return apiFetch('/api/system/overview');
}
