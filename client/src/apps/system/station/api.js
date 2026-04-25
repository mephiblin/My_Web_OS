import { apiFetch } from '../../../utils/api.js';

function encodePathQuery(path) {
  return `path=${encodeURIComponent(String(path || ''))}`;
}

export async function fetchStationInfo(path) {
  return apiFetch(`/api/media/station-info?${encodePathQuery(path)}`);
}
