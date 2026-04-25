import { apiFetch } from '../../../utils/api.js';
import { normalizeTransferJobStatus } from './normalization.js';

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
  const status = normalizeTransferJobStatus(item?.status || item?.state || item?.phase || item?.lastStatus);
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
    errorCode: text(item?.error?.code || item?.errorCode || item?.lastErrorCode),
    error: text(item?.error?.message || item?.error || item?.errorMessage || item?.lastError),
    errorDetails: item?.error?.details || null,
    raw: item
  };
}

function normalizeSummary(payload) {
  const summary = payload?.summary && typeof payload.summary === 'object' ? payload.summary : {};
  const read = (key) => {
    const value = Number(summary?.[key]);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  };
  return {
    total: read('total'),
    queued: read('queued'),
    running: read('running'),
    completed: read('completed'),
    failed: read('failed'),
    canceled: read('canceled')
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
    return { jobs, summary: normalizeSummary(result.payload), path: result.path };
  } catch (err) {
    throw toApiError(
      err,
      'TRANSFER_LIST_FAILED',
      '전송 작업 목록을 불러오지 못했습니다. 전송 백엔드 API를 확인하세요.'
    );
  }
}

export async function retryTransferJob(jobId) {
  const id = text(jobId);
  if (!id) {
    throw {
      code: 'TRANSFER_RETRY_INVALID_ID',
      message: '전송 작업 ID가 필요합니다.'
    };
  }

  try {
    const payload = await apiFetch(`/api/transfer/jobs/${encodeURIComponent(id)}/retry`, {
      method: 'POST'
    });
    return {
      job: payload?.job ? normalizeJob(payload.job) : null,
      payload
    };
  } catch (err) {
    throw toApiError(
      err,
      'TRANSFER_RETRY_FAILED',
      '전송 작업 재시도에 실패했습니다.'
    );
  }
}

export async function clearTransferJobs(statuses = ['completed', 'failed', 'canceled']) {
  const list = Array.isArray(statuses)
    ? statuses.map((item) => text(item).toLowerCase()).filter(Boolean)
    : [];
  const query = list.length > 0
    ? `?statuses=${encodeURIComponent(list.join(','))}`
    : '';

  try {
    return await apiFetch(`/api/transfer/jobs${query}`, {
      method: 'DELETE'
    });
  } catch (err) {
    throw toApiError(
      err,
      'TRANSFER_CLEAR_FAILED',
      '전송 작업 기록 정리에 실패했습니다.'
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
      'URL 다운로드 작업 생성에 실패했습니다. 전송 백엔드 API 지원 여부를 확인하세요.'
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
      '로컬 복사 작업 생성에 실패했습니다. 원본 경로/대상 경로와 백엔드 API를 확인하세요.'
    );
  }
}

export async function cancelTransferJob(jobId) {
  const id = text(jobId);
  if (!id) {
    throw {
      code: 'TRANSFER_CANCEL_INVALID_ID',
      message: '전송 작업 ID가 필요합니다.'
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
    '전송 작업 취소에 실패했습니다. 이 작업은 백엔드에서 취소를 지원하지 않을 수 있습니다.'
  );
}

export function isRunningStatus(status) {
  const value = normalizeTransferJobStatus(status);
  return value === 'running' || value === 'queued' || value === 'pending';
}

export { normalizeTransferJobStatus } from './normalization.js';
