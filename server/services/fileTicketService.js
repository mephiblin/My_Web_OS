const crypto = require('crypto');

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_TTL_MS = 10 * 60 * 1000;
const TICKET_PREFIX = 'wos_tkt_';

const tickets = new Map();

function now() {
  return Date.now();
}

function purgeExpired(currentTime = now()) {
  for (const [ticket, record] of tickets.entries()) {
    if (!record || record.expiresAt <= currentTime) {
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
  if (!scope) {
    const err = new Error('Ticket scope is required.');
    err.code = 'FILE_TICKET_SCOPE_REQUIRED';
    throw err;
  }
  if (!user) {
    const err = new Error('Ticket user is required.');
    err.code = 'FILE_TICKET_USER_REQUIRED';
    throw err;
  }

  const ttlMs = normalizeTtl(input.ttlMs);
  const issuedAt = now();
  const ticket = `${TICKET_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
  const record = {
    ticket,
    scope,
    user,
    appId: input.appId ? String(input.appId) : '',
    path: input.path ? String(input.path) : '',
    createdAt: issuedAt,
    expiresAt: issuedAt + ttlMs,
    metadata: input.metadata && typeof input.metadata === 'object' ? { ...input.metadata } : {}
  };

  tickets.set(ticket, record);
  return { ...record };
}

function getTicket(ticket, options = {}) {
  purgeExpired();

  const value = String(ticket || '').trim();
  const record = tickets.get(value);
  if (!record) {
    const err = new Error('Ticket is invalid or expired.');
    err.status = 403;
    err.code = 'FILE_TICKET_INVALID';
    throw err;
  }

  const expectedScope = String(options.scope || '').trim();
  if (expectedScope && record.scope !== expectedScope) {
    const err = new Error('Ticket scope is invalid for this operation.');
    err.status = 403;
    err.code = 'FILE_TICKET_SCOPE_MISMATCH';
    throw err;
  }

  const expectedAppId = String(options.appId || '').trim();
  if (expectedAppId && record.appId !== expectedAppId) {
    const err = new Error('Ticket target app is invalid for this operation.');
    err.status = 403;
    err.code = 'FILE_TICKET_TARGET_MISMATCH';
    throw err;
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
  createTicket,
  getTicket,
  purgeExpired,
  revokeTicket,
  _resetForTests
};
