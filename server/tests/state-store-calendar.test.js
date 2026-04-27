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
  assert.equal(normalized.lastUpdatedAt, 1714000010000);
});

test('stateStore calendar default is stable', () => {
  const fallback = stateStore.validateState('calendar', null);
  assert.deepEqual(fallback, {
    events: [],
    lastUpdatedAt: null
  });
});
