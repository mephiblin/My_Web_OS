import { apiFetch } from '../../../utils/api.js';

const OPERATION_META = {
  list: { title: 'Browse Failed', defaultMessage: 'Could not load this folder.' },
  read: { title: 'Read Failed', defaultMessage: 'Could not read this file.' },
  raw: { title: 'Preview Failed', defaultMessage: 'Could not load raw file data.' },
  write: { title: 'Save Failed', defaultMessage: 'Could not save this file.' },
  createDir: { title: 'Create Folder Failed', defaultMessage: 'Could not create this folder.' },
  delete: { title: 'Delete Failed', defaultMessage: 'Could not move this item to trash.' },
  rename: { title: 'Rename Failed', defaultMessage: 'Could not rename this item.' },
  upload: { title: 'Upload Failed', defaultMessage: 'Could not upload this file.' },
  extract: { title: 'Extract Failed', defaultMessage: 'Could not extract this archive.' },
  share: { title: 'Share Failed', defaultMessage: 'Could not create a share link.' },
  cloudList: { title: 'Cloud Browse Failed', defaultMessage: 'Could not load this cloud folder.' },
  cloudRead: { title: 'Cloud Read Failed', defaultMessage: 'Could not read this cloud file.' },
  cloudAdd: { title: 'Cloud Connect Failed', defaultMessage: 'Could not connect this network drive.' },
  cloudMount: { title: 'Cloud Mount Failed', defaultMessage: 'Could not mount this network drive.' },
  cloudUpload: { title: 'Cloud Upload Failed', defaultMessage: 'Could not upload file to cloud remote.' },
  cloudUploadJobs: { title: 'Cloud Upload Status Failed', defaultMessage: 'Could not load cloud upload jobs.' },
  cloudUploadCancel: { title: 'Cloud Upload Cancel Failed', defaultMessage: 'Could not cancel cloud upload.' },
  search: { title: 'Search Failed', defaultMessage: 'Could not search files.' },
  trash: { title: 'Trash Failed', defaultMessage: 'Could not load trash items.' },
  restore: { title: 'Restore Failed', defaultMessage: 'Could not restore this item.' },
  emptyTrash: { title: 'Empty Trash Failed', defaultMessage: 'Could not empty trash.' },
  config: { title: 'Load Failed', defaultMessage: 'Could not load file station configuration.' },
  userDirs: { title: 'Load Failed', defaultMessage: 'Could not load user directories.' },
  cloudRemotes: { title: 'Load Failed', defaultMessage: 'Could not load cloud remotes.' },
  grants: { title: 'Grant Load Failed', defaultMessage: 'Could not load active file grants.' },
  revokeGrant: { title: 'Grant Revoke Failed', defaultMessage: 'Could not revoke this file grant.' }
};

function parseErrorMessage(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (typeof err.message === 'string') return err.message;
  return 'Unexpected error';
}

function inferCodeFromMessage(message) {
  const msg = (message || '').toLowerCase();
  if (!msg) return 'UNKNOWN_ERROR';
  if (msg.includes('system inventory is protected')) return 'FS_SYSTEM_PROTECTED';
  if (msg.includes('access to this path is restricted')) return 'FS_PERMISSION_DENIED';
  if (msg.includes('invalid path')) return 'FS_INVALID_PATH';
  if (msg.includes('enoent') || msg.includes('no such file')) return 'FS_PATH_NOT_FOUND';
  if (msg.includes('eacces') || msg.includes('eperm') || msg.includes('permission denied')) return 'FS_PERMISSION_DENIED';
  if (msg.includes('cannot read a directory')) return 'FS_READ_DIRECTORY_BLOCKED';
  if (msg.includes('path is not a directory')) return 'FS_NOT_DIRECTORY';
  if (msg.includes('cannot stream a directory')) return 'FS_RAW_DIRECTORY_BLOCKED';
  return 'REQUEST_FAILED';
}

