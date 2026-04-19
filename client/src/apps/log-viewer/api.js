import { apiFetch } from '../../utils/api.js';

export async function fetchLogs(type = 'ALL', limit = 100) {
  return apiFetch(`/api/logs?type=${type}&limit=${limit}`);
}
