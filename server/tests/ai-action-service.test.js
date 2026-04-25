const test = require('node:test');
const assert = require('node:assert/strict');

const { buildReply } = require('../services/aiActionService');

test('buildReply returns docker result card with raw output and action', () => {
  const result = buildReply({
    message: 'docker status 알려줘',
    desktopApps: [],
    runtimeSummary: { total: 2, running: 1, error: 0 },
    docker: { ok: true, count: 3, raw: 'id1\tUp\tapi' },
    recentErrors: []
  });

  assert.equal(typeof result.reply, 'string');
  assert.equal(result.resultCard.title, 'Docker Status');
  assert.equal(result.resultCard.rawOutput, 'id1\tUp\tapi');
  assert.equal(result.resultCard.actions.some((item) => item.type === 'inspect_docker_status'), true);
});

test('buildReply creates default quick actions when no explicit intent', () => {
  const result = buildReply({
    message: '뭐부터 하면 좋을까?',
    desktopApps: [],
    runtimeSummary: { total: 0, running: 0, error: 0 },
    docker: { ok: false, count: 0, error: 'x', raw: '' },
    recentErrors: []
  });

  assert.equal(result.resultCard.title, 'Suggested Next Actions');
  assert.equal(result.resultCard.actions.length >= 2, true);
});

test('buildReply includes logs open action for error-log intent', () => {
  const result = buildReply({
    message: '최근 에러 로그 보여줘',
    desktopApps: [],
    runtimeSummary: { total: 1, running: 1, error: 0 },
    docker: null,
    recentErrors: [{ timestamp: new Date().toISOString(), action: 'sample' }]
  });

  assert.equal(result.resultCard.actions.some((item) => item.type === 'open_system_app' && item.payload?.appId === 'logs'), true);
  assert.equal(result.resultCard.actions.some((item) => item.type === 'summarize_recent_error_logs'), true);
  assert.equal(result.resultCard.actions.some((item) => item.type === 'open_audit'), true);
  const auditAction = result.resultCard.actions.find((item) => item.type === 'open_audit');
  assert.equal(auditAction?.payload?.focus, 'audit');
  assert.equal(typeof auditAction?.payload?.search, 'string');
});

test('buildReply includes package center action for package intent', () => {
  const result = buildReply({
    message: '패키지 업데이트 점검해줘',
    desktopApps: [],
    runtimeSummary: { total: 0, running: 0, error: 0 },
    docker: null,
    recentErrors: []
  });

  assert.equal(result.resultCard.actions.some((item) => item.type === 'open_system_app' && item.payload?.appId === 'package-center'), true);
  assert.equal(result.resultCard.actions.some((item) => item.type === 'open_audit'), true);
});