function getFriendlyMessage(code, operation, originalMessage) {
  const op = OPERATION_META[operation] || {};
  const fallback = op.defaultMessage || 'Request failed.';
  const boundaryMap = {
    FS_SYSTEM_PROTECTED: 'This location is protected by system boundary rules. Use system or package tools instead.',
    FS_PERMISSION_DENIED: 'This location is outside your allowed roots. Choose a permitted folder.',
    FS_INVALID_PATH: 'The selected path is invalid. Check the path and try again.',
    FS_PATH_NOT_FOUND: 'The target path no longer exists.',
    FS_READ_DIRECTORY_BLOCKED: 'You selected a folder where a file is required.',
    FS_NOT_DIRECTORY: 'You selected a file where a folder is required.',
    FS_RAW_DIRECTORY_BLOCKED: 'Raw preview is not available for folders.'
  };
  return boundaryMap[code] || originalMessage || fallback;
}

function normalizeApiError(operation, err) {
  const message = parseErrorMessage(err);
  const code = inferCodeFromMessage(message);
  const op = OPERATION_META[operation] || {};
  return {
    error: true,
    operation,
    code,
    title: op.title || 'Request Failed',
    message: getFriendlyMessage(code, operation, message),
    rawMessage: message,
    isBoundaryError: code.startsWith('FS_')
  };
}

async function withNormalizedError(operation, request) {
  try {
    return await request();
  } catch (err) {
    throw normalizeApiError(operation, err);
  }
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toCloudUploadStatus(value) {
  const raw = text(value).toLowerCase();
  if (!raw) return 'unknown';
  if (raw === 'pending') return 'queued';
  if (raw === 'active' || raw === 'working' || raw === 'uploading') return 'running';
  if (raw === 'done' || raw === 'success' || raw === 'complete') return 'completed';
  if (raw === 'error') return 'failed';
  if (raw === 'cancelled') return 'canceled';
  return raw;
}

function toCloudUploadProgress(item, status) {
  const nestedPercent = Number(item?.progress?.percent);
  if (Number.isFinite(nestedPercent)) return Math.max(0, Math.min(100, nestedPercent));

  const parsed = Number(item?.progress ?? item?.percent ?? item?.progressPct);
  if (Number.isFinite(parsed)) return Math.max(0, Math.min(100, parsed));

  const transferred = Number(item?.transferredBytes ?? item?.bytesTransferred ?? item?.progress?.transferredBytes);
  const total = Number(item?.totalBytes ?? item?.bytesTotal ?? item?.size ?? item?.progress?.totalBytes);
  if (Number.isFinite(transferred) && Number.isFinite(total) && total > 0) {
    return Math.max(0, Math.min(100, Math.round((transferred / total) * 100)));
  }

  if (status === 'completed') return 100;
  return 0;
}

function normalizeCloudUploadJob(item) {
  const status = toCloudUploadStatus(item?.status || item?.state || item?.phase || item?.lastStatus);
  return {
    id: text(item?.id || item?.jobId || item?.uploadId),
    status,
    progress: toCloudUploadProgress(item, status),
    remote: text(item?.remote || item?.remoteName),
    path: text(item?.path || item?.remotePath || item?.destinationPath || item?.targetPath),
    fileName: text(item?.fileName || item?.name || item?.targetName || item?.sourceName),
    cancelable: item?.cancelable !== false && !['completed', 'failed', 'canceled'].includes(status),
    error: text(item?.error?.message || item?.error || item?.errorMessage || item?.lastError),
    createdAt: item?.createdAt || item?.created || null,
    updatedAt: item?.updatedAt || item?.updated || item?.finishedAt || item?.progress?.updatedAt || null,
    raw: item
  };
}

function normalizeCloudUploadJobList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data?.jobs)) return payload.data.jobs;
  if (Array.isArray(payload?.data?.uploads)) return payload.data.uploads;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.jobs)) return payload.jobs;
  if (Array.isArray(payload?.uploads)) return payload.uploads;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

async function tryApiFetch(path, options = {}) {
  try {
    return { ok: true, payload: await apiFetch(path, options), path };
  } catch (err) {
    return { ok: false, error: err, path };
  }
}

export function toUserNotification(err, fallbackTitle = 'Request Failed') {
  const normalized = err?.error ? err : normalizeApiError('unknown', err);
  return {
    title: normalized.title || fallbackTitle,
    message: normalized.message || 'Request failed.',
    type: 'error'
  };
}

export async function fetchConfig() {
  return withNormalizedError('config', () => apiFetch('/api/fs/config'));
}

