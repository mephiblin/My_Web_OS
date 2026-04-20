const fs = require('fs-extra');
const path = require('path');
const inventoryPaths = require('./inventoryPaths');

const APP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function assertSafeAppId(appId) {
  if (typeof appId !== 'string' || !APP_ID_PATTERN.test(appId)) {
    const err = new Error('Invalid app id.');
    err.code = 'APP_ID_INVALID';
    throw err;
  }
  return appId;
}

function ensureWithinRoot(rootPath, targetPath) {
  const normalizedRoot = path.resolve(rootPath);
  const normalizedTarget = path.resolve(targetPath);
  const relative = path.relative(normalizedRoot, normalizedTarget);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    const err = new Error('Path escapes the application sandbox.');
    err.code = 'APP_PATH_OUTSIDE_ROOT';
    throw err;
  }

  return normalizedTarget;
}

async function getAppRoot(appId) {
  const { appsDir } = await inventoryPaths.ensureInventoryStructure();
  return path.join(appsDir, assertSafeAppId(appId));
}

async function getAppDataRoot(appId) {
  const { dataDir } = await inventoryPaths.ensureInventoryStructure();
  return path.join(dataDir, assertSafeAppId(appId));
}

async function getManifestFile(appId) {
  return path.join(await getAppRoot(appId), 'manifest.json');
}

async function ensureAppDataRoot(appId) {
  const dataRoot = await getAppDataRoot(appId);
  await fs.ensureDir(dataRoot);
  return dataRoot;
}

async function resolveAppAssetPath(appId, relativePath = '') {
  const appRoot = await getAppRoot(appId);
  const safeRelativePath = typeof relativePath === 'string' ? relativePath.replace(/^[/\\]+/, '') : '';
  return ensureWithinRoot(appRoot, path.join(appRoot, safeRelativePath));
}

async function resolveAppDataPath(appId, relativePath = '') {
  const dataRoot = await ensureAppDataRoot(appId);
  const safeRelativePath = typeof relativePath === 'string' ? relativePath.replace(/^[/\\]+/, '') : '';
  return ensureWithinRoot(dataRoot, path.join(dataRoot, safeRelativePath));
}

module.exports = {
  APP_ID_PATTERN,
  assertSafeAppId,
  ensureAppDataRoot,
  ensureWithinRoot,
  getAppDataRoot,
  getAppRoot,
  getManifestFile,
  resolveAppAssetPath,
  resolveAppDataPath
};
