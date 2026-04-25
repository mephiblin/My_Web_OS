const fs = require('fs-extra');

const inventoryPaths = require('../utils/inventoryPaths');
const appPaths = require('../utils/appPaths');
const builtinAppsSeed = require('../config/builtinAppsSeed');
const { normalizeRuntimeProfile, sanitizeProfileForClient } = require('./runtimeProfiles');

const DEFAULT_WINDOW = {
  width: 960,
  height: 720,
  minWidth: 480,
  minHeight: 320
};
const APP_MODELS = Object.freeze({
  SYSTEM: 'system',
  STANDARD: 'standard',
  PACKAGE: 'package'
});
const OWNERSHIP_CONTRACT_VERSION = '1.0.0';
const BUILTIN_SYSTEM_APP_IDS = new Set([
  'files',
  'terminal',
  'monitor',
  'docker',
  'control-panel',
  'settings',
  'logs',
  'package-center',
  'transfer'
]);
const BUILTIN_DEFAULT_VERSION = '0.0.0';
const ICON_FILE_EXT_RE = /\.(png|jpe?g|webp|gif|svg|ico)$/i;
const MEDIA_SCOPE_RE = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const FILE_ASSOC_ACTIONS = new Set(['preview', 'open', 'edit', 'import', 'export']);
const FILE_EXTENSION_RE = /^[a-z0-9][a-z0-9._+-]{0,31}$/i;
const MIME_TYPE_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;

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

function normalizeFileAssociations(input, options = {}) {
  const strict = Boolean(options.strict);
  if (input === undefined || input === null) {
    return [];
  }

  if (!Array.isArray(input)) {
    if (strict) {
      const err = new Error('Manifest fileAssociations must be an array.');
      err.code = 'PACKAGE_FILE_ASSOCIATIONS_INVALID';
      throw err;
    }
    return [];
  }

  const normalized = [];
  const seen = new Set();

  for (let index = 0; index < input.length; index += 1) {
    const row = input[index];
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      if (strict) {
        const err = new Error(`fileAssociations[${index}] must be an object.`);
        err.code = 'PACKAGE_FILE_ASSOCIATION_INVALID';
        throw err;
      }
      continue;
    }

    const rawExtensions = Array.isArray(row.extensions) ? row.extensions : [];
    const extensions = [];
    const extensionSet = new Set();
    for (const rawExtension of rawExtensions) {
      const extension = String(rawExtension || '').trim().toLowerCase().replace(/^\./, '');
      if (!extension) continue;
      if (!FILE_EXTENSION_RE.test(extension)) {
        if (strict) {
          const err = new Error(`fileAssociations[${index}] has invalid extension "${rawExtension}".`);
          err.code = 'PACKAGE_FILE_ASSOCIATION_EXTENSION_INVALID';
          throw err;
        }
        continue;
      }
      if (extensionSet.has(extension)) continue;
      extensionSet.add(extension);
      extensions.push(extension);
    }

    const rawMimeTypes = Array.isArray(row.mimeTypes) ? row.mimeTypes : [];
    const mimeTypes = [];
    const mimeSet = new Set();
    for (const rawMimeType of rawMimeTypes) {
      const mimeType = String(rawMimeType || '').trim().toLowerCase();
      if (!mimeType) continue;
      if (!MIME_TYPE_RE.test(mimeType)) {
        if (strict) {
          const err = new Error(`fileAssociations[${index}] has invalid mime type "${rawMimeType}".`);
          err.code = 'PACKAGE_FILE_ASSOCIATION_MIME_INVALID';
          throw err;
        }
        continue;
      }
      if (mimeSet.has(mimeType)) continue;
      mimeSet.add(mimeType);
      mimeTypes.push(mimeType);
    }

    if (extensions.length === 0 && mimeTypes.length === 0) {
      if (strict) {
        const err = new Error(`fileAssociations[${index}] must include at least one extension or mime type.`);
        err.code = 'PACKAGE_FILE_ASSOCIATION_TARGET_REQUIRED';
        throw err;
      }
      continue;
    }

    const rawActions = Array.isArray(row.actions) ? row.actions : [];
    const actions = [];
    const actionSet = new Set();
    for (const rawAction of rawActions) {
      const action = String(rawAction || '').trim().toLowerCase();
      if (!action) continue;
      if (!FILE_ASSOC_ACTIONS.has(action)) {
        if (strict) {
          const err = new Error(`fileAssociations[${index}] has unsupported action "${rawAction}".`);
          err.code = 'PACKAGE_FILE_ASSOCIATION_ACTION_INVALID';
          throw err;
        }
        continue;
      }
      if (actionSet.has(action)) continue;
      actionSet.add(action);
      actions.push(action);
    }

    const requestedDefaultAction = String(row.defaultAction || '').trim().toLowerCase();
    let defaultAction = actions[0] || 'open';
    if (requestedDefaultAction) {
      if (!FILE_ASSOC_ACTIONS.has(requestedDefaultAction)) {
        if (strict) {
          const err = new Error(`fileAssociations[${index}] has invalid defaultAction "${row.defaultAction}".`);
          err.code = 'PACKAGE_FILE_ASSOCIATION_DEFAULT_ACTION_INVALID';
          throw err;
        }
      } else if (actionSet.size === 0 || actionSet.has(requestedDefaultAction)) {
        defaultAction = requestedDefaultAction;
      } else if (strict) {
        const err = new Error(`fileAssociations[${index}] defaultAction must be included in actions.`);
        err.code = 'PACKAGE_FILE_ASSOCIATION_DEFAULT_ACTION_MISSING';
        throw err;
      }
    }

    if (actions.length === 0) {
      actions.push(defaultAction);
    }

    if (!actions.includes(defaultAction)) {
      actions.unshift(defaultAction);
    }

    const key = JSON.stringify({
      extensions,
      mimeTypes,
      actions,
      defaultAction
    });
    if (seen.has(key)) continue;
    seen.add(key);

    normalized.push({
      extensions,
      mimeTypes,
      actions,
      defaultAction
    });
  }

  return normalized;
}

