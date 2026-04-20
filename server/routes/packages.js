const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const multer = require('multer');
const AdmZip = require('adm-zip');

const auth = require('../middleware/auth');
const auditService = require('../services/auditService');
const packageRegistryService = require('../services/packageRegistryService');
const packageLifecycleService = require('../services/packageLifecycleService');
const appPaths = require('../utils/appPaths');
const inventoryPaths = require('../utils/inventoryPaths');
const { normalizeRuntimeProfile, assertValidRuntimeProfile, toManifestRuntimeFields } = require('../services/runtimeProfiles');

const router = express.Router();
router.use(auth);

const DEFAULT_ENTRY = 'index.html';
const DEFAULT_WINDOW = {
  width: 960,
  height: 720,
  minWidth: 480,
  minHeight: 320
};
const ICON_FILE_EXT_RE = /\.(png|jpe?g|webp|gif|svg|ico)$/i;
const REGISTRY_DOWNLOAD_TIMEOUT_MS = 15000;
const REGISTRY_DOWNLOAD_MAX_BYTES = 80 * 1024 * 1024;
const ECOSYSTEM_TEMPLATE_NAMESPACE = 'official';
const CAPABILITY_CATALOG = [
  {
    id: 'app.data.list',
    category: 'storage',
    risk: 'low',
    summary: 'List files and directories in the package-owned data root.'
  },
  {
    id: 'app.data.read',
    category: 'storage',
    risk: 'low',
    summary: 'Read files from the package-owned data root.'
  },
  {
    id: 'app.data.write',
    category: 'storage',
    risk: 'medium',
    summary: 'Write files to the package-owned data root.'
  },
  {
    id: 'ui.notification',
    category: 'ui',
    risk: 'low',
    summary: 'Display user-visible notifications.'
  },
  {
    id: 'window.open',
    category: 'ui',
    risk: 'medium',
    summary: 'Open another desktop app window.'
  },
  {
    id: 'system.info',
    category: 'system',
    risk: 'medium',
    summary: 'Read system overview metrics exposed by the gateway.'
  }
];
const upload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      try {
        const targetDir = path.join(__dirname, '../storage/tmp');
        await fs.ensureDir(targetDir);
        cb(null, targetDir);
      } catch (err) {
        cb(err);
      }
    },
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
  }),
  limits: {
    fileSize: 50 * 1024 * 1024
  }
});
const REGISTRY_SOURCES_FILE = 'package-registries.json';
const APP_ID_ROUTE = ':id';
const ROOT_PACKAGE_JSON_PATH = path.join(__dirname, '../../package.json');
let cachedServerVersion = '';

const ECOSYSTEM_TEMPLATES = [
  {
    id: 'markdown-workspace',
    title: 'Markdown Workspace',
    category: 'productivity',
    description: '문서 작성/노트용 1st-party 기본 앱 템플릿',
    defaults: {
      runtimeType: 'sandbox-html',
      appType: 'app',
      entry: 'index.html',
      permissions: ['app.data.read', 'app.data.write', 'ui.notification']
    }
  },
  {
    id: 'ops-dashboard',
    title: 'Ops Dashboard',
    category: 'system',
    description: '상태/이벤트 확인용 운영 대시보드 템플릿',
    defaults: {
      runtimeType: 'sandbox-html',
      appType: 'app',
      entry: 'index.html',
      permissions: ['system.info', 'ui.notification']
    }
  },
  {
    id: 'service-probe',
    title: 'Service Probe',
    category: 'runtime',
    description: '런타임 헬스 체크/복구 실험용 서비스 템플릿',
    defaults: {
      runtimeType: 'process-node',
      appType: 'service',
      entry: 'service.js',
      permissions: []
    }
  }
];

function toPosixPath(value = '') {
  return String(value).split(path.sep).join('/');
}

function normalizeRelativePath(value = '') {
  return String(value || '').replace(/^[/\\]+/, '');
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function normalizeZipEntryPath(value = '') {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
}

function compareVersions(a, b) {
  return packageLifecycleService.compareVersions(a, b);
}

function normalizeManifestChannel(value) {
  const input = String(value || '').trim().toLowerCase();
  if (packageLifecycleService.CHANNELS.includes(input)) {
    return input;
  }
  return 'stable';
}

function normalizeManifestDependencies(value) {
  return packageLifecycleService.normalizeDependencies(value);
}

function normalizeManifestCompatibility(value) {
  return packageLifecycleService.normalizeCompatibility(value);
}

async function getServerVersion() {
  if (cachedServerVersion) return cachedServerVersion;
  const rootPackage = await fs.readJson(ROOT_PACKAGE_JSON_PATH).catch(() => null);
  cachedServerVersion = String(rootPackage?.version || '0.0.0').trim() || '0.0.0';
  return cachedServerVersion;
}

async function getManifestFilePath(appId) {
  return appPaths.getManifestFile(appId);
}

async function getRegistrySourcesFile() {
  const roots = await inventoryPaths.ensureInventoryStructure();
  return path.join(roots.systemDir, REGISTRY_SOURCES_FILE);
}

async function readRegistrySources() {
  const filePath = await getRegistrySourcesFile();
  if (!(await fs.pathExists(filePath))) {
    return [];
  }

  const payload = await fs.readJson(filePath).catch(() => []);
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .filter((item) => item && typeof item === 'object' && typeof item.id === 'string' && typeof item.url === 'string')
    .map((item) => ({
      id: item.id.trim(),
      title: String(item.title || item.id).trim(),
      url: item.url.trim(),
      enabled: item.enabled !== false
    }))
    .filter((item) => item.id && item.url);
}

async function writeRegistrySources(sources) {
  const filePath = await getRegistrySourcesFile();
  await fs.writeJson(filePath, sources, { spaces: 2 });
}

async function readManifestRaw(appId) {
  const manifestFile = await getManifestFilePath(appId);
  if (!(await fs.pathExists(manifestFile))) {
    return null;
  }

  const manifest = await fs.readJson(manifestFile);
  return manifest && typeof manifest === 'object' ? manifest : null;
}

async function resolvePackagePath(appId, relativePath = '') {
  const appRoot = await appPaths.getAppRoot(appId);
  const safeRelativePath = normalizeRelativePath(relativePath);
  return appPaths.ensureWithinRoot(appRoot, path.join(appRoot, safeRelativePath));
}

async function addDirectoryToZip(zip, rootPath, relativePath = '') {
  const targetDir = path.join(rootPath, relativePath);
  const entries = await fs.readdir(targetDir, { withFileTypes: true });
  for (const entry of entries) {
    const childRelativePath = path.join(relativePath, entry.name);
    if (entry.isDirectory()) {
      await addDirectoryToZip(zip, rootPath, childRelativePath);
      continue;
    }

    if (!entry.isFile()) continue;
    zip.addLocalFile(path.join(rootPath, childRelativePath), path.dirname(toPosixPath(childRelativePath)));
  }
}

function getManifestEntryFromZip(zip) {
  const zipEntries = zip.getEntries();
  const fileEntries = zipEntries.filter((entry) => !entry.isDirectory);
  return (
    fileEntries.find((entry) => normalizeZipEntryPath(entry.entryName) === 'manifest.json') ||
    fileEntries.find((entry) => normalizeZipEntryPath(entry.entryName).endsWith('/manifest.json')) ||
    null
  );
}

async function readManifestFromZip(filePath) {
  const zip = new AdmZip(filePath);
  const manifestZipEntry = getManifestEntryFromZip(zip);
  if (!manifestZipEntry) {
    const err = new Error('manifest.json not found in package archive.');
    err.code = 'PACKAGE_IMPORT_MANIFEST_MISSING';
    throw err;
  }

  const manifestBuffer = zip.readFile(manifestZipEntry);
  if (!manifestBuffer) {
    const err = new Error('Could not read manifest.json from package archive.');
    err.code = 'PACKAGE_IMPORT_MANIFEST_INVALID';
    throw err;
  }

  const parsedManifest = JSON.parse(manifestBuffer.toString('utf8'));
  return normalizeManifestInput(parsedManifest || {});
}

async function importZipPackageFromFile(filePath, options = {}) {
  const overwrite = Boolean(options.overwrite);
  const zip = new AdmZip(filePath);
  const zipEntries = zip.getEntries();
  const fileEntries = zipEntries.filter((entry) => !entry.isDirectory);
  const manifestZipEntry =
    fileEntries.find((entry) => normalizeZipEntryPath(entry.entryName) === 'manifest.json') ||
    fileEntries.find((entry) => normalizeZipEntryPath(entry.entryName).endsWith('/manifest.json'));

  if (!manifestZipEntry) {
    const err = new Error('manifest.json not found in package archive.');
    err.code = 'PACKAGE_IMPORT_MANIFEST_MISSING';
    throw err;
  }

  const manifestEntryName = normalizeZipEntryPath(manifestZipEntry.entryName);
  const manifestPrefix = manifestEntryName.endsWith('/manifest.json')
    ? manifestEntryName.slice(0, -'manifest.json'.length)
    : '';

  const manifestBuffer = zip.readFile(manifestZipEntry);
  if (!manifestBuffer) {
    const err = new Error('Could not read manifest.json from package archive.');
    err.code = 'PACKAGE_IMPORT_MANIFEST_INVALID';
    throw err;
  }

  const parsedManifest = JSON.parse(manifestBuffer.toString('utf8'));
  const manifest = normalizeManifestInput(parsedManifest || {});
  const appRoot = await appPaths.getAppRoot(manifest.id);

  if ((await fs.pathExists(appRoot)) && !overwrite) {
    const err = new Error(`Package "${manifest.id}" already exists.`);
    err.code = 'PACKAGE_ALREADY_EXISTS';
    throw err;
  }

  if (await fs.pathExists(appRoot)) {
    await fs.remove(appRoot);
  }
  await fs.ensureDir(appRoot);

  try {
    for (const entry of fileEntries) {
      const normalizedEntryPath = normalizeZipEntryPath(entry.entryName);
      const relativePath = manifestPrefix && normalizedEntryPath.startsWith(manifestPrefix)
        ? normalizedEntryPath.slice(manifestPrefix.length)
        : normalizedEntryPath;

      if (!relativePath) continue;
      const absoluteTarget = appPaths.ensureWithinRoot(appRoot, path.join(appRoot, normalizeRelativePath(relativePath)));
      await fs.ensureDir(path.dirname(absoluteTarget));
      const content = zip.readFile(entry);
      await fs.writeFile(absoluteTarget, content);
    }
  } catch (err) {
    await fs.remove(appRoot);
    err.code = err.code || 'PACKAGE_IMPORT_WRITE_FAILED';
    throw err;
  }

  const installed = await packageRegistryService.getSandboxApp(manifest.id);
  if (!installed) {
    await fs.remove(appRoot);
    const err = new Error('Imported package is invalid or missing entry file.');
    err.code = 'PACKAGE_IMPORT_INVALID';
    throw err;
  }

  return installed;
}

function normalizeRegistrySourceInput(input) {
  const id = String(input?.id || '').trim();
  const title = String(input?.title || id).trim();
  const url = String(input?.url || '').trim();

  if (!id) {
    const err = new Error('Registry source id is required.');
    err.code = 'REGISTRY_SOURCE_ID_REQUIRED';
    throw err;
  }
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(id)) {
    const err = new Error('Registry source id is invalid.');
    err.code = 'REGISTRY_SOURCE_ID_INVALID';
    throw err;
  }
  if (!url) {
    const err = new Error('Registry source url is required.');
    err.code = 'REGISTRY_SOURCE_URL_REQUIRED';
    throw err;
  }
  if (!/^https?:\/\//.test(url)) {
    const err = new Error('Registry source url must start with http:// or https://');
    err.code = 'REGISTRY_SOURCE_URL_INVALID';
    throw err;
  }

  return {
    id,
    title: title || id,
    url,
    enabled: input?.enabled !== false
  };
}

