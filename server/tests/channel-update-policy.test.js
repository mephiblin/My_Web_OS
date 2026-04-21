const test = require('node:test');
const assert = require('node:assert/strict');

const channelUpdatePolicyService = require('../services/channelUpdatePolicyService');

test('blocks candidate when target channel is more stable', () => {
  const result = channelUpdatePolicyService.evaluateCandidate({
    installedVersion: '1.0.0',
    candidateVersion: '1.1.0',
    targetChannel: 'stable',
    candidateChannel: 'beta',
    publishedAt: '2026-04-01T00:00:00.000Z',
    now: new Date('2026-04-21T00:00:00.000Z')
  });

  assert.equal(result.allowed, false);
  assert.equal(result.blockedReason, 'channel-policy-blocked');
});

test('blocks candidate when rollout delay is active', () => {
  const result = channelUpdatePolicyService.evaluateCandidate({
    installedVersion: '1.0.0',
    candidateVersion: '1.1.0',
    targetChannel: 'stable',
    candidateChannel: 'stable',
    publishedAt: '2026-04-21T10:00:00.000Z',
    now: new Date('2026-04-21T12:00:00.000Z')
  });

  assert.equal(result.allowed, false);
  assert.equal(result.blockedReason, 'rollout-delay-active');
});

test('selects latest allowed update', () => {
  const summary = channelUpdatePolicyService.selectBestUpdate({
    installedVersion: '1.0.0',
    targetChannel: 'beta',
    now: new Date('2026-04-21T12:00:00.000Z'),
    candidates: [
      { id: 'demo', version: '1.1.0', channel: 'stable', publishedAt: '2026-04-19T00:00:00.000Z' },
      { id: 'demo', version: '1.2.0', channel: 'beta', publishedAt: '2026-04-20T00:00:00.000Z' },
      { id: 'demo', version: '1.3.0', channel: 'alpha', publishedAt: '2026-04-10T00:00:00.000Z' }
    ]
  });

  assert.equal(summary.hasUpdate, true);
  assert.equal(summary.selected.version, '1.2.0');
  assert.equal(summary.selected.policy.allowed, true);
});
