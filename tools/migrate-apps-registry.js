#!/usr/bin/env node
'use strict';

const fs = require('fs-extra');
const path = require('path');
const inventoryPaths = require('../server/utils/inventoryPaths');
const builtinAppsSeed = require('../server/config/builtinAppsSeed');

const FALLBACK_REGISTRY = builtinAppsSeed;

function parseArgs(argv) {
  const args = {
    dryRun: false,
    failOnRemoval: false,
    force: false,
    help: false
  };

  for (const rawToken of argv) {
    const token = String(rawToken || '').trim();
    if (!token) continue;
    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (token === '--force') {
      args.force = true;
      continue;
    }
    if (token === '--fail-on-removal') {
      args.failOnRemoval = true;
      continue;
    }
    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }
    throw new Error(`Unsupported option: ${token}`);
  }

  return args;
}

function printUsage() {
  console.log('Usage: node tools/migrate-apps-registry.js [--dry-run] [--force] [--fail-on-removal]');
  console.log('');
  console.log('Options:');
  console.log('  --dry-run  Compute target registry and diff without writing.');
  console.log('  --force    Overwrite an existing current registry.');
  console.log('  --fail-on-removal');
  console.log('             In dry-run mode, fail when the target would remove app ids.');
}

async function loadJsonArray(filePath) {
  if (!(await fs.pathExists(filePath))) return null;
  const payload = await fs.readJson(filePath);
  if (!Array.isArray(payload)) {
    throw new Error(`Registry must be a JSON array: ${filePath}`);
  }
  return payload;
}

function normalizeAppRecord(app) {
  if (!app || typeof app !== 'object') return null;
  const id = String(app.id || '').trim();
  if (!id) return null;
  return { ...app, id };
}

function normalizeRegistry(apps) {
  return (Array.isArray(apps) ? apps : []).map(normalizeAppRecord).filter(Boolean);
}

function sortJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((sorted, key) => {
      sorted[key] = sortJsonValue(value[key]);
      return sorted;
    }, {});
  }
  return value;
}

function comparableJson(value) {
  return JSON.stringify(sortJsonValue(value));
}

function registryById(apps) {
  const rows = new Map();
  for (const app of normalizeRegistry(apps)) {
    rows.set(app.id, app);
  }
  return rows;
}

function summarizeRegistryDiff(currentApps, targetApps) {
  const currentById = registryById(currentApps);
  const targetById = registryById(targetApps);
  const added = [];
  const removed = [];
  const changed = [];

  for (const [id, targetApp] of targetById.entries()) {
    const currentApp = currentById.get(id);
    if (!currentApp) {
      added.push(id);
    } else if (comparableJson(currentApp) !== comparableJson(targetApp)) {
      changed.push(id);
    }
  }

  for (const id of currentById.keys()) {
    if (!targetById.has(id)) {
      removed.push(id);
    }
  }

  return {
    added: added.sort(),
    removed: removed.sort(),
    changed: changed.sort()
  };
}

function formatIdSummary(ids) {
  return ids.length > 0 ? ids.join(', ') : '(none)';
}

function makeTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function printDryRunSummary({
  appsRegistryFile,
  legacyAppsRegistryFile,
  hasCurrent,
  hasLegacy,
  force,
  normalized,
  diff
}) {
  console.log(`[migrate-apps-registry] dry-run: target -> ${appsRegistryFile}`);
  console.log(`[migrate-apps-registry] source: ${hasLegacy ? legacyAppsRegistryFile : 'builtin seed'}`);
  console.log(`[migrate-apps-registry] normalized target: ${normalized.length} app(s)`);

  if (hasCurrent && force) {
    console.log('[migrate-apps-registry] action: would overwrite existing registry and create a timestamped backup first.');
  } else if (hasCurrent) {
    console.log('[migrate-apps-registry] action: would skip because current registry exists; use --force to overwrite.');
  } else {
    console.log('[migrate-apps-registry] action: would create current registry.');
  }

  console.log(`[migrate-apps-registry] added id(s): ${formatIdSummary(diff.added)}`);
  console.log(`[migrate-apps-registry] removed id(s): ${formatIdSummary(diff.removed)}`);
  console.log(`[migrate-apps-registry] changed id(s): ${formatIdSummary(diff.changed)}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  if (args.failOnRemoval && !args.dryRun) {
    throw new Error('--fail-on-removal requires --dry-run.');
  }

  const [appsRegistryFile, legacyAppsRegistryFile] = await Promise.all([
    inventoryPaths.getAppsRegistryFile(),
    inventoryPaths.getLegacyAppsRegistryFile()
  ]);

  if (!args.dryRun) {
    await inventoryPaths.ensureInventoryStructure();
  }

  const hasCurrent = await fs.pathExists(appsRegistryFile);
  if (!args.dryRun && hasCurrent && !args.force) {
    console.log(`[migrate-apps-registry] skip: already exists -> ${appsRegistryFile}`);
    console.log('[migrate-apps-registry] use --force to overwrite.');
    return;
  }

  const currentApps = args.dryRun && hasCurrent ? await loadJsonArray(appsRegistryFile) : [];
  const legacyApps = await loadJsonArray(legacyAppsRegistryFile);
  const sourceApps = Array.isArray(legacyApps) ? legacyApps : FALLBACK_REGISTRY;
  const normalized = normalizeRegistry(sourceApps);

  if (args.dryRun) {
    const diff = summarizeRegistryDiff(currentApps, normalized);
    printDryRunSummary({
      appsRegistryFile,
      legacyAppsRegistryFile,
      hasCurrent,
      hasLegacy: Array.isArray(legacyApps),
      force: args.force,
      normalized,
      diff
    });
    if (args.failOnRemoval && diff.removed.length > 0) {
      console.log(`[migrate-apps-registry] FAIL dry-run would remove app id(s): ${formatIdSummary(diff.removed)}`);
      process.exitCode = 1;
    }
    return;
  }

  await fs.ensureDir(path.dirname(appsRegistryFile));
  if (hasCurrent && args.force) {
    const backupFile = `${appsRegistryFile}.${makeTimestamp()}.bak`;
    await fs.copyFile(appsRegistryFile, backupFile);
    console.log(`[migrate-apps-registry] current registry backup kept -> ${backupFile}`);
  }

  await fs.writeJson(appsRegistryFile, normalized, { spaces: 2 });
  console.log(`[migrate-apps-registry] wrote ${normalized.length} app(s) -> ${appsRegistryFile}`);

  if (!legacyApps) {
    console.log(`[migrate-apps-registry] legacy source missing (${legacyAppsRegistryFile}), initialized from builtin seed.`);
  } else {
    const backupFile = `${legacyAppsRegistryFile}.bak`;
    await fs.copyFile(legacyAppsRegistryFile, backupFile).catch(() => {});
    console.log(`[migrate-apps-registry] backup kept -> ${backupFile}`);
  }
}

main().catch((err) => {
  console.error(`[migrate-apps-registry] FAIL ${err.message}`);
  process.exitCode = 1;
});