function normalizeRemotePackage(item = {}, source) {
  const id = String(item.id || '').trim();
  const title = String(item.title || item.name || id).trim();
  if (!id || !title) {
    return null;
  }

  const rawIcon = String(item.icon || '').trim();
  const rawIconUrl = String(item.iconUrl || '').trim();
  const iconUrl = rawIconUrl || (isHttpUrl(rawIcon) || /^data:image\//i.test(rawIcon) ? rawIcon : '');
  const iconType = iconUrl ? 'image' : (String(item.iconType || '').trim() || 'lucide');

  return {
    id,
    title,
    description: String(item.description || '').trim(),
    version: String(item.version || '').trim() || '0.0.0',
    author: String(item.author || '').trim(),
    repository: String(item.repository || item.homepage || '').trim(),
    zipUrl: String(item.zipUrl || item.downloadUrl || '').trim(),
    manifestUrl: String(item.manifestUrl || '').trim(),
    icon: rawIcon || 'LayoutGrid',
    iconUrl,
    iconType,
    permissions: Array.isArray(item.permissions) ? item.permissions.map((permission) => String(permission)).filter(Boolean) : [],
    capabilities: Array.isArray(item.capabilities) ? item.capabilities.map((capability) => String(capability)).filter(Boolean) : [],
    source: {
      id: source.id,
      title: source.title,
      url: source.url
    }
  };
}

function listEcosystemTemplates() {
  return ECOSYSTEM_TEMPLATES.map((template) => ({
    ...template,
    namespace: ECOSYSTEM_TEMPLATE_NAMESPACE
  }));
}

function getEcosystemTemplate(templateId) {
  const key = String(templateId || '').trim();
  return ECOSYSTEM_TEMPLATES.find((item) => item.id === key) || null;
}

async function fetchRegistryPackagesFromSource(source) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(source.url, {
      method: 'GET',
      signal: controller.signal
    });
    if (!response.ok) {
      const err = new Error(`Failed to fetch registry source (${response.status}).`);
      err.code = 'REGISTRY_SOURCE_FETCH_FAILED';
      throw err;
    }

    const payload = await response.json();
    const rawPackages = Array.isArray(payload) ? payload : (Array.isArray(payload?.packages) ? payload.packages : []);
    return rawPackages
      .map((item) => normalizeRemotePackage(item, source))
      .filter(Boolean);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function downloadRegistryPackageZip(zipUrl) {
  if (!isHttpUrl(zipUrl)) {
    const err = new Error('zipUrl must start with http:// or https://');
    err.code = 'REGISTRY_PACKAGE_ZIP_URL_INVALID';
    throw err;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REGISTRY_DOWNLOAD_TIMEOUT_MS);

  try {
    const response = await fetch(zipUrl, {
      method: 'GET',
      signal: controller.signal
    });

    if (!response.ok) {
      const err = new Error(`Failed to download package archive (${response.status}).`);
      err.code = 'REGISTRY_PACKAGE_DOWNLOAD_FAILED';
      throw err;
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength && contentLength > REGISTRY_DOWNLOAD_MAX_BYTES) {
      const err = new Error('Package archive exceeds size limit.');
      err.code = 'REGISTRY_PACKAGE_TOO_LARGE';
      throw err;
    }

    const payload = Buffer.from(await response.arrayBuffer());
    if (payload.length > REGISTRY_DOWNLOAD_MAX_BYTES) {
      const err = new Error('Package archive exceeds size limit.');
      err.code = 'REGISTRY_PACKAGE_TOO_LARGE';
      throw err;
    }

    const tmpDir = path.join(__dirname, '../storage/tmp');
    await fs.ensureDir(tmpDir);
    const tmpFile = path.join(tmpDir, `registry-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`);
    await fs.writeFile(tmpFile, payload);
    return tmpFile;
  } catch (err) {
    if (err.name === 'AbortError') {
      err.code = 'REGISTRY_PACKAGE_DOWNLOAD_TIMEOUT';
      err.message = 'Timed out while downloading package archive.';
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

function createDefaultHtmlTemplate({ appId, title }) {
  const escapedTitle = String(title || appId || 'Sandbox App')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapedTitle}</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #e5edf9;
        background: radial-gradient(circle at top, #1e293b 0%, #020617 65%);
        display: grid;
        place-items: center;
      }
      .card {
        width: min(560px, calc(100vw - 32px));
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 16px;
        background: rgba(15, 23, 42, 0.78);
        padding: 24px;
      }
      h1 { margin: 0 0 8px; font-size: 22px; }
      p { margin: 0; color: #9fb3cc; line-height: 1.5; }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>${escapedTitle}</h1>
      <p>Package <code>${appId}</code> is ready. Edit this file from Package Center.</p>
    </main>
  </body>
</html>
`;
}

function createDefaultServiceTemplate({ appId, runtimeType }) {
  if (runtimeType === 'process-python') {
    return `#!/usr/bin/env python3
import time

print("Service ${appId} started", flush=True)
while True:
    print("heartbeat", flush=True)
    time.sleep(5)
`;
  }

  if (runtimeType === 'binary') {
    return `#!/usr/bin/env bash
echo "Service ${appId} started"
while true; do
  echo "heartbeat"
  sleep 5
done
`;
  }

  return `'use strict';

console.log('Service ${appId} started');
setInterval(() => {
  console.log('heartbeat');
}, 5000);
`;
}

function normalizeManifestInput(input, fallbackAppId) {
  const appId = String(input?.id || fallbackAppId || '').trim();
  appPaths.assertSafeAppId(appId);

  const title = String(input?.title || '').trim();
  if (!title) {
    const err = new Error('Package title is required.');
    err.code = 'PACKAGE_TITLE_REQUIRED';
    throw err;
  }

  const resolvedEntry = typeof input?.entry === 'string'
    ? input.entry
    : (input?.entry && typeof input.entry.app === 'string' ? input.entry.app : DEFAULT_ENTRY);
  const entry = normalizeRelativePath(resolvedEntry || DEFAULT_ENTRY);

  let normalizedIcon = 'LayoutGrid';
  if (typeof input?.icon === 'string') {
    const iconValue = input.icon.trim();
    normalizedIcon = iconValue || 'LayoutGrid';
  } else if (input?.icon && typeof input.icon === 'object') {
    const iconType = String(input.icon.type || '').trim();
    if (iconType === 'image') {
      const src = String(input.icon.src || '').trim();
      if (src) {
        normalizedIcon = {
          type: 'image',
          src
        };
      }
    } else if (iconType === 'lucide') {
      const name = String(input.icon.name || '').trim();
      normalizedIcon = name || 'LayoutGrid';
    }
  }

  if (typeof normalizedIcon === 'string' && !isHttpUrl(normalizedIcon) && !/^data:image\//i.test(normalizedIcon) && ICON_FILE_EXT_RE.test(normalizedIcon)) {
    normalizedIcon = normalizeRelativePath(normalizedIcon);
  }

  const runtimeProfile = normalizeRuntimeProfile({
    ...input,
    id: appId,
    entry
  });
  assertValidRuntimeProfile(input, runtimeProfile);
  const runtimeFields = toManifestRuntimeFields(runtimeProfile);
  const dependencies = normalizeManifestDependencies(input?.dependencies);
  const compatibility = normalizeManifestCompatibility(input?.compatibility);
  const release = {
    channel: normalizeManifestChannel(input?.release?.channel || input?.channel || 'stable')
  };

  return {
    id: appId,
    title,
    description: String(input?.description || '').trim(),
    version: String(input?.version || '1.0.0').trim() || '1.0.0',
    type: runtimeFields.type,
    runtime: runtimeFields.runtime,
    service: runtimeFields.service,
    healthcheck: runtimeFields.healthcheck,
    resources: runtimeFields.resources,
    icon: normalizedIcon,
    author: String(input?.author || '').trim(),
    repository: String(input?.repository || '').trim(),
    singleton: Boolean(input?.singleton),
    entry: runtimeProfile.entry || entry,
    permissions: Array.isArray(input?.permissions)
      ? input.permissions.map((permission) => String(permission)).filter(Boolean)
      : [],
    capabilities: Array.isArray(input?.capabilities)
      ? input.capabilities.map((capability) => String(capability)).filter(Boolean)
      : [],
    dependencies,
    compatibility,
    release,
    window: {
      width: Number.isFinite(Number(input?.window?.width)) ? Number(input.window.width) : DEFAULT_WINDOW.width,
      height: Number.isFinite(Number(input?.window?.height)) ? Number(input.window.height) : DEFAULT_WINDOW.height,
      minWidth: Number.isFinite(Number(input?.window?.minWidth)) ? Number(input.window.minWidth) : DEFAULT_WINDOW.minWidth,
      minHeight: Number.isFinite(Number(input?.window?.minHeight)) ? Number(input.window.minHeight) : DEFAULT_WINDOW.minHeight
    }
  };
}

async function listDirectoryEntries(appId, relativePath = '') {
  const targetDir = await resolvePackagePath(appId, relativePath);
  if (!(await fs.pathExists(targetDir))) {
    const err = new Error('Requested directory was not found.');
    err.code = 'PACKAGE_PATH_NOT_FOUND';
    throw err;
  }

  const stats = await fs.stat(targetDir);
  if (!stats.isDirectory()) {
    const err = new Error('Requested path is not a directory.');
    err.code = 'PACKAGE_PATH_NOT_DIRECTORY';
    throw err;
  }

  const entries = await fs.readdir(targetDir, { withFileTypes: true });
  const basePath = normalizeRelativePath(relativePath);

  return entries.map((entry) => ({
    name: entry.name,
    type: entry.isDirectory() ? 'directory' : 'file',
    path: toPosixPath(path.join(basePath, entry.name))
  }));
}

async function computePackageHealthReport(appId, options = {}) {
  const safeAppId = appPaths.assertSafeAppId(appId);
  const runtimeManager = options.runtimeManager || null;
  const manifest = await readManifestRaw(safeAppId);
  if (!manifest) {
    const err = new Error('Package not found.');
    err.code = 'PACKAGE_NOT_FOUND';
    throw err;
  }

  const checks = [];
  let runtimeProfile = null;

  try {
    runtimeProfile = normalizeRuntimeProfile(manifest);
    assertValidRuntimeProfile(manifest, runtimeProfile);
    checks.push({
      id: 'manifest.runtime',
      level: 'pass',
      message: 'Runtime profile is valid.'
    });
  } catch (err) {
    checks.push({
      id: 'manifest.runtime',
      level: 'fail',
      code: err.code || 'RUNTIME_PROFILE_INVALID',
      message: err.message
    });
  }

  if (runtimeProfile && runtimeProfile.appType !== 'service') {
    const entryPath = await resolvePackagePath(safeAppId, runtimeProfile.entry || manifest.entry || DEFAULT_ENTRY).catch(() => '');
    if (entryPath && (await fs.pathExists(entryPath))) {
      checks.push({
        id: 'package.entry',
        level: 'pass',
        message: 'UI entry file exists.'
      });
    } else {
      checks.push({
        id: 'package.entry',
        level: 'fail',
        code: 'PACKAGE_ENTRY_NOT_FOUND',
        message: `Entry file "${runtimeProfile.entry || manifest.entry || DEFAULT_ENTRY}" was not found.`
      });
    }
  }

  const dependencies = normalizeManifestDependencies(manifest.dependencies);
  if (dependencies.length > 0) {
    const installed = await packageRegistryService.listSandboxApps();
    const installedIds = new Set(installed.map((item) => item.id));

    for (const dependency of dependencies) {
      const exists = installedIds.has(dependency.id);
      if (exists) {
        checks.push({
          id: `dependency.${dependency.id}`,
          level: 'pass',
          message: `Dependency "${dependency.id}" is installed.`,
          versionRange: dependency.version
        });
      } else if (dependency.optional) {
        checks.push({
          id: `dependency.${dependency.id}`,
          level: 'warn',
          message: `Optional dependency "${dependency.id}" is not installed.`,
          versionRange: dependency.version
        });
      } else {
        checks.push({
          id: `dependency.${dependency.id}`,
          level: 'fail',
          code: 'DEPENDENCY_MISSING',
          message: `Required dependency "${dependency.id}" is not installed.`,
          versionRange: dependency.version
        });
      }
    }
  } else {
    checks.push({
      id: 'dependencies',
      level: 'pass',
      message: 'No package dependencies declared.'
    });
  }

  const compatibility = normalizeManifestCompatibility(manifest.compatibility);
  const serverVersion = await getServerVersion();

  if (compatibility.minServerVersion) {
    if (compareVersions(serverVersion, compatibility.minServerVersion) < 0) {
      checks.push({
        id: 'compatibility.minServerVersion',
        level: 'fail',
        code: 'COMPATIBILITY_MIN_VERSION_MISMATCH',
        message: `Server version ${serverVersion} is lower than required ${compatibility.minServerVersion}.`
      });
    } else {
      checks.push({
        id: 'compatibility.minServerVersion',
        level: 'pass',
        message: `Server version ${serverVersion} satisfies minimum ${compatibility.minServerVersion}.`
      });
    }
  }

  if (compatibility.maxServerVersion) {
    if (compareVersions(serverVersion, compatibility.maxServerVersion) > 0) {
      checks.push({
        id: 'compatibility.maxServerVersion',
        level: 'fail',
        code: 'COMPATIBILITY_MAX_VERSION_MISMATCH',
        message: `Server version ${serverVersion} exceeds maximum ${compatibility.maxServerVersion}.`
      });
    } else {
      checks.push({
        id: 'compatibility.maxServerVersion',
        level: 'pass',
        message: `Server version ${serverVersion} is below maximum ${compatibility.maxServerVersion}.`
      });
    }
  }

  if (compatibility.requiredRuntimeTypes.length > 0 && runtimeProfile) {
    if (!compatibility.requiredRuntimeTypes.includes(runtimeProfile.runtimeType)) {
      checks.push({
        id: 'compatibility.runtimeType',
        level: 'fail',
        code: 'COMPATIBILITY_RUNTIME_TYPE_MISMATCH',
        message: `Runtime type "${runtimeProfile.runtimeType}" is not in required list.`,
        required: compatibility.requiredRuntimeTypes
      });
    } else {
      checks.push({
        id: 'compatibility.runtimeType',
        level: 'pass',
        message: `Runtime type "${runtimeProfile.runtimeType}" is compatible.`
      });
    }
  }

  if (runtimeManager && typeof runtimeManager.validateApp === 'function') {
    const runtimeValidation = await runtimeManager.validateApp(safeAppId).catch((err) => ({
      valid: false,
      checks: [
        {
          id: 'runtime.validation',
          level: 'fail',
          code: err.code || 'RUNTIME_VALIDATION_FAILED',
          message: err.message
        }
      ]
    }));
    for (const runtimeCheck of runtimeValidation.checks || []) {
      checks.push({
        ...runtimeCheck,
        id: `runtime.${runtimeCheck.id || 'check'}`
      });
    }
  }

  const status = checks.some((check) => check.level === 'fail')
    ? 'fail'
    : checks.some((check) => check.level === 'warn')
      ? 'warn'
      : 'pass';

  return {
    appId: safeAppId,
    status,
    checkedAt: new Date().toISOString(),
    serverVersion,
    dependencies,
    compatibility,
    checks
  };
}

router.get('/', async (req, res) => {
  try {
    const packages = await packageRegistryService.listSandboxApps();
    const runtimeManager = req.app.get('runtimeManager');
    const runtimeStatusMap = runtimeManager?.getRuntimeStatusMap
      ? runtimeManager.getRuntimeStatusMap()
      : {};
    res.json({
      success: true,
      packages: packages.map((pkg) => ({
        ...pkg,
        runtimeStatus: runtimeStatusMap[pkg.id] || null
      }))
    });
  } catch (err) {
    res.status(500).json({
      error: true,
      message: err.message
    });
  }
});

router.get('/runtime/capabilities', async (_req, res) => {
  return res.json({
    success: true,
    runtime: 'sandbox',
    capabilities: CAPABILITY_CATALOG
  });
});

router.post('/', async (req, res) => {
  try {
    const manifest = normalizeManifestInput(req.body || {});
    const appRoot = await appPaths.getAppRoot(manifest.id);
    if (await fs.pathExists(appRoot)) {
      return res.status(409).json({
        error: true,
        code: 'PACKAGE_ALREADY_EXISTS',
        message: `Package "${manifest.id}" already exists.`
      });
    }

    await fs.ensureDir(appRoot);
    await fs.writeJson(path.join(appRoot, 'manifest.json'), manifest, { spaces: 2 });
    const runtimeProfile = normalizeRuntimeProfile(manifest);
    const shouldCreateEntryFile = Boolean(manifest.entry);
    if (shouldCreateEntryFile) {
      const entryPath = await resolvePackagePath(manifest.id, manifest.entry);
      await fs.ensureDir(path.dirname(entryPath));
      if (runtimeProfile.appType === 'service') {
        await fs.writeFile(
          entryPath,
          createDefaultServiceTemplate({ appId: manifest.id, runtimeType: runtimeProfile.runtimeType }),
          'utf8'
        );
      } else {
        await fs.writeFile(entryPath, createDefaultHtmlTemplate({ appId: manifest.id, title: manifest.title }), 'utf8');
      }
    }

    const created = await packageRegistryService.getSandboxApp(manifest.id);
    await packageLifecycleService.recordInstall(manifest.id, {
      manifest,
      reason: 'create',
      source: 'local:create'
    });
    await auditService.log(
      'PACKAGES',
      `Create Package: ${manifest.id}`,
      { appId: manifest.id, user: req.user?.username },
      'INFO'
    );

    return res.status(201).json({
      success: true,
      package: created
    });
  } catch (err) {
    const status = err.code === 'APP_ID_INVALID' || err.code?.startsWith('PACKAGE_') || err.code === 'RUNTIME_PROFILE_INVALID' ? 400 : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'PACKAGE_CREATE_FAILED',
      message: err.message
    });
  }
});

router.post(`/${APP_ID_ROUTE}/clone`, async (req, res) => {
  try {
    const sourceId = appPaths.assertSafeAppId(req.params.id);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const targetId = appPaths.assertSafeAppId(String(body.targetId || '').trim());
    const title = String(body.title || '').trim();

    const sourceRoot = await appPaths.getAppRoot(sourceId);
    if (!(await fs.pathExists(sourceRoot))) {
      return res.status(404).json({
        error: true,
        code: 'PACKAGE_NOT_FOUND',
        message: 'Source package not found.'
      });
    }

    const targetRoot = await appPaths.getAppRoot(targetId);
    if (await fs.pathExists(targetRoot)) {
      return res.status(409).json({
        error: true,
        code: 'PACKAGE_ALREADY_EXISTS',
        message: `Package "${targetId}" already exists.`
      });
    }

    await fs.copy(sourceRoot, targetRoot);
    const clonedManifest = await readManifestRaw(targetId);
    if (!clonedManifest) {
      throw new Error('Cloned package manifest not found.');
    }

    clonedManifest.id = targetId;
    if (title) {
      clonedManifest.title = title;
    } else if (clonedManifest.title) {
      clonedManifest.title = `${clonedManifest.title} (Copy)`;
    } else {
      clonedManifest.title = targetId;
    }

    await fs.writeJson(await getManifestFilePath(targetId), clonedManifest, { spaces: 2 });
    const created = await packageRegistryService.getSandboxApp(targetId);
    await packageLifecycleService.recordInstall(targetId, {
      manifest: clonedManifest,
      reason: 'clone',
      source: `clone:${sourceId}`
    });

    await auditService.log(
      'PACKAGES',
      `Clone Package: ${sourceId} -> ${targetId}`,
      { sourceId, targetId, user: req.user?.username },
      'INFO'
    );

    return res.status(201).json({
      success: true,
      package: created
    });
  } catch (err) {
    const isClientError = err.code === 'APP_ID_INVALID' || err.code === 'PACKAGE_ALREADY_EXISTS';
    return res.status(isClientError ? 400 : 500).json({
      error: true,
      code: err.code || 'PACKAGE_CLONE_FAILED',
      message: err.message
    });
  }
});

router.delete(`/${APP_ID_ROUTE}`, async (req, res) => {
  try {
    const appId = appPaths.assertSafeAppId(req.params.id);
    const appRoot = await appPaths.getAppRoot(appId);
    const runtimeManager = req.app.get('runtimeManager');
    if (!(await fs.pathExists(appRoot))) {
      return res.status(404).json({
        error: true,
        code: 'PACKAGE_NOT_FOUND',
        message: 'Package not found.'
      });
    }

    await runtimeManager?.stopApp?.(appId).catch(() => {});
    await fs.remove(appRoot);
    await fs.remove(await appPaths.getAppDataRoot(appId)).catch(() => {});
    await auditService.log(
      'PACKAGES',
      `Delete Package: ${appId}`,
      { appId, user: req.user?.username },
      'WARN'
    );
    return res.json({ success: true });
  } catch (err) {
    const status = err.code === 'APP_ID_INVALID' ? 400 : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'PACKAGE_DELETE_FAILED',
      message: err.message
    });
  }
});

router.get(`/${APP_ID_ROUTE}/export`, async (req, res) => {
  try {
    const appId = appPaths.assertSafeAppId(req.params.id);
    const appRoot = await appPaths.getAppRoot(appId);
    if (!(await fs.pathExists(appRoot))) {
      return res.status(404).json({
        error: true,
        code: 'PACKAGE_NOT_FOUND',
        message: 'Package not found.'
      });
    }

    const manifest = await readManifestRaw(appId);
    if (!manifest) {
      return res.status(404).json({
        error: true,
        code: 'PACKAGE_MANIFEST_NOT_FOUND',
        message: 'manifest.json not found.'
      });
    }

    const zip = new AdmZip();
    await addDirectoryToZip(zip, appRoot);
    const output = zip.toBuffer();
    const fileName = `${appId}-${String(manifest.version || '0.0.0').replace(/[^a-zA-Z0-9._-]/g, '_')}.webospkg.zip`;

    await auditService.log(
      'PACKAGES',
      `Export Package: ${appId}`,
      { appId, user: req.user?.username },
      'INFO'
    );

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.send(output);
  } catch (err) {
    const status = err.code === 'APP_ID_INVALID' ? 400 : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'PACKAGE_EXPORT_FAILED',
      message: err.message
    });
  }
});

router.post('/import', upload.single('package'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: true,
        code: 'PACKAGE_IMPORT_FILE_REQUIRED',
        message: 'Upload file field "package" is required.'
      });
    }

    const overwrite = String(req.body?.overwrite || '').toLowerCase() === 'true';
    const runtimeManager = req.app.get('runtimeManager');
    const incomingManifest = await readManifestFromZip(req.file.path);
    const appId = incomingManifest.id;
    const runtimeStatus = runtimeManager?.getRuntimeStatusMap?.()[appId] || null;
    const wasRunning = runtimeStatus && ['running', 'starting', 'degraded'].includes(runtimeStatus.status);
    const existing = await packageRegistryService.getSandboxApp(appId);

    let backup = null;
    if (overwrite && existing) {
      await runtimeManager?.stopApp?.(appId).catch(() => {});
      backup = await packageLifecycleService.createBackup(appId, {
        note: 'Pre-import overwrite snapshot'
      });
    }

    let installed;
    try {
      installed = await importZipPackageFromFile(req.file.path, { overwrite });
    } catch (err) {
      if (backup?.id) {
        await packageLifecycleService.restoreBackup(appId, backup.id).catch(() => {});
        if (wasRunning) {
          await runtimeManager?.startApp?.(appId).catch(() => {});
        }
      }
      throw err;
    }

    await packageLifecycleService.recordInstall(installed.id, {
      manifest: incomingManifest,
      reason: overwrite && existing ? 'import-overwrite' : 'import',
      source: 'upload:zip',
      backupId: backup?.id || null
    });

    if (wasRunning) {
      await runtimeManager?.startApp?.(installed.id).catch(() => {});
    }

    await auditService.log(
      'PACKAGES',
      `Import Package: ${installed.id}`,
      { appId: installed.id, overwrite, backupId: backup?.id || null, user: req.user?.username },
      'INFO'
    );

    return res.status(201).json({
      success: true,
      package: installed
    });
  } catch (err) {
    const status =
      err.code === 'APP_ID_INVALID' ||
      err.code?.startsWith('PACKAGE_') ||
      err.code === 'RUNTIME_PROFILE_INVALID'
        ? 400
        : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'PACKAGE_IMPORT_FAILED',
      message: err.message
    });
  } finally {
    if (req.file?.path) {
      await fs.remove(req.file.path).catch(() => {});
    }
  }
});

router.get('/registry/sources', async (_req, res) => {
  try {
    const sources = await readRegistrySources();
    return res.json({
      success: true,
      sources
    });
  } catch (err) {
    return res.status(500).json({
      error: true,
      code: 'REGISTRY_SOURCE_READ_FAILED',
      message: err.message
    });
  }
});

router.post('/registry/sources', async (req, res) => {
  try {
    const input = normalizeRegistrySourceInput(req.body || {});
    const sources = await readRegistrySources();
    const next = sources.filter((item) => item.id !== input.id);
    next.push(input);
    await writeRegistrySources(next);
    await auditService.log(
      'PACKAGES',
      `Upsert Registry Source: ${input.id}`,
      { sourceId: input.id, url: input.url, user: req.user?.username },
      'INFO'
    );

    return res.status(201).json({
      success: true,
      source: input,
      sources: next
    });
  } catch (err) {
    const status = err.code?.startsWith('REGISTRY_SOURCE_') ? 400 : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'REGISTRY_SOURCE_UPSERT_FAILED',
      message: err.message
    });
  }
});

router.delete('/registry/sources/:id', async (req, res) => {
  try {
    const sourceId = String(req.params.id || '').trim();
    if (!sourceId) {
      return res.status(400).json({
        error: true,
        code: 'REGISTRY_SOURCE_ID_REQUIRED',
        message: 'Source id is required.'
      });
    }

    const sources = await readRegistrySources();
    const next = sources.filter((item) => item.id !== sourceId);
    await writeRegistrySources(next);
    await auditService.log(
      'PACKAGES',
      `Delete Registry Source: ${sourceId}`,
      { sourceId, user: req.user?.username },
      'WARN'
    );

    return res.json({
      success: true,
      sources: next
    });
  } catch (err) {
    return res.status(500).json({
      error: true,
      code: 'REGISTRY_SOURCE_DELETE_FAILED',
      message: err.message
    });
  }
});

router.get('/registry', async (req, res) => {
  try {
    const sourceId = String(req.query.source || '').trim();
    const sources = await readRegistrySources();
    const enabledSources = sourceId
      ? sources.filter((item) => item.id === sourceId)
      : sources.filter((item) => item.enabled !== false);
    const installedApps = await packageRegistryService.listSandboxApps();
    const installedIds = new Set(installedApps.map((item) => item.id));

    const results = await Promise.all(
      enabledSources.map(async (source) => {
        try {
          const packages = await fetchRegistryPackagesFromSource(source);
          return {
            source,
            ok: true,
            packages: packages.map((pkg) => ({
              ...pkg,
              installed: installedIds.has(pkg.id)
            }))
          };
        } catch (err) {
          return {
            source,
            ok: false,
            error: err.message,
            packages: []
          };
        }
      })
    );

    return res.json({
      success: true,
      results
    });
  } catch (err) {
    return res.status(500).json({
      error: true,
      code: 'REGISTRY_FETCH_FAILED',
      message: err.message
    });
  }
});

router.post('/registry/install', async (req, res) => {
  let tempZipFile = '';
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const sourceId = String(body.sourceId || '').trim();
    const packageId = String(body.packageId || '').trim();
    const overwrite = String(body.overwrite || '').toLowerCase() === 'true' || body.overwrite === true;
    let zipUrl = String(body.zipUrl || '').trim();

    if (!zipUrl) {
      if (!sourceId || !packageId) {
        return res.status(400).json({
          error: true,
          code: 'REGISTRY_INSTALL_TARGET_REQUIRED',
          message: 'Either zipUrl or (sourceId + packageId) is required.'
        });
      }

      const sources = await readRegistrySources();
      const source = sources.find((item) => item.id === sourceId);
      if (!source) {
        return res.status(404).json({
          error: true,
          code: 'REGISTRY_SOURCE_NOT_FOUND',
          message: `Registry source "${sourceId}" not found.`
        });
      }

      const packages = await fetchRegistryPackagesFromSource(source);
      const targetPackage = packages.find((item) => item.id === packageId);
      if (!targetPackage) {
        return res.status(404).json({
          error: true,
          code: 'REGISTRY_PACKAGE_NOT_FOUND',
          message: `Package "${packageId}" was not found in source "${sourceId}".`
        });
      }

      if (!targetPackage.zipUrl) {
        return res.status(400).json({
          error: true,
          code: 'REGISTRY_PACKAGE_ZIP_MISSING',
          message: `Package "${packageId}" does not expose a zipUrl.`
        });
      }

      zipUrl = targetPackage.zipUrl;
    }

    tempZipFile = await downloadRegistryPackageZip(zipUrl);
    const runtimeManager = req.app.get('runtimeManager');
    const incomingManifest = await readManifestFromZip(tempZipFile);
    const appId = incomingManifest.id;
    const existing = await packageRegistryService.getSandboxApp(appId);
    const runtimeStatus = runtimeManager?.getRuntimeStatusMap?.()[appId] || null;
    const wasRunning = runtimeStatus && ['running', 'starting', 'degraded'].includes(runtimeStatus.status);

    let backup = null;
    if (overwrite && existing) {
      await runtimeManager?.stopApp?.(appId).catch(() => {});
      backup = await packageLifecycleService.createBackup(appId, {
        note: 'Pre-registry overwrite snapshot'
      });
    }

    let installed;
    try {
      installed = await importZipPackageFromFile(tempZipFile, { overwrite });
    } catch (err) {
      if (backup?.id) {
        await packageLifecycleService.restoreBackup(appId, backup.id).catch(() => {});
        if (wasRunning) {
          await runtimeManager?.startApp?.(appId).catch(() => {});
        }
      }
      throw err;
    }

    await packageLifecycleService.recordInstall(installed.id, {
      manifest: incomingManifest,
      reason: overwrite && existing ? 'upgrade-overwrite' : 'registry-install',
      source: sourceId ? `registry:${sourceId}` : 'registry:direct-url',
      backupId: backup?.id || null
    });

    if (wasRunning) {
      await runtimeManager?.startApp?.(installed.id).catch(() => {});
    }

    await auditService.log(
      'PACKAGES',
      `Install Registry Package: ${installed.id}`,
      {
        appId: installed.id,
        sourceId: sourceId || 'direct-url',
        zipUrl,
        overwrite,
        backupId: backup?.id || null,
        user: req.user?.username
      },
      'INFO'
    );

    return res.status(201).json({
      success: true,
      package: installed
    });
  } catch (err) {
    const status =
      err.code === 'APP_ID_INVALID' ||
      err.code?.startsWith('PACKAGE_') ||
      err.code === 'REGISTRY_PACKAGE_TOO_LARGE' ||
      err.code === 'REGISTRY_PACKAGE_ZIP_URL_INVALID' ||
      err.code === 'REGISTRY_PACKAGE_DOWNLOAD_TIMEOUT' ||
      err.code === 'REGISTRY_PACKAGE_DOWNLOAD_FAILED' ||
      err.code === 'RUNTIME_PROFILE_INVALID'
        ? 400
        : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'REGISTRY_PACKAGE_INSTALL_FAILED',
      message: err.message
    });
  } finally {
    if (tempZipFile) {
      await fs.remove(tempZipFile).catch(() => {});
    }
  }
});

router.get('/ecosystem/templates', async (_req, res) => {
  return res.json({
    success: true,
    namespace: ECOSYSTEM_TEMPLATE_NAMESPACE,
    templates: listEcosystemTemplates()
  });
});

router.post('/ecosystem/templates/:templateId/scaffold', async (req, res) => {
  try {
    const template = getEcosystemTemplate(req.params.templateId);
    if (!template) {
      return res.status(404).json({
        error: true,
        code: 'ECOSYSTEM_TEMPLATE_NOT_FOUND',
        message: 'Requested ecosystem template was not found.'
      });
    }

    const requestedId = String(req.body?.appId || '').trim();
    const appId = requestedId || `${template.id}-${Date.now()}`;
    appPaths.assertSafeAppId(appId);

    const manifest = normalizeManifestInput({
      id: appId,
      title: String(req.body?.title || `${template.title} (${appId})`).trim(),
      description: String(req.body?.description || template.description || '').trim(),
      version: String(req.body?.version || '0.1.0').trim() || '0.1.0',
      type: template.defaults.appType,
      runtime: {
        type: template.defaults.runtimeType,
        entry: template.defaults.entry
      },
      permissions: Array.isArray(req.body?.permissions)
        ? req.body.permissions
        : template.defaults.permissions
    });

    const appRoot = await appPaths.getAppRoot(manifest.id);
    if (await fs.pathExists(appRoot)) {
      return res.status(409).json({
        error: true,
        code: 'PACKAGE_ALREADY_EXISTS',
        message: `Package "${manifest.id}" already exists.`
      });
    }

    await fs.ensureDir(appRoot);
    await fs.writeJson(path.join(appRoot, 'manifest.json'), manifest, { spaces: 2 });

    const runtimeProfile = normalizeRuntimeProfile(manifest);
    const entryPath = await resolvePackagePath(manifest.id, manifest.entry);
    await fs.ensureDir(path.dirname(entryPath));
    if (runtimeProfile.appType === 'service') {
      await fs.writeFile(
        entryPath,
        createDefaultServiceTemplate({ appId: manifest.id, runtimeType: runtimeProfile.runtimeType }),
        'utf8'
      );
    } else {
      await fs.writeFile(entryPath, createDefaultHtmlTemplate({ appId: manifest.id, title: manifest.title }), 'utf8');
    }

    const readmePath = await resolvePackagePath(manifest.id, 'README.md');
    await fs.writeFile(
      readmePath,
      `# ${manifest.title}\n\nGenerated from ecosystem template \`${template.id}\`.\n`,
      'utf8'
    );

    await packageLifecycleService.recordInstall(manifest.id, {
      manifest,
      reason: 'ecosystem-scaffold',
      source: `ecosystem:${template.id}`
    });

    await auditService.log(
      'PACKAGES',
      `Scaffold Ecosystem Template: ${template.id} -> ${manifest.id}`,
      { templateId: template.id, appId: manifest.id, user: req.user?.username },
      'INFO'
    );

    const created = await packageRegistryService.getSandboxApp(manifest.id);
    return res.status(201).json({
      success: true,
      template: {
        id: template.id,
        namespace: ECOSYSTEM_TEMPLATE_NAMESPACE
      },
      package: created
    });
  } catch (err) {
    const status = err.code === 'APP_ID_INVALID' || err.code?.startsWith('PACKAGE_') ? 400 : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'ECOSYSTEM_TEMPLATE_SCAFFOLD_FAILED',
      message: err.message
    });
  }
});

