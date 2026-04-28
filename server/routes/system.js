const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs-extra');
const si = require('systeminformation');

const auth = require('../middleware/auth');
const auditService = require('../services/auditService');
const packageRegistryService = require('../services/packageRegistryService');
const languagePackService = require('../services/languagePackService');
const { APP_API_POLICY, checkCompatibility } = require('../services/appApiPolicy');
const storageService = require('../services/storageService');
const stateStore = require('../services/stateStore');
const calendarHolidayService = require('../services/calendarHolidayService');
const calendarGoogleService = require('../services/calendarGoogleService');
const serverConfig = require('../config/serverConfig');
const {
  resolveSafePath,
  isWithinAllowedRoots,
  isProtectedSystemPath,
  assertWithinAllowedRealRoots
} = require('../utils/pathPolicy');
const inventoryPaths = require('../utils/inventoryPaths');
const mediaLibraryPaths = require('../utils/mediaLibraryPaths');

const router = express.Router();

const OVERVIEW_CACHE_TTL_MS = 1500;
const OVERVIEW_STALE_TTL_MS = 10000;
const NETWORK_IPS_CACHE_TTL_MS = 60000;
const NETWORK_IPS_STALE_TTL_MS = 300000;
let overviewCache = null;
let overviewInflight = null;
let networkIpsCache = null;
let networkIpsInflight = null;

async function collectSystemOverview() {
  const [cpu, mem, fsSize, osInfo, gfx, net, cpuTemp] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.fsSize(),
    si.osInfo(),
    si.graphics(),
    si.networkStats(),
    si.cpuTemperature()
  ]);

  return {
    cpu: cpu.currentLoad.toFixed(2),
    cpuTemp: {
      main: cpuTemp.main,
      max: cpuTemp.max
    },
    memory: {
      total: mem.total,
      used: mem.used,
      percentage: ((mem.used / mem.total) * 100).toFixed(2)
    },
    storage: fsSize.map((drive) => ({
      fs: drive.fs,
      size: drive.size,
      used: drive.used,
      use: drive.use
    })),
    os: {
      distro: osInfo.distro,
      release: osInfo.release,
      platform: osInfo.platform
    },
    gpu: gfx.controllers.map((g) => ({
      model: g.model,
      vram: g.vram,
      bus: g.bus,
      temperatureGpu: g.temperatureGpu
    })),
    network: net.map((n) => ({
      iface: n.iface,
      rx_sec: n.rx_sec,
      tx_sec: n.tx_sec
    }))
  };
}

function startOverviewRefresh() {
  if (!overviewInflight) {
    overviewInflight = collectSystemOverview()
      .then((data) => {
        overviewCache = {
          data,
          fetchedAt: Date.now()
        };
        return data;
      })
      .finally(() => {
        overviewInflight = null;
      });
  }
  return overviewInflight;
}

async function getSystemOverviewSnapshot() {
  const now = Date.now();
  const age = overviewCache ? now - overviewCache.fetchedAt : Infinity;

  if (overviewCache && age <= OVERVIEW_CACHE_TTL_MS) {
    return { data: overviewCache.data, cacheState: 'hit' };
  }

  if (overviewCache && age <= OVERVIEW_STALE_TTL_MS) {
    startOverviewRefresh().catch((err) => {
      console.warn('[SYSTEM] Failed to refresh system overview cache:', err.message);
    });
    return { data: overviewCache.data, cacheState: 'stale' };
  }

  const data = await startOverviewRefresh();
  return { data, cacheState: 'miss' };
}

async function collectNetworkIps() {
  const netInterfaces = await si.networkInterfaces();
  const local = netInterfaces.find((i) => !i.internal && i.ip4 && i.operstate === 'up') || netInterfaces[0];

  let external = 'Unknown';
  try {
    const response = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(1200) });
    const data = await response.json();
    external = data.ip;
  } catch (_e) {
    external = 'Unavailable';
  }

  return {
    local: local ? local.ip4 : 'Unknown',
    external
  };
}

function startNetworkIpsRefresh() {
  if (!networkIpsInflight) {
    networkIpsInflight = collectNetworkIps()
      .then((data) => {
        networkIpsCache = {
          data,
          fetchedAt: Date.now()
        };
        return data;
      })
      .finally(() => {
        networkIpsInflight = null;
      });
  }
  return networkIpsInflight;
}

async function getNetworkIpsSnapshot() {
  const now = Date.now();
  const age = networkIpsCache ? now - networkIpsCache.fetchedAt : Infinity;

  if (networkIpsCache && age <= NETWORK_IPS_CACHE_TTL_MS) {
    return { data: networkIpsCache.data, cacheState: 'hit' };
  }

  if (networkIpsCache && age <= NETWORK_IPS_STALE_TTL_MS) {
    startNetworkIpsRefresh().catch((err) => {
      console.warn('[SYSTEM] Failed to refresh network IP cache:', err.message);
    });
    return { data: networkIpsCache.data, cacheState: 'stale' };
  }

  const data = await startNetworkIpsRefresh();
  return { data, cacheState: 'miss' };
}

function handleStateKeyError(res, err) {
  if (err.code === 'STATE_KEY_UNSUPPORTED') {
    return res.status(400).json({
      error: true,
      code: err.code,
      message: err.message
    });
  }
  return res.status(500).json({ error: true, message: err.message });
}

function createCalendarError(status, code, message, details = null) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.details = details;
  return err;
}

