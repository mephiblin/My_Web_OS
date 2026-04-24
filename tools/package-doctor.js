#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeRuntimeProfile } = require('../server/services/runtimeProfiles');

const SUPPORTED_RUNTIME_TYPES = new Set(['sandbox-html', 'process-node', 'process-python', 'binary']);
const SUPPORTED_APP_TYPES = new Set(['app', 'widget', 'service', 'hybrid', 'developer']);
const KNOWN_PERMISSIONS = new Set([
  'app.data.list',
  'app.data.read',
  'app.data.write',
  'ui.notification',
  'window.open',
  'system.info'
]);

function readArgs(argv) {
  const args = {
    manifest: '',
    json: false,
    help: false
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim();
    if (!token) continue;
    if (token === '--json') {
      args.json = true;
      continue;
    }
    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }
    if (token.startsWith('--manifest=')) {
      args.manifest = token.slice('--manifest='.length);
      continue;
    }
    if (!args.manifest) {
      args.manifest = token;
    }
  }

  return args;
}

function makeResult(status, id, message, detail = '') {
  return { status, id, message, detail };
}

function runChecks(manifest) {
  const checks = [];

  const id = String(manifest?.id || '').trim();
  const title = String(manifest?.title || '').trim();
  const appType = String(manifest?.type || '').trim();
  const runtimeProfile = normalizeRuntimeProfile(manifest);
  const runtimeType = String(runtimeProfile?.runtimeType || '').trim();
  const entry = String(runtimeProfile?.entry || manifest?.entry || '').trim();
  const permissions = Array.isArray(manifest?.permissions) ? manifest.permissions.map(String) : [];

  checks.push(
    id
      ? makeResult('pass', 'manifest.id', 'Package id exists.', id)
      : makeResult('fail', 'manifest.id', 'Package id is required.')
  );

  checks.push(
    title
      ? makeResult('pass', 'manifest.title', 'Package title exists.', title)
      : makeResult('fail', 'manifest.title', 'Package title is required.')
  );

  checks.push(
    SUPPORTED_APP_TYPES.has(appType)
      ? makeResult('pass', 'manifest.type', 'App type is supported.', appType)
      : makeResult('fail', 'manifest.type', 'App type is invalid.', appType || '(empty)')
  );

  checks.push(
    SUPPORTED_RUNTIME_TYPES.has(runtimeType)
      ? makeResult('pass', 'manifest.runtime.type', 'Runtime type is supported.', runtimeType)
      : makeResult('fail', 'manifest.runtime.type', 'Runtime type is invalid.', runtimeType || '(empty)')
  );

  const runtimeDeclared = Boolean(
    (typeof manifest?.runtime === 'string' && String(manifest.runtime || '').trim()) ||
    (manifest?.runtime && typeof manifest.runtime === 'object' && String(manifest.runtime.type || '').trim())
  );
  if (!runtimeDeclared) {
    checks.push(
      makeResult(
        'warn',
        'manifest.runtime.type',
        'Runtime type is omitted and defaults to sandbox-html. Consider declaring it explicitly.',
        runtimeType || 'sandbox-html'
      )
    );
  }

  if (appType !== 'service') {
    checks.push(
      entry
        ? makeResult('pass', 'manifest.runtime.entry', 'Runtime entry exists.', entry)
        : makeResult('fail', 'manifest.runtime.entry', 'Runtime entry is required for non-service apps.')
    );
  } else {
    checks.push(makeResult('pass', 'manifest.runtime.entry', 'Service app entry rule is acceptable.', entry || '(empty)'));
  }

  for (const permission of permissions) {
    if (!KNOWN_PERMISSIONS.has(permission)) {
      checks.push(
        makeResult('warn', `permissions.${permission}`, 'Permission is not in known capability catalog.', permission)
      );
    }
  }

  if (permissions.length === 0) {
    checks.push(makeResult('warn', 'permissions', 'No permissions declared. Confirm this is intentional.'));
  }

  const failCount = checks.filter((item) => item.status === 'fail').length;
  const warnCount = checks.filter((item) => item.status === 'warn').length;
  const status = failCount > 0 ? 'fail' : (warnCount > 0 ? 'warn' : 'pass');

  return { status, failCount, warnCount, checks };
}

function printTextReport(report, manifestPath) {
  const icon = report.status === 'pass' ? 'PASS' : report.status === 'warn' ? 'WARN' : 'FAIL';
  console.log(`[package-doctor] ${icon} ${manifestPath}`);
  for (const check of report.checks) {
    const head = `[${String(check.status || 'info').toUpperCase()}] ${check.id}: ${check.message}`;
    if (check.detail) {
      console.log(`${head} (${check.detail})`);
    } else {
      console.log(head);
    }
  }
  console.log(`[summary] fails=${report.failCount} warns=${report.warnCount}`);
}

function main() {
  const args = readArgs(process.argv);
  if (args.help) {
    console.log('Usage: node tools/package-doctor.js [--json] [--manifest=<path>] <manifest-path>');
    console.log('Example: npm run package:doctor -- server/storage/inventory/apps/hello-sandbox/manifest.json');
    return;
  }
  const manifestPath = args.manifest
    ? path.resolve(process.cwd(), args.manifest)
    : path.resolve(process.cwd(), 'server/storage/inventory/apps/example/manifest.json');

  if (!fs.existsSync(manifestPath)) {
    console.error(`[package-doctor] FAIL Manifest not found: ${manifestPath}`);
    process.exitCode = 1;
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    console.error(`[package-doctor] FAIL Invalid JSON: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const report = runChecks(manifest);
  if (args.json) {
    console.log(JSON.stringify({ manifestPath, ...report }, null, 2));
  } else {
    printTextReport(report, manifestPath);
  }

  if (report.status === 'fail') {
    process.exitCode = 1;
  }
}

main();