router.get(`/${APP_ID_ROUTE}/lifecycle`, async (req, res) => {
  try {
    const appId = appPaths.assertSafeAppId(req.params.id);
    const manifest = await readManifestRaw(appId);
    if (!manifest) {
      return res.status(404).json({
        error: true,
        code: 'PACKAGE_NOT_FOUND',
        message: 'Package not found.'
      });
    }

    const lifecycle = await packageLifecycleService.getLifecycle(appId, manifest);
    return res.json({
      success: true,
      lifecycle
    });
  } catch (err) {
    const status = err.code === 'APP_ID_INVALID' ? 400 : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'PACKAGE_LIFECYCLE_READ_FAILED',
      message: err.message
    });
  }
});

router.put(`/${APP_ID_ROUTE}/channel`, async (req, res) => {
  try {
    const appId = appPaths.assertSafeAppId(req.params.id);
    const manifest = await readManifestRaw(appId);
    if (!manifest) {
      return res.status(404).json({
        error: true,
        code: 'PACKAGE_NOT_FOUND',
        message: 'Package not found.'
      });
    }

    const channel = normalizeManifestChannel(req.body?.channel);
    const lifecycle = await packageLifecycleService.setChannel(appId, channel);
    manifest.release = {
      ...(manifest.release && typeof manifest.release === 'object' ? manifest.release : {}),
      channel
    };
    await fs.writeJson(await getManifestFilePath(appId), manifest, { spaces: 2 });

    await auditService.log(
      'PACKAGES',
      `Set Package Channel: ${appId}`,
      { appId, channel, user: req.user?.username },
      'INFO'
    );

    return res.json({
      success: true,
      channel,
      lifecycle
    });
  } catch (err) {
    const status = err.code === 'APP_ID_INVALID' ? 400 : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'PACKAGE_CHANNEL_UPDATE_FAILED',
      message: err.message
    });
  }
});

