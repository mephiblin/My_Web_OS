import { API_BASE } from './constants.js';

function getToken() {
  return localStorage.getItem('web_os_token');
}

function getHeader(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') {
    return headers.get(name) || headers.get(name.toLowerCase()) || headers.get(name.toUpperCase()) || undefined;
  }
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || undefined;
}

async function parseResponsePayload(res) {
  const status = Number(res?.status || 0);
  if (status === 204 || status === 205) {
    return {};
  }

  const text = await res.text().catch(() => '');
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function pickErrorCode(payload, status) {
  if (typeof payload?.code === 'string' && payload.code) return payload.code;
  if (typeof payload?.error?.code === 'string' && payload.error.code) return payload.error.code;
  if (typeof payload?.error === 'string' && payload.error) return payload.error;
  if (typeof payload?.type === 'string' && payload.type) return payload.type;
  return status ? `HTTP_${status}` : 'API_ERROR';
}

function pickMessage(payload, status) {
  if (typeof payload?.message === 'string' && payload.message) return payload.message;
  if (typeof payload?.detail === 'string' && payload.detail) return payload.detail;
  if (typeof payload?.title === 'string' && payload.title) return payload.title;
  if (typeof payload?.error?.message === 'string' && payload.error.message) return payload.error.message;
  if (typeof payload?.error === 'string' && payload.error) return payload.error;
  return status ? `HTTP Error: ${status}` : 'API request failed';
}

export class ApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
    this.validation = options.validation;
    this.retryAfter = options.retryAfter;
    this.requestId = options.requestId;
    this.payload = options.payload || {};
  }
}

export function isApiError(err) {
  return err instanceof ApiError || Boolean(err && err.name === 'ApiError' && typeof err.message === 'string');
}

export function getErrorCode(err, fallback = 'UNKNOWN_ERROR') {
  if (isApiError(err) && err.code) return err.code;
  if (typeof err?.code === 'string' && err.code) return err.code;
  return fallback;
}

export function getUserFacingMessage(err, fallback = 'Request failed.') {
  if (isApiError(err) && err.message) return err.message;
  if (typeof err?.message === 'string' && err.message) return err.message;
  return fallback;
}

/**
 * Authenticated fetch wrapper. Automatically injects JWT token.
 */
export async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = {
    ...options.headers,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (options.body && typeof options.body === 'string') {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const payload = await parseResponsePayload(res);
  if (!res.ok) {
    throw new ApiError(pickMessage(payload, res.status), {
      status: res.status,
      code: pickErrorCode(payload, res.status),
      details: payload.details ?? payload.detail,
      validation: payload.validation,
      retryAfter: payload.retryAfter ?? getHeader(res.headers, 'retry-after'),
      requestId: payload.requestId ?? getHeader(res.headers, 'x-request-id'),
      payload
    });
  }
  return payload;
}

export async function apiFetchBlob(path, options = {}) {
  const token = getToken();
  const headers = {
    ...options.headers,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const payload = await parseResponsePayload(res);
    throw new ApiError(pickMessage(payload, res.status), {
      status: res.status,
      code: pickErrorCode(payload, res.status),
      details: payload.details ?? payload.detail,
      validation: payload.validation,
      retryAfter: payload.retryAfter ?? getHeader(res.headers, 'retry-after'),
      requestId: payload.requestId ?? getHeader(res.headers, 'x-request-id'),
      payload
    });
  }

  return {
    blob: await res.blob(),
    headers: res.headers,
    status: res.status
  };
}

export async function apiFetchTicketUrl(path, body = {}, options = {}) {
  const payload = await apiFetch(path, {
    method: options.method || 'POST',
    signal: options.signal,
    body: JSON.stringify(body || {})
  });
  const url = String(payload?.url || payload?.ticketUrl || payload?.href || '').trim();
  if (!url) {
    throw new ApiError('Ticket URL response did not include a url.', {
      status: 500,
      code: 'TICKET_URL_MISSING',
      payload
    });
  }
  return url;
}

export function fetchRawFileTicketUrl(filePath, options = {}) {
  return apiFetchTicketUrl('/api/fs/raw-ticket', {
    path: String(filePath || ''),
    disposition: options.disposition || 'inline'
  }, {
    signal: options.signal
  });
}
