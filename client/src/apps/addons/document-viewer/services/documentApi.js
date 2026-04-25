import { apiFetch } from '../../../../utils/api.js';

export async function fetchDocumentText(path) {
  return apiFetch(`/api/fs/read?path=${encodeURIComponent(String(path || ''))}`);
}