router.post(`/${APP_ID_ROUTE}/backup`, async (req, res) => {
  try {
    const appId = appPaths.assertSafeAppId(req.params.id);
    const note = String(req.body?.note || '').trim();
    const backup = await packageLifecycleService.createBackup(appId, {
      note: note || 'Manual backup requested from API'
    });

    await auditService.log(
      'PACKAGES',
      `Create Package Backup: ${appId}`,
      { appId, backupId: backup.id, user: req.user?.username },
      'INFO'
    );

    return res.status(201).json({
      success: true,
      backup
    });
  } catch (err) {
    const status =
      err.code === 'APP_ID_INVALID' || err.code === 'PACKAGE_NOT_FOUND'
        ? 400
        : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'PACKAGE_BACKUP_CREATE_FAILED',
      message: err.message
    });
  }
});

router.post(`/${APP_ID_ROUTE}/rollback`, async (req, res) => {
  try {
    const appId = appPaths.assertSafeAppId(req.params.id);
    const backupId = String(req.body?.backupId || '').trim();
    if (!backupId) {
      return res.status(400).json({
        error: true,
        code: 'PACKAGE_BACKUP_ID_REQUIRED',
        message: 'Body \"backupId\" is required.'
      });
    }

    const runtimeManager = req.app.get('runtimeManager');
    const runtimeStatus = runtimeManager?.getRuntimeStatusMap?.()[appId] || null;
    const wasRunning = runtimeStatus && ['running', 'starting', 'degraded'].includes(runtimeStatus.status);
    if (wasRunning) {
      await runtimeManager?.stopApp?.(appId).catch(() => {});
    }

    const restored = await packageLifecycleService.restoreBackup(appId, backupId);
    if (wasRunning) {
      await runtimeManager?.startApp?.(appId).catch(() => {});
    }

    await auditService.log(
      'PACKAGES',
      `Rollback Package: ${appId}`,
      { appId, backupId, user: req.user?.username },
      'WARN'
    );

    return res.json({
      success: true,
      restored
    });
  } catch (err) {
    const status =
      err.code === 'APP_ID_INVALID' ||
      err.code === 'PACKAGE_BACKUP_NOT_FOUND' ||
      err.code === 'PACKAGE_BACKUP_FILE_NOT_FOUND' ||
      err.code === 'PACKAGE_BACKUP_INVALID'
        ? 400
        : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'PACKAGE_ROLLBACK_FAILED',
      message: err.message
    });
  }
});

