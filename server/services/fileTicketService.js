const crypto = require('crypto');

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_TTL_MS = 10 * 60 * 1000;
const MEDIA_IDLE_TIMEOUT_MS = 45 * 60 * 1000;
const MEDIA_ABSOLUTE_TTL_MS = 8 * 60 * 60 * 1000;
const TICKET_PREFIX = 'wos_tkt_';
const PROFILE_PREVIEW = 'preview';
const PROFILE_MEDIA = 'media';

const tickets = new Map();

function now() {
  return Date.now();
}

function createTicketError(status, code, message, details = null) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.details = details;
  return err;
}

function normalizeProfile(profile) {
  const value = String(profile || '').trim().toLowerCase();
  if (!value || value === PROFILE_PREVIEW) return PROFILE_PREVIEW;
  if (value === PROFILE_MEDIA) return PROFILE_MEDIA;
  throw createTicketError(400, 'FILE_TICKET_PROFILE_INVALID', 'Ticket profile must be preview or media.');
}

function normalizePositiveMs(value, fallback, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(Math.floor(numeric), max);
}

function normalizeMtimeMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.trunc(numeric);
}

function normalizeStats(input = {}) {
  const stats = input.stats || input;
  const size = Number(stats.size);
  const mtimeMs = normalizeMtimeMs(stats.mtimeMs ?? stats.mtime?.getTime?.() ?? stats.mtime);
  if (!Number.isFinite(size) || size < 0 || mtimeMs === null) {
    throw createTicketError(
      400,
      'FILE_TICKET_TARGET_STATS_REQUIRED',
      'Media leases require target file size and mtime.'
    );
  }
  return {
    size,
    mtime: mtimeMs
  };
}

function isMediaRecord(record) {
  return record?.profile === PROFILE_MEDIA;
}

function isRecordExpired(record, currentTime = now()) {
  if (!record) return true;
  if (isMediaRecord(record)) {
    return record.absoluteExpiresAt <= currentTime
      || record.lastAccess + record.idleTimeoutMs <= currentTime;
  }
  return record.expiresAt <= currentTime;
}

function purgeExpired(currentTime = now(), options = {}) {
  const preserveMediaErrors = options.preserveMediaErrors === true;
  for (const [ticket, record] of tickets.entries()) {
    if (!record) {
      tickets.delete(ticket);
      continue;
    }
    if (isMediaRecord(record) && preserveMediaErrors) {
      continue;
    }
    if (isRecordExpired(record, currentTime)) {
      tickets.delete(ticket);
    }
  }
}

function normalizeTtl(ttlMs) {
  const value = Number(ttlMs);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_TTL_MS;
  return Math.min(Math.floor(value), MAX_TTL_MS);
}

