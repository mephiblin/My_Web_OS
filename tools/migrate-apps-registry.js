#!/usr/bin/env node
'use strict';

const fs = require('fs-extra');
const path = require('path');
const inventoryPaths = require('../server/utils/inventoryPaths');
const builtinAppsSeed = require('../server/config/builtinAppsSeed');

const FALLBACK_REGISTRY = builtinAppsSeed;

function parseArgs(argv) {
  return {
    force: argv.includes('--force')
  };
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await inventoryPaths.ensureInventoryStructure();
  const [appsRegistryFile, legacyAppsRegistryFile] = await Promise.all([
    inventoryPaths.getAppsRegistryFile(),
    inventoryPaths.getLegacyAppsRegistryFile()
  ]);

  const hasCurrent = await fs.pathExists(appsRegistryFile);
  if (hasCurrent && !args.force) {
    console.log(`[migrate-apps-registry] skip: already exists -> ${appsRegistryFile}`);
    console.log('[migrate-apps-registry] use --force to overwrite.');
    return;
  }

  const legacyApps = await loadJsonArray(legacyAppsRegistryFile);
  const sourceApps = Array.isArray(legacyApps) ? legacyApps : FALLBACK_REGISTRY;
  const normalized = sourceApps.map(normalizeAppRecord).filter(Boolean);

  await fs.ensureDir(path.dirname(appsRegistryFile));
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