export async function fetchUserDirs() {
  return withNormalizedError('userDirs', () => apiFetch('/api/fs/user-dirs'));
}

export async function listDir(path) {
  return withNormalizedError('list', () => apiFetch(`/api/fs/list?path=${encodeURIComponent(path)}`));
}

export async function uploadChunk(path, fileChunk, uploadId, chunkIndex, totalChunks, fileName) {
  const formData = new FormData();
  formData.append('path', path);
  formData.append('uploadId', uploadId);
  formData.append('chunkIndex', chunkIndex);
  formData.append('totalChunks', totalChunks);
  formData.append('fileName', fileName);
  formData.append('chunk', fileChunk);

  return withNormalizedError('upload', () => apiFetch('/api/fs/upload-chunk', {
    method: 'POST',
    body: formData
  }));
}

export async function readFile(path) {
  return withNormalizedError('read', () => apiFetch(`/api/fs/read?path=${encodeURIComponent(path)}`));
}

export async function writeFile(path, content) {
  return withNormalizedError('write', () => apiFetch('/api/fs/write', {
    method: 'POST',
    body: JSON.stringify({ path, content })
  }));
}

export async function writeFileWithPolicy(path, content, options = {}) {
  const payload = {
    path,
    content,
    grantId: options.grantId || '',
    appId: options.appId || '',
    operationSource: options.operationSource || '',
    overwrite: options.overwrite === true,
    approval: options.approval && typeof options.approval === 'object'
      ? options.approval
      : undefined
  };
  return withNormalizedError('write', () => apiFetch('/api/fs/write', {
    method: 'POST',
    body: JSON.stringify(payload)
  }));
}

export async function createFileGrant(path, mode = 'read', appId = '', source = 'file-station') {
  return withNormalizedError('read', () => apiFetch('/api/fs/grant', {
    method: 'POST',
    body: JSON.stringify({
      path,
      mode,
      appId,
      source
    })
  }));
}

export async function fetchDesktopApps() {
  return withNormalizedError('config', () => apiFetch('/api/system/apps'));
}

export async function fetchActiveFileGrants(source = 'file-station') {
  const query = source ? `?source=${encodeURIComponent(source)}` : '';
  return withNormalizedError('grants', () => apiFetch(`/api/fs/grants${query}`));
}

export async function revokeFileGrant(grantId, source = 'file-station') {
  const id = text(grantId);
  const query = source ? `?source=${encodeURIComponent(source)}` : '';
  return withNormalizedError('revokeGrant', () => apiFetch(`/api/fs/grants/${encodeURIComponent(id)}${query}`, {
    method: 'DELETE'
  }));
}

export async function revokeFileGrants(source = '') {
  const query = source ? `?source=${encodeURIComponent(source)}` : '';
  return withNormalizedError('revokeGrant', () => apiFetch(`/api/fs/grants${query}`, {
    method: 'DELETE'
  }));
}

export async function createDir(path) {
  return withNormalizedError('createDir', () => apiFetch('/api/fs/create-dir', {
    method: 'POST',
    body: JSON.stringify({ path })
  }));
}

export async function deleteItem(path) {
  return withNormalizedError('delete', () => apiFetch('/api/fs/delete', {
    method: 'DELETE',
    body: JSON.stringify({ path })
  }));
}

export async function renameItem(oldPath, newName) {
  return withNormalizedError('rename', () => apiFetch('/api/fs/rename', {
    method: 'PUT',
    body: JSON.stringify({ oldPath, newName })
  }));
}

export async function searchFiles(query, path = '') {
  return withNormalizedError('search', () => apiFetch(`/api/fs/search?q=${encodeURIComponent(query)}&path=${encodeURIComponent(path)}`));
}

export async function fetchTrash() {
  return withNormalizedError('trash', () => apiFetch('/api/fs/trash'));
}

export async function restoreItem(id) {
  return withNormalizedError('restore', () => apiFetch('/api/fs/restore', {
    method: 'POST',
    body: JSON.stringify({ id })
  }));
}

export async function emptyTrash() {
  return withNormalizedError('emptyTrash', () => apiFetch('/api/fs/empty-trash', {
    method: 'DELETE'
  }));
}

export async function listArchive(path) {
  return withNormalizedError('read', () => apiFetch(`/api/fs/archive-list?path=${encodeURIComponent(path)}`));
}