router.get(`/${APP_ID_ROUTE}/health`, async (req, res) => {
  try {
    const appId = appPaths.assertSafeAppId(req.params.id);
    const runtimeManager = req.app.get('runtimeManager');
    const report = await computePackageHealthReport(appId, { runtimeManager });
    await packageLifecycleService.recordQaReport(appId, {
      checkedAt: report.checkedAt,
      status: report.status,
      summary: `Package health check finished with status: ${report.status}.`,
      checks: report.checks
    });

    return res.json({
      success: true,
      report
    });
  } catch (err) {
    const status = err.code === 'APP_ID_INVALID' || err.code === 'PACKAGE_NOT_FOUND' ? 400 : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'PACKAGE_HEALTH_CHECK_FAILED',
      message: err.message
    });
  }
});

router.get(`/${APP_ID_ROUTE}`, async (req, res) => {
  try {
    const pkg = await packageRegistryService.getSandboxApp(req.params.id);
    if (!pkg) {
      return res.status(404).json({
        error: true,
        code: 'PACKAGE_NOT_FOUND',
        message: 'Package not found.'
      });
    }

    const manifest = await readManifestRaw(req.params.id);
    const lifecycle = await packageLifecycleService.getLifecycle(req.params.id, manifest || {});
    const runtimeManager = req.app.get('runtimeManager');
    const runtimeStatus = runtimeManager?.getRuntimeStatusMap
      ? runtimeManager.getRuntimeStatusMap()[req.params.id] || null
      : null;

    return res.json({
      success: true,
      package: pkg,
      runtimeStatus,
      lifecycle,
      manifest
    });
  } catch (err) {
    return res.status(400).json({
      error: true,
      code: err.code || 'PACKAGE_DETAIL_FAILED',
      message: err.message
    });
  }
});

