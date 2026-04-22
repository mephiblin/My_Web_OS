const fs = require('fs-extra');

const inventoryPaths = require('../utils/inventoryPaths');
const appPaths = require('../utils/appPaths');
const { normalizeRuntimeProfile, sanitizeProfileForClient } = require('./runtimeProfiles');

const DEFAULT_WINDOW = {
  width: 960,
  height: 720,
  minWidth: 480,
  minHeight: 320
};
const ICON_FILE_EXT_RE = /\.(png|jpe?g|webp|gif|svg|ico)$/i;
const MEDIA_SCOPE_RE = /^[a-z0-9][a-z0-9._:-]{0,127}$/;

function normalizeBuiltinIcon(iconValue) {
  if (typeof iconValue !== 'string') {
    return {
      icon: 'LayoutGrid',
      iconType: 'lucide',
      iconName: 'LayoutGrid',
      iconUrl: ''
    };
  }

  const value = iconValue.trim();
  if (!value) {
    return {
      icon: 'LayoutGrid',
      iconType: 'lucide',
      iconName: 'LayoutGrid',
      iconUrl: ''
    };
  }

  if (/^https?:\/\//i.test(value) || /^data:image\//i.test(value)) {
    return {
      icon: 'LayoutGrid',
      iconType: 'image',
      iconName: 'LayoutGrid',
      iconUrl: value
    };
  }

  return {
    icon: value,
    iconType: 'lucide',
    iconName: value,
    iconUrl: ''
  };
}

function normalizeSandboxIcon(iconValue, appId) {
  const fallback = {
    icon: 'LayoutGrid',
    iconType: 'lucide',
    iconName: 'LayoutGrid',
    iconUrl: '',
    iconPath: null
  };

  if (!iconValue) return fallback;

  if (typeof iconValue === 'object') {
    if (iconValue.type === 'image' && typeof iconValue.src === 'string') {
      iconValue = iconValue.src;
    } else if (iconValue.type === 'lucide' && typeof iconValue.name === 'string') {
      iconValue = iconValue.name;
    } else {
      return fallback;
    }
  }

  if (typeof iconValue !== 'string') return fallback;

  const value = iconValue.trim();
  if (!value) return fallback;

  if (/^https?:\/\//i.test(value) || /^data:image\//i.test(value)) {
    return {
      icon: 'LayoutGrid',
      iconType: 'image',
      iconName: 'LayoutGrid',
      iconUrl: value,
      iconPath: null
    };
  }

  const normalizedPath = value.replace(/^[/\\]+/, '');
  const looksLikeAssetPath =
    normalizedPath.includes('/') ||
    normalizedPath.includes('\\') ||
    ICON_FILE_EXT_RE.test(normalizedPath);

  if (looksLikeAssetPath) {
    return {
      icon: 'LayoutGrid',
      iconType: 'image',
      iconName: 'LayoutGrid',
      iconUrl: `/api/sandbox/${encodeURIComponent(appId)}/${normalizedPath}`,
      iconPath: normalizedPath
    };
  }

  return {
    icon: value,
    iconType: 'lucide',
    iconName: value,
    iconUrl: '',
    iconPath: null
  };
}

