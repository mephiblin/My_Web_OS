const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

function toFileUrl(relativePath) {
  return pathToFileURL(path.resolve(__dirname, '..', '..', relativePath)).href;
}

test('transfer status normalization maps legacy/error states to canonical UI status', async () => {
  const moduleUrl = toFileUrl('client/src/apps/system/transfer/normalization.js');
  const transferNormalization = await import(moduleUrl);
  const { normalizeTransferJobStatus } = transferNormalization;

  assert.equal(normalizeTransferJobStatus('error'), 'failed');
  assert.equal(normalizeTransferJobStatus('ERROR'), 'failed');
  assert.equal(normalizeTransferJobStatus('success'), 'completed');
  assert.equal(normalizeTransferJobStatus('active'), 'running');
  assert.equal(normalizeTransferJobStatus('cancelled'), 'canceled');
  assert.equal(normalizeTransferJobStatus('queued'), 'queued');
  assert.equal(normalizeTransferJobStatus(''), 'unknown');
});

test('sandbox message clone helper falls back safely for non-cloneable payloads', async () => {
  const moduleUrl = toFileUrl('client/src/utils/messagePayload.js');
  const messagePayload = await import(moduleUrl);
  const { cloneMessagePayload } = messagePayload;

  const source = { message: 'ok', nested: { count: 1 } };
  const cloned = cloneMessagePayload(source, null);
  assert.deepEqual(cloned, source);
  assert.notEqual(cloned, source);

  const nonCloneable = { action: 'invoke', fn: () => 'blocked' };
  const fallback = { safe: true };
  const safe = cloneMessagePayload(nonCloneable, fallback);
  assert.equal(safe?.action, 'invoke');
  assert.equal(Object.prototype.hasOwnProperty.call(safe, 'fn'), false);

  const circular = {};
  circular.self = circular;
  const circularFallback = { circular: false };
  const safeCircular = cloneMessagePayload(circular, circularFallback);
  if (typeof structuredClone === 'function') {
    assert.ok(safeCircular && typeof safeCircular === 'object');
    assert.equal(safeCircular.self, safeCircular);
  } else {
    assert.deepEqual(safeCircular, circularFallback);
  }
});
