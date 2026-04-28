const crypto = require('crypto');
const path = require('path');
const fs = require('fs-extra');
const inventoryPaths = require('../utils/inventoryPaths');

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_EVENTS_BASE_URL = 'https://www.googleapis.com/calendar/v3/calendars';
const GOOGLE_CALENDAR_READONLY_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
const STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_REFRESH_SKEW_MS = 60 * 1000;
const DEFAULT_MAX_RESULTS = 2500;

function createGoogleCalendarError(status, code, message, details = null) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.details = details;
  return err;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toTrimmedString(value, maxLength = 2048) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function mask(value) {
  const text = toTrimmedString(value, 4096);
  if (!text) return '';
  if (text.length <= 8) return `${text.slice(0, 2)}****`;
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function defaultSecrets() {
  return {
    oauthClient: {
      clientId: '',
      clientSecret: '',
      redirectUri: ''
    },
    tokensBySourceId: {},
    oauthStates: {}
  };
}

function defaultSyncState() {
  return { google: {} };
}

async function getSecretsFile() {
  const roots = await inventoryPaths.ensureInventoryStructure();
  return path.join(roots.systemDir, 'calendar-google-secrets.json');
}

async function getSyncStateFile() {
  const roots = await inventoryPaths.ensureInventoryStructure();
  return path.join(roots.systemDir, 'calendar-sync-state.json');
}

async function readJsonWithDefault(filePath, fallback) {
  try {
    if (!(await fs.pathExists(filePath))) return clone(fallback);
    const data = await fs.readJson(filePath);
    return data && typeof data === 'object' ? data : clone(fallback);
  } catch (_err) {
    return clone(fallback);
  }
}

function normalizeSecrets(value) {
  const fallback = defaultSecrets();
  const oauthClient = value && typeof value.oauthClient === 'object' ? value.oauthClient : {};
  const tokensBySourceId = value && typeof value.tokensBySourceId === 'object' && !Array.isArray(value.tokensBySourceId)
    ? value.tokensBySourceId
    : {};
  const oauthStates = value && typeof value.oauthStates === 'object' && !Array.isArray(value.oauthStates)
    ? value.oauthStates
    : {};
  const normalizedTokens = {};
  for (const [sourceId, token] of Object.entries(tokensBySourceId)) {
    if (!token || typeof token !== 'object') continue;
    normalizedTokens[toTrimmedString(sourceId, 128)] = {
      accessToken: toTrimmedString(token.accessToken, 4096),
      refreshToken: toTrimmedString(token.refreshToken, 4096),
      expiryDate: Number.isFinite(token.expiryDate) ? token.expiryDate : 0,
      scope: toTrimmedString(token.scope, 1024),
      tokenType: toTrimmedString(token.tokenType || 'Bearer', 64) || 'Bearer'
    };
  }
  const normalizedStates = {};
  const now = Date.now();
  for (const [nonce, state] of Object.entries(oauthStates)) {
    if (!state || typeof state !== 'object') continue;
    const safeNonce = toTrimmedString(nonce, 128);
    const expiresAt = Number(state.expiresAt);
    if (!safeNonce || !Number.isFinite(expiresAt) || expiresAt <= now) continue;
    normalizedStates[safeNonce] = {
      sourceId: toTrimmedString(state.sourceId, 128) || 'google-primary',
      stateHash: toTrimmedString(state.stateHash, 256),
      expiresAt
    };
  }
  return {
    oauthClient: {
      clientId: toTrimmedString(oauthClient.clientId, 512),
      clientSecret: toTrimmedString(oauthClient.clientSecret, 4096),
      redirectUri: toTrimmedString(oauthClient.redirectUri, 2048)
    },
    tokensBySourceId: normalizedTokens || fallback.tokensBySourceId,
    oauthStates: normalizedStates || fallback.oauthStates
  };
}

async function readSecrets() {
  return normalizeSecrets(await readJsonWithDefault(await getSecretsFile(), defaultSecrets()));
}

async function writeSecrets(secrets) {
  const normalized = normalizeSecrets(secrets);
  const filePath = await getSecretsFile();
  await fs.writeJson(filePath, normalized, { spaces: 2 });
  await fs.chmod(filePath, 0o600).catch(() => {});
  return normalized;
}

function normalizeSyncState(value) {
  const google = value && typeof value.google === 'object' && !Array.isArray(value.google) ? value.google : {};
  const normalizedGoogle = {};
  for (const [sourceId, entry] of Object.entries(google)) {
    if (!entry || typeof entry !== 'object') continue;
    normalizedGoogle[toTrimmedString(sourceId, 128)] = {
      syncToken: toTrimmedString(entry.syncToken, 4096) || null,
      lastSyncedAt: toTrimmedString(entry.lastSyncedAt, 64) || null,
      lastError: entry.lastError && typeof entry.lastError === 'object'
        ? {
          code: toTrimmedString(entry.lastError.code, 128),
          message: toTrimmedString(entry.lastError.message, 1000),
          at: toTrimmedString(entry.lastError.at, 64) || new Date().toISOString()
        }
        : null,
      backoffUntil: toTrimmedString(entry.backoffUntil, 64) || null
    };
  }
  return { google: normalizedGoogle };
}

async function readSyncState() {
  return normalizeSyncState(await readJsonWithDefault(await getSyncStateFile(), defaultSyncState()));
}

async function writeSyncState(syncState) {
  const normalized = normalizeSyncState(syncState);
  const filePath = await getSyncStateFile();
  await fs.writeJson(filePath, normalized, { spaces: 2 });
  await fs.chmod(filePath, 0o600).catch(() => {});
  return normalized;
}

function publicConfigFromSecrets(secrets, sourceId = 'google-primary') {
  const oauthClient = secrets.oauthClient || {};
  const token = secrets.tokensBySourceId?.[sourceId] || null;
  return {
    configured: Boolean(oauthClient.clientId && oauthClient.clientSecret && oauthClient.redirectUri),
    clientIdMasked: mask(oauthClient.clientId),
    redirectUri: oauthClient.redirectUri || '',
    hasClientSecret: Boolean(oauthClient.clientSecret),
    connected: Boolean(token && token.refreshToken),
    sourceId
  };
}

async function getPublicConfig(sourceId = 'google-primary') {
  return publicConfigFromSecrets(await readSecrets(), sourceId);
}

async function updateOAuthClient(input = {}) {
  const previous = await readSecrets();
  const clientId = toTrimmedString(input.clientId, 512) || previous.oauthClient.clientId;
  const clientSecret = toTrimmedString(input.clientSecret, 4096) || previous.oauthClient.clientSecret;
  const redirectUri = toTrimmedString(input.redirectUri, 2048) || previous.oauthClient.redirectUri;
  if (!clientId) throw createGoogleCalendarError(400, 'CALENDAR_GOOGLE_CLIENT_ID_REQUIRED', 'Google OAuth clientId is required.');
  if (!clientSecret) throw createGoogleCalendarError(400, 'CALENDAR_GOOGLE_CLIENT_SECRET_REQUIRED', 'Google OAuth clientSecret is required.');
  if (!redirectUri || !/^https?:\/\//i.test(redirectUri)) {
    throw createGoogleCalendarError(400, 'CALENDAR_GOOGLE_REDIRECT_URI_INVALID', 'Google OAuth redirectUri must be an absolute http(s) URL.');
  }
  const next = await writeSecrets({
    ...previous,
    oauthClient: { clientId, clientSecret, redirectUri }
  });
  return publicConfigFromSecrets(next);
}

function signingSecret() {
  return process.env.JWT_SECRET || 'calendar-google-dev-secret';
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signPayload(encodedPayload) {
  return crypto.createHmac('sha256', signingSecret()).update(encodedPayload).digest('base64url');
}

function hashState(state) {
  return crypto.createHash('sha256').update(String(state || '')).digest('hex');
}

function createSignedState(sourceId) {
  const now = Date.now();
  const nonce = crypto.randomUUID();
  const expiresAt = now + STATE_TTL_MS;
  const payload = base64url(JSON.stringify({ sourceId, iat: now, exp: expiresAt, nonce }));
  const state = `${payload}.${signPayload(payload)}`;
  return { state, nonce, expiresAt };
}

function decodeSignedState(state) {
  const raw = toTrimmedString(state, 4096);
  const [payload, signature] = raw.split('.');
  if (!payload || !signature || signature !== signPayload(payload)) {
    throw createGoogleCalendarError(400, 'CALENDAR_GOOGLE_OAUTH_STATE_INVALID', 'Google OAuth state is invalid.');
  }
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch (_err) {
    throw createGoogleCalendarError(400, 'CALENDAR_GOOGLE_OAUTH_STATE_INVALID', 'Google OAuth state is invalid.');
  }
  if (!decoded.exp || decoded.exp < Date.now()) {
    throw createGoogleCalendarError(400, 'CALENDAR_GOOGLE_OAUTH_STATE_EXPIRED', 'Google OAuth state has expired.');
  }
  const sourceId = toTrimmedString(decoded.sourceId, 128) || 'google-primary';
  const nonce = toTrimmedString(decoded.nonce, 128);
  if (!nonce) {
    throw createGoogleCalendarError(400, 'CALENDAR_GOOGLE_OAUTH_STATE_INVALID', 'Google OAuth state is invalid.');
  }
  return { sourceId, nonce, raw };
}

function verifySignedState(state) {
  const decoded = decodeSignedState(state);
  return { sourceId: decoded.sourceId };
}

async function consumeSignedState(state) {
  const decoded = decodeSignedState(state);
  const secrets = await readSecrets();
  const storedState = secrets.oauthStates?.[decoded.nonce];
  if (!storedState || storedState.stateHash !== hashState(decoded.raw) || storedState.sourceId !== decoded.sourceId) {
    throw createGoogleCalendarError(400, 'CALENDAR_GOOGLE_OAUTH_STATE_CONSUMED', 'Google OAuth state was already used or is unknown.');
  }
  const nextStates = { ...secrets.oauthStates };
  delete nextStates[decoded.nonce];
  await writeSecrets({ ...secrets, oauthStates: nextStates });
  return { sourceId: decoded.sourceId };
}

async function buildAuthStart(sourceId = 'google-primary') {
  const secrets = await readSecrets();
  const { clientId, redirectUri } = secrets.oauthClient;
  if (!clientId || !secrets.oauthClient.clientSecret || !redirectUri) {
    throw createGoogleCalendarError(400, 'CALENDAR_GOOGLE_OAUTH_CLIENT_NOT_CONFIGURED', 'Google OAuth client is not configured.');
  }
  const signedState = createSignedState(sourceId);
  const nextStates = {
    ...secrets.oauthStates,
    [signedState.nonce]: {
      sourceId,
      stateHash: hashState(signedState.state),
      expiresAt: signedState.expiresAt
    }
  };
  await writeSecrets({ ...secrets, oauthStates: nextStates });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_CALENDAR_READONLY_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: signedState.state
  });
  return {
    url: `${GOOGLE_AUTH_URL}?${params.toString()}`,
    sourceId,
    scope: GOOGLE_CALENDAR_READONLY_SCOPE
  };
}