function createTicket(input = {}) {
  purgeExpired();

  const scope = String(input.scope || '').trim();
  const user = String(input.user || '').trim();
  const profile = normalizeProfile(input.profile);
  if (!scope) {
    throw createTicketError(400, 'FILE_TICKET_SCOPE_REQUIRED', 'Ticket scope is required.');
  }
  if (!user) {
    throw createTicketError(400, 'FILE_TICKET_USER_REQUIRED', 'Ticket user is required.');
  }

  const ttlMs = profile === PROFILE_MEDIA
    ? normalizePositiveMs(input.absoluteTtlMs ?? input.ttlMs, MEDIA_ABSOLUTE_TTL_MS, MEDIA_ABSOLUTE_TTL_MS)
    : normalizeTtl(input.ttlMs);
  const issuedAt = now();
  const ticket = `${TICKET_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
  const record = {
    ticket,
    scope,
    profile,
    user,
    appId: input.appId ? String(input.appId) : '',
    path: input.path ? String(input.path) : '',
    createdAt: issuedAt,
    expiresAt: issuedAt + ttlMs,
    metadata: input.metadata && typeof input.metadata === 'object' ? { ...input.metadata } : {}
  };

  if (profile === PROFILE_MEDIA) {
    if (!record.path) {
      throw createTicketError(400, 'FILE_TICKET_PATH_REQUIRED', 'Media leases require a target file path.');
    }
    const target = normalizeStats(input);
    record.idleTimeoutMs = normalizePositiveMs(input.idleTimeoutMs, MEDIA_IDLE_TIMEOUT_MS, MEDIA_IDLE_TIMEOUT_MS);
    record.lastAccess = issuedAt;
    record.absoluteExpiresAt = issuedAt + ttlMs;
    record.size = target.size;
    record.mtime = target.mtime;
  }

  tickets.set(ticket, record);
  return { ...record };
}

function getTicket(ticket, options = {}) {
  const currentTime = now();
  purgeExpired(currentTime, { preserveMediaErrors: true });

  const value = String(ticket || '').trim();
  const record = tickets.get(value);
  if (!record) {
    throw createTicketError(403, 'FILE_TICKET_INVALID', 'Ticket is invalid or expired.');
  }

  const expectedProfile = normalizeProfile(options.profile || record.profile || PROFILE_PREVIEW);
  if (expectedProfile && record.profile !== expectedProfile) {
    throw createTicketError(403, 'FILE_TICKET_PROFILE_MISMATCH', 'Ticket profile is invalid for this operation.');
  }

  if (isMediaRecord(record)) {
    if (record.absoluteExpiresAt <= currentTime) {
      tickets.delete(value);
      throw createTicketError(403, 'FS_MEDIA_LEASE_EXPIRED', 'Media lease has expired.', {
        profile: PROFILE_MEDIA,
        reason: 'absolute_expired'
      });
    }
    if (record.lastAccess + record.idleTimeoutMs <= currentTime) {
      tickets.delete(value);
      throw createTicketError(403, 'FS_MEDIA_LEASE_IDLE_TIMEOUT', 'Media lease expired after being idle.', {
        profile: PROFILE_MEDIA,
        reason: 'idle_timeout'
      });
    }
  }

  const expectedScope = String(options.scope || '').trim();
  if (expectedScope && record.scope !== expectedScope) {
    throw createTicketError(
      403,
      isMediaRecord(record) ? 'FS_MEDIA_LEASE_INVALID' : 'FILE_TICKET_SCOPE_MISMATCH',
      isMediaRecord(record)
        ? 'Media lease is invalid for this operation.'
        : 'Ticket scope is invalid for this operation.',
      isMediaRecord(record) ? { profile: PROFILE_MEDIA, reason: 'scope_mismatch' } : null
    );
  }

  const expectedAppId = String(options.appId || '').trim();
  if (expectedAppId && record.appId !== expectedAppId) {
    throw createTicketError(
      403,
      isMediaRecord(record) ? 'FS_MEDIA_LEASE_INVALID' : 'FILE_TICKET_TARGET_MISMATCH',
      isMediaRecord(record)
        ? 'Media lease is invalid for this operation.'
        : 'Ticket target app is invalid for this operation.',
      isMediaRecord(record) ? { profile: PROFILE_MEDIA, reason: 'app_mismatch' } : null
    );
  }

  return { ...record, metadata: { ...record.metadata } };
}

function assertTicketTargetUnchanged(record, stats) {
  if (!isMediaRecord(record)) return;
  const current = normalizeStats(stats);
  if (record.size !== current.size || record.mtime !== current.mtime) {
    revokeTicket(record.ticket);
    throw createTicketError(409, 'FS_MEDIA_LEASE_TARGET_CHANGED', 'Media lease target changed after the lease was issued.', {
      profile: PROFILE_MEDIA,
      expected: {
        size: record.size,
        mtime: record.mtime
      },
      actual: current
    });
  }
}

function touchTicket(ticket, options = {}) {
  const value = String(ticket || '').trim();
  const record = tickets.get(value);
  if (!isMediaRecord(record)) return null;

  const currentTime = now();
  if (isRecordExpired(record, currentTime)) return null;

  record.lastAccess = currentTime;
  if (options.metadata && typeof options.metadata === 'object') {
    record.metadata = { ...record.metadata, ...options.metadata };
  }
  return { ...record, metadata: { ...record.metadata } };
}

function revokeTicket(ticket) {
  return tickets.delete(String(ticket || '').trim());
}

function _resetForTests() {
  tickets.clear();
}

module.exports = {
  DEFAULT_TTL_MS,
  MAX_TTL_MS,
  MEDIA_IDLE_TIMEOUT_MS,
  MEDIA_ABSOLUTE_TTL_MS,
  PROFILE_PREVIEW,
  PROFILE_MEDIA,
  assertTicketTargetUnchanged,
  createTicket,
  getTicket,
  purgeExpired,
  revokeTicket,
  touchTicket,
  _resetForTests
};