router.get(`/${APP_ID_ROUTE}/manifest`, async (req, res) => {
  try {
    appPaths.assertSafeAppId(req.params.id);
    const manifest = await readManifestRaw(req.params.id);
    if (!manifest) {
      return res.status(404).json({
        error: true,
        code: 'PACKAGE_NOT_FOUND',
        message: 'Package not found.'
      });
    }

    return res.json({
      success: true,
      manifest
    });
  } catch (err) {
    const status = err.code === 'APP_ID_INVALID' ? 400 : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'PACKAGE_MANIFEST_READ_FAILED',
      message: err.message
    });
  }
});

router.put(`/${APP_ID_ROUTE}/manifest`, async (req, res) => {
  try {
    const routeAppId = appPaths.assertSafeAppId(req.params.id);
    const manifest = normalizeManifestInput(req.body || {}, routeAppId);
    if (manifest.id !== routeAppId) {
      return res.status(400).json({
        error: true,
        code: 'PACKAGE_ID_MISMATCH',
        message: 'Manifest id must match route id.'
      });
    }

    const appRoot = await appPaths.getAppRoot(routeAppId);
    if (!(await fs.pathExists(appRoot))) {
      return res.status(404).json({
        error: true,
        code: 'PACKAGE_NOT_FOUND',
        message: 'Package not found.'
      });
    }

    const previousManifest = await readManifestRaw(routeAppId);
    const runtimeProfile = normalizeRuntimeProfile(manifest);
    assertValidRuntimeProfile(manifest, runtimeProfile);
    const shouldValidateUiEntry = runtimeProfile.appType !== 'service';
    const entryPath = await resolvePackagePath(routeAppId, manifest.entry);
    if (shouldValidateUiEntry && !(await fs.pathExists(entryPath))) {
      return res.status(400).json({
        error: true,
        code: 'PACKAGE_ENTRY_NOT_FOUND',
        message: `Entry file "${manifest.entry}" does not exist.`
      });
    }

    await fs.writeJson(await getManifestFilePath(routeAppId), manifest, { spaces: 2 });
    if (String(previousManifest?.version || '') !== String(manifest.version || '')) {
      await packageLifecycleService.recordInstall(routeAppId, {
        manifest,
        reason: 'manifest-version-update',
        source: 'manifest:update'
      });
    } else {
      await packageLifecycleService.setChannel(routeAppId, manifest.release?.channel || 'stable');
    }
    await auditService.log(
      'PACKAGES',
      `Update Manifest: ${routeAppId}`,
      { appId: routeAppId, user: req.user?.username },
      'INFO'
    );

    const updated = await packageRegistryService.getSandboxApp(routeAppId);
    return res.json({
      success: true,
      package: updated,
      manifest
    });
  } catch (err) {
    const status = err.code === 'APP_ID_INVALID' || err.code?.startsWith('PACKAGE_') || err.code === 'RUNTIME_PROFILE_INVALID' ? 400 : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'PACKAGE_MANIFEST_UPDATE_FAILED',
      message: err.message
    });
  }
});

