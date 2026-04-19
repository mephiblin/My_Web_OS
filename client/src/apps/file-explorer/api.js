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

export async function uploadChunk(path, fileChunk, uploadId, chunkIndex, totalChunks, fileName) {
  const formData = new FormData();
  formData.append('path', path);
  formData.append('uploadId', uploadId);
  formData.append('chunkIndex', chunkIndex);
  formData.append('totalChunks', totalChunks);
  formData.append('fileName', fileName);
  formData.append('chunk', fileChunk);

  return apiFetch('/api/fs/upload-chunk', {
    method: 'POST',
    body: formData
  });
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

export async function searchFiles(query) {
  return apiFetch(`/api/fs/search?q=${encodeURIComponent(query)}`);
}

export async function fetchTrash() {
  return apiFetch('/api/fs/trash');
}

export async function restoreItem(id) {
  return apiFetch('/api/fs/restore', {
    method: 'POST',
    body: JSON.stringify({ id })
  });
}

export async function emptyTrash() {
  return apiFetch('/api/fs/empty-trash', {
    method: 'DELETE'
  });
}

export async function listArchive(path) {
  return apiFetch(`/api/fs/archive-list?path=${encodeURIComponent(path)}`);
}

export async function extractArchive(path, destPath = '') {
  return apiFetch('/api/fs/extract', {
    method: 'POST',
    body: JSON.stringify({ path, destPath })
  });
}

export async function fetchCloudRemotes() {
  return apiFetch('/api/cloud/remotes');
}

export async function listCloudDir(remote, path) {
  return apiFetch(`/api/cloud/list?remote=${encodeURIComponent(remote)}&path=${encodeURIComponent(path)}`);
}

export async function readCloudFile(remote, path) {
  return apiFetch(`/api/cloud/read?remote=${encodeURIComponent(remote)}&path=${encodeURIComponent(path)}`);
}

export async function createShareLink(path, expiryHours) {
  return apiFetch('/api/share/create', {
    method: 'POST',
    body: JSON.stringify({ path, expiryHours })
  });
}