async function exchangeCodeForToken(code) {
  const secrets = await readSecrets();
  const { clientId, clientSecret, redirectUri } = secrets.oauthClient;
  if (!clientId || !clientSecret || !redirectUri) {
    throw createGoogleCalendarError(400, 'CALENDAR_GOOGLE_OAUTH_CLIENT_NOT_CONFIGURED', 'Google OAuth client is not configured.');
  }
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw createGoogleCalendarError(response.status, 'CALENDAR_GOOGLE_TOKEN_EXCHANGE_FAILED', 'Google OAuth token exchange failed.', {
      status: response.status,
      error: data.error || null
    });
  }
  return data;
}

function normalizeTokenResponse(data = {}, previous = null) {
  const accessToken = toTrimmedString(data.access_token, 4096) || previous?.accessToken || '';
  const refreshToken = toTrimmedString(data.refresh_token, 4096) || previous?.refreshToken || '';
  const expiresIn = Number(data.expires_in);
  const expiryDate = Number.isFinite(expiresIn) ? Date.now() + expiresIn * 1000 : previous?.expiryDate || 0;
  if (!accessToken) throw createGoogleCalendarError(502, 'CALENDAR_GOOGLE_ACCESS_TOKEN_MISSING', 'Google did not return an access token.');
  if (!refreshToken) throw createGoogleCalendarError(502, 'CALENDAR_GOOGLE_REFRESH_TOKEN_MISSING', 'Google did not return a refresh token.');
  return {
    accessToken,
    refreshToken,
    expiryDate,
    scope: toTrimmedString(data.scope, 1024) || GOOGLE_CALENDAR_READONLY_SCOPE,
    tokenType: toTrimmedString(data.token_type || 'Bearer', 64) || 'Bearer'
  };
}