function sendCalendarError(res, err) {
  return res.status(err.status || 500).json({
    error: true,
    code: err.code || 'CALENDAR_INTERNAL_ERROR',
    message: err.message || 'Calendar operation failed.',
    details: err.details || null
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sendGoogleCalendarCallbackPage(res, result) {
  const success = result?.success === true;
  const title = escapeHtml(success ? 'Google Calendar connected' : 'Google Calendar connection failed');
  const message = escapeHtml(success
    ? 'You can close this window and return to My Web OS.'
    : result?.message || 'Google Calendar OAuth failed.');
  return res
    .status(success ? 200 : (result?.status || 400))
    .type('html')
    .send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      body { font-family: system-ui, sans-serif; min-height: 100vh; display: grid; place-items: center; margin: 0; background: #0f172a; color: #e2e8f0; }
      main { max-width: 520px; padding: 28px; border: 1px solid rgba(148, 163, 184, 0.25); border-radius: 20px; background: rgba(15, 23, 42, 0.86); }
      h1 { margin: 0 0 10px; font-size: 22px; }
      p { margin: 0; color: #94a3b8; line-height: 1.6; }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${message}</p>
    </main>
  </body>
</html>`);
}

router.get('/calendar/google/auth/callback', async (req, res) => {
  try {
    const result = await calendarGoogleService.handleOAuthCallback({
      code: req.query?.code,
      state: req.query?.state
    });
    return sendGoogleCalendarCallbackPage(res, { success: true, data: result });
  } catch (err) {
    return sendGoogleCalendarCallbackPage(res, {
      success: false,
      status: err.status || 400,
      message: err.message || 'Google Calendar OAuth failed.'
    });
  }
});

router.use(auth);

function isIsoDateTime(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp);
}

function toTimestampOrNull(value) {
  if (!isIsoDateTime(value)) return null;
  return Date.parse(value);
}

function toTrimmedOptionalString(value, maxLength = 4000) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.slice(0, maxLength);
}

function normalizeCalendarCreateInput(body = {}) {
  const title = toTrimmedOptionalString(body.title, 200);
  const startAt = toTrimmedOptionalString(body.startAt, 64);
  const endAt = toTrimmedOptionalString(body.endAt, 64);
  const color = toTrimmedOptionalString(body.color, 20) || '#58a6ff';
  const note = toTrimmedOptionalString(body.note, 4000);

  if (!title) {
    throw createCalendarError(400, 'CALENDAR_EVENT_TITLE_REQUIRED', 'title is required.');
  }
  if (!isIsoDateTime(startAt)) {
    throw createCalendarError(400, 'CALENDAR_EVENT_START_INVALID', 'startAt must be a valid ISO datetime string.');
  }
  if (endAt && !isIsoDateTime(endAt)) {
    throw createCalendarError(400, 'CALENDAR_EVENT_END_INVALID', 'endAt must be a valid ISO datetime string.');
  }

  const startTs = toTimestampOrNull(startAt);
  const endTs = toTimestampOrNull(endAt);
  if (startTs && endTs && endTs < startTs) {
    throw createCalendarError(400, 'CALENDAR_EVENT_RANGE_INVALID', 'endAt must be greater than or equal to startAt.');
  }

  return {
    title,
    startAt: new Date(startTs).toISOString(),
    endAt: endTs ? new Date(endTs).toISOString() : null,
    allDay: body.allDay === true,
    color,
    note: note || null
  };
}

function normalizeCalendarUpdateInput(body = {}) {
  const hasField = (key) => Object.prototype.hasOwnProperty.call(body, key);
  if (!hasField('title') && !hasField('startAt') && !hasField('endAt') && !hasField('allDay') && !hasField('color') && !hasField('note')) {
    throw createCalendarError(400, 'CALENDAR_EVENT_PATCH_EMPTY', 'At least one updatable field is required.');
  }

  const patch = {};

  if (hasField('title')) {
    const title = toTrimmedOptionalString(body.title, 200);
    if (!title) {
      throw createCalendarError(400, 'CALENDAR_EVENT_TITLE_REQUIRED', 'title cannot be empty.');
    }
    patch.title = title;
  }

  if (hasField('startAt')) {
    const startAt = toTrimmedOptionalString(body.startAt, 64);
    if (!isIsoDateTime(startAt)) {
      throw createCalendarError(400, 'CALENDAR_EVENT_START_INVALID', 'startAt must be a valid ISO datetime string.');
    }
    patch.startAt = new Date(Date.parse(startAt)).toISOString();
  }

  if (hasField('endAt')) {
    const endAt = body.endAt == null ? '' : toTrimmedOptionalString(body.endAt, 64);
    if (!endAt) {
      patch.endAt = null;
    } else if (!isIsoDateTime(endAt)) {
      throw createCalendarError(400, 'CALENDAR_EVENT_END_INVALID', 'endAt must be a valid ISO datetime string.');
    } else {
      patch.endAt = new Date(Date.parse(endAt)).toISOString();
    }
  }

  if (hasField('allDay')) {
    patch.allDay = body.allDay === true;
  }

  if (hasField('color')) {
    patch.color = toTrimmedOptionalString(body.color, 20) || '#58a6ff';
  }

  if (hasField('note')) {
    const note = toTrimmedOptionalString(body.note, 4000);
    patch.note = note || null;
  }

  return patch;
}

function rangesOverlap(startA, endA, startB, endB) {
  return startA <= endB && startB <= endA;
}

function eventOverlapsRange(item, fromTs, toTs) {
  const startTs = toTimestampOrNull(item?.startAt);
  if (!startTs) return false;

  const endTsRaw = toTimestampOrNull(item?.endAt);
  const endTs = endTsRaw == null ? startTs : endTsRaw;

  return rangesOverlap(startTs, endTs, fromTs, toTs);
}

function normalizeCalendarEventForResponse(item, fallbackSource = 'local') {
  const source = toTrimmedOptionalString(item?.source, 128) || fallbackSource;
  const sourceType = toTrimmedOptionalString(item?.sourceType, 32) || (source === 'local' ? 'local' : fallbackSource);
  return {
    ...item,
    source,
    sourceType,
    readOnly: item?.readOnly === true || sourceType !== 'local',
    externalId: item?.externalId || null,
    provider: item?.provider || null,
    calendarId: item?.calendarId || source
  };
}

function parseCalendarSourceFilter(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const selected = value.split(',').map((item) => item.trim()).filter(Boolean);
  return selected.length ? new Set(selected) : null;
}

function sourceIsSelected(source, selectedSources) {
  if (!source || source.enabled === false) return false;
  if (!selectedSources) return true;
  return selectedSources.has(source.id) || selectedSources.has(source.type);
}

function getCalendarSources(state) {
  return Array.isArray(state?.sources) ? state.sources : [];
}

function getRequestedHolidayYears(fromTs, toTs) {
  const now = new Date();
  if (!Number.isFinite(fromTs) || !Number.isFinite(toTs)) {
    return [now.getUTCFullYear()];
  }
  const fromYear = new Date(fromTs).getUTCFullYear();
  const toYear = new Date(toTs).getUTCFullYear();
  const years = [];
  for (let year = fromYear; year <= toYear && years.length < 10; year += 1) {
    years.push(year);
  }
  return years;
}

async function collectProviderCalendarEvents({ state, fromTs, toTs, selectedSources }) {
  const sources = getCalendarSources(state);
  const providerEvents = [];
  const providerStatuses = [];

  for (const source of sources) {
    if (!sourceIsSelected(source, selectedSources)) continue;
    if (source.type === 'holiday') {
      const years = getRequestedHolidayYears(fromTs, toTs);
      for (const year of years) {
        try {
          const result = await calendarHolidayService.getHolidayEvents({
            year,
            countryCode: source.config?.countryCode || 'KR',
            provider: source.config?.provider || 'nager',
            sourceId: source.id,
            color: source.color
          });
          providerEvents.push(...result.data);
          providerStatuses.push({
            sourceId: source.id,
            type: source.type,
            provider: result.provider,
            countryCode: result.countryCode,
            year,
            cacheState: result.cacheState,
            lastFetchedAt: result.lastFetchedAt
          });
        } catch (err) {
          providerStatuses.push({
            sourceId: source.id,
            type: source.type,
            year,
            error: {
              code: err.code || 'CALENDAR_PROVIDER_FAILED',
              message: err.message || 'Calendar provider failed.'
            }
          });
        }
      }
    } else if (source.type === 'caldav' || source.type === 'google') {
      if (source.type === 'google') {
        const status = await calendarGoogleService.getSourceStatus(source.id);
        providerStatuses.push({
          sourceId: source.id,
          type: source.type,
          syncEnabled: source.config?.syncEnabled === true,
          status: status.connected ? 'cached' : 'not-connected',
          lastSyncedAt: status.lastSyncedAt,
          lastError: status.lastError,
          backoffUntil: status.backoffUntil
        });
      } else {
        providerStatuses.push({
          sourceId: source.id,
          type: source.type,
          syncEnabled: source.config?.syncEnabled === true,
          status: 'not-implemented'
        });
      }
    }
  }

  return {
    events: providerEvents.filter((item) => eventOverlapsRange(item, fromTs, toTs)),
    providerStatuses
  };
}

async function collectCalendarEventsForRange({ state, fromTs, toTs, selectedSources }) {
  const sources = getCalendarSources(state);
  const sourceLookup = new Map(sources.map((source) => [source.id, source]));
  const storedEvents = Array.isArray(state?.events) ? state.events : [];
  const selectedStoredEvents = storedEvents
    .map((item) => normalizeCalendarEventForResponse(item, 'local'))
    .filter((item) => {
      const source = sourceLookup.get(item.source) || { id: item.source, type: item.sourceType, enabled: true };
      return sourceIsSelected(source, selectedSources);
    })
    .filter((item) => eventOverlapsRange(item, fromTs, toTs));
  const providerResult = await collectProviderCalendarEvents({ state, fromTs, toTs, selectedSources });
  const data = [...selectedStoredEvents, ...providerResult.events]
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || String(a.title || '').localeCompare(String(b.title || '')));
  return {
    data,
    providerStatuses: providerResult.providerStatuses
  };
}

function normalizeCalendarSourceInput(body = {}, existing = null) {
  const type = toTrimmedOptionalString(body.type ?? existing?.type, 32);
  if (!['local', 'holiday', 'caldav', 'google'].includes(type)) {
    throw createCalendarError(400, 'CALENDAR_SOURCE_TYPE_INVALID', 'source type must be local, holiday, caldav, or google.');
  }
  const id = toTrimmedOptionalString(body.id ?? existing?.id, 128) || `${type}-${crypto.randomUUID()}`;
  const title = toTrimmedOptionalString(body.title ?? existing?.title, 120) || (type === 'holiday' ? 'Public Holidays' : 'Calendar Source');
  const color = toTrimmedOptionalString(body.color ?? existing?.color, 20) || (type === 'holiday' ? '#ef4444' : '#58a6ff');
  const rawConfig = body.config && typeof body.config === 'object' && !Array.isArray(body.config) ? body.config : existing?.config || {};
  const config = {};

  if (type === 'holiday') {
    config.countryCode = calendarHolidayService.normalizeCountryCode(rawConfig.countryCode || 'KR');
    config.provider = calendarHolidayService.normalizeProvider(rawConfig.provider || 'nager');
  } else if (type === 'caldav') {
    config.serverUrl = toTrimmedOptionalString(rawConfig.serverUrl, 2048);
    config.username = toTrimmedOptionalString(rawConfig.username, 256);
    config.calendarUrl = toTrimmedOptionalString(rawConfig.calendarUrl, 2048);
    config.syncEnabled = rawConfig.syncEnabled === true;
    config.syncDirection = rawConfig.syncDirection === 'twoWay' ? 'twoWay' : 'readOnly';
  } else if (type === 'google') {
    config.calendarId = toTrimmedOptionalString(rawConfig.calendarId, 256) || 'primary';
    config.syncEnabled = rawConfig.syncEnabled === true;
    config.syncDirection = rawConfig.syncDirection === 'twoWay' ? 'twoWay' : 'readOnly';
  }

  return {
    id,
    title,
    type,
    enabled: body.enabled !== undefined ? body.enabled !== false : existing?.enabled !== false,
    readOnly: type !== 'local' || body.readOnly === true || existing?.readOnly === true,
    color,
    config,
    lastSyncedAt: existing?.lastSyncedAt || null,
    lastError: existing?.lastError || null
  };
}

async function ensureGoogleSource(state, sourceId = 'google-primary') {
  const sources = getCalendarSources(state);
  const existing = sources.find((source) => source.id === sourceId);
  if (existing) return { source: existing, state };
  const now = Date.now();
  const source = normalizeCalendarSourceInput({
    id: sourceId,
    title: 'Google Calendar',
    type: 'google',
    enabled: true,
    readOnly: true,
    color: '#4285f4',
    config: {
      calendarId: 'primary',
      syncEnabled: true,
      syncDirection: 'readOnly'
    }
  });
  const nextState = await stateStore.writeState('calendar', {
    ...state,
    sources: [...sources, source],
    lastUpdatedAt: now
  });
  return { source, state: nextState };
}

function mergeGoogleSyncEvents(existingEvents, syncResult) {
  const sourceId = syncResult.sourceId;
  const current = Array.isArray(existingEvents) ? existingEvents : [];
  if (syncResult.fullSync) {
    return [
      ...current.filter((event) => event.source !== sourceId),
      ...syncResult.data
    ];
  }
  const removed = new Set(syncResult.removedExternalIds || []);
  const incoming = new Map((syncResult.data || []).map((event) => [event.externalId, event]));
  const next = [];
  for (const event of current) {
    if (event.source !== sourceId) {
      next.push(event);
      continue;
    }
    if (removed.has(event.externalId)) continue;
    if (incoming.has(event.externalId)) {
      next.push(incoming.get(event.externalId));
      incoming.delete(event.externalId);
    } else {
      next.push(event);
    }
  }
  next.push(...incoming.values());
  return next;
}

async function syncGoogleCalendarSource(source, state) {
  const result = await calendarGoogleService.syncSource(source);
  const now = Date.now();
  const sources = getCalendarSources(state);
  const nextSources = sources.map((item) => (item.id === source.id
    ? {
      ...item,
      lastSyncedAt: result.lastSyncedAt,
      lastError: null
    }
    : item));
  const nextState = await stateStore.writeState('calendar', {
    ...state,
    events: mergeGoogleSyncEvents(state?.events, result),
    sources: nextSources,
    lastUpdatedAt: now
  });
  return { result, state: nextState };
}

function createBackupError(status, code, message, details = null) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.details = details;
  return err;
}

function sendBackupError(res, err) {
  return res.status(err.status || 500).json({
    error: true,
    code: err.code || 'BACKUP_JOB_INTERNAL_ERROR',
    message: err.message || 'Backup job operation failed.',
    details: err.details || null
  });
}

function toSafeTrimmedString(value, maxLength = 4096) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.slice(0, maxLength);
}

function toBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  return fallback;
}

function formatTimestamp(value) {
  const date = new Date(value);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function withTimestampName(baseName, timestamp) {
  const parsed = path.parse(baseName);
  if (!parsed.ext) return `${baseName}-${timestamp}`;
  return `${parsed.name}-${timestamp}${parsed.ext}`;
}

async function resolveAndValidateBackupPath(rawPath, fieldName) {
  const pathValue = toSafeTrimmedString(rawPath);
  if (!pathValue) {
    throw createBackupError(
      400,
      `BACKUP_JOB_INVALID_${fieldName.toUpperCase()}`,
      `${fieldName} is required.`
    );
  }

  let absolutePath;
  try {
    absolutePath = resolveSafePath(pathValue);
  } catch (err) {
    throw createBackupError(
      400,
      `BACKUP_JOB_INVALID_${fieldName.toUpperCase()}`,
      err.message || `${fieldName} is invalid.`,
      { path: pathValue }
    );
  }

  const { allowedRoots, inventoryRoot } = await serverConfig.getPaths();
  if (!isWithinAllowedRoots(absolutePath, allowedRoots)) {
    throw createBackupError(
      403,
      `BACKUP_JOB_${fieldName.toUpperCase()}_FORBIDDEN`,
      `${fieldName} must be inside allowed roots.`,
      { path: absolutePath }
    );
  }

  if (isProtectedSystemPath(absolutePath, [inventoryRoot])) {
    throw createBackupError(
      403,
      `BACKUP_JOB_${fieldName.toUpperCase()}_SYSTEM_PROTECTED`,
      `${fieldName} cannot target protected system inventory paths.`,
      { path: absolutePath }
    );
  }

  try {
    await assertWithinAllowedRealRoots(absolutePath, allowedRoots);
  } catch (err) {
    throw createBackupError(
      err?.status || 403,
      `BACKUP_JOB_${fieldName.toUpperCase()}_FORBIDDEN`,
      `${fieldName} must stay inside allowed roots after symlink resolution.`,
      { path: absolutePath }
    );
  }

  return absolutePath;
}

async function loadBackupJobsState() {
  return stateStore.readState('backupJobs');
}

async function saveBackupJobsState(nextState) {
  return stateStore.writeState('backupJobs', nextState);
}

const WALLPAPER_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const WALLPAPER_VIDEO_EXTENSIONS = new Set(['.mp4', '.webm']);
const WALLPAPER_ALLOWED_EXTENSIONS = new Set([...WALLPAPER_IMAGE_EXTENSIONS, ...WALLPAPER_VIDEO_EXTENSIONS]);

function createMediaLibraryError(status, code, message, details = null) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.details = details;
  return err;
}

function sendMediaLibraryError(res, err) {
  return res.status(err.status || 500).json({
    error: true,
    code: err.code || 'MEDIA_LIBRARY_INTERNAL_ERROR',
    message: err.message || 'Media library operation failed.',
    details: err.details || null
  });
}

function sendLanguagePackError(res, err) {
  return res.status(err.status || 500).json({
    error: true,
    code: err.code || 'LANGUAGE_PACK_INTERNAL_ERROR',
    message: err.message || 'Language pack operation failed.',
    details: err.details || null
  });
}

function getWallpaperKindByExtension(extension) {
  if (WALLPAPER_IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (WALLPAPER_VIDEO_EXTENSIONS.has(extension)) return 'video';
  return 'unknown';
}

function sanitizeFileStem(stem) {
  const normalized = String(stem || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 80);
  return normalized || 'wallpaper';
}

function getWallpaperExtensionOrThrow(fileName) {
  const extension = path.extname(String(fileName || '')).toLowerCase();
  if (!WALLPAPER_ALLOWED_EXTENSIONS.has(extension)) {
    throw createMediaLibraryError(
      400,
      'MEDIA_LIBRARY_UNSUPPORTED_EXTENSION',
      'Only supported wallpaper image/video extensions can be used.',
      { fileName }
    );
  }
  return extension;
}

function buildWallpaperItem(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  return {
    filename: fileName,
    name: path.parse(fileName).name,
    kind: getWallpaperKindByExtension(extension),
    url: `/api/media-library-files/wallpapers/${encodeURIComponent(fileName)}`
  };
}

async function generateUniqueWallpaperFileName(fileName) {
  const extension = getWallpaperExtensionOrThrow(fileName);
  const stem = sanitizeFileStem(path.parse(fileName).name);
  const wallpapersDir = await mediaLibraryPaths.getWallpapersDir();

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const suffix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const candidate = `${stem}-${suffix}${extension}`;
    if (!(await fs.pathExists(path.join(wallpapersDir, candidate)))) {
      return candidate;
    }
  }

  throw createMediaLibraryError(
    500,
    'MEDIA_LIBRARY_FILENAME_GENERATION_FAILED',
    'Failed to generate a unique wallpaper file name.'
  );
}

const uploadWP = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      mediaLibraryPaths.getWallpapersDir()
        .then((wallpapersDir) => fs.ensureDir(wallpapersDir).then(() => cb(null, wallpapersDir)))
        .catch((err) => cb(err));
    },
    filename: (req, file, cb) => {
      generateUniqueWallpaperFileName(file.originalname)
        .then((fileName) => cb(null, fileName))
        .catch((err) => cb(err));
    }
  }),
  fileFilter: (req, file, cb) => {
    try {
      getWallpaperExtensionOrThrow(file.originalname);
      cb(null, true);
    } catch (err) {
      cb(err);
    }
  }
});

const uploadLanguagePack = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: languagePackService.LANGUAGE_PACK_UPLOAD_MAX_BYTES
  },
  fileFilter: (_req, file, cb) => {
    const extension = path.extname(String(file.originalname || '')).toLowerCase();
    if (extension !== '.json') {
      return cb(
        languagePackService.createLanguagePackError(
          400,
          'LANGUAGE_PACK_UPLOAD_UNSUPPORTED_FILE',
          'Language pack upload supports only .json files.'
        )
      );
    }
    return cb(null, true);
  }
});

/**
 * GET /api/system/overview
 * Get quick overview of system status
 */
router.get('/overview', async (req, res) => {
  try {
    const snapshot = await getSystemOverviewSnapshot();
    res.setHeader('X-WebOS-Overview-Cache', snapshot.cacheState);
    res.json(snapshot.data);
  } catch (err) {
    res.status(500).json({
      error: true,
      code: 'SYSTEM_OVERVIEW_FAILED',
      message: err.message
    });
  }
});

/**
 * GET /api/system/cpu
 * Detailed CPU stats
 */
router.get('/cpu', async (req, res) => {
  try {
    const [cpu, load, temp] = await Promise.all([
      si.cpu(),
      si.currentLoad(),
      si.cpuTemperature()
    ]);
    res.json({ cpu, load, temp });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * GET /api/system/network-ips
 * Get local and external IP addresses
 */
router.get('/network-ips', async (req, res) => {
  try {
    const snapshot = await getNetworkIpsSnapshot();
    res.setHeader('X-WebOS-Network-IPs-Cache', snapshot.cacheState);
    res.json(snapshot.data);
  } catch (err) {
    res.status(500).json({
      error: true,
      code: 'SYSTEM_NETWORK_IPS_FAILED',
      message: err.message
    });
  }
});

/**
 * GET /api/system/ops-summary
 * Aggregated operations view for Resource Monitor / Log Viewer.
 */
router.get('/ops-summary', async (req, res) => {
  try {
    const manager = req.app.get('serviceManager');
    const runtime = req.app.get('runtimeManager');

    const serviceSnapshot = manager?.getStatusSnapshot ? manager.getStatusSnapshot() : {};
    const runtimeStatusMap = runtime?.getRuntimeStatusMap ? runtime.getRuntimeStatusMap() : {};
    const runtimeApps = Object.values(runtimeStatusMap || {});
    const packages = await packageRegistryService.listSandboxApps().catch(() => []);
    const recentErrors = await auditService.getLogs({ limit: 80, level: 'ERROR' }).catch(() => []);
    const recentWarnings = await auditService.getLogs({ limit: 80, level: 'WARNING' }).catch(() => []);

    res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      services: {
        total: Object.keys(serviceSnapshot || {}).length,
        running: Object.values(serviceSnapshot || {}).filter((item) => item?.status === 'running').length,
        error: Object.values(serviceSnapshot || {}).filter((item) => item?.status === 'error').length
      },
      runtime: {
        total: runtimeApps.length,
        running: runtimeApps.filter((item) => item?.status === 'running' || item?.status === 'starting' || item?.status === 'degraded').length,
        error: runtimeApps.filter((item) => item?.status === 'error').length
      },
      packages: {
        total: packages.length
      },
      logs: {
        recentErrorCount: recentErrors.length,
        recentWarningCount: recentWarnings.length,
        recentErrors: recentErrors.slice(0, 20)
      }
    });
  } catch (err) {
    res.status(500).json({
      error: true,
      code: 'SYSTEM_OPS_SUMMARY_FAILED',
      message: err.message
    });
  }
});

/**
 * GET /api/system/apps
 * Get dynamic app registry
 */
router.get('/apps', async (req, res) => {
  try {
    const apps = await packageRegistryService.listDesktopApps();
    res.json(apps);
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * GET /api/system/apps/ownership-matrix
 * Get ownership matrix and launch contract summary for system/package apps.
 */
router.get('/apps/ownership-matrix', async (_req, res) => {
  try {
    const matrix = await packageRegistryService.getAppsOwnershipMatrix();
    return res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      contractVersion: matrix.contractVersion,
      items: matrix.items
    });
  } catch (err) {
    return res.status(500).json({
      error: true,
      code: 'APP_OWNERSHIP_MATRIX_FETCH_FAILED',
      message: err.message
    });
  }
});

/**
 * GET /api/system/app-api-policy
 * Return WebOS app API compatibility policy.
 */
router.get('/app-api-policy', async (req, res) => {
  try {
    const clientVersion = String(req.query.clientVersion || '').trim();
    const compatibility = clientVersion
      ? checkCompatibility(clientVersion)
      : null;

    return res.json({
      success: true,
      policy: APP_API_POLICY,
      compatibility
    });
  } catch (err) {
    return res.status(500).json({
      error: true,
      code: 'APP_API_POLICY_FETCH_FAILED',
      message: err.message
    });
  }
});

/**
 * GET /api/system/storage/diagnostics
 * Get S.M.A.R.T health data
 */
router.get('/storage/diagnostics', async (req, res) => {
  try {
    const data = await storageService.getDiagnostics();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * GET /api/system/processes
 * Get running processes list
 */
router.get('/processes', async (req, res) => {
  try {
    const data = await si.processes();
    const list = (data.list || []).sort((a, b) => (b.cpu || 0) - (a.cpu || 0));
    res.json(list.slice(0, 50));
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * GET /api/system/network/connections
 * Get active ports and sessions
 */
router.get('/network/connections', async (req, res) => {
  try {
    const data = await si.networkConnections();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * GET /api/system/wallpapers/list
 * List all files in the media library wallpapers directory
 */
router.get('/wallpapers/list', async (req, res) => {
  try {
    await mediaLibraryPaths.ensureMediaLibraryStructure();
    const wallpapersDir = await mediaLibraryPaths.getWallpapersDir();
    const files = await fs.readdir(wallpapersDir);
    const wallpapers = files.filter((f) => WALLPAPER_ALLOWED_EXTENSIONS.has(path.extname(f).toLowerCase()));
    const items = wallpapers.map(buildWallpaperItem);
    res.json({ success: true, data: wallpapers, items });
  } catch (err) {
    return sendMediaLibraryError(
      res,
      createMediaLibraryError(500, 'MEDIA_LIBRARY_LIST_FAILED', err.message || 'Failed to read wallpaper library.')
    );
  }
});

/**
 * POST /api/system/wallpapers/upload
 * Upload a new wallpaper
 */
router.post('/wallpapers/upload', (req, res) => {
  uploadWP.single('file')(req, res, async (err) => {
    try {
      if (err) {
        if (err.code && String(err.code).startsWith('MEDIA_LIBRARY_')) {
          return sendMediaLibraryError(res, err);
        }
        return sendMediaLibraryError(
          res,
          createMediaLibraryError(500, 'MEDIA_LIBRARY_UPLOAD_FAILED', err.message || 'Upload failed.')
        );
      }
      if (!req.file) {
        return sendMediaLibraryError(
          res,
          createMediaLibraryError(400, 'MEDIA_LIBRARY_UPLOAD_FILE_REQUIRED', 'Upload file is required.')
        );
      }

      const item = buildWallpaperItem(req.file.filename);
      await auditService.log(
        'SYSTEM',
        'Upload Wallpaper',
        { fileName: req.file.filename, user: req.user?.username },
        'INFO'
      );
      return res.json({ success: true, filename: req.file.filename, data: item });
    } catch (routeErr) {
      return sendMediaLibraryError(
        res,
        createMediaLibraryError(500, 'MEDIA_LIBRARY_UPLOAD_FAILED', routeErr.message || 'Upload failed.')
      );
    }
  });
});

/**
 * POST /api/system/wallpapers/import
 * Import a wallpaper from an allowed host path
 */
router.post('/wallpapers/import', async (req, res) => {
  try {
    const sourcePathValue = toSafeTrimmedString(req.body?.sourcePath);
    if (!sourcePathValue) {
      throw createMediaLibraryError(
        400,
        'MEDIA_LIBRARY_INVALID_SOURCE_PATH',
        'sourcePath is required.'
      );
    }

    let sourcePath;
    try {
      sourcePath = resolveSafePath(sourcePathValue);
    } catch (err) {
      throw createMediaLibraryError(
        400,
        'MEDIA_LIBRARY_INVALID_SOURCE_PATH',
        err.message || 'sourcePath is invalid.',
        { sourcePath: sourcePathValue }
      );
    }

    const { allowedRoots, inventoryRoot } = await serverConfig.getPaths();
    if (!isWithinAllowedRoots(sourcePath, allowedRoots)) {
      throw createMediaLibraryError(
        403,
        'MEDIA_LIBRARY_SOURCE_FORBIDDEN',
        'sourcePath must be inside allowed roots.',
        { sourcePath }
      );
    }
    if (isProtectedSystemPath(sourcePath, [inventoryRoot])) {
      throw createMediaLibraryError(
        403,
        'MEDIA_LIBRARY_SOURCE_SYSTEM_PROTECTED',
        'sourcePath cannot target protected system inventory paths.',
        { sourcePath }
      );
    }

    if (!(await fs.pathExists(sourcePath))) {
      throw createMediaLibraryError(
        404,
        'MEDIA_LIBRARY_SOURCE_NOT_FOUND',
        'sourcePath does not exist.',
        { sourcePath }
      );
    }

    const sourceStat = await fs.stat(sourcePath);
    if (!sourceStat.isFile()) {
      throw createMediaLibraryError(
        400,
        'MEDIA_LIBRARY_SOURCE_NOT_FILE',
        'sourcePath must reference a file.',
        { sourcePath }
      );
    }

    const sourceName = path.basename(sourcePath);
    getWallpaperExtensionOrThrow(sourceName);

    await mediaLibraryPaths.ensureMediaLibraryStructure();
    const targetName = await generateUniqueWallpaperFileName(sourceName);
    const wallpapersDir = await mediaLibraryPaths.getWallpapersDir();
    const destinationPath = path.join(wallpapersDir, targetName);

    await fs.copy(sourcePath, destinationPath, { overwrite: false, errorOnExist: true, dereference: false });

    const item = buildWallpaperItem(targetName);
    await auditService.log(
      'SYSTEM',
      'Import Wallpaper',
      { sourcePath, fileName: targetName, user: req.user?.username },
      'INFO'
    );
    return res.status(201).json({ success: true, filename: targetName, data: item });
  } catch (err) {
    if (err.code && String(err.code).startsWith('MEDIA_LIBRARY_')) {
      return sendMediaLibraryError(res, err);
    }
    return sendMediaLibraryError(
      res,
      createMediaLibraryError(500, 'MEDIA_LIBRARY_IMPORT_FAILED', err.message || 'Wallpaper import failed.')
    );
  }
});

/**
 * GET /api/system/language-packs
 * List builtin and uploaded language packs for core desktop UI.
 */
router.get('/language-packs', async (_req, res) => {
  try {
    const packs = await languagePackService.listLanguagePacks();
    return res.json({
      success: true,
      data: packs
    });
  } catch (err) {
    return sendLanguagePackError(res, err);
  }
});

/**
 * POST /api/system/language-packs/upload
 * Upload runtime language pack JSON file.
 */
router.post('/language-packs/upload', (req, res) => {
  uploadLanguagePack.single('file')(req, res, async (err) => {
    try {
      if (err) {
        if (err.code && String(err.code).startsWith('LANGUAGE_PACK_')) {
          return sendLanguagePackError(res, err);
        }
        if (err.code === 'LIMIT_FILE_SIZE') {
          return sendLanguagePackError(
            res,
            languagePackService.createLanguagePackError(
              400,
              'LANGUAGE_PACK_UPLOAD_TOO_LARGE',
              `Language pack file must be <= ${languagePackService.LANGUAGE_PACK_UPLOAD_MAX_BYTES} bytes.`
            )
          );
        }
        return sendLanguagePackError(
          res,
          languagePackService.createLanguagePackError(
            500,
            'LANGUAGE_PACK_UPLOAD_FAILED',
            err.message || 'Language pack upload failed.'
          )
        );
      }

      if (!req.file) {
        return sendLanguagePackError(
          res,
          languagePackService.createLanguagePackError(
            400,
            'LANGUAGE_PACK_UPLOAD_FILE_REQUIRED',
            'Upload file is required.'
          )
        );
      }

      const savedPack = await languagePackService.saveUploadedLanguagePackFromBuffer(req.file.buffer);
      await auditService.log(
        'SYSTEM',
        'Upload Language Pack',
        {
          user: req.user?.username,
          code: savedPack.code,
          fileName: savedPack.fileName,
          source: savedPack.source
        },
        'INFO'
      );

      return res.status(201).json({
        success: true,
        data: savedPack
      });
    } catch (routeErr) {
      return sendLanguagePackError(res, routeErr);
    }
  });
});

/**
 * GET /api/system/language-packs/:code
 * Get one language pack payload for runtime i18n usage.
 */
router.get('/language-packs/:code', async (req, res) => {
  try {
    const pack = await languagePackService.getLanguagePack(req.params.code);
    return res.json({
      success: true,
      data: pack
    });
  } catch (err) {
    return sendLanguagePackError(res, err);
  }
});

/**
 * GET /api/system/calendar/sources
 * List configured calendar sources.
 */
router.get('/calendar/sources', async (_req, res) => {
  try {
    const state = await stateStore.readState('calendar');
    return res.json({
      success: true,
      data: getCalendarSources(state),
      total: getCalendarSources(state).length,
      lastUpdatedAt: state?.lastUpdatedAt || null
    });
  } catch (err) {
    return sendCalendarError(res, err);
  }
});

/**
 * POST /api/system/calendar/sources
 * Create one calendar source without accepting secret fields.
 */
router.post('/calendar/sources', async (req, res) => {
  try {
    const state = await stateStore.readState('calendar');
    const sources = getCalendarSources(state);
    const nextSource = normalizeCalendarSourceInput(req.body || {});
    if (sources.some((source) => source.id === nextSource.id)) {
      throw createCalendarError(409, 'CALENDAR_SOURCE_EXISTS', 'calendar source already exists.', { id: nextSource.id });
    }
    const now = Date.now();
    const nextState = await stateStore.writeState('calendar', {
      ...state,
      sources: [...sources, nextSource],
      lastUpdatedAt: now
    });
    return res.status(201).json({
      success: true,
      data: nextSource,
      lastUpdatedAt: nextState?.lastUpdatedAt || now
    });
  } catch (err) {
    return sendCalendarError(res, err);
  }
});

/**
 * PUT /api/system/calendar/sources/:id
 * Update one calendar source without accepting secret fields.
 */
router.put('/calendar/sources/:id', async (req, res) => {
  try {
    const sourceId = toTrimmedOptionalString(req.params?.id, 128);
    const state = await stateStore.readState('calendar');
    const sources = getCalendarSources(state);
    const existing = sources.find((source) => source.id === sourceId);
    if (!existing) {
      throw createCalendarError(404, 'CALENDAR_SOURCE_NOT_FOUND', 'calendar source not found.', { id: sourceId });
    }
    if (existing.id === 'local' && req.body?.type && req.body.type !== 'local') {
      throw createCalendarError(400, 'CALENDAR_SOURCE_LOCAL_LOCKED', 'local source type cannot be changed.');
    }
    const nextSource = {
      ...normalizeCalendarSourceInput({ ...req.body, id: existing.id, type: existing.type }, existing),
      id: existing.id,
      type: existing.type
    };
    const now = Date.now();
    const nextState = await stateStore.writeState('calendar', {
      ...state,
      sources: sources.map((source) => (source.id === sourceId ? nextSource : source)),
      lastUpdatedAt: now
    });
    return res.json({
      success: true,
      data: nextSource,
      lastUpdatedAt: nextState?.lastUpdatedAt || now
    });
  } catch (err) {
    return sendCalendarError(res, err);
  }
});

/**
 * DELETE /api/system/calendar/sources/:id
 * Remove one non-local calendar source.
 */
router.delete('/calendar/sources/:id', async (req, res) => {
  try {
    const sourceId = toTrimmedOptionalString(req.params?.id, 128);
    if (sourceId === 'local') {
      throw createCalendarError(400, 'CALENDAR_SOURCE_LOCAL_LOCKED', 'local source cannot be removed.');
    }
    const state = await stateStore.readState('calendar');
    const sources = getCalendarSources(state);
    const nextSources = sources.filter((source) => source.id !== sourceId);
    if (nextSources.length === sources.length) {
      throw createCalendarError(404, 'CALENDAR_SOURCE_NOT_FOUND', 'calendar source not found.', { id: sourceId });
    }
    const now = Date.now();
    const nextState = await stateStore.writeState('calendar', {
      ...state,
      sources: nextSources,
      lastUpdatedAt: now
    });
    return res.json({
      success: true,
      data: { removedId: sourceId },
      lastUpdatedAt: nextState?.lastUpdatedAt || now
    });
  } catch (err) {
    return sendCalendarError(res, err);
  }
});

router.post('/calendar/sources/:id/sync', async (req, res) => {
  try {
    const sourceId = toTrimmedOptionalString(req.params?.id, 128);
    const state = await stateStore.readState('calendar');
    const source = getCalendarSources(state).find((item) => item.id === sourceId);
    if (!source) {
      throw createCalendarError(404, 'CALENDAR_SOURCE_NOT_FOUND', 'calendar source not found.', { id: sourceId });
    }
    if (source.type === 'holiday') {
      const year = Number.parseInt(String(req.body?.year || new Date().getUTCFullYear()), 10);
      const result = await calendarHolidayService.getHolidayEvents({
        year,
        countryCode: source.config?.countryCode || 'KR',
        provider: source.config?.provider || 'nager',
        sourceId: source.id,
        color: source.color
      });
      return res.json(result);
    }
    if (source.type === 'google') {
      const { result } = await syncGoogleCalendarSource(source, state);
      return res.json({
        success: true,
        sourceId,
        type: source.type,
        total: result.total,
        fullSync: result.fullSync,
        lastSyncedAt: result.lastSyncedAt
      });
    }
    throw createCalendarError(501, 'CALENDAR_SYNC_PROVIDER_NOT_IMPLEMENTED', 'Calendar sync provider is registered but not implemented yet.', {
      sourceId,
      type: source.type
    });
  } catch (err) {
    return sendCalendarError(res, err);
  }
});

router.get('/calendar/google/config', async (req, res) => {
  try {
    const sourceId = toTrimmedOptionalString(req.query?.sourceId, 128) || 'google-primary';
    const status = await calendarGoogleService.getSourceStatus(sourceId);
    return res.json({ success: true, data: status });
  } catch (err) {
    return sendCalendarError(res, err);
  }
});

router.put('/calendar/google/config', async (req, res) => {
  try {
    const data = await calendarGoogleService.updateOAuthClient(req.body || {});
    return res.json({ success: true, data });
  } catch (err) {
    return sendCalendarError(res, err);
  }
});

router.get('/calendar/google/auth/start', async (req, res) => {
  try {
    const sourceId = toTrimmedOptionalString(req.query?.sourceId, 128) || 'google-primary';
    const result = await calendarGoogleService.buildAuthStart(sourceId);
    if (String(req.query?.format || '').toLowerCase() === 'json') {
      return res.json({ success: true, data: result });
    }
    return res.redirect(result.url);
  } catch (err) {
    return sendCalendarError(res, err);
  }
});

router.post('/calendar/google/disconnect', async (req, res) => {
  try {
    const sourceId = toTrimmedOptionalString(req.body?.sourceId, 128) || 'google-primary';
    const state = await stateStore.readState('calendar');
    const sources = getCalendarSources(state);
    const now = Date.now();
    const nextState = await stateStore.writeState('calendar', {
      ...state,
      events: (Array.isArray(state?.events) ? state.events : []).filter((event) => event.source !== sourceId),
      sources: sources.map((source) => (source.id === sourceId ? { ...source, enabled: false, lastError: null } : source)),
      lastUpdatedAt: now
    });
    const data = await calendarGoogleService.disconnect(sourceId);
    return res.json({ success: true, data, lastUpdatedAt: nextState?.lastUpdatedAt || now });
  } catch (err) {
    return sendCalendarError(res, err);
  }
});

router.post('/calendar/google/sync', async (req, res) => {
  try {
    const sourceId = toTrimmedOptionalString(req.body?.sourceId, 128) || 'google-primary';
    const state = await stateStore.readState('calendar');
    const { source, state: sourceState } = await ensureGoogleSource(state, sourceId);
    const { result } = await syncGoogleCalendarSource(source, sourceState);
    return res.json({
      success: true,
      sourceId,
      type: 'google',
      total: result.total,
      fullSync: result.fullSync,
      lastSyncedAt: result.lastSyncedAt
    });
  } catch (err) {
    return sendCalendarError(res, err);
  }
});

/**
 * GET /api/system/calendar/events
 * Read calendar events with optional time range filtering.
 */
router.get('/calendar/events', async (req, res) => {
  try {
    const fromRaw = toTrimmedOptionalString(req.query?.from, 64);
    const toRaw = toTrimmedOptionalString(req.query?.to, 64);

    const fromTs = fromRaw ? toTimestampOrNull(fromRaw) : null;
    const toTs = toRaw ? toTimestampOrNull(toRaw) : null;

    if (fromRaw && fromTs == null) {
      throw createCalendarError(400, 'CALENDAR_RANGE_FROM_INVALID', 'from must be a valid ISO datetime string.');
    }
    if (toRaw && toTs == null) {
      throw createCalendarError(400, 'CALENDAR_RANGE_TO_INVALID', 'to must be a valid ISO datetime string.');
    }
    if (fromTs != null && toTs != null && toTs < fromTs) {
      throw createCalendarError(400, 'CALENDAR_RANGE_INVALID', 'to must be greater than or equal to from.');
    }

    const state = await stateStore.readState('calendar');
    const rangeFromTs = fromTs == null ? Number.MIN_SAFE_INTEGER : fromTs;
    const rangeToTs = toTs == null ? Number.MAX_SAFE_INTEGER : toTs;
    const selectedSources = parseCalendarSourceFilter(req.query?.sources);
    const result = await collectCalendarEventsForRange({
      state,
      fromTs: rangeFromTs,
      toTs: rangeToTs,
      selectedSources
    });

    return res.json({
      success: true,
      data: result.data,
      total: result.data.length,
      sources: result.providerStatuses,
      lastUpdatedAt: state?.lastUpdatedAt || null
    });
  } catch (err) {
    return sendCalendarError(res, err);
  }
});

/**
 * GET /api/system/calendar/month
 * Read calendar events for one month window.
 */
router.get('/calendar/month', async (req, res) => {
  try {
    const now = new Date();
    const year = Number.parseInt(String(req.query?.year ?? now.getFullYear()), 10);
    const month = Number.parseInt(String(req.query?.month ?? now.getMonth() + 1), 10);

    if (!Number.isFinite(year) || year < 1970 || year > 9999) {
      throw createCalendarError(400, 'CALENDAR_MONTH_YEAR_INVALID', 'year must be between 1970 and 9999.');
    }
    if (!Number.isFinite(month) || month < 1 || month > 12) {
      throw createCalendarError(400, 'CALENDAR_MONTH_VALUE_INVALID', 'month must be between 1 and 12.');
    }

    const fromTs = Date.UTC(year, month - 1, 1, 0, 0, 0, 0);
    const toTs = Date.UTC(year, month, 0, 23, 59, 59, 999);

    const state = await stateStore.readState('calendar');
    const selectedSources = parseCalendarSourceFilter(req.query?.sources);
    const result = await collectCalendarEventsForRange({
      state,
      fromTs,
      toTs,
      selectedSources
    });

    return res.json({
      success: true,
      data: result.data,
      total: result.data.length,
      range: {
        from: new Date(fromTs).toISOString(),
        to: new Date(toTs).toISOString(),
        year,
        month
      },
      sources: result.providerStatuses,
      lastUpdatedAt: state?.lastUpdatedAt || null
    });
  } catch (err) {
    return sendCalendarError(res, err);
  }
});

/**
 * POST /api/system/calendar/events
 * Create one calendar event.
 */
router.post('/calendar/events', async (req, res) => {
  try {
    const input = normalizeCalendarCreateInput(req.body || {});
    const state = await stateStore.readState('calendar');
    const events = Array.isArray(state?.events) ? state.events : [];
    const now = Date.now();

    const nextEvent = {
      id: crypto.randomUUID(),
      ...input,
      source: 'local',
      sourceType: 'local',
      readOnly: false,
      externalId: null,
      provider: null,
      calendarId: 'local',
      createdAt: now,
      updatedAt: now
    };

    const nextState = await stateStore.writeState('calendar', {
      ...state,
      events: [...events, nextEvent],
      lastUpdatedAt: now
    });

    await auditService.log(
      'SYSTEM',
      'Create Calendar Event',
      { user: req.user?.username, eventId: nextEvent.id, title: nextEvent.title },
      'INFO'
    );

    return res.status(201).json({
      success: true,
      data: nextEvent,
      lastUpdatedAt: nextState?.lastUpdatedAt || now
    });
  } catch (err) {
    return sendCalendarError(res, err);
  }
});

/**
 * PUT /api/system/calendar/events/:id
 * Update one calendar event.
 */
router.put('/calendar/events/:id', async (req, res) => {
  try {
    const eventId = toTrimmedOptionalString(req.params?.id, 128);
    if (!eventId) {
      throw createCalendarError(400, 'CALENDAR_EVENT_ID_REQUIRED', 'event id is required.');
    }

    const patch = normalizeCalendarUpdateInput(req.body || {});
    const state = await stateStore.readState('calendar');
    const events = Array.isArray(state?.events) ? state.events : [];
    const existing = events.find((item) => String(item?.id || '') === eventId);
    if (!existing) {
      throw createCalendarError(404, 'CALENDAR_EVENT_NOT_FOUND', 'calendar event not found.', { id: eventId });
    }
    if (existing.readOnly === true || (existing.source && existing.source !== 'local')) {
      throw createCalendarError(409, 'CALENDAR_EVENT_READ_ONLY', 'read-only calendar events cannot be updated.', { id: eventId });
    }

    const candidate = {
      ...existing,
      ...patch
    };

    const startTs = toTimestampOrNull(candidate.startAt);
    const endTs = toTimestampOrNull(candidate.endAt);
    if (startTs == null) {
      throw createCalendarError(400, 'CALENDAR_EVENT_START_INVALID', 'startAt must be a valid ISO datetime string.');
    }
    if (candidate.endAt && endTs == null) {
      throw createCalendarError(400, 'CALENDAR_EVENT_END_INVALID', 'endAt must be a valid ISO datetime string.');
    }
    if (endTs != null && endTs < startTs) {
      throw createCalendarError(400, 'CALENDAR_EVENT_RANGE_INVALID', 'endAt must be greater than or equal to startAt.');
    }

    const now = Date.now();
    const nextEvent = {
      ...candidate,
      startAt: new Date(startTs).toISOString(),
      endAt: endTs != null ? new Date(endTs).toISOString() : null,
      source: 'local',
      sourceType: 'local',
      readOnly: false,
      externalId: null,
      provider: null,
      calendarId: 'local',
      updatedAt: now
    };

    const nextEvents = events.map((item) => (String(item?.id || '') === eventId ? nextEvent : item));
    const nextState = await stateStore.writeState('calendar', {
      ...state,
      events: nextEvents,
      lastUpdatedAt: now
    });

    await auditService.log(
      'SYSTEM',
      'Update Calendar Event',
      { user: req.user?.username, eventId: eventId, title: nextEvent.title },
      'INFO'
    );

    return res.json({
      success: true,
      data: nextEvent,
      lastUpdatedAt: nextState?.lastUpdatedAt || now
    });
  } catch (err) {
    return sendCalendarError(res, err);
  }
});

/**
 * DELETE /api/system/calendar/events/:id
 * Remove one calendar event.
 */
router.delete('/calendar/events/:id', async (req, res) => {
  try {
    const eventId = toTrimmedOptionalString(req.params?.id, 128);
    if (!eventId) {
      throw createCalendarError(400, 'CALENDAR_EVENT_ID_REQUIRED', 'event id is required.');
    }

    const state = await stateStore.readState('calendar');
    const events = Array.isArray(state?.events) ? state.events : [];
    const existing = events.find((item) => String(item?.id || '') === eventId);
    if (existing && (existing.readOnly === true || (existing.source && existing.source !== 'local'))) {
      throw createCalendarError(409, 'CALENDAR_EVENT_READ_ONLY', 'read-only calendar events cannot be deleted.', { id: eventId });
    }
    const nextEvents = events.filter((item) => String(item?.id || '') !== eventId);
    if (nextEvents.length === events.length) {
      throw createCalendarError(404, 'CALENDAR_EVENT_NOT_FOUND', 'calendar event not found.', { id: eventId });
    }

    const now = Date.now();
    const nextState = await stateStore.writeState('calendar', {
      ...state,
      events: nextEvents,
      lastUpdatedAt: now
    });

    await auditService.log(
      'SYSTEM',
      'Delete Calendar Event',
      { user: req.user?.username, eventId: eventId },
      'INFO'
    );

    return res.json({
      success: true,
      data: { removedId: eventId },
      lastUpdatedAt: nextState?.lastUpdatedAt || now
    });
  } catch (err) {
    return sendCalendarError(res, err);
  }
});

/**
 * GET /api/system/state/:key
 * Read OS state from protected inventory state store
 */
router.get('/state/:key', async (req, res) => {
  try {
    const data = await stateStore.readState(req.params.key);
    res.json({ success: true, data });
  } catch (err) {
    handleStateKeyError(res, err);
  }
});

/**
 * POST /api/system/state/:key
 * Write OS state to protected inventory state store
 */
router.post('/state/:key', async (req, res) => {
  try {
    const savedState = await stateStore.writeState(req.params.key, req.body);
    await auditService.log('SYSTEM', `Save State: ${req.params.key}`, { user: req.user?.username }, 'INFO');
    res.json({ success: true, data: savedState });
  } catch (err) {
    handleStateKeyError(res, err);
  }
});

/**
 * GET /api/system/backup-jobs
 * Read backup job manager state
 */
router.get('/backup-jobs', async (_req, res) => {
  try {
    const data = await loadBackupJobsState();
    res.json({ success: true, data });
  } catch (err) {
    sendBackupError(res, createBackupError(500, 'BACKUP_JOB_READ_FAILED', err.message));
  }
});

/**
 * POST /api/system/backup-jobs
 * Create backup job
 */
router.post('/backup-jobs', async (req, res) => {
  try {
    const name = toSafeTrimmedString(req.body?.name, 200);
    const sourcePath = await resolveAndValidateBackupPath(req.body?.sourcePath, 'sourcePath');
    const destinationRoot = await resolveAndValidateBackupPath(req.body?.destinationRoot, 'destinationRoot');

    const id = crypto.randomUUID();
    const now = Date.now();
    const fallbackName = `Backup ${path.basename(sourcePath) || id.slice(0, 8)}`;
    const nextJob = {
      id,
      name: name || fallbackName,
      sourcePath,
      destinationRoot,
      includeTimestamp: toBool(req.body?.includeTimestamp, true),
      createdAt: now,
      lastRunAt: null,
      lastStatus: null,
      lastOutputPath: null,
      lastError: null
    };

    const state = await loadBackupJobsState();
    const nextState = {
      ...state,
      jobs: [...state.jobs, nextJob]
    };
    const saved = await saveBackupJobsState(nextState);
    const created = saved.jobs.find((job) => job.id === id) || nextJob;

    await auditService.log('SYSTEM', 'Create Backup Job', { user: req.user?.username, id, name: created.name }, 'INFO');
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    sendBackupError(res, err);
  }
});

/**
 * DELETE /api/system/backup-jobs/:id
 * Remove backup job
 */
router.delete('/backup-jobs/:id', async (req, res) => {
  try {
    const id = toSafeTrimmedString(req.params.id, 128);
    if (!id) {
      throw createBackupError(400, 'BACKUP_JOB_INVALID_ID', 'Backup job id is required.');
    }

    const state = await loadBackupJobsState();
    const exists = state.jobs.some((job) => job.id === id);
    if (!exists) {
      throw createBackupError(404, 'BACKUP_JOB_NOT_FOUND', 'Backup job not found.', { id });
    }

    const nextState = {
      ...state,
      jobs: state.jobs.filter((job) => job.id !== id),
      history: state.history.filter((entry) => entry.jobId !== id)
    };
    await saveBackupJobsState(nextState);

    await auditService.log('SYSTEM', 'Delete Backup Job', { user: req.user?.username, id }, 'INFO');
    res.json({ success: true, data: { removedId: id } });
  } catch (err) {
    sendBackupError(res, err);
  }
});

/**
 * POST /api/system/backup-jobs/:id/run
 * Execute backup job immediately
 */
router.post('/backup-jobs/:id/run', async (req, res) => {
  const id = toSafeTrimmedString(req.params.id, 128);
  const startedAt = Date.now();

  try {
    if (!id) {
      throw createBackupError(400, 'BACKUP_JOB_INVALID_ID', 'Backup job id is required.');
    }

    const state = await loadBackupJobsState();
    const targetJob = state.jobs.find((job) => job.id === id);
    if (!targetJob) {
      throw createBackupError(404, 'BACKUP_JOB_NOT_FOUND', 'Backup job not found.', { id });
    }

    const sourcePath = await resolveAndValidateBackupPath(targetJob.sourcePath, 'sourcePath');
    const destinationRoot = await resolveAndValidateBackupPath(targetJob.destinationRoot, 'destinationRoot');

    const sourceExists = await fs.pathExists(sourcePath);
    if (!sourceExists) {
      throw createBackupError(
        400,
        'BACKUP_JOB_SOURCE_NOT_FOUND',
        'Backup source path does not exist.',
        { sourcePath }
      );
    }

    const sourceStats = await fs.stat(sourcePath);
    if (!(await fs.pathExists(destinationRoot))) {
      throw createBackupError(
        400,
        'BACKUP_JOB_DESTINATION_NOT_FOUND',
        'Backup destination root does not exist.',
        { destinationRoot }
      );
    }
    const destinationStats = await fs.stat(destinationRoot);
    if (!destinationStats.isDirectory()) {
      throw createBackupError(
        400,
        'BACKUP_JOB_DESTINATION_NOT_DIRECTORY',
        'Backup destination root must be a directory.',
        { destinationRoot }
      );
    }

    const now = Date.now();
    const timeSuffix = formatTimestamp(now);
    const sourceName = path.basename(sourcePath);
    const outputName = targetJob.includeTimestamp
      ? withTimestampName(sourceName, timeSuffix)
      : sourceName;
    const outputPath = path.join(destinationRoot, outputName);

    if (await fs.pathExists(outputPath)) {
      throw createBackupError(
        409,
        'BACKUP_JOB_OUTPUT_ALREADY_EXISTS',
        'Backup output path already exists.',
        { outputPath }
      );
    }

    if (!sourceStats.isFile() && !sourceStats.isDirectory()) {
      throw createBackupError(
        400,
        'BACKUP_JOB_SOURCE_UNSUPPORTED_TYPE',
        'Only file and directory sources are supported for backup.',
        { sourcePath }
      );
    }

    await fs.copy(sourcePath, outputPath, {
      overwrite: false,
      errorOnExist: true,
      dereference: false,
      preserveTimestamps: true
    });

    const finishedAt = Date.now();
    const historyEntry = {
      id: crypto.randomUUID(),
      jobId: id,
      startedAt,
      finishedAt,
      status: 'success',
      outputPath,
      error: null
    };

    const nextJobs = state.jobs.map((job) => (job.id === id
      ? {
          ...job,
          lastRunAt: finishedAt,
          lastStatus: 'success',
          lastOutputPath: outputPath,
          lastError: null
        }
      : job));
    const nextHistory = [...state.history, historyEntry].slice(-500);
    const saved = await saveBackupJobsState({ ...state, jobs: nextJobs, history: nextHistory });
    const updatedJob = saved.jobs.find((job) => job.id === id);

    await auditService.log('SYSTEM', 'Run Backup Job', { user: req.user?.username, id, outputPath }, 'INFO');
    res.json({
      success: true,
      data: {
        job: updatedJob,
        run: historyEntry
      }
    });
  } catch (err) {
    if (!id) {
      return sendBackupError(res, err);
    }

    let latestState;
    try {
      latestState = await loadBackupJobsState();
      const targetJob = latestState.jobs.find((job) => job.id === id);
      if (targetJob) {
        const finishedAt = Date.now();
        const failEntry = {
          id: crypto.randomUUID(),
          jobId: id,
          startedAt,
          finishedAt,
          status: 'error',
          outputPath: null,
          error: err.message || 'Backup job run failed.'
        };

        const nextJobs = latestState.jobs.map((job) => (job.id === id
          ? {
              ...job,
              lastRunAt: finishedAt,
              lastStatus: 'error',
              lastOutputPath: null,
              lastError: failEntry.error
            }
          : job));
        const nextHistory = [...latestState.history, failEntry].slice(-500);
        await saveBackupJobsState({ ...latestState, jobs: nextJobs, history: nextHistory });
      }
    } catch (_persistErr) {
      // Ignore persistence failure in error path and return original run error.
    }

    return sendBackupError(res, err);
  }
});

/**
 * GET /api/system/widget-library
 * List all widget templates from inventory
 */
router.get('/widget-library', async (req, res) => {
  try {
    await inventoryPaths.ensureInventoryStructure();
    const widgetsDir = await inventoryPaths.getWidgetLibraryDir();
    const files = await fs.readdir(widgetsDir);
    const library = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const item = await fs.readJson(path.join(widgetsDir, file));
      library.push(item);
    }

    res.json({ success: true, data: library });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * POST /api/system/widget-library/:id
 * Save or update a widget template
 */
router.post('/widget-library/:id', async (req, res) => {
  try {
    await inventoryPaths.ensureInventoryStructure();
    const widgetsDir = await inventoryPaths.getWidgetLibraryDir();
    const widgetFile = path.join(widgetsDir, `${req.params.id}.json`);
    await fs.writeJson(widgetFile, req.body, { spaces: 2 });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * DELETE /api/system/widget-library/:id
 * Remove a widget template
 */
router.delete('/widget-library/:id', async (req, res) => {
  try {
    await inventoryPaths.ensureInventoryStructure();
    const widgetsDir = await inventoryPaths.getWidgetLibraryDir();
    const widgetFile = path.join(widgetsDir, `${req.params.id}.json`);

    if (!(await fs.pathExists(widgetFile))) {
      return res.status(404).json({ error: true, message: 'Widget template not found' });
    }

    await fs.remove(widgetFile);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: true, message: err.message });
  }
});

module.exports = router;
