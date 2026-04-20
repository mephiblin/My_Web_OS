const fs = require('fs-extra');

const inventoryPaths = require('../utils/inventoryPaths');
const appPaths = require('../utils/appPaths');

const DEFAULT_WINDOW = {
  width: 960,
  height: 720,
  minWidth: 480,
  minHeight: 320
};

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
  return {
    ...app,
    runtime: 'builtin',
    source: 'system-registry',
    permissions: Array.isArray(app.permissions) ? app.permissions : [],
    singleton: Boolean(app.singleton),
    icon: app.icon || 'LayoutGrid',
    window: normalizeWindow(app.window)
  };
}

function normalizeSandboxManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') return null;
  if (typeof manifest.id !== 'string' || typeof manifest.title !== 'string' || typeof manifest.entry !== 'string') {
    return null;
  }

  try {
    appPaths.assertSafeAppId(manifest.id);
  } catch (_err) {
    return null;
  }

  return {
    id: manifest.id,
    title: manifest.title,
    description: manifest.description || '',
    icon: manifest.icon || 'LayoutGrid',
    version: manifest.version || '0.0.0',
    type: manifest.type || 'app',
    entry: manifest.entry,
    runtime: 'sandbox',
    source: 'inventory-package',
    singleton: Boolean(manifest.singleton),
    permissions: Array.isArray(manifest.permissions) ? manifest.permissions.map(String) : [],
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

  const entryFile = await appPaths.resolveAppAssetPath(appId, normalized.entry);
  if (!(await fs.pathExists(entryFile))) {
    return null;
  }

  await appPaths.ensureAppDataRoot(appId);

  return {
    ...normalized,
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