async function handleOAuthCallback({ code, state }) {
  const authState = await consumeSignedState(state);
  const safeCode = toTrimmedString(code, 4096);
  if (!safeCode) throw createGoogleCalendarError(400, 'CALENDAR_GOOGLE_OAUTH_CODE_REQUIRED', 'Google OAuth code is required.');
  const secrets = await readSecrets();
  const tokenData = await exchangeCodeForToken(safeCode);
  const previousToken = secrets.tokensBySourceId?.[authState.sourceId] || null;
  const token = normalizeTokenResponse(tokenData, previousToken);
  const next = await writeSecrets({
    ...secrets,
    tokensBySourceId: {
      ...secrets.tokensBySourceId,
      [authState.sourceId]: token
    }
  });
  return publicConfigFromSecrets(next, authState.sourceId);
}

async function refreshAccessToken(sourceId, token, secrets) {
  if (token.accessToken && token.expiryDate && token.expiryDate - TOKEN_REFRESH_SKEW_MS > Date.now()) {
    return token;
  }
  if (!token.refreshToken) {
    throw createGoogleCalendarError(401, 'CALENDAR_GOOGLE_REFRESH_TOKEN_MISSING', 'Google refresh token is missing.');
  }
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: secrets.oauthClient.clientId,
      client_secret: secrets.oauthClient.clientSecret,
      refresh_token: token.refreshToken,
      grant_type: 'refresh_token'
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw createGoogleCalendarError(response.status, 'CALENDAR_GOOGLE_TOKEN_REFRESH_FAILED', 'Google OAuth token refresh failed.', {
      status: response.status,
      error: data.error || null
    });
  }
  const nextToken = normalizeTokenResponse(data, token);
  await writeSecrets({
    ...secrets,
    tokensBySourceId: {
      ...secrets.tokensBySourceId,
      [sourceId]: nextToken
    }
  });
  return nextToken;
}

