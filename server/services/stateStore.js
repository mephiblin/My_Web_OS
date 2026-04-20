const fs = require('fs-extra');
const inventoryPaths = require('../utils/inventoryPaths');

const STATE_KEYS = new Set(['settings', 'windows', 'widgets', 'shortcuts', 'desktops']);

const DEFAULT_SETTINGS = {
  blurIntensity: 20,
  transparency: 0.05,
  accentColor: '#58a6ff',
  wallpaperType: 'css',
  wallpaper: 'linear-gradient(135deg, #1e2a3a 0%, #0d1117 100%)',
  wallpaperId: 'default',
  wallpaperFit: 'cover'
};

const DEFAULT_WINDOWS = {
  windows: [],
  active: null
};

const DEFAULT_WIDGETS = [
  { id: 'widget-clock', type: 'preset', source: 'clock', title: 'Clock', x: 20, y: 30, w: 200, h: 200, locked: true },
  { id: 'widget-monitor', type: 'system', source: 'sys-cpu', title: 'CPU Monitor', x: 20, y: 250, w: 220, h: 200, locked: true }
];

const DEFAULT_SHORTCUTS = {
  shortcuts: []
};

const DEFAULT_DESKTOPS = {
  desktops: [
    { id: 1, name: 'Desktop 1' },
    { id: 2, name: 'Desktop 2' },
    { id: 3, name: 'Desktop 3' }
  ],
  currentDesktopId: 1
};

