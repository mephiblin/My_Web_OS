const fs = require('fs-extra');
const path = require('path');
const inventoryPaths = require('../utils/inventoryPaths');

const FILE_NAME = 'runtime-instances.json';

function defaultState() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    apps: {}
  };
}

function normalizeSnapshot(input) {
  if (!input || typeof input !== 'object') {
    return defaultState();
  }

  return {
    version: Number.isFinite(Number(input.version)) ? Number(input.version) : 1,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : new Date().toISOString(),
    apps: input.apps && typeof input.apps === 'object' ? input.apps : {}
  };
}

async function getFilePath() {
  const roots = await inventoryPaths.ensureInventoryStructure();
  return path.join(roots.systemDir, FILE_NAME);
}

async function readAll() {
  const filePath = await getFilePath();
  if (!(await fs.pathExists(filePath))) {
    const initial = defaultState();
    await fs.writeJson(filePath, initial, { spaces: 2 });
    return initial;
  }

  try {
    const payload = await fs.readJson(filePath);
    return normalizeSnapshot(payload);
  } catch (_err) {
    const backup = `${filePath}.corrupt-${Date.now()}.json`;
    await fs.copy(filePath, backup).catch(() => {});
    const initial = defaultState();
    await fs.writeJson(filePath, initial, { spaces: 2 });
    return initial;
  }
}

async function writeAll(snapshot) {
  const filePath = await getFilePath();
  const normalized = normalizeSnapshot(snapshot);
  normalized.updatedAt = new Date().toISOString();
  await fs.writeJson(filePath, normalized, { spaces: 2 });
  return normalized;
}

module.exports = {
  readAll,
  writeAll
};