async function getAuthorizedToken(sourceId) {
  const secrets = await readSecrets();
  const token = secrets.tokensBySourceId?.[sourceId];
  if (!token || !token.refreshToken) {
    throw createGoogleCalendarError(401, 'CALENDAR_GOOGLE_NOT_CONNECTED', 'Google Calendar source is not connected.', { sourceId });
  }
  return refreshAccessToken(sourceId, token, secrets);
}

function normalizeGoogleEvent(item, source) {
  const externalId = toTrimmedString(item?.id, 512);
  if (!externalId) return null;
  if (item.status === 'cancelled') {
    return { cancelled: true, externalId };
  }
  const calendarId = source.config?.calendarId || 'primary';
  const title = toTrimmedString(item.summary, 200) || '(No title)';
  const allDay = Boolean(item.start?.date);
  let startAt = '';
  let endAt = null;
  if (allDay) {
    startAt = new Date(`${item.start.date}T00:00:00.000Z`).toISOString();
    if (item.end?.date) {
      const exclusiveEnd = new Date(`${item.end.date}T00:00:00.000Z`).getTime();
      const inclusiveEnd = Number.isFinite(exclusiveEnd) ? exclusiveEnd - 24 * 60 * 60 * 1000 : NaN;
      endAt = Number.isFinite(inclusiveEnd) ? new Date(inclusiveEnd).toISOString() : null;
    }
  } else {
    startAt = item.start?.dateTime ? new Date(item.start.dateTime).toISOString() : '';
    endAt = item.end?.dateTime ? new Date(item.end.dateTime).toISOString() : null;
  }
  if (!startAt) return null;
  return {
    id: `google:${source.id}:${externalId}`,
    title,
    startAt,
    endAt,
    allDay,
    color: source.color || '#4285f4',
    note: toTrimmedString(item.description, 4000) || null,
    source: source.id,
    sourceType: 'google',
    readOnly: true,
    externalId,
    provider: 'google',
    calendarId,
    updatedAt: item.updated || new Date().toISOString()
  };
}