router.get(`/${APP_ID_ROUTE}/files`, async (req, res) => {
  try {
    const appId = appPaths.assertSafeAppId(req.params.id);
    const entries = await listDirectoryEntries(appId, req.query.path || '');
    return res.json({
      success: true,
      entries
    });
  } catch (err) {
    const isClientError = err.code === 'APP_ID_INVALID' || err.code === 'APP_PATH_OUTSIDE_ROOT' || err.code?.startsWith('PACKAGE_PATH_');
    return res.status(isClientError ? 400 : 500).json({
      error: true,
      code: err.code || 'PACKAGE_FILES_LIST_FAILED',
      message: err.message
    });
  }
});

router.get(`/${APP_ID_ROUTE}/file`, async (req, res) => {
  try {
    const appId = appPaths.assertSafeAppId(req.params.id);
    const requestedPath = String(req.query.path || '').trim();
    if (!requestedPath) {
      return res.status(400).json({
        error: true,
        code: 'PACKAGE_FILE_PATH_REQUIRED',
        message: 'Query "path" is required.'
      });
    }

    const targetFile = await resolvePackagePath(appId, requestedPath);
    if (!(await fs.pathExists(targetFile))) {
      return res.status(404).json({
        error: true,
        code: 'PACKAGE_FILE_NOT_FOUND',
        message: 'File not found.'
      });
    }

    const stats = await fs.stat(targetFile);
    if (!stats.isFile()) {
      return res.status(400).json({
        error: true,
        code: 'PACKAGE_FILE_NOT_A_FILE',
        message: 'Requested path is not a file.'
      });
    }

    const content = await fs.readFile(targetFile, 'utf8');
    return res.json({
      success: true,
      file: {
        path: normalizeRelativePath(requestedPath),
        content
      }
    });
  } catch (err) {
    const status = err.code === 'APP_ID_INVALID' || err.code === 'APP_PATH_OUTSIDE_ROOT' ? 400 : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'PACKAGE_FILE_READ_FAILED',
      message: err.message
    });
  }
});

