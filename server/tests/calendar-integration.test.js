const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('fs-extra');
const jwt = require('jsonwebtoken');
const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'calendar-integration-secret';

const systemRouter = require('../routes/system');
const stateStore = require('../services/stateStore');
const inventoryPaths = require('../utils/inventoryPaths');
const calendarHolidayService = require('../services/calendarHolidayService');
const nativeFetch = global.fetch.bind(global);

function signToken(username = 'calendar-owner') {
  return jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/system', systemRouter);

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  };
}

async function requestJson(baseUrl, endpoint, token, options = {}) {
  const response = await nativeFetch(`${baseUrl}${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_err) {
    json = { parseError: true, raw: text };
  }
  return { status: response.status, json };
}

async function withCalendarStorageReset(fn) {
  const roots = await inventoryPaths.ensureInventoryStructure();
  const calendarFile = await inventoryPaths.getStateFile('calendar');
  const holidaysFile = path.join(roots.systemDir, 'calendar-holidays.json');
  const previousCalendar = await fs.pathExists(calendarFile) ? await fs.readFile(calendarFile) : null;
  const previousHolidays = await fs.pathExists(holidaysFile) ? await fs.readFile(holidaysFile) : null;
  const previousFetch = global.fetch;

  try {
    await fs.remove(calendarFile);
    await fs.remove(holidaysFile);
    await stateStore.writeState('calendar', {
      events: [],
      sources: [
        { id: 'local', title: 'Local Calendar', type: 'local', enabled: true, readOnly: false, color: '#58a6ff', config: {} },
        { id: 'holidays-kr', title: 'KR Public Holidays', type: 'holiday', enabled: true, readOnly: true, color: '#ef4444', config: { countryCode: 'KR', provider: 'nager' } }
      ],
      lastUpdatedAt: null
    });
    await fn();
  } finally {
    global.fetch = previousFetch;
    if (previousCalendar) {
      await fs.writeFile(calendarFile, previousCalendar);
    } else {
      await fs.remove(calendarFile);
    }
    if (previousHolidays) {
      await fs.writeFile(holidaysFile, previousHolidays);
    } else {
      await fs.remove(holidaysFile);
    }
  }
}

test('holiday provider normalizes Nager.Date rows into read-only calendar events', () => {
  const event = calendarHolidayService.normalizeNagerHoliday(
    { date: '2026-01-01', localName: 'New Year', name: "New Year's Day" },
    { sourceId: 'holidays-kr', provider: 'nager', countryCode: 'KR', color: '#ef4444', fetchedAt: 1777000000000 }
  );

  assert.equal(event.title, 'New Year');
  assert.equal(event.startAt, '2026-01-01T00:00:00.000Z');
  assert.equal(event.allDay, true);
  assert.equal(event.readOnly, true);
  assert.equal(event.source, 'holidays-kr');
  assert.equal(event.sourceType, 'holiday');
});

test('calendar month merges local events and holiday provider events with source filtering', async () => {
  await withCalendarStorageReset(async () => {
    let fetchCount = 0;
    global.fetch = async () => {
      fetchCount += 1;
      return {
        ok: true,
        status: 200,
        async json() {
          return [
            { date: '2026-04-05', localName: 'Holiday Probe', name: 'Holiday Probe' }
          ];
        }
      };
    };

    const server = await createServer();
    const token = signToken();
    try {
      const created = await requestJson(server.baseUrl, '/api/system/calendar/events', token, {
        method: 'POST',
        body: {
          title: 'Local Probe',
          startAt: '2026-04-28T10:00:00.000Z'
        }
      });
      assert.equal(created.status, 201, JSON.stringify(created.json));

      const merged = await requestJson(server.baseUrl, '/api/system/calendar/month?year=2026&month=4', token);
      assert.equal(merged.status, 200, JSON.stringify(merged.json));
      assert.equal(merged.json.total, 2, JSON.stringify(merged.json));
      assert.equal(merged.json.data.some((item) => item.source === 'local'), true);
      assert.equal(merged.json.data.some((item) => item.sourceType === 'holiday' && item.readOnly === true), true);
      assert.equal(fetchCount, 1);

      const localOnly = await requestJson(server.baseUrl, '/api/system/calendar/month?year=2026&month=4&sources=local', token);
      assert.equal(localOnly.status, 200, JSON.stringify(localOnly.json));
      assert.equal(localOnly.json.total, 1, JSON.stringify(localOnly.json));
      assert.equal(localOnly.json.data[0].source, 'local');
    } finally {
      await server.close();
    }
  });
});

test('calendar source registry stores sanitized non-secret provider settings', async () => {
  await withCalendarStorageReset(async () => {
    const server = await createServer();
    const token = signToken();
    try {
      const created = await requestJson(server.baseUrl, '/api/system/calendar/sources', token, {
        method: 'POST',
        body: {
          id: 'nextcloud',
          title: 'Nextcloud',
          type: 'caldav',
          config: {
            serverUrl: 'https://cloud.example/remote.php/dav',
            username: 'me',
            password: 'must-not-survive'
          }
        }
      });
      assert.equal(created.status, 201, JSON.stringify(created.json));
      assert.equal(created.json.data.config.password, undefined);
      assert.equal(created.json.data.readOnly, true);

      const listed = await requestJson(server.baseUrl, '/api/system/calendar/sources', token);
      assert.equal(listed.status, 200, JSON.stringify(listed.json));
      assert.equal(listed.json.data.some((source) => source.id === 'nextcloud'), true);
    } finally {
      await server.close();
    }
  });
});

test('read-only stored calendar events cannot be updated or deleted', async () => {
  await withCalendarStorageReset(async () => {
    await stateStore.writeState('calendar', {
      events: [
        {
          id: 'holiday-event',
          title: 'Read Only Holiday',
          startAt: '2026-04-05T00:00:00.000Z',
          allDay: true,
          source: 'holidays-kr',
          sourceType: 'holiday',
          readOnly: true,
          color: '#ef4444'
        }
      ],
      sources: [
        { id: 'local', title: 'Local Calendar', type: 'local', enabled: true, readOnly: false, color: '#58a6ff', config: {} },
        { id: 'holidays-kr', title: 'KR Public Holidays', type: 'holiday', enabled: true, readOnly: true, color: '#ef4444', config: { countryCode: 'KR', provider: 'nager' } }
      ]
    });

    const server = await createServer();
    const token = signToken();
    try {
      const updated = await requestJson(server.baseUrl, '/api/system/calendar/events/holiday-event', token, {
        method: 'PUT',
        body: { title: 'Changed' }
      });
      assert.equal(updated.status, 409, JSON.stringify(updated.json));
      assert.equal(updated.json.code, 'CALENDAR_EVENT_READ_ONLY');

      const removed = await requestJson(server.baseUrl, '/api/system/calendar/events/holiday-event', token, {
        method: 'DELETE'
      });
      assert.equal(removed.status, 409, JSON.stringify(removed.json));
      assert.equal(removed.json.code, 'CALENDAR_EVENT_READ_ONLY');
    } finally {
      await server.close();
    }
  });
});

test('Google Calendar all-day event normalization uses inclusive end date', () => {
  const calendarGoogleService = require('../services/calendarGoogleService');
  const event = calendarGoogleService.normalizeGoogleEvent(
    {
      id: 'all-day-google',
      summary: 'All Day Google Event',
      start: { date: '2026-04-29' },
      end: { date: '2026-04-30' },
      updated: '2026-04-20T00:00:00.000Z'
    },
    {
      id: 'google-primary',
      type: 'google',
      color: '#4285f4',
      config: { calendarId: 'primary' }
    }
  );

  assert.equal(event.allDay, true);
  assert.equal(event.startAt, '2026-04-29T00:00:00.000Z');
  assert.equal(event.endAt, '2026-04-29T00:00:00.000Z');
  assert.equal(event.readOnly, true);
});

test('Google Calendar OAuth start returns a signed authorization URL without exposing secrets', async () => {
  await withCalendarStorageReset(async () => {
    const roots = await inventoryPaths.ensureInventoryStructure();
    const secretsFile = path.join(roots.systemDir, 'calendar-google-secrets.json');
    const previousSecrets = await fs.pathExists(secretsFile) ? await fs.readFile(secretsFile) : null;
    try {
      await fs.writeJson(secretsFile, {
        oauthClient: {
          clientId: 'google-client-id',
          clientSecret: 'google-client-secret',
          redirectUri: 'http://127.0.0.1:3000/api/system/calendar/google/auth/callback'
        },
        tokensBySourceId: {}
      });
      const server = await createServer();
      const token = signToken();
      try {
        const started = await requestJson(server.baseUrl, '/api/system/calendar/google/auth/start?sourceId=google-primary&format=json', token);
        assert.equal(started.status, 200, JSON.stringify(started.json));
        const authUrl = new URL(started.json.data.url);
        assert.equal(authUrl.hostname, 'accounts.google.com');
        assert.equal(authUrl.searchParams.get('client_id'), 'google-client-id');
        assert.equal(authUrl.searchParams.get('scope'), 'https://www.googleapis.com/auth/calendar.events.readonly');
        assert.ok(authUrl.searchParams.get('state'));
        assert.doesNotMatch(JSON.stringify(started.json), /google-client-secret|accessToken|refreshToken/);
      } finally {
        await server.close();
      }
    } finally {
      if (previousSecrets) await fs.writeFile(secretsFile, previousSecrets);
      else await fs.remove(secretsFile);
    }
  });
});

test('Google Calendar OAuth callback stores tokens and config response stays redacted', async () => {
  await withCalendarStorageReset(async () => {
    const roots = await inventoryPaths.ensureInventoryStructure();
    const secretsFile = path.join(roots.systemDir, 'calendar-google-secrets.json');
    const previousSecrets = await fs.pathExists(secretsFile) ? await fs.readFile(secretsFile) : null;
    const previousFetch = global.fetch;
    try {
      await fs.writeJson(secretsFile, {
        oauthClient: {
          clientId: 'google-client-id',
          clientSecret: 'google-client-secret',
          redirectUri: 'http://127.0.0.1:3000/api/system/calendar/google/auth/callback'
        },
        tokensBySourceId: {}
      });
      global.fetch = async () => ({
        ok: true,
        status: 200,
        async json() {
          return {
            access_token: 'access-token-secret',
            refresh_token: 'refresh-token-secret',
            expires_in: 3600,
            scope: 'https://www.googleapis.com/auth/calendar.events.readonly',
            token_type: 'Bearer'
          };
        }
      });
      const calendarGoogleService = require('../services/calendarGoogleService');
      const start = await calendarGoogleService.buildAuthStart('google-primary');
      const state = new URL(start.url).searchParams.get('state');
      const server = await createServer();
      const token = signToken();
      try {
        const callbackResponse = await nativeFetch(`${server.baseUrl}/api/system/calendar/google/auth/callback?code=oauth-code-secret&state=${encodeURIComponent(state)}`);
        assert.equal(callbackResponse.status, 200);
        const replayResponse = await nativeFetch(`${server.baseUrl}/api/system/calendar/google/auth/callback?code=oauth-code-secret&state=${encodeURIComponent(state)}`);
        assert.equal(replayResponse.status, 400);
        const config = await requestJson(server.baseUrl, '/api/system/calendar/google/config?sourceId=google-primary', token);
        assert.equal(config.status, 200, JSON.stringify(config.json));
        assert.equal(config.json.data.connected, true);
        assert.equal(config.json.data.configured, true);
        assert.doesNotMatch(JSON.stringify(config.json), /access-token-secret|refresh-token-secret|google-client-secret|oauth-code-secret/);
        const secretsMode = (await fs.stat(secretsFile)).mode & 0o777;
        assert.equal(secretsMode, 0o600);
      } finally {
        await server.close();
      }
    } finally {
      global.fetch = previousFetch;
      if (previousSecrets) await fs.writeFile(secretsFile, previousSecrets);
      else await fs.remove(secretsFile);
    }
  });
});

test('Google Calendar sync refreshes expired access tokens without losing refresh token', async () => {
  await withCalendarStorageReset(async () => {
    const roots = await inventoryPaths.ensureInventoryStructure();
    const secretsFile = path.join(roots.systemDir, 'calendar-google-secrets.json');
    const syncFile = path.join(roots.systemDir, 'calendar-sync-state.json');
    const previousSecrets = await fs.pathExists(secretsFile) ? await fs.readFile(secretsFile) : null;
    const previousSync = await fs.pathExists(syncFile) ? await fs.readFile(syncFile) : null;
    const previousFetch = global.fetch;
    try {
      await fs.writeJson(secretsFile, {
        oauthClient: {
          clientId: 'google-client-id',
          clientSecret: 'google-client-secret',
          redirectUri: 'http://127.0.0.1:3000/api/system/calendar/google/auth/callback'
        },
        tokensBySourceId: {
          'google-primary': {
            accessToken: 'expired-access-token',
            refreshToken: 'refresh-token-secret',
            expiryDate: Date.now() - 1000,
            scope: 'https://www.googleapis.com/auth/calendar.events.readonly',
            tokenType: 'Bearer'
          }
        }
      });
      await fs.remove(syncFile);
      const calls = [];
      global.fetch = async (url) => {
        calls.push(String(url));
        if (String(url).includes('oauth2.googleapis.com/token')) {
          return {
            ok: true,
            status: 200,
            async json() {
              return {
                access_token: 'fresh-access-token',
                expires_in: 3600,
                scope: 'https://www.googleapis.com/auth/calendar.events.readonly',
                token_type: 'Bearer'
              };
            }
          };
        }
        return {
          ok: true,
          status: 200,
          async json() {
            return { items: [], nextSyncToken: 'after-refresh-sync-token' };
          }
        };
      };
      await stateStore.writeState('calendar', {
        events: [],
        sources: [
          { id: 'local', title: 'Local Calendar', type: 'local', enabled: true, readOnly: false, color: '#58a6ff', config: {} },
          { id: 'google-primary', title: 'Google Calendar', type: 'google', enabled: true, readOnly: true, color: '#4285f4', config: { calendarId: 'primary', syncEnabled: true, syncDirection: 'readOnly' } }
        ]
      });
      const server = await createServer();
      const token = signToken();
      try {
        const synced = await requestJson(server.baseUrl, '/api/system/calendar/google/sync', token, {
          method: 'POST',
          body: { sourceId: 'google-primary' }
        });
        assert.equal(synced.status, 200, JSON.stringify(synced.json));
        assert.equal(calls.some((url) => url.includes('oauth2.googleapis.com/token')), true);
        assert.equal(calls.some((url) => url.includes('googleapis.com/calendar/v3/calendars/primary/events')), true);
        const secrets = await fs.readJson(secretsFile);
        assert.equal(secrets.tokensBySourceId['google-primary'].accessToken, 'fresh-access-token');
        assert.equal(secrets.tokensBySourceId['google-primary'].refreshToken, 'refresh-token-secret');
      } finally {
        await server.close();
      }
    } finally {
      global.fetch = previousFetch;
      if (previousSecrets) await fs.writeFile(secretsFile, previousSecrets);
      else await fs.remove(secretsFile);
      if (previousSync) await fs.writeFile(syncFile, previousSync);
      else await fs.remove(syncFile);
    }
  });
});

test('Google Calendar sync stores read-only events and month API merges them', async () => {
  await withCalendarStorageReset(async () => {
    const roots = await inventoryPaths.ensureInventoryStructure();
    const secretsFile = path.join(roots.systemDir, 'calendar-google-secrets.json');
    const syncFile = path.join(roots.systemDir, 'calendar-sync-state.json');
    const previousSecrets = await fs.pathExists(secretsFile) ? await fs.readFile(secretsFile) : null;
    const previousSync = await fs.pathExists(syncFile) ? await fs.readFile(syncFile) : null;
    const previousFetch = global.fetch;
    try {
      await fs.writeJson(secretsFile, {
        oauthClient: {
          clientId: 'google-client-id',
          clientSecret: 'google-client-secret',
          redirectUri: 'http://127.0.0.1:3000/api/system/calendar/google/auth/callback'
        },
        tokensBySourceId: {
          'google-primary': {
            accessToken: 'access-token-secret',
            refreshToken: 'refresh-token-secret',
            expiryDate: Date.now() + 3600000,
            scope: 'https://www.googleapis.com/auth/calendar.events.readonly',
            tokenType: 'Bearer'
          }
        }
      });
      await fs.remove(syncFile);
      global.fetch = async (url) => {
        assert.match(String(url), /googleapis\.com\/calendar\/v3\/calendars\/primary\/events/);
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              items: [
                {
                  id: 'google-event-1',
                  summary: 'Google Read Only Probe',
                  start: { dateTime: '2026-04-28T11:00:00+09:00' },
                  end: { dateTime: '2026-04-28T12:00:00+09:00' },
                  updated: '2026-04-20T00:00:00.000Z'
                }
              ],
              nextSyncToken: 'next-sync-token-secret'
            };
          }
        };
      };
      await stateStore.writeState('calendar', {
        events: [],
        sources: [
          { id: 'local', title: 'Local Calendar', type: 'local', enabled: true, readOnly: false, color: '#58a6ff', config: {} },
          { id: 'google-primary', title: 'Google Calendar', type: 'google', enabled: true, readOnly: true, color: '#4285f4', config: { calendarId: 'primary', syncEnabled: true, syncDirection: 'readOnly' } }
        ],
        lastUpdatedAt: null
      });
      const server = await createServer();
      const token = signToken();
      try {
        const synced = await requestJson(server.baseUrl, '/api/system/calendar/google/sync', token, {
          method: 'POST',
          body: { sourceId: 'google-primary' }
        });
        assert.equal(synced.status, 200, JSON.stringify(synced.json));
        assert.equal(synced.json.total, 1);

        const month = await requestJson(server.baseUrl, '/api/system/calendar/month?year=2026&month=4&sources=google', token);
        assert.equal(month.status, 200, JSON.stringify(month.json));
        assert.equal(month.json.total, 1, JSON.stringify(month.json));
        assert.equal(month.json.data[0].sourceType, 'google');
        assert.equal(month.json.data[0].readOnly, true);
        assert.equal(month.json.data[0].provider, 'google');

        const updated = await requestJson(server.baseUrl, `/api/system/calendar/events/${encodeURIComponent(month.json.data[0].id)}`, token, {
          method: 'PUT',
          body: { title: 'Changed' }
        });
        assert.equal(updated.status, 409, JSON.stringify(updated.json));
        assert.equal(updated.json.code, 'CALENDAR_EVENT_READ_ONLY');
      } finally {
        await server.close();
      }
    } finally {
      global.fetch = previousFetch;
      if (previousSecrets) await fs.writeFile(secretsFile, previousSecrets);
      else await fs.remove(secretsFile);
      if (previousSync) await fs.writeFile(syncFile, previousSync);
      else await fs.remove(syncFile);
    }
  });
});

test('Google Calendar expired sync token falls back to full sync', async () => {
  await withCalendarStorageReset(async () => {
    const roots = await inventoryPaths.ensureInventoryStructure();
    const secretsFile = path.join(roots.systemDir, 'calendar-google-secrets.json');
    const syncFile = path.join(roots.systemDir, 'calendar-sync-state.json');
    const previousSecrets = await fs.pathExists(secretsFile) ? await fs.readFile(secretsFile) : null;
    const previousSync = await fs.pathExists(syncFile) ? await fs.readFile(syncFile) : null;
    const previousFetch = global.fetch;
    try {
      await fs.writeJson(secretsFile, {
        oauthClient: { clientId: 'id', clientSecret: 'secret', redirectUri: 'http://127.0.0.1/callback' },
        tokensBySourceId: {
          'google-primary': {
            accessToken: 'access-token-secret',
            refreshToken: 'refresh-token-secret',
            expiryDate: Date.now() + 3600000,
            scope: 'https://www.googleapis.com/auth/calendar.events.readonly',
            tokenType: 'Bearer'
          }
        }
      });
      await fs.writeJson(syncFile, { google: { 'google-primary': { syncToken: 'expired-token', lastSyncedAt: null, lastError: null, backoffUntil: null } } });
      let callCount = 0;
      global.fetch = async (url) => {
        callCount += 1;
        if (String(url).includes('syncToken=expired-token')) {
          return { ok: false, status: 410, async json() { return { error: { message: 'Gone' } }; } };
        }
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              items: [
                { id: 'full-sync-event', summary: 'Recovered Event', start: { date: '2026-04-29' }, end: { date: '2026-04-30' } }
              ],
              nextSyncToken: 'fresh-sync-token'
            };
          }
        };
      };
      await stateStore.writeState('calendar', {
        events: [{ id: 'google:google-primary:old', title: 'Old', startAt: '2026-04-01T00:00:00.000Z', source: 'google-primary', sourceType: 'google', readOnly: true, externalId: 'old' }],
        sources: [
          { id: 'local', title: 'Local Calendar', type: 'local', enabled: true, readOnly: false, color: '#58a6ff', config: {} },
          { id: 'google-primary', title: 'Google Calendar', type: 'google', enabled: true, readOnly: true, color: '#4285f4', config: { calendarId: 'primary', syncEnabled: true, syncDirection: 'readOnly' } }
        ]
      });
      const server = await createServer();
      const token = signToken();
      try {
        const synced = await requestJson(server.baseUrl, '/api/system/calendar/sources/google-primary/sync', token, { method: 'POST', body: {} });
        assert.equal(synced.status, 200, JSON.stringify(synced.json));
        assert.equal(synced.json.fullSync, true);
        assert.equal(callCount, 2);
        const month = await requestJson(server.baseUrl, '/api/system/calendar/month?year=2026&month=4&sources=google-primary', token);
        assert.equal(month.status, 200, JSON.stringify(month.json));
        assert.equal(month.json.total, 1);
        assert.equal(month.json.data[0].externalId, 'full-sync-event');
      } finally {
        await server.close();
      }
    } finally {
      global.fetch = previousFetch;
      if (previousSecrets) await fs.writeFile(secretsFile, previousSecrets);
      else await fs.remove(secretsFile);
      if (previousSync) await fs.writeFile(syncFile, previousSync);
      else await fs.remove(syncFile);
    }
  });
});

test('Google Calendar rate limit stores retry state without leaking tokens', async () => {
  await withCalendarStorageReset(async () => {
    const roots = await inventoryPaths.ensureInventoryStructure();
    const secretsFile = path.join(roots.systemDir, 'calendar-google-secrets.json');
    const syncFile = path.join(roots.systemDir, 'calendar-sync-state.json');
    const previousSecrets = await fs.pathExists(secretsFile) ? await fs.readFile(secretsFile) : null;
    const previousSync = await fs.pathExists(syncFile) ? await fs.readFile(syncFile) : null;
    const previousFetch = global.fetch;
    try {
      await fs.writeJson(secretsFile, {
        oauthClient: { clientId: 'id', clientSecret: 'secret', redirectUri: 'http://127.0.0.1/callback' },
        tokensBySourceId: {
          'google-primary': {
            accessToken: 'access-token-secret',
            refreshToken: 'refresh-token-secret',
            expiryDate: Date.now() + 3600000,
            scope: 'https://www.googleapis.com/auth/calendar.events.readonly',
            tokenType: 'Bearer'
          }
        }
      });
      await fs.remove(syncFile);
      let fetchCount = 0;
      global.fetch = async () => {
        fetchCount += 1;
        return { ok: false, status: 429, async json() { return { error: { message: 'rate limited' } }; } };
      };
      await stateStore.writeState('calendar', {
        events: [],
        sources: [
          { id: 'local', title: 'Local Calendar', type: 'local', enabled: true, readOnly: false, color: '#58a6ff', config: {} },
          { id: 'google-primary', title: 'Google Calendar', type: 'google', enabled: true, readOnly: true, color: '#4285f4', config: { calendarId: 'primary', syncEnabled: true, syncDirection: 'readOnly' } }
        ]
      });
      const server = await createServer();
      const token = signToken();
      try {
        const synced = await requestJson(server.baseUrl, '/api/system/calendar/google/sync', token, {
          method: 'POST',
          body: { sourceId: 'google-primary' }
        });
        assert.equal(synced.status, 429, JSON.stringify(synced.json));
        assert.equal(synced.json.code, 'CALENDAR_GOOGLE_RATE_LIMITED');
        assert.doesNotMatch(JSON.stringify(synced.json), /access-token-secret|refresh-token-secret/);
        const syncState = await fs.readJson(syncFile);
        assert.equal(syncState.google['google-primary'].lastError.code, 'CALENDAR_GOOGLE_RATE_LIMITED');
        assert.ok(syncState.google['google-primary'].backoffUntil);
        const syncMode = (await fs.stat(syncFile)).mode & 0o777;
        assert.equal(syncMode, 0o600);
        const blocked = await requestJson(server.baseUrl, '/api/system/calendar/google/sync', token, {
          method: 'POST',
          body: { sourceId: 'google-primary' }
        });
        assert.equal(blocked.status, 429, JSON.stringify(blocked.json));
        assert.equal(blocked.json.code, 'CALENDAR_GOOGLE_BACKOFF_ACTIVE');
        assert.equal(fetchCount, 1);
      } finally {
        await server.close();
      }
    } finally {
      global.fetch = previousFetch;
      if (previousSecrets) await fs.writeFile(secretsFile, previousSecrets);
      else await fs.remove(secretsFile);
      if (previousSync) await fs.writeFile(syncFile, previousSync);
      else await fs.remove(syncFile);
    }
  });
});