async function listGoogleEvents({ source, syncToken = null, accessToken }) {
  const calendarId = encodeURIComponent(source.config?.calendarId || 'primary');
  let pageToken = '';
  const events = [];
  let nextSyncToken = null;
  do {
    const params = new URLSearchParams({ maxResults: String(DEFAULT_MAX_RESULTS) });
    if (syncToken) params.set('syncToken', syncToken);
    if (pageToken) params.set('pageToken', pageToken);
    const response = await fetch(`${GOOGLE_EVENTS_BASE_URL}/${calendarId}/events?${params.toString()}`, {
      headers: { authorization: `Bearer ${accessToken}` }
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 410) {
      throw createGoogleCalendarError(410, 'CALENDAR_GOOGLE_SYNC_TOKEN_EXPIRED', 'Google Calendar sync token expired.');
    }
    if (response.status === 403 || response.status === 429) {
      throw createGoogleCalendarError(response.status, 'CALENDAR_GOOGLE_RATE_LIMITED', 'Google Calendar sync was rate limited.', { status: response.status });
    }
    if (!response.ok) {
      throw createGoogleCalendarError(response.status, 'CALENDAR_GOOGLE_EVENTS_FAILED', 'Google Calendar events request failed.', {
        status: response.status,
        error: data.error?.message || data.error || null
      });
    }
    if (Array.isArray(data.items)) events.push(...data.items);
    pageToken = data.nextPageToken || '';
    nextSyncToken = data.nextSyncToken || nextSyncToken;
  } while (pageToken);
  return { events, nextSyncToken };
}

function googleBackoffUntil(status) {
  if (status === 403 || status === 429) return new Date(Date.now() + 5 * 60 * 1000).toISOString();
  return null;
}

function assertNoActiveBackoff(entry = {}) {
  const until = Date.parse(entry.backoffUntil || '');
  if (Number.isFinite(until) && until > Date.now()) {
    throw createGoogleCalendarError(429, 'CALENDAR_GOOGLE_BACKOFF_ACTIVE', 'Google Calendar sync is temporarily paused after a rate-limit response.', {
      backoffUntil: new Date(until).toISOString()
    });
  }
}

async function syncSource(source) {
  if (!source || source.type !== 'google') {
    throw createGoogleCalendarError(400, 'CALENDAR_GOOGLE_SOURCE_INVALID', 'Google calendar source is invalid.');
  }
  const sourceId = source.id || 'google-primary';
  const syncState = await readSyncState();
  const previousEntry = syncState.google[sourceId] || {};
  assertNoActiveBackoff(previousEntry);
  const token = await getAuthorizedToken(sourceId);
  let usedFullResync = false;
  let result;
  try {
    result = await listGoogleEvents({ source, syncToken: previousEntry.syncToken, accessToken: token.accessToken });
  } catch (err) {
    if (err.status === 410 || err.code === 'CALENDAR_GOOGLE_SYNC_TOKEN_EXPIRED') {
      usedFullResync = true;
      result = await listGoogleEvents({ source, syncToken: null, accessToken: token.accessToken });
    } else {
      const nextState = clone(syncState);
      nextState.google[sourceId] = {
        ...previousEntry,
        lastError: { code: err.code || 'CALENDAR_GOOGLE_SYNC_FAILED', message: err.message, at: new Date().toISOString() },
        backoffUntil: googleBackoffUntil(err.status)
      };
      await writeSyncState(nextState);
      throw err;
    }
  }
  const normalized = result.events.map((item) => normalizeGoogleEvent(item, source)).filter(Boolean);
  const activeEvents = normalized.filter((item) => !item.cancelled);
  const removedExternalIds = normalized.filter((item) => item.cancelled).map((item) => item.externalId);
  const nextState = clone(syncState);
  nextState.google[sourceId] = {
    syncToken: result.nextSyncToken || null,
    lastSyncedAt: new Date().toISOString(),
    lastError: null,
    backoffUntil: null
  };
  await writeSyncState(nextState);
  return {
    sourceId,
    fullSync: usedFullResync || !previousEntry.syncToken,
    data: activeEvents,
    removedExternalIds,
    nextSyncToken: result.nextSyncToken || null,
    lastSyncedAt: nextState.google[sourceId].lastSyncedAt,
    total: activeEvents.length
  };
}

async function disconnect(sourceId = 'google-primary') {
  const secrets = await readSecrets();
  const syncState = await readSyncState();
  const nextTokens = { ...secrets.tokensBySourceId };
  delete nextTokens[sourceId];
  const nextGoogleState = { ...syncState.google };
  delete nextGoogleState[sourceId];
  await writeSecrets({ ...secrets, tokensBySourceId: nextTokens });
  await writeSyncState({ ...syncState, google: nextGoogleState });
  return publicConfigFromSecrets(await readSecrets(), sourceId);
}

async function getSourceStatus(sourceId = 'google-primary') {
  const [secrets, syncState] = await Promise.all([readSecrets(), readSyncState()]);
  const entry = syncState.google[sourceId] || {};
  return {
    ...publicConfigFromSecrets(secrets, sourceId),
    lastSyncedAt: entry.lastSyncedAt || null,
    lastError: entry.lastError || null,
    backoffUntil: entry.backoffUntil || null
  };
}

module.exports = {
  GOOGLE_CALENDAR_READONLY_SCOPE,
  createGoogleCalendarError,
  readSecrets,
  writeSecrets,
  readSyncState,
  writeSyncState,
  getPublicConfig,
  updateOAuthClient,
  buildAuthStart,
  verifySignedState,
  handleOAuthCallback,
  normalizeGoogleEvent,
  syncSource,
  disconnect,
  getSourceStatus
};
