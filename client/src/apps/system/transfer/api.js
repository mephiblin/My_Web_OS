import { apiFetch } from '../../../utils/api.js';

const LIST_PATHS = [
  '/api/transfer/jobs',
  '/api/system/transfer-jobs',
  '/api/system/transfers',
  '/api/fs/transfer-jobs'
];

const CREATE_URL_PATHS = [
  '/api/transfer/jobs/download',
  '/api/system/transfer-jobs/url-download',
  '/api/system/transfers/url-download',
  '/api/system/transfer-jobs'
];

const CREATE_COPY_PATHS = [
  '/api/transfer/jobs/copy',
  '/api/system/transfer-jobs/local-copy',
  '/api/system/transfers/local-copy',
  '/api/system/transfer-jobs'
];

const CANCEL_PATHS = [
  (jobId) => `/api/transfer/jobs/${encodeURIComponent(jobId)}/cancel`,
  (jobId) => `/api/system/transfer-jobs/${encodeURIComponent(jobId)}/cancel`,
  (jobId) => `/api/system/transfers/${encodeURIComponent(jobId)}/cancel`,
  (jobId) => `/api/fs/transfer-jobs/${encodeURIComponent(jobId)}/cancel`
];

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toStatus(value) {
  const raw = text(value).toLowerCase();
  if (!raw) return 'unknown';
  if (raw === 'done' || raw === 'success' || raw === 'completed') return 'completed';
  if (raw === 'active' || raw === 'working') return 'running';
  if (raw === 'cancelled' || raw === 'canceled') return 'canceled';
  return raw;
}

function toProgress(item, status) {
  const nestedPercent = Number(item?.progress?.percent);
  if (Number.isFinite(nestedPercent)) {
    return Math.max(0, Math.min(100, nestedPercent));
  }

  const parsed = Number(item?.progress ?? item?.percent ?? item?.progressPct);
  if (Number.isFinite(parsed)) {
    return Math.max(0, Math.min(100, parsed));
  }
  if (status === 'completed') return 100;
  return 0;
}

function inferType(item) {
  const type = text(item?.type || item?.kind || item?.jobType).toLowerCase();
  if (type) return type;
  if (text(item?.url)) return 'url-download';
  if (text(item?.sourcePath)) return 'local-copy';
  return 'unknown';
}

function normalizeJob(item) {
  const status = toStatus(item?.status || item?.state || item?.phase || item?.lastStatus);
  return {
    id: text(item?.id || item?.jobId),
    type: inferType(item),
    status,
    progress: toProgress(item, status),
    createdAt: item?.createdAt || item?.created || null,
    updatedAt: item?.updatedAt || item?.progress?.updatedAt || item?.updated || item?.finishedAt || null,
    fileName: text(item?.fileName || item?.name || item?.targetName || item?.destinationPath?.split?.('/').pop?.()),
    url: text(item?.url),
    sourcePath: text(item?.sourcePath || item?.source),
    destinationDir: text(item?.destinationDir || item?.destinationRoot || item?.destinationPath),
    error: text(item?.error?.message || item?.error || item?.errorMessage || item?.lastError),
    raw: item
  };
}

function normalizeJobListResponse(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data?.jobs)) return payload.data.jobs;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.jobs)) return payload.jobs;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function toApiError(err, fallbackCode, fallbackMessage) {
  return {
    code: text(err?.code) || fallbackCode,
    message: text(err?.message) || fallbackMessage
  };
}

async function tryRequest(path, options = {}) {
  try {
    return { ok: true, payload: await apiFetch(path, options), path };
  } catch (err) {
    return { ok: false, error: err, path };
  }
}

async function firstSuccess(paths, options) {
  let lastError = null;
  for (const path of paths) {
    const result = await tryRequest(path, options);
    if (result.ok) return result;
    lastError = result.error || new Error(`Request failed: ${result.path}`);
  }
  throw lastError || new Error('Transfer API request failed.');
}

export async function listTransferJobs() {
  try {
    const result = await firstSuccess(LIST_PATHS, { method: 'GET' });
    const jobs = normalizeJobListResponse(result.payload).map(normalizeJob).filter((item) => item.id);
    return { jobs, path: result.path };
  } catch (err) {
    throw toApiError(
      err,
      'TRANSFER_LIST_FAILED',
      'Failed to load transfer jobs. Transfer backend API may be unavailable.'
    );
  }
}

export async function createUrlDownloadJob(payload) {
  const body = {
    type: 'url-download',
    kind: 'url-download',
    jobType: 'url-download',
    url: text(payload?.url),
    destinationDir: text(payload?.destinationDir),
    destinationRoot: text(payload?.destinationDir),
    fileName: text(payload?.fileName) || undefined
  };

  try {
    const result = await firstSuccess(CREATE_URL_PATHS, {
      method: 'POST',
      body: JSON.stringify(body)
    });
    return { payload: result.payload, path: result.path };
  } catch (err) {
    throw toApiError(
      err,
      'TRANSFER_CREATE_URL_FAILED',
      'Failed to create URL download job. Check transfer backend API support.'
    );
  }
}

export async function createLocalCopyJob(payload) {
  const body = {
    type: 'local-copy',
    kind: 'local-copy',
    jobType: 'local-copy',
    sourcePath: text(payload?.sourcePath),
    destinationDir: text(payload?.destinationDir),
    destinationRoot: text(payload?.destinationDir),
    fileName: text(payload?.fileName) || undefined
  };

  try {
    const result = await firstSuccess(CREATE_COPY_PATHS, {
      method: 'POST',
      body: JSON.stringify(body)
    });
    return { payload: result.payload, path: result.path };
  } catch (err) {
    throw toApiError(
      err,
      'TRANSFER_CREATE_COPY_FAILED',
      'Failed to create local copy job. Check source path, destination, and backend API support.'
    );
  }
}

export async function cancelTransferJob(jobId) {
  const id = text(jobId);
  if (!id) {
    throw {
      code: 'TRANSFER_CANCEL_INVALID_ID',
      message: 'Transfer job id is required.'
    };
  }

  let lastError = null;
  for (const makePath of CANCEL_PATHS) {
    const path = makePath(id);
    const postAttempt = await tryRequest(path, { method: 'POST' });
    if (postAttempt.ok) return { payload: postAttempt.payload, path };
    lastError = postAttempt.error;

    const deleteAttempt = await tryRequest(path, { method: 'DELETE' });
    if (deleteAttempt.ok) return { payload: deleteAttempt.payload, path };
    lastError = deleteAttempt.error;
  }

  throw toApiError(
    lastError,
    'TRANSFER_CANCEL_FAILED',
    'Failed to cancel transfer job. The backend may not support cancellation for this job.'
  );
}

export function isRunningStatus(status) {
  const value = toStatus(status);
  return value === 'running' || value === 'queued' || value === 'pending';
}