router.put(`/${APP_ID_ROUTE}/file`, async (req, res) => {
  try {
    const appId = appPaths.assertSafeAppId(req.params.id);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const requestedPath = String(body.path || '').trim();
    if (!requestedPath) {
      return res.status(400).json({
        error: true,
        code: 'PACKAGE_FILE_PATH_REQUIRED',
        message: 'Body "path" is required.'
      });
    }

    const targetFile = await resolvePackagePath(appId, requestedPath);
    await fs.ensureDir(path.dirname(targetFile));
    await fs.writeFile(targetFile, String(body.content || ''), 'utf8');

    await auditService.log(
      'PACKAGES',
      `Write Package File: ${appId}`,
      { appId, path: normalizeRelativePath(requestedPath), user: req.user?.username },
      'INFO'
    );

    return res.json({
      success: true,
      file: {
        path: normalizeRelativePath(requestedPath)
      }
    });
  } catch (err) {
    const status = err.code === 'APP_ID_INVALID' || err.code === 'APP_PATH_OUTSIDE_ROOT' ? 400 : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'PACKAGE_FILE_WRITE_FAILED',
      message: err.message
    });
  }
});

router.post(`/${APP_ID_ROUTE}/file`, async (req, res) => {
  try {
    const appId = appPaths.assertSafeAppId(req.params.id);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const requestedPath = String(body.path || '').trim();
    const createType = body.type === 'directory' ? 'directory' : 'file';

    if (!requestedPath) {
      return res.status(400).json({
        error: true,
        code: 'PACKAGE_FILE_PATH_REQUIRED',
        message: 'Body "path" is required.'
      });
    }

    const targetPath = await resolvePackagePath(appId, requestedPath);
    if (await fs.pathExists(targetPath)) {
      return res.status(409).json({
        error: true,
        code: 'PACKAGE_FILE_ALREADY_EXISTS',
        message: 'Target path already exists.'
      });
    }

    if (createType === 'directory') {
      await fs.ensureDir(targetPath);
    } else {
      await fs.ensureDir(path.dirname(targetPath));
      await fs.writeFile(targetPath, String(body.content || ''), 'utf8');
    }

    await auditService.log(
      'PACKAGES',
      `Create Package Path: ${appId}`,
      { appId, path: normalizeRelativePath(requestedPath), type: createType, user: req.user?.username },
      'INFO'
    );

    return res.status(201).json({
      success: true,
      type: createType,
      path: normalizeRelativePath(requestedPath)
    });
  } catch (err) {
    const status = err.code === 'APP_ID_INVALID' || err.code === 'APP_PATH_OUTSIDE_ROOT' ? 400 : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'PACKAGE_PATH_CREATE_FAILED',
      message: err.message
    });
  }
});

router.delete(`/${APP_ID_ROUTE}/file`, async (req, res) => {
  try {
    const appId = appPaths.assertSafeAppId(req.params.id);
    const requestedPath = String(req.query.path || '').trim();
    if (!requestedPath) {
      return res.status(400).json({
        error: true,
        code: 'PACKAGE_FILE_PATH_REQUIRED',
        message: 'Query "path" is required.'
      });
    }

    const normalizedPath = normalizeRelativePath(requestedPath);
    if (normalizedPath === 'manifest.json') {
      return res.status(400).json({
        error: true,
        code: 'PACKAGE_MANIFEST_DELETE_FORBIDDEN',
        message: 'manifest.json cannot be deleted with this endpoint.'
      });
    }

    const targetPath = await resolvePackagePath(appId, requestedPath);
    if (!(await fs.pathExists(targetPath))) {
      return res.status(404).json({
        error: true,
        code: 'PACKAGE_FILE_NOT_FOUND',
        message: 'Target path not found.'
      });
    }

    await fs.remove(targetPath);
    await auditService.log(
      'PACKAGES',
      `Delete Package Path: ${appId}`,
      { appId, path: normalizedPath, user: req.user?.username },
      'WARN'
    );

    return res.json({
      success: true
    });
  } catch (err) {
    const status = err.code === 'APP_ID_INVALID' || err.code === 'APP_PATH_OUTSIDE_ROOT' ? 400 : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'PACKAGE_PATH_DELETE_FAILED',
      message: err.message
    });
  }
});

module.exports = router;
