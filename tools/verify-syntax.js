#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');

const targets = [
  'server/index.js',
  'server/routes/packages.js',
  'server/routes/fs.js',
  'server/routes/runtime.js',
  'server/routes/docker.js',
  'server/middleware/auth.js',
  'server/middleware/pathGuard.js',
  'server/services/packageLifecycleService.js',
  'server/services/packageRegistryService.js',
  'server/services/templateCatalogService.js',
  'server/services/fileGrantService.js',
  'server/services/fileTicketService.js',
  'server/services/operationApprovalService.js',
  'server/utils/pathPolicy.js',
  'server/utils/urlRedaction.js',
  'client/src/utils/api.js',
  'client/src/apps/system/package-center/api.js',
  'client/src/core/stores/appRegistryStore.js'
].map((file) => ({ file, optional: false }));

const checked = [];

for (const target of targets) {
  const filePath = path.join(rootDir, target.file);

  if (!fs.existsSync(filePath)) {
    if (target.optional) {
      const reason = target.reason ? `: ${target.reason}` : '';
      console.log(`[verify:syntax] skip optional ${target.file}${reason}`);
      continue;
    }

    console.error(`[verify:syntax] missing required file: ${target.file}`);
    process.exit(1);
  }

  console.log(`[verify:syntax] checking ${target.file}`);
  checked.push(target.file);

  const result = spawnSync(process.execPath, ['--check', filePath], {
    cwd: rootDir,
    encoding: 'utf8'
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.error) {
    console.error(`[verify:syntax] failed ${target.file}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    const code = result.status === null ? 'unknown' : result.status;
    console.error(`[verify:syntax] failed ${target.file} (exit ${code})`);
    process.exit(result.status || 1);
  }
}

console.log(`[verify:syntax] checked ${checked.length} file(s)`);
