import { apiFetch } from '../../utils/api.js';

export async function readFile(path) {
  return apiFetch(`/api/fs/read?path=${encodeURIComponent(path)}`);
}

export async function saveFile(path, content) {
  return apiFetch('/api/fs/write', {
    method: 'POST',
    body: JSON.stringify({ path, content })
  });
}
