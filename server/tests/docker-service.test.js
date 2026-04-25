const test = require('node:test');
const assert = require('node:assert/strict');

const { parseDockerJsonLines } = require('../services/dockerService');

test('parseDockerJsonLines handles newline-delimited docker --format json output', () => {
  const output = [
    '{"ID":"a1","Names":"api"}',
    '{"ID":"b2","Names":"worker"}'
  ].join('\n');

  const rows = parseDockerJsonLines(output);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].ID, 'a1');
  assert.equal(rows[1].Names, 'worker');
});

test('parseDockerJsonLines handles docker compose array JSON output', () => {
  const output = JSON.stringify([
    { Name: 'stack-a', Status: 'running(2)' },
    { Name: 'stack-b', Status: 'exited(1)' }
  ]);

  const rows = parseDockerJsonLines(output);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].Name, 'stack-a');
  assert.equal(rows[1].Status, 'exited(1)');
});

