import { apiFetch } from '../../utils/api.js';

export async function fetchLogs(options = {}) {
  const { category = 'ALL', level = 'ALL', search = '', limit = 100 } = options;
  const params = new URLSearchParams({ category, level, search, limit });
  return apiFetch(`/api/logs?${params.toString()}`);
}
