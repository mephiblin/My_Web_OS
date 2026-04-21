const test = require('node:test');
const assert = require('node:assert/strict');

const packageLifecycleService = require('../services/packageLifecycleService');

test('matchesVersionRange supports caret ranges', () => {
  assert.equal(packageLifecycleService.matchesVersionRange('1.2.5', '^1.2.0'), true);
  assert.equal(packageLifecycleService.matchesVersionRange('2.0.0', '^1.2.0'), false);
  assert.equal(packageLifecycleService.matchesVersionRange('0.3.4', '^0.3.1'), true);
  assert.equal(packageLifecycleService.matchesVersionRange('0.4.0', '^0.3.1'), false);
});

test('matchesVersionRange supports tilde ranges', () => {
  assert.equal(packageLifecycleService.matchesVersionRange('1.2.9', '~1.2.3'), true);
  assert.equal(packageLifecycleService.matchesVersionRange('1.3.0', '~1.2.3'), false);
});

test('matchesVersionRange supports comparator groups and OR', () => {
  assert.equal(packageLifecycleService.matchesVersionRange('1.5.0', '>=1.2.0 <2.0.0'), true);
  assert.equal(packageLifecycleService.matchesVersionRange('2.1.0', '>=1.2.0 <2.0.0'), false);
  assert.equal(packageLifecycleService.matchesVersionRange('2.1.0', '<1.0.0 || >=2.0.0'), true);
});

test('matchesVersionRange handles partial and prerelease semantics', () => {
  assert.equal(packageLifecycleService.matchesVersionRange('1.2.5', '1.2'), true);
  assert.equal(packageLifecycleService.matchesVersionRange('1.3.0', '1.2'), false);
  assert.equal(packageLifecycleService.matchesVersionRange('1.2.0-beta.1', '^1.2.0'), false);
  assert.equal(packageLifecycleService.matchesVersionRange('1.2.0-beta.2', '>=1.2.0-beta.1 <1.2.0'), true);
});
