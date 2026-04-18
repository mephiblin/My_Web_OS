import { apiFetch } from '../../utils/api.js';

export async function fetchConfig() {
  return apiFetch('/api/fs/config');
}

export async function fetchUserDirs() {
  return apiFetch('/api/fs/user-dirs');
}

export async function listDir(path) {
  return apiFetch(`/api/fs/list?path=${encodeURIComponent(path)}`);
}

export async function readFile(path) {
  return apiFetch(`/api/fs/read?path=${encodeURIComponent(path)}`);
}

export async function writeFile(path, content) {
  return apiFetch('/api/fs/write', {
    method: 'POST',
    body: JSON.stringify({ path, content })
  });
}

export async function createDir(path) {
  return apiFetch('/api/fs/create-dir', {
    method: 'POST',
    body: JSON.stringify({ path })
  });
}

export async function deleteItem(path) {
  return apiFetch('/api/fs/delete', {
    method: 'DELETE',
    body: JSON.stringify({ path })
  });
}

export async function renameItem(oldPath, newName) {
  return apiFetch('/api/fs/rename', {
    method: 'PUT',
    body: JSON.stringify({ oldPath, newName })
  });
}
