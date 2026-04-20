const fs = require('fs-extra');
const path = require('path');
const serverConfig = require('../config/serverConfig');

async function getRoots() {
  const configPaths = await serverConfig.getPaths();
  const inventoryRoot = configPaths.inventoryRoot;

  return {
    inventoryRoot,
    systemDir: path.join(inventoryRoot, 'system'),
    appsDir: path.join(inventoryRoot, 'apps'),
    widgetsDir: path.join(inventoryRoot, 'widgets'),
    scriptsDir: path.join(inventoryRoot, 'scripts'),
    dataDir: path.join(inventoryRoot, 'data'),
    wallpapersDir: path.join(inventoryRoot, 'wallpapers'),
    iconsDir: path.join(inventoryRoot, 'icons'),
    legacyStorageDir: configPaths.serverStorageRoot
  };
}

async function ensureInventoryStructure() {
  const roots = await getRoots();
  await Promise.all([
    fs.ensureDir(roots.inventoryRoot),
    fs.ensureDir(roots.systemDir),
    fs.ensureDir(roots.appsDir),
    fs.ensureDir(roots.widgetsDir),
    fs.ensureDir(roots.scriptsDir),
    fs.ensureDir(roots.dataDir),
    fs.ensureDir(roots.wallpapersDir),
    fs.ensureDir(roots.iconsDir)
  ]);
  return roots;
}

async function getStateFile(key) {
  const roots = await getRoots();
  return path.join(roots.systemDir, `${key}.json`);
}

async function getLegacyStateFile(key) {
  const roots = await getRoots();
  return path.join(roots.inventoryRoot, `state_${key}.json`);
}

async function getAppsRegistryFile() {
  const roots = await getRoots();
  return path.join(roots.systemDir, 'apps.json');
}

async function getLegacyAppsRegistryFile() {
  const roots = await getRoots();
  return path.join(roots.legacyStorageDir, 'apps.json');
}

async function getWidgetLibraryDir() {
  const roots = await getRoots();
  return roots.widgetsDir;
}

async function getWallpapersDir() {
  const roots = await getRoots();
  return roots.wallpapersDir;
}

module.exports = {
  getRoots,
  ensureInventoryStructure,
  getStateFile,
  getLegacyStateFile,
  getAppsRegistryFile,
  getLegacyAppsRegistryFile,
  getWidgetLibraryDir,
  getWallpapersDir
};