function normalizeManifestMediaScopes(input, options = {}) {
  const strict = Boolean(options.strict);
  let rawScopes = [];

  if (Array.isArray(input)) {
    rawScopes = input;
  } else if (input && typeof input === 'object') {
    if (Array.isArray(input.scopes)) {
      rawScopes = input.scopes;
    } else if (input.media && typeof input.media === 'object' && Array.isArray(input.media.scopes)) {
      rawScopes = input.media.scopes;
    } else if (Array.isArray(input.mediaScopes)) {
      rawScopes = input.mediaScopes;
    } else if (strict && Object.prototype.hasOwnProperty.call(input, 'media')) {
      if (input.media === null || typeof input.media !== 'object' || Array.isArray(input.media)) {
        const err = new Error('Manifest media scopes must be an array of strings.');
        err.code = 'PACKAGE_MEDIA_SCOPES_INVALID';
        throw err;
      }
      if (Object.prototype.hasOwnProperty.call(input.media, 'scopes') && !Array.isArray(input.media.scopes)) {
        const err = new Error('Manifest media.scopes must be an array of strings.');
        err.code = 'PACKAGE_MEDIA_SCOPES_INVALID';
        throw err;
      }
    } else if (strict && Object.prototype.hasOwnProperty.call(input, 'mediaScopes') && !Array.isArray(input.mediaScopes)) {
      const err = new Error('Manifest mediaScopes must be an array of strings.');
      err.code = 'PACKAGE_MEDIA_SCOPES_INVALID';
      throw err;
    }
  } else if (strict && input !== undefined && input !== null) {
    const err = new Error('Manifest media scopes must be an array of strings.');
    err.code = 'PACKAGE_MEDIA_SCOPES_INVALID';
    throw err;
  }

  const normalized = [];
  const seen = new Set();
  for (const scopeValue of rawScopes) {
    const scope = String(scopeValue || '').trim().toLowerCase();
    if (!scope) continue;
    if (!MEDIA_SCOPE_RE.test(scope)) {
      if (strict) {
        const err = new Error(`Invalid media scope "${scopeValue}".`);
        err.code = 'PACKAGE_MEDIA_SCOPE_INVALID';
        throw err;
      }
      continue;
    }

    if (seen.has(scope)) continue;
    seen.add(scope);
    normalized.push(scope);
  }

  return normalized;
}

async function readBuiltinRegistry() {
  await inventoryPaths.ensureInventoryStructure();
  const [appsFile, legacyAppsFile] = await Promise.all([
    inventoryPaths.getAppsRegistryFile(),
    inventoryPaths.getLegacyAppsRegistryFile()
  ]);
  const [currentAppsExists, legacyAppsExists] = await Promise.all([
    fs.pathExists(appsFile),
    fs.pathExists(legacyAppsFile)
  ]);

  const currentApps = currentAppsExists ? await fs.readJson(appsFile) : [];
  const legacyApps = legacyAppsExists ? await fs.readJson(legacyAppsFile) : [];

  const merged = [];
  const seen = new Set();

  for (const app of [...(Array.isArray(currentApps) ? currentApps : []), ...(Array.isArray(legacyApps) ? legacyApps : [])]) {
    if (!app || typeof app !== 'object' || typeof app.id !== 'string' || seen.has(app.id)) {
      continue;
    }

    merged.push(app);
    seen.add(app.id);
  }

  return merged;
}

function normalizeWindow(value) {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_WINDOW };
  }

  return {
    width: Number.isFinite(Number(value.width)) ? Number(value.width) : DEFAULT_WINDOW.width,
    height: Number.isFinite(Number(value.height)) ? Number(value.height) : DEFAULT_WINDOW.height,
    minWidth: Number.isFinite(Number(value.minWidth)) ? Number(value.minWidth) : DEFAULT_WINDOW.minWidth,
    minHeight: Number.isFinite(Number(value.minHeight)) ? Number(value.minHeight) : DEFAULT_WINDOW.minHeight
  };
}

function normalizeBuiltinApp(app) {
  const iconMeta = normalizeBuiltinIcon(app.icon);
  return {
    ...app,
    runtime: 'builtin',
    source: 'system-registry',
    permissions: Array.isArray(app.permissions) ? app.permissions : [],
    singleton: Boolean(app.singleton),
    icon: iconMeta.icon,
    iconType: iconMeta.iconType,
    iconName: iconMeta.iconName,
    iconUrl: iconMeta.iconUrl,
    window: normalizeWindow(app.window)
  };
}

function normalizeSandboxManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') return null;
  const runtimeProfile = normalizeRuntimeProfile(manifest);
  const resolvedEntry = runtimeProfile.entry;
  const mediaScopes = normalizeManifestMediaScopes(manifest);

  if (typeof manifest.id !== 'string' || typeof manifest.title !== 'string') {
    return null;
  }
  if (runtimeProfile.appType !== 'service' && (!resolvedEntry || !resolvedEntry.trim())) return null;

  try {
    appPaths.assertSafeAppId(manifest.id);
  } catch (_err) {
    return null;
  }

  const iconMeta = normalizeSandboxIcon(manifest.icon, manifest.id);

  return {
    id: manifest.id,
    title: manifest.title,
    description: manifest.description || '',
    icon: iconMeta.icon,
    iconType: iconMeta.iconType,
    iconName: iconMeta.iconName,
    iconUrl: iconMeta.iconUrl,
    iconPath: iconMeta.iconPath,
    version: manifest.version || '0.0.0',
    type: runtimeProfile.appType,
    appType: runtimeProfile.appType,
    entry: resolvedEntry,
    runtime: runtimeProfile.runtimeType === 'sandbox-html' ? 'sandbox' : runtimeProfile.runtimeType,
    runtimeType: runtimeProfile.runtimeType,
    runtimeProfile: sanitizeProfileForClient(runtimeProfile),
    source: 'inventory-package',
    singleton: Boolean(manifest.singleton),
    permissions: Array.isArray(manifest.permissions) ? manifest.permissions.map(String) : [],
    capabilities: Array.isArray(manifest.capabilities) ? manifest.capabilities.map(String).filter(Boolean) : [],
    media: {
      scopes: mediaScopes
    },
    author: manifest.author || '',
    repository: manifest.repository || '',
    window: normalizeWindow(manifest.window)
  };
}

async function readSandboxManifest(appId) {
  const manifestFile = await appPaths.getManifestFile(appId);
  if (!(await fs.pathExists(manifestFile))) {
    return null;
  }

  const manifest = await fs.readJson(manifestFile);
  const normalized = normalizeSandboxManifest(manifest);
  if (!normalized) {
    return null;
  }

  if (normalized.id !== appId) {
    return null;
  }

  if (normalized.appType !== 'service') {
    const entryFile = await appPaths.resolveAppAssetPath(appId, normalized.entry);
    if (!(await fs.pathExists(entryFile))) {
      return null;
    }
  }

  if (normalized.iconType === 'image' && normalized.iconPath) {
    const iconFile = await appPaths.resolveAppAssetPath(appId, normalized.iconPath).catch(() => null);
    if (!iconFile || !(await fs.pathExists(iconFile))) {
      normalized.icon = 'LayoutGrid';
      normalized.iconType = 'lucide';
      normalized.iconName = 'LayoutGrid';
      normalized.iconUrl = '';
      normalized.iconPath = null;
    }
  }

  await appPaths.ensureAppDataRoot(appId);

  const { iconPath, ...safeNormalized } = normalized;

  if (normalized.appType === 'service') {
    return safeNormalized;
  }

  return {
    ...safeNormalized,
    sandbox: {
      routeBase: `/api/sandbox/${encodeURIComponent(appId)}/`,
      entryUrl: `/api/sandbox/${encodeURIComponent(appId)}/${normalized.entry.replace(/^[/\\]+/, '')}`
    }
  };
}

async function listSandboxApps() {
  const { appsDir } = await inventoryPaths.ensureInventoryStructure();
  const entries = await fs.readdir(appsDir, { withFileTypes: true }).catch(() => []);
  const sandboxApps = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifest = await readSandboxManifest(entry.name);
    if (manifest) {
      sandboxApps.push(manifest);
    }
  }

  sandboxApps.sort((a, b) => a.title.localeCompare(b.title));
  return sandboxApps;
}

const packageRegistryService = {
  normalizeManifestMediaScopes,

  async listDesktopApps() {
    const [builtinApps, sandboxApps] = await Promise.all([
      readBuiltinRegistry(),
      listSandboxApps()
    ]);

    const merged = [];
    const seen = new Set();

    for (const builtinApp of builtinApps.map(normalizeBuiltinApp)) {
      merged.push(builtinApp);
      seen.add(builtinApp.id);
    }

    for (const sandboxApp of sandboxApps) {
      if (sandboxApp.appType === 'service') {
        continue;
      }
      if (seen.has(sandboxApp.id)) {
        console.warn(`[PACKAGES] Skipping sandbox app "${sandboxApp.id}" because a builtin app already uses that id.`);
        continue;
      }
      merged.push(sandboxApp);
      seen.add(sandboxApp.id);
    }

    return merged;
  },

  async getSandboxApp(appId) {
    return readSandboxManifest(appId);
  },

  async listSandboxApps() {
    return listSandboxApps();
  }
};

module.exports = packageRegistryService;
