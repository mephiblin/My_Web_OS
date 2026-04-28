const fs = require('fs-extra');
const path = require('path');
const inventoryPaths = require('../utils/inventoryPaths');

const CACHE_FILE_NAME = 'calendar-holidays.json';
const DEFAULT_PROVIDER = 'nager';
const DEFAULT_COUNTRY = 'KR';
const REQUEST_TIMEOUT_MS = 5000;

function createHolidayError(status, code, message, details = null) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.details = details;
  return err;
}

function normalizeCountryCode(value) {
  const code = String(value || DEFAULT_COUNTRY).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : DEFAULT_COUNTRY;
}

function normalizeProvider(value) {
  const provider = String(value || DEFAULT_PROVIDER).trim().toLowerCase();
  return provider || DEFAULT_PROVIDER;
}

function normalizeYear(value) {
  const year = Number.parseInt(String(value), 10);
  if (!Number.isFinite(year) || year < 1970 || year > 9999) {
    throw createHolidayError(400, 'CALENDAR_HOLIDAY_YEAR_INVALID', 'year must be between 1970 and 9999.');
  }
  return year;
}

function cacheKey(provider, countryCode, year) {
  return `${provider}:${countryCode}:${year}`;
}

async function getCacheFile() {
  const roots = await inventoryPaths.ensureInventoryStructure();
  return path.join(roots.systemDir, CACHE_FILE_NAME);
}

async function readCache() {
  const file = await getCacheFile();
  try {
    const data = await fs.readJson(file);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    return {};
  }
}

async function writeCache(cache) {
  const file = await getCacheFile();
  await fs.ensureDir(path.dirname(file));
  await fs.writeJson(file, cache && typeof cache === 'object' ? cache : {}, { spaces: 2 });
}

function normalizeNagerHoliday(row, context) {
  if (!row || typeof row !== 'object') return null;
  const date = String(row.date || '').trim();
  const name = String(row.localName || row.name || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name) return null;

  return {
    id: `${context.sourceId}:${date}:${name}`.slice(0, 128),
    title: name.slice(0, 200),
    startAt: `${date}T00:00:00.000Z`,
    endAt: null,
    allDay: true,
    color: context.color || '#ef4444',
    note: row.name && row.name !== name ? String(row.name).slice(0, 4000) : null,
    source: context.sourceId,
    sourceType: 'holiday',
    readOnly: true,
    externalId: `${context.provider}:${context.countryCode}:${date}:${String(row.name || name)}`.slice(0, 256),
    provider: context.provider,
    calendarId: context.countryCode,
    createdAt: context.fetchedAt,
    updatedAt: context.fetchedAt
  };
}

async function fetchNagerHolidays({ year, countryCode }) {
  const url = `https://date.nager.at/api/v3/PublicHolidays/${encodeURIComponent(year)}/${encodeURIComponent(countryCode)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) {
    throw createHolidayError(
      response.status,
      'CALENDAR_HOLIDAY_PROVIDER_FAILED',
      `Holiday provider returned ${response.status}.`,
      { provider: DEFAULT_PROVIDER, countryCode, year }
    );
  }
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

async function fetchProviderHolidays({ provider, countryCode, year }) {
  if (provider === 'nager') {
    return fetchNagerHolidays({ year, countryCode });
  }
  throw createHolidayError(400, 'CALENDAR_HOLIDAY_PROVIDER_UNSUPPORTED', 'holiday provider is not supported.', { provider });
}

async function getHolidayEvents(options = {}) {
  const year = normalizeYear(options.year);
  const countryCode = normalizeCountryCode(options.countryCode);
  const provider = normalizeProvider(options.provider);
  const sourceId = String(options.sourceId || `holidays-${countryCode.toLowerCase()}`).trim();
  const color = String(options.color || '#ef4444').trim().slice(0, 20);
  const key = cacheKey(provider, countryCode, year);
  const cache = await readCache();
  let entry = cache[key];
  let cacheState = entry ? 'stale' : 'miss';
  let rows = Array.isArray(entry?.items) ? entry.items : [];

  try {
    rows = await fetchProviderHolidays({ provider, countryCode, year });
    entry = {
      provider,
      countryCode,
      year,
      fetchedAt: Date.now(),
      items: rows
    };
    cache[key] = entry;
    await writeCache(cache);
    cacheState = 'fresh';
  } catch (err) {
    if (!entry) throw err;
    cacheState = 'fallback';
  }

  const context = {
    sourceId,
    provider,
    countryCode,
    color,
    fetchedAt: entry?.fetchedAt || Date.now()
  };
  const events = rows.map((row) => normalizeNagerHoliday(row, context)).filter(Boolean);
  return {
    success: true,
    data: events,
    total: events.length,
    provider,
    countryCode,
    year,
    cacheState,
    lastFetchedAt: entry?.fetchedAt || null
  };
}

module.exports = {
  createHolidayError,
  getHolidayEvents,
  normalizeCountryCode,
  normalizeProvider,
  normalizeNagerHoliday
};