async function readBuiltinRegistry() {
  await inventoryPaths.ensureInventoryStructure();
  const appsFile = await inventoryPaths.getAppsRegistryFile();
  const normalizeRegistryRows = (rows) => {
    if (!Array.isArray(rows)) {
      return null;
    }
    return rows.filter((app) => app && typeof app === 'object' && typeof app.id === 'string');
  };

  const writeSeedRegistry = async () => {
    const seeded = normalizeRegistryRows(builtinAppsSeed) || [];
    await fs.writeJson(appsFile, seeded, { spaces: 2 });
    return seeded;
  };

  if (!(await fs.pathExists(appsFile))) {
    return writeSeedRegistry();
  }

  try {
    const currentApps = await fs.readJson(appsFile);
    const normalized = normalizeRegistryRows(currentApps);
    if (normalized) {
      return normalized;
    }
  } catch (err) {
    console.warn(`[PACKAGES] Failed to read builtin registry (${appsFile}): ${err.message}`);
  }

  return writeSeedRegistry();
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
  const appModel = classifyBuiltinAppModel(app);
  const normalizedTitle = String(app.title || app.name || app.id || '').trim() || 'Untitled App';
  const normalizedDescription = String(app.description || '').trim();
  const normalizedVersion = String(app.version || BUILTIN_DEFAULT_VERSION).trim() || BUILTIN_DEFAULT_VERSION;
  const normalizedEntry = typeof app.entry === 'string' && app.entry.trim() ? app.entry.trim() : '';
  const normalizedPermissions = Array.isArray(app.permissions) ? app.permissions.map(String).filter(Boolean) : [];
  const normalizedFileAssociations = normalizeFileAssociations(app.fileAssociations);
  const normalizedWindow = normalizeWindow(app.window);
  const builtinType = appModel === APP_MODELS.SYSTEM ? 'system' : 'app';
  const normalizedAppType = String(app.appType || app.type || builtinType).trim() || builtinType;

  return {
    ...app,
    title: normalizedTitle,
    description: normalizedDescription,
    version: normalizedVersion,
    appModel,
    type: String(app.type || builtinType).trim() || builtinType,
    appType: normalizedAppType,
    entry: normalizedEntry,
    runtime: 'builtin',
    runtimeType: 'builtin',
    source: 'system-registry',
    permissions: normalizedPermissions,
    fileAssociations: normalizedFileAssociations,
    singleton: Boolean(app.singleton),
    icon: iconMeta.icon,
    iconType: iconMeta.iconType,
    iconName: iconMeta.iconName,
    iconUrl: iconMeta.iconUrl,
    window: normalizedWindow,
    launch: {
      mode: 'component',
      componentId: String(app.componentId || app.id || '').trim() || String(app.id || '').trim(),
      singleton: Boolean(app.singleton)
    },
    dataBoundary: typeof app.dataBoundary === 'string' ? app.dataBoundary.trim() : '',
    manifestLike: {
      id: String(app.id || '').trim(),
      title: normalizedTitle,
      description: normalizedDescription,
      version: normalizedVersion,
      type: normalizedAppType,
      runtime: {
        type: 'builtin',
        entry: normalizedEntry
      },
      permissions: normalizedPermissions,
      fileAssociations: normalizedFileAssociations,
      window: normalizedWindow
    }
  };
}

function normalizeAppModel(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === APP_MODELS.SYSTEM ||
    normalized === APP_MODELS.STANDARD ||
    normalized === APP_MODELS.PACKAGE
  ) {
    return normalized;
  }

  return null;
}