export async function extractArchive(path, destPath = '') {
  return withNormalizedError('extract', () => apiFetch('/api/fs/extract', {
    method: 'POST',
    body: JSON.stringify({ path, destPath })
  }));
}

export async function fetchCloudRemotes() {
  return withNormalizedError('cloudRemotes', () => apiFetch('/api/cloud/remotes'));
}

export async function listCloudDir(remote, path) {
  return withNormalizedError('cloudList', () => apiFetch(`/api/cloud/list?remote=${encodeURIComponent(remote)}&path=${encodeURIComponent(path)}`));
}

export async function readCloudFile(remote, path) {
  return withNormalizedError('cloudRead', () => apiFetch(`/api/cloud/read?remote=${encodeURIComponent(remote)}&path=${encodeURIComponent(path)}`));
}

export async function createShareLink(path, expiryHours) {
  return withNormalizedError('share', () => apiFetch('/api/share/create', {
    method: 'POST',
    body: JSON.stringify({ path, expiryHours })
  }));
}

export async function addWebDAV(name, url, user, pass) {
  return withNormalizedError('cloudAdd', () => apiFetch('/api/cloud/add-webdav', {
    method: 'POST',
    body: JSON.stringify({ name, url, user, pass })
  }));
}

export async function mountCloudRemote(name) {
  return withNormalizedError('cloudMount', () => apiFetch('/api/cloud/mount', {
    method: 'POST',
    body: JSON.stringify({ name })
  }));
}

export async function fetchCloudMountStatus(name = '') {
  if (name) {
    return withNormalizedError('cloudMount', () => apiFetch(`/api/cloud/mount-status?name=${encodeURIComponent(name)}`));
  }
  return withNormalizedError('cloudMount', () => apiFetch('/api/cloud/mount-status'));
}

export async function uploadCloudFile(remote, path, file) {
  const formData = new FormData();
  formData.append('remote', String(remote || ''));
  formData.append('path', String(path || ''));
  formData.append('fileName', String(file?.name || 'upload.bin'));
  formData.append('async', 'true');
  formData.append('file', file);

  const payload = await withNormalizedError('cloudUpload', () => apiFetch('/api/cloud/upload', {
    method: 'POST',
    body: formData
  }));

  const rawJob = payload?.job || payload?.upload || payload?.data?.job || payload?.data?.upload || (
    payload?.jobId || payload?.uploadId || payload?.id
      ? payload
      : null
  );
  return {
    ...payload,
    cloudUploadJob: rawJob ? normalizeCloudUploadJob(rawJob) : null
  };
}

export async function listCloudUploadJobs() {
  const paths = [
    '/api/cloud/upload-jobs',
    '/api/cloud/uploads',
    '/api/cloud/upload/jobs'
  ];
  let lastError = null;

  for (const path of paths) {
    const result = await tryApiFetch(path, { method: 'GET' });
    if (result.ok) {
      return {
        jobs: normalizeCloudUploadJobList(result.payload).map(normalizeCloudUploadJob).filter((job) => job.id),
        path: result.path,
        payload: result.payload
      };
    }
    lastError = result.error;
  }

  throw normalizeApiError('cloudUploadJobs', lastError);
}

export async function cancelCloudUploadJob(jobId) {
  const id = text(jobId);
  if (!id) {
    throw normalizeApiError('cloudUploadCancel', new Error('Cloud upload job id is required.'));
  }

  const paths = [
    `/api/cloud/upload-jobs/${encodeURIComponent(id)}/cancel`,
    `/api/cloud/uploads/${encodeURIComponent(id)}/cancel`,
    `/api/cloud/upload/jobs/${encodeURIComponent(id)}/cancel`
  ];
  let lastError = null;

  for (const path of paths) {
    const postAttempt = await tryApiFetch(path, { method: 'POST' });
    if (postAttempt.ok) return { payload: postAttempt.payload, path };
    lastError = postAttempt.error;

    const deleteAttempt = await tryApiFetch(path, { method: 'DELETE' });
    if (deleteAttempt.ok) return { payload: deleteAttempt.payload, path };
    lastError = deleteAttempt.error;
  }

  throw normalizeApiError('cloudUploadCancel', lastError);
}