const DEFAULT_BY_KEY = {
  settings: DEFAULT_SETTINGS,
  windows: DEFAULT_WINDOWS,
  widgets: DEFAULT_WIDGETS,
  shortcuts: DEFAULT_SHORTCUTS,
  desktops: DEFAULT_DESKTOPS
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function ensureStateKey(key) {
  if (!STATE_KEYS.has(key)) {
    const err = new Error(`Unsupported state key: ${key}`);
    err.code = 'STATE_KEY_UNSUPPORTED';
    throw err;
  }
}

function asNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function asString(value, fallback) {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}

function normalizeSettings(value) {
  if (!isObject(value)) return clone(DEFAULT_SETTINGS);

  const wallpaperType = ['css', 'image', 'video'].includes(value.wallpaperType) ? value.wallpaperType : DEFAULT_SETTINGS.wallpaperType;
  const wallpaperFit = ['cover', 'contain', 'stretch', 'center', 'tile'].includes(value.wallpaperFit) ? value.wallpaperFit : DEFAULT_SETTINGS.wallpaperFit;

  return {
    blurIntensity: asNumber(value.blurIntensity, DEFAULT_SETTINGS.blurIntensity),
    transparency: asNumber(value.transparency, DEFAULT_SETTINGS.transparency),
    accentColor: asString(value.accentColor, DEFAULT_SETTINGS.accentColor),
    wallpaperType,
    wallpaper: asString(value.wallpaper, DEFAULT_SETTINGS.wallpaper),
    wallpaperId: asString(value.wallpaperId, DEFAULT_SETTINGS.wallpaperId),
    wallpaperFit
  };
}

function normalizeWindowItem(item) {
  if (!isObject(item)) return null;
  if (typeof item.id !== 'string' || item.id.trim() === '') return null;

  return {
    ...item,
    id: item.id,
    appId: asString(item.appId, item.id),
    title: asString(item.title, 'App'),
    x: asNumber(item.x, 100),
    y: asNumber(item.y, 100),
    width: asNumber(item.width, 800),
    height: asNumber(item.height, 600),
    minimized: Boolean(item.minimized),
    maximized: Boolean(item.maximized),
    zIndex: asNumber(item.zIndex, 50),
    desktopId: asNumber(item.desktopId, 1),
    data: item.data === undefined ? null : item.data
  };
}

function normalizeWindows(value) {
  if (!isObject(value)) return clone(DEFAULT_WINDOWS);

  const normalizedWindows = Array.isArray(value.windows)
    ? value.windows.map(normalizeWindowItem).filter(Boolean)
    : [];

  return {
    windows: normalizedWindows,
    active: typeof value.active === 'string' && value.active.trim() !== '' ? value.active : null
  };
}

function normalizeWidgetItem(item, index) {
  if (!isObject(item)) return null;

  return {
    ...item,
    id: asString(item.id, `widget-${index + 1}`),
    type: asString(item.type, 'preset'),
    source: asString(item.source, 'clock'),
    title: asString(item.title, 'Widget'),
    x: asNumber(item.x, 100),
    y: asNumber(item.y, 100),
    w: asNumber(item.w, 250),
    h: asNumber(item.h, 200),
    locked: typeof item.locked === 'boolean' ? item.locked : true
  };
}

function normalizeWidgets(value) {
  if (!Array.isArray(value)) return clone(DEFAULT_WIDGETS);
  if (value.length === 0) return [];

  const normalized = value
    .map((item, index) => normalizeWidgetItem(item, index))
    .filter(Boolean);

  return normalized.length > 0 ? normalized : clone(DEFAULT_WIDGETS);
}

function normalizeShortcuts(value) {
  if (!isObject(value) || !Array.isArray(value.shortcuts)) {
    return clone(DEFAULT_SHORTCUTS);
  }

  const shortcuts = value.shortcuts
    .filter(isObject)
    .map((item, index) => {
      const name = asString(item.name, '');
      const itemPath = asString(item.path, '');
      if (!name || !itemPath) return null;

      return {
        ...item,
        id: asString(item.id, `shortcut-${index + 1}`),
        name,
        path: itemPath,
        isDirectory: Boolean(item.isDirectory),
        ext: asString(item.ext, name.split('.').pop().toLowerCase())
      };
    })
    .filter(Boolean);

  return { shortcuts };
}

function normalizeDesktops(value) {
  if (!isObject(value) || !Array.isArray(value.desktops)) {
    return clone(DEFAULT_DESKTOPS);
  }

  const desktops = value.desktops
    .filter(isObject)
    .map((item, index) => ({
      id: asNumber(item.id, index + 1),
      name: asString(item.name, `Desktop ${index + 1}`)
    }));

  return {
    desktops: desktops.length > 0 ? desktops : clone(DEFAULT_DESKTOPS.desktops),
    currentDesktopId: asNumber(value.currentDesktopId, 1)
  };
}

function validateState(key, value) {
  ensureStateKey(key);

  switch (key) {
    case 'settings':
      return normalizeSettings(value);
    case 'windows':
      return normalizeWindows(value);
    case 'widgets':
      return normalizeWidgets(value);
    case 'shortcuts':
      return normalizeShortcuts(value);
    case 'desktops':
      return normalizeDesktops(value);
    default:
      return clone(DEFAULT_BY_KEY[key]);
  }
}

function getDefaultState(key) {
  ensureStateKey(key);
  return clone(DEFAULT_BY_KEY[key]);
}

async function tryReadJson(filePath) {
  try {
    if (!(await fs.pathExists(filePath))) {
      return { exists: false, data: null, error: null };
    }

    const data = await fs.readJson(filePath);
    return { exists: true, data, error: null };
  } catch (error) {
    return { exists: true, data: null, error };
  }
}

async function backupCorruptFile(filePath) {
  if (!(await fs.pathExists(filePath))) return;
  const backupPath = `${filePath}.corrupt-${Date.now()}.json`;
  await fs.copy(filePath, backupPath);
}

async function readState(key) {
  ensureStateKey(key);
  await inventoryPaths.ensureInventoryStructure();

  const stateFile = await inventoryPaths.getStateFile(key);
  const legacyFile = await inventoryPaths.getLegacyStateFile(key);

  const primary = await tryReadJson(stateFile);
  if (primary.exists && !primary.error) {
    return validateState(key, primary.data);
  }

  if (primary.error) {
    await backupCorruptFile(stateFile);
  }

  const legacy = await tryReadJson(legacyFile);
  if (legacy.exists && !legacy.error) {
    const normalized = validateState(key, legacy.data);
    await fs.writeJson(stateFile, normalized, { spaces: 2 });
    return normalized;
  }

  if (legacy.error) {
    await backupCorruptFile(legacyFile);
  }

  const fallback = getDefaultState(key);
  await fs.writeJson(stateFile, fallback, { spaces: 2 });
  return fallback;
}

async function writeState(key, value) {
  ensureStateKey(key);
  await inventoryPaths.ensureInventoryStructure();

  const stateFile = await inventoryPaths.getStateFile(key);
  const normalized = validateState(key, value);
  await fs.writeJson(stateFile, normalized, { spaces: 2 });
  return normalized;
}

module.exports = {
  readState,
  writeState,
  validateState,
  getDefaultState
};