function classifyBuiltinAppModel(app) {
  const explicitModel = normalizeAppModel(app?.appModel);
  if (explicitModel && explicitModel !== APP_MODELS.PACKAGE) {
    return explicitModel;
  }

  const explicitType = String(app?.type || app?.appType || app?.kind || '').trim().toLowerCase();
  if (explicitType === 'system' || explicitType === 'core' || explicitType === 'host') {
    return APP_MODELS.SYSTEM;
  }
  if (explicitType === 'standard' || explicitType === 'app' || explicitType === 'builtin') {
    return APP_MODELS.STANDARD;
  }

  if (BUILTIN_SYSTEM_APP_IDS.has(app?.id)) {
    return APP_MODELS.SYSTEM;
  }

  return APP_MODELS.STANDARD;
}

function resolveOwnerTier(appModel) {
  if (appModel === APP_MODELS.SYSTEM) {
    return 'core-system';
  }
  if (appModel === APP_MODELS.STANDARD) {
    return 'core-addon';
  }
  if (appModel === APP_MODELS.PACKAGE) {
    return 'package-addon';
  }
  return 'unknown';
}

function resolveLaunchContract(app) {
  const launch = app && typeof app.launch === 'object' ? app.launch : null;
  const runtimeType = String(app?.runtimeType || '').trim().toLowerCase();
  const mode = launch?.mode || (runtimeType === 'builtin' ? 'component' : runtimeType === 'sandbox-html' ? 'sandbox' : 'unknown');

  return {
    mode,
    componentId: launch?.componentId ?? null,
    entryUrl: launch?.entryUrl ?? null,
    singleton: Boolean(launch?.singleton ?? app?.singleton)
  };
}

function resolveDataBoundary(app, ownerTier, launch) {
  const explicitBoundary = String(app?.dataBoundary || '').trim();
  if (explicitBoundary === 'host-shared' || explicitBoundary === 'inventory-app-data' || explicitBoundary === 'none') {
    return explicitBoundary;
  }
  if (ownerTier === 'package-addon') {
    return 'inventory-app-data';
  }
  if (launch.mode === 'component') {
    return 'host-shared';
  }
  return 'none';
}

function buildOwnershipMatrixItems(apps) {
  return apps.map((app) => {
    const appModel = normalizeAppModel(app?.appModel) || null;
    const ownerTier = resolveOwnerTier(appModel);
    const launch = resolveLaunchContract(app);

    return {
      id: String(app?.id || '').trim(),
      title: String(app?.title || '').trim(),
      appModel,
      ownerTier,
      source: String(app?.source || '').trim(),
      runtimeType: String(app?.runtimeType || app?.runtime || '').trim(),
      launch,
      dataBoundary: resolveDataBoundary(app, ownerTier, launch)
    };
  });
}

function normalizeSandboxManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') return null;
  const runtimeProfile = normalizeRuntimeProfile(manifest);
  const resolvedEntry = runtimeProfile.entry;
  const mediaScopes = normalizeManifestMediaScopes(manifest);
  const fileAssociations = normalizeFileAssociations(manifest.fileAssociations);

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
    appModel: APP_MODELS.PACKAGE,
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
    fileAssociations,
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
    launch: {
      mode: 'sandbox',
      componentId: null,
      singleton: Boolean(safeNormalized.singleton),
      entryUrl: `/api/sandbox/${encodeURIComponent(appId)}/${normalized.entry.replace(/^[/\\]+/, '')}`
    },
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
  normalizeManifestFileAssociations: normalizeFileAssociations,
  OWNERSHIP_CONTRACT_VERSION,

  async listDesktopApps() {
    const [builtinApps, sandboxApps] = await Promise.all([
      readBuiltinRegistry(),
      listSandboxApps()
    ]);

    const merged = [];
    const seen = new Set();
    const replacedBuiltinIds = new Set();
    const sandboxById = new Map(sandboxApps.map((app) => [app.id, app]));

    for (const builtinApp of builtinApps.map(normalizeBuiltinApp)) {
      const packageReplacement = sandboxById.get(builtinApp.id);
      if (packageReplacement && builtinApp.appModel === APP_MODELS.STANDARD) {
        merged.push({
          ...packageReplacement,
          replacesBuiltin: true,
          replacedBuiltin: {
            id: builtinApp.id,
            appModel: builtinApp.appModel,
            source: builtinApp.source,
            runtime: builtinApp.runtime
          }
        });
        seen.add(packageReplacement.id);
        replacedBuiltinIds.add(packageReplacement.id);
        continue;
      }
      merged.push(builtinApp);
      seen.add(builtinApp.id);
    }

    for (const sandboxApp of sandboxApps) {
      if (sandboxApp.appType === 'service') {
        continue;
      }
      if (seen.has(sandboxApp.id)) {
        if (replacedBuiltinIds.has(sandboxApp.id)) {
          continue;
        }
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
  },

  async getAppsOwnershipMatrix() {
    const apps = await this.listDesktopApps();
    return {
      contractVersion: OWNERSHIP_CONTRACT_VERSION,
      items: buildOwnershipMatrixItems(apps)
    };
  }
};

module.exports = packageRegistryService;
