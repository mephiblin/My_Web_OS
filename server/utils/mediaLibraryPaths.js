const fs = require('fs-extra');
const path = require('path');
const serverConfig = require('../config/serverConfig');

async function getRoots() {
  const configPaths = await serverConfig.getPaths();
  const mediaLibraryRoot = path.join(configPaths.serverStorageRoot, 'media-library');

  return {
    mediaLibraryRoot,
    wallpapersDir: path.join(mediaLibraryRoot, 'wallpapers')
  };
}

async function ensureMediaLibraryStructure() {
  const roots = await getRoots();
  await Promise.all([
    fs.ensureDir(roots.mediaLibraryRoot),
    fs.ensureDir(roots.wallpapersDir)
  ]);
  return roots;
}

async function getMediaLibraryRoot() {
  const roots = await getRoots();
  return roots.mediaLibraryRoot;
}

async function getWallpapersDir() {
  const roots = await getRoots();
  return roots.wallpapersDir;
}

module.exports = {
  getRoots,
  ensureMediaLibraryStructure,
  getMediaLibraryRoot,
  getWallpapersDir
};
