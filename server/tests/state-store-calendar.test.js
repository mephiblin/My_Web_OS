const test = require('node:test');
const assert = require('node:assert/strict');

const stateStore = require('../services/stateStore');

test('stateStore supports calendar key with normalized events', () => {
  const normalized = stateStore.validateState('calendar', {
    events: [
      {
        id: 'event-1',
        title: 'Deploy',
        startAt: '2026-04-28T10:00:00.000Z',
        endAt: '2026-04-28T11:00:00.000Z',
        allDay: false,
        color: '#34d399',
        note: 'Check logs',
        createdAt: 1714000000000,
        updatedAt: 1714000005000
      },
      {
        id: 'event-2',
        title: '',
        startAt: '',
        color: '#000000'
      }
    ],
    lastUpdatedAt: 1714000010000
  });

  assert.equal(Array.isArray(normalized.events), true);
  assert.equal(normalized.events.length, 1);
  assert.equal(normalized.events[0].id, 'event-1');
  assert.equal(normalized.events[0].title, 'Deploy');
  assert.equal(normalized.events[0].source, 'local');
  assert.equal(normalized.events[0].sourceType, 'local');
  assert.equal(normalized.events[0].readOnly, false);
  assert.equal(normalized.lastUpdatedAt, 1714000010000);
});

test('stateStore calendar default is stable', () => {
  const fallback = stateStore.validateState('calendar', null);
  assert.deepEqual(fallback.events, []);
  assert.equal(fallback.lastUpdatedAt, null);
  assert.equal(fallback.sources.some((source) => source.id === 'local'), true);
  assert.equal(fallback.sources.some((source) => source.id === 'holidays-kr'), true);
});

test('stateStore supports calendar source registry with sanitized configs', () => {
  const normalized = stateStore.validateState('calendar', {
    sources: [
      {
        id: 'holidays-us',
        title: 'US Holidays',
        type: 'holiday',
        enabled: true,
        color: '#ff0000',
        config: {
          countryCode: 'us',
          provider: 'nager',
          secret: 'must-not-survive'
        }
      },
      {
        id: 'nextcloud',
        title: 'Nextcloud',
        type: 'caldav',
        config: {
          serverUrl: 'https://cloud.example/remote.php/dav',
          username: 'me',
          password: 'must-not-survive',
          syncDirection: 'twoWay'
        }
      }
    ]
  });

  const holiday = normalized.sources.find((source) => source.id === 'holidays-us');
  const caldav = normalized.sources.find((source) => source.id === 'nextcloud');
  assert.equal(holiday.config.countryCode, 'US');
  assert.equal(holiday.config.secret, undefined);
  assert.equal(holiday.readOnly, true);
  assert.equal(caldav.config.password, undefined);
  assert.equal(caldav.config.syncDirection, 'twoWay');
  assert.equal(caldav.readOnly, true);
});
