const express = require('express');
const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');
const multer = require('multer');
const AdmZip = require('adm-zip');

const auth = require('../middleware/auth');
const serverConfig = require('../config/serverConfig');
const auditService = require('../services/auditService');
const fileTicketService = require('../services/fileTicketService');
const operationApprovalService = require('../services/operationApprovalService');
const packageRegistryService = require('../services/packageRegistryService');
const packageLifecycleService = require('../services/packageLifecycleService');
const channelUpdatePolicyService = require('../services/channelUpdatePolicyService');
const templateQualityGate = require('../services/templateQualityGate');
const templateCatalogService = require('../services/templateCatalogService');
const stateStore = require('../services/stateStore');
const { CAPABILITY_CATALOG } = require('../services/capabilityCatalog');
const { APP_API_POLICY, checkCompatibility } = require('../services/appApiPolicy');
const appPaths = require('../utils/appPaths');
const inventoryPaths = require('../utils/inventoryPaths');
const { resolveSafePath, isWithinAllowedRoots, isProtectedSystemPath } = require('../utils/pathPolicy');
const {
  normalizeRuntimeProfile,
  assertValidRuntimeProfile,
  toManifestRuntimeFields,
  isManagedRuntime
} = require('../services/runtimeProfiles');

const router = express.Router();

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
const LOCAL_WORKSPACE_MODES = new Set(['read', 'readwrite']);
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
let cachedAdminUsername = '';

router.get(`/${APP_ID_ROUTE}/export`, async (req, res, next) => {
  const ticket = String(req.query?.ticket || '').trim();
  if (!ticket) return next();

  try {
    const appId = appPaths.assertSafeAppId(req.params.id);
    const record = fileTicketService.getTicket(ticket, {
      scope: 'package.export',
      appId
    });
    return sendPackageExport(appId, record.user, res);
  } catch (err) {
    const status = err.status || (err.code === 'APP_ID_INVALID' ? 400 : 403);
    return res.status(status).json({
      error: true,
      code: err.code || 'PACKAGE_EXPORT_TICKET_INVALID',
      message: err.message || 'Package export ticket is invalid or expired.'
    });
  }
});

router.use(auth);

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

async function getAdminUsername() {
  if (cachedAdminUsername) return cachedAdminUsername;
  const value = await serverConfig.get('auth.adminUsername').catch(() => process.env.ADMIN_USERNAME || '');
  cachedAdminUsername = String(value || process.env.ADMIN_USERNAME || '').trim();
  return cachedAdminUsername;
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

async function computePackageDeleteTargetHash(appId, manifest = null) {
  const appRoot = await appPaths.getAppRoot(appId);
  const appDataRoot = await appPaths.getAppDataRoot(appId);
  const hash = crypto.createHash('sha256');
  hash.update('package-delete-target-v2\0');
  hash.update(JSON.stringify({ appId, manifestId: manifest?.id || null }));
  hash.update('\0');

  async function addPathSnapshot(rootPath, label, relativePath = '') {
    const targetPath = path.join(rootPath, relativePath);
    const stat = await fs.lstat(targetPath).catch(() => null);
    const normalizedRelativePath = toPosixPath(relativePath || '.');
    if (!stat) {
      hash.update(JSON.stringify({ label, path: normalizedRelativePath, missing: true }));
      hash.update('\0');
      return;
    }

    if (stat.isSymbolicLink()) {
      const linkTarget = await fs.readlink(targetPath).catch(() => '');
      hash.update(JSON.stringify({ label, path: normalizedRelativePath, type: 'symlink', linkTarget }));
      hash.update('\0');
      return;
    }

    if (stat.isDirectory()) {
      hash.update(JSON.stringify({ label, path: normalizedRelativePath, type: 'directory' }));
      hash.update('\0');
      const entries = await fs.readdir(targetPath, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        await addPathSnapshot(rootPath, label, path.join(relativePath, entry.name));
      }
      return;
    }

    if (stat.isFile()) {
      hash.update(JSON.stringify({
        label,
        path: normalizedRelativePath,
        type: 'file',
        size: stat.size,
        mode: stat.mode
      }));
      hash.update('\0');
      await new Promise((resolve, reject) => {
        const stream = fs.createReadStream(targetPath);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('error', reject);
        stream.on('end', resolve);
      });
      hash.update('\0');
      return;
    }

    hash.update(JSON.stringify({ label, path: normalizedRelativePath, type: 'other', mode: stat.mode }));
    hash.update('\0');
  }

  await addPathSnapshot(appRoot, 'appRoot');
  await addPathSnapshot(appDataRoot, 'appDataRoot');
  return `sha256:${hash.digest('hex')}`;
}

function getPackageDeleteLabel(appId, manifest = null, installed = null) {
  return String(
    installed?.title ||
    installed?.name ||
    manifest?.title ||
    manifest?.name ||
    appId
  ).trim() || appId;
}

async function buildPackageDeletePreflight(appId, options = {}) {
  const safeAppId = appPaths.assertSafeAppId(appId);
  const appRoot = await appPaths.getAppRoot(safeAppId);
  if (!(await fs.pathExists(appRoot))) {
    const err = new Error('Package not found.');
    err.code = 'PACKAGE_NOT_FOUND';
    throw err;
  }

  const manifest = await readManifestRaw(safeAppId);
  const installed = await packageRegistryService.getSandboxApp(safeAppId).catch(() => null);
  const lifecycle = await packageLifecycleService.getLifecycle(safeAppId, manifest).catch(() => null);
  const backups = Array.isArray(lifecycle?.backups) ? lifecycle.backups : [];
  const latestBackup = backups.length > 0 ? backups[backups.length - 1] : null;
  const recoverability = {
    backupAvailable: Boolean(latestBackup),
    latestBackupId: latestBackup?.id || null,
    rollbackSupported: Boolean(latestBackup)
  };
  const target = {
    type: 'package',
    id: safeAppId,
    label: getPackageDeleteLabel(safeAppId, manifest, installed)
  };
  const targetHash = await computePackageDeleteTargetHash(safeAppId, manifest);
  const operation = operationApprovalService.createOperation({
    action: 'package.delete',
    userId: options.userId,
    target,
    targetHash,
    typedConfirmation: safeAppId,
    metadata: {
      recoverability
    }
  });

  return {
    operationId: operation.operationId,
    action: 'package.delete',
    target,
    riskLevel: 'high',
    impact: [
      'Package files will be removed.',
      'Package app data will be removed.',
      'Open With defaults for this package will be cleared.'
    ],
    recoverability,
    approval: {
      required: true,
      typedConfirmation: safeAppId,
      expiresAt: operation.expiresAt
    },
    targetHash
  };
}

function buildPackageDeleteApprovalAudit(input = {}) {
  return {
    operationId: input.operationId,
    target: input.target,
    riskLevel: 'high',
    approval: {
      operationId: input.operationId,
      user: input.user,
      nonceConsumed: true,
      approvedAt: input.approvedAt || null,
      consumedAt: input.consumedAt || null,
      expiresAt: input.expiresAt || null,
      targetHash: input.targetHash || ''
    },
    recoverability: input.recoverability || {
      backupAvailable: false,
      latestBackupId: null,
      rollbackSupported: false
    },
    result: input.result,
    reason: input.reason || '',
    user: input.user
  };
}

function stableJsonStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function computeObjectHash(label, value) {
  const hash = crypto.createHash('sha256');
  hash.update(`${label}\0`);
  hash.update(stableJsonStringify(value));
  return `sha256:${hash.digest('hex')}`;
}

async function computeFileHash(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return `sha256:${hash.digest('hex')}`;
}

function getLifecycleApprovalAction(operationType) {
  const type = String(operationType || '').trim();
  if (type === 'rollback') return 'package.rollback';
  if (type === 'manifest-update') return 'package.manifest.update';
  if (type === 'update') return 'package.update';
  return 'package.install';
}

function getLifecycleApprovalCodePrefix(action) {
  if (action === 'package.rollback') return 'PACKAGE_ROLLBACK_APPROVAL';
  if (action === 'package.manifest.update') return 'PACKAGE_MANIFEST_APPROVAL';
  if (action === 'package.import') return 'PACKAGE_IMPORT_APPROVAL';
  if (action === 'package.update') return 'PACKAGE_UPDATE_APPROVAL';
  return 'PACKAGE_INSTALL_APPROVAL';
}

function getLifecycleApprovalImpact(action, preflight = {}) {
  const operationType = preflight.operation?.type || '';
  if (action === 'package.rollback') {
    return [
      'The selected package backup will replace the current package files.',
      'Runtime state may be stopped and restarted during rollback.',
      'Current package code and manifest behavior can change.'
    ];
  }
  if (action === 'package.manifest.update') {
    return [
      'Package manifest permissions, runtime settings, and file associations may change.',
      'Package lifecycle metadata may be updated.',
      'Runtime behavior can change after the manifest is saved.'
    ];
  }
  if (action === 'package.update' || operationType === 'update') {
    return [
      'Existing package files may be replaced.',
      'A backup snapshot may be created before overwrite.',
      'Executable package code, permissions, runtime behavior, and file associations can change.'
    ];
  }
  return [
    'A new package will be installed into the local inventory.',
    'Executable package code, permissions, runtime behavior, and file associations can be added.',
    'Package lifecycle state will be recorded.'
  ];
}

function buildLifecycleRecoverability(preflight = {}) {
  const backupPlan = preflight.backupPlan || {};
  const backups = Array.isArray(preflight.availableBackups) ? preflight.availableBackups : [];
  return {
    backupPlanned: Boolean(backupPlan.required),
    backupReason: backupPlan.reason || null,
    backupAvailable: backups.length > 0,
    rollbackSupported: backups.length > 0 || Boolean(backupPlan.required),
    selectedBackupId: preflight.selectedBackup?.id || preflight.operation?.backupId || null
  };
}

function createLifecycleApprovalTargetHash(action, evidence = {}) {
  return computeObjectHash('package-lifecycle-approval-target-v1', {
    action,
    ...evidence
  });
}

function attachLifecycleApproval(preflight, options = {}) {
  const action = options.action || getLifecycleApprovalAction(preflight?.operation?.type);
  const target = {
    type: action === 'package.rollback' ? 'package.rollback' : 'package',
    id: String(options.targetId || preflight?.operation?.appId || '').trim(),
    label: String(options.label || preflight?.operation?.appId || '').trim()
  };
  const recoverability = buildLifecycleRecoverability(preflight);
  const operation = operationApprovalService.createOperation({
    action,
    userId: options.userId,
    target,
    targetHash: options.targetHash,
    typedConfirmation: target.id,
    metadata: {
      recoverability,
      operation: preflight.operation || null,
      lifecycleSafeguards: preflight.lifecycleSafeguards || null
    }
  });

  return {
    ...preflight,
    action,
    target,
    riskLevel: 'high',
    impact: getLifecycleApprovalImpact(action, preflight),
    recoverability,
    operationId: operation.operationId,
    targetHash: options.targetHash,
    approval: {
      required: true,
      typedConfirmation: target.id,
      expiresAt: operation.expiresAt
    }
  };
}

function normalizeApprovalPayload(body = {}) {
  const approval = body?.approval && typeof body.approval === 'object' && !Array.isArray(body.approval)
    ? body.approval
    : body;
  return approval && typeof approval === 'object' && !Array.isArray(approval) ? approval : {};
}

function hasApprovalEvidence(approval = {}) {
  return Boolean(
    String(approval.operationId || '').trim() &&
    String(approval.nonce || '').trim() &&
    String(approval.targetHash || '').trim()
  );
}

function assertNoLegacyApprovalShortcut(approval = {}, prefix) {
  if (approval && approval.approved === true && !hasApprovalEvidence(approval)) {
    const err = new Error('Legacy approval shortcuts are not accepted for package lifecycle operations.');
    err.code = `${prefix}_LEGACY_APPROVAL_REJECTED`;
    err.status = 428;
    throw err;
  }
}

function consumeLifecycleApproval({ approval, action, targetId, targetHash, userId }) {
  const prefix = getLifecycleApprovalCodePrefix(action);
  assertNoLegacyApprovalShortcut(approval, prefix);
  if (!hasApprovalEvidence(approval)) {
    const err = new Error('Package lifecycle operation requires a scoped approval nonce.');
    err.code = `${prefix}_REQUIRED`;
    err.status = 428;
    throw err;
  }
  if (String(approval.targetHash || '').trim() !== targetHash) {
    const err = new Error('Package lifecycle approval target hash does not match the current package state.');
    err.code = `${prefix}_TARGET_CHANGED`;
    err.status = 428;
    throw err;
  }
  try {
    return operationApprovalService.consumeApproval({
      operationId: approval.operationId,
      nonce: approval.nonce,
      userId,
      action,
      targetId,
      targetHash
    });
  } catch (err) {
    const wrapped = new Error(err.message);
    wrapped.code = `${prefix}_INVALID`;
    wrapped.status = 428;
    wrapped.cause = err;
    throw wrapped;
  }
}

async function logLifecycleApprovalAudit(action, details = {}, level = 'INFO') {
  await auditService.log(
    'PACKAGES',
    action,
    {
      operationId: details.operationId || null,
      appId: details.appId || details.target?.id || null,
      target: details.target || null,
      targetHash: details.targetHash || '',
      approval: details.approval || null,
      result: details.result || null,
      user: details.user
    },
    level
  );
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

async function sendPackageExport(appId, username, res) {
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
    { appId, user: username },
    'INFO'
  );

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  return res.send(output);
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

  const releaseInput = item.release && typeof item.release === 'object' ? item.release : {};
  const releaseChannel = normalizeManifestChannel(item.channel || releaseInput.channel || 'stable');
  const publishedAt = String(item.publishedAt || releaseInput.publishedAt || item.updatedAt || item.createdAt || '').trim();
  const rolloutDelayRaw = item.rolloutDelayMs ?? releaseInput.rolloutDelayMs;
  const rolloutDelayMs = Number.isFinite(Number(rolloutDelayRaw))
    ? Math.max(0, Number(rolloutDelayRaw))
    : (channelUpdatePolicyService.CHANNEL_DELAY_MS[releaseChannel] || 0);

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
    release: {
      channel: releaseChannel,
      publishedAt,
      rolloutDelayMs
    },
    source: {
      id: source.id,
      title: source.title,
      url: source.url
    }
  };
}

function buildTemplateManifestInput(template, requestBody = {}) {
  const body = requestBody && typeof requestBody === 'object' ? requestBody : {};
  const manifestPatch = body.manifestPatch && typeof body.manifestPatch === 'object'
    ? body.manifestPatch
    : {};

  const requestedId = String(body.appId || manifestPatch.id || '').trim();
  const appId = requestedId || `${template.id}-${Date.now()}`;
  appPaths.assertSafeAppId(appId);

  const baseInput = {
    id: appId,
    title: String(body.title || manifestPatch.title || `${template.title} (${appId})`).trim(),
    description: String(body.description || manifestPatch.description || template.description || '').trim(),
    version: String(body.version || manifestPatch.version || '0.1.0').trim() || '0.1.0',
    type: template.defaults.appType,
    runtime: {
      type: template.defaults.runtimeType,
      entry: template.defaults.entry
    },
    ...(template.defaults.appType === 'hybrid'
      ? {
          ui: {
            type: 'sandbox-html',
            entry: template.defaults.uiEntry || 'ui/index.html'
          },
          service: {
            autoStart: false,
            restartPolicy: 'on-failure',
            maxRetries: 3,
            restartDelayMs: 1000,
            http: { enabled: true }
          },
          healthcheck: {
            type: 'http',
            path: '/health',
            intervalMs: 10000,
            timeoutMs: 2000
          }
        }
      : {}),
    permissions: Array.isArray(body.permissions)
      ? body.permissions
      : (Array.isArray(manifestPatch.permissions) ? manifestPatch.permissions : template.defaults.permissions)
  };

  const mergedInput = {
    ...baseInput,
    ...manifestPatch,
    id: appId,
    title: baseInput.title
  };

  if (manifestPatch.runtime && typeof manifestPatch.runtime === 'object') {
    mergedInput.runtime = {
      ...baseInput.runtime,
      ...manifestPatch.runtime
    };
  } else {
    mergedInput.runtime = baseInput.runtime;
  }

  if (Array.isArray(baseInput.permissions)) {
    mergedInput.permissions = [...baseInput.permissions];
  }

  return normalizeManifestInput(mergedInput);
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

async function buildLifecycleMap(installedApps = []) {
  const entries = await Promise.all(
    installedApps.map(async (item) => {
      const appId = String(item?.id || '').trim();
      if (!appId) return [appId, null];
      try {
        const lifecycle = await packageLifecycleService.getLifecycle(appId);
        return [appId, lifecycle];
      } catch (_err) {
        return [appId, null];
      }
    })
  );
  return new Map(entries);
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
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

APP_ID = os.environ.get("WEBOS_APP_ID", "${appId}")
PORT = int(os.environ.get("WEBOS_SERVICE_PORT", "0") or "0")

class Handler(BaseHTTPRequestHandler):
    def _json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._json({"ok": True, "appId": APP_ID})
            return
        if self.path == "/library/status":
            roots = json.loads(os.environ.get("WEBOS_ALLOWED_ROOTS_JSON", "[]"))
            self._json({
                "appId": APP_ID,
                "dataDir": os.environ.get("WEBOS_APP_DATA_DIR", ""),
                "allowedRoots": roots
            })
            return
        self._json({"error": True, "code": "NOT_FOUND", "message": "Not found"}, 404)

if not PORT:
    raise SystemExit("WEBOS_SERVICE_PORT is required")

print(f"Service {APP_ID} listening on {PORT}", flush=True)
HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
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

const http = require('http');

const appId = process.env.WEBOS_APP_ID || '${appId}';
const port = Number(process.env.WEBOS_SERVICE_PORT || 0);
const allowedRoots = (() => {
  try {
    return JSON.parse(process.env.WEBOS_ALLOWED_ROOTS_JSON || '[]');
  } catch (_err) {
    return [];
  }
})();

if (!port) {
  throw new Error('WEBOS_SERVICE_PORT is required.');
}

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/health') {
    res.end(JSON.stringify({ ok: true, appId }));
    return;
  }
  if (req.url === '/library/status') {
    res.end(JSON.stringify({
      appId,
      dataDir: process.env.WEBOS_APP_DATA_DIR || '',
      allowedRoots
    }));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: true, code: 'NOT_FOUND', message: 'Not found' }));
});

server.listen(port, '127.0.0.1', () => {
  console.log(\`Service \${appId} listening on \${port}\`);
});
`;
}

function createHybridUiTemplate({ appId, title }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; grid-template-rows: auto 1fr auto; font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; }
      header, footer { padding: 12px 16px; border-bottom: 1px solid #334155; background: #111827; }
      main { padding: 16px; display: grid; gap: 12px; align-content: start; }
      button { width: fit-content; border: 1px solid #38bdf8; background: #075985; color: white; border-radius: 6px; padding: 8px 10px; cursor: pointer; }
      pre { white-space: pre-wrap; background: #020617; border: 1px solid #334155; border-radius: 6px; padding: 12px; }
      .error { color: #fecaca; }
    </style>
  </head>
  <body>
    <header><strong>${title}</strong></header>
    <main>
      <button id="statusButton" type="button">Load Service Status</button>
      <pre id="output">Waiting for WebOS context...</pre>
    </main>
    <footer id="status">Starting...</footer>
    <script src="/api/sandbox/sdk.js" crossorigin="anonymous"></script>
    <script>
      const statusEl = document.getElementById('status');
      const outputEl = document.getElementById('output');
      const button = document.getElementById('statusButton');
      function show(value) {
        outputEl.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      }
      async function loadStatus() {
        statusEl.textContent = 'Requesting service...';
        const result = await window.WebOS.service.request({ method: 'GET', path: '/library/status' });
        statusEl.textContent = 'Service ready';
        show(result);
      }
      window.WebOS.ready()
        .then(() => {
          statusEl.textContent = 'Ready: ${appId}';
          button.addEventListener('click', () => loadStatus().catch((err) => {
            statusEl.textContent = err.message || 'Service request failed';
            statusEl.className = 'error';
            show({ code: err.code || 'SERVICE_REQUEST_FAILED', message: err.message || String(err) });
          }));
        })
        .catch((err) => {
          statusEl.textContent = err.message || 'Startup failed';
          statusEl.className = 'error';
        });
    </script>
  </body>
</html>
`;
}

function createTemplateEntryContent(templateId, options = {}) {
  const key = String(templateId || '').trim();
  const appId = String(options.appId || '').trim();
  const title = String(options.title || appId || 'Web OS App').trim();

  if (!key || key === 'empty-html') {
    return createDefaultHtmlTemplate({ appId, title });
  }

  if (key === 'memo-app') {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      body { margin: 0; padding: 12px; font-family: sans-serif; background: #0f172a; color: #e2e8f0; }
      textarea { width: 100%; min-height: 70vh; border-radius: 8px; border: 1px solid #334155; background: #111827; color: #e2e8f0; padding: 10px; box-sizing: border-box; }
      .row { display: flex; gap: 8px; margin-top: 8px; }
      button { border: 1px solid #334155; background: #1e293b; color: #e2e8f0; border-radius: 6px; padding: 6px 10px; cursor: pointer; }
    </style>
  </head>
  <body>
    <h3>${title}</h3>
    <textarea id="memo" placeholder="Write memo..."></textarea>
    <div class="row">
      <button id="save">Save</button>
      <button id="load">Load</button>
    </div>
    <script src="/api/sandbox/sdk.js" crossorigin="anonymous"></script>
    <script>
      const el = document.getElementById('memo');
      async function save() {
        const sdk = window.WebOS;
        if (!sdk?.app?.data?.write) return;
        await sdk.app.data.write({ path: 'memo.txt', content: el.value });
      }
      async function load() {
        const sdk = window.WebOS;
        if (!sdk?.app?.data?.read) return;
        try {
          const out = await sdk.app.data.read({ path: 'memo.txt' });
          el.value = out?.content || '';
        } catch (_err) {}
      }
      document.getElementById('save').onclick = save;
      document.getElementById('load').onclick = load;
      window.WebOS?.ready?.().then(load).catch(() => {});
    </script>
  </body>
</html>`;
  }

  if (key === 'todo-app') {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      body { margin: 0; padding: 12px; font-family: sans-serif; background: #0f172a; color: #e2e8f0; }
      form { display: flex; gap: 8px; margin-bottom: 10px; }
      input { flex: 1; border: 1px solid #334155; border-radius: 6px; padding: 8px; background: #111827; color: #e2e8f0; }
      button { border: 1px solid #334155; border-radius: 6px; background: #1e293b; color: #e2e8f0; padding: 7px 10px; cursor: pointer; }
      ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
      li { display: flex; align-items: center; gap: 8px; padding: 8px; border: 1px solid #334155; border-radius: 6px; background: #111827; }
      li.done span { text-decoration: line-through; opacity: 0.65; }
      .remove { margin-left: auto; }
    </style>
  </head>
  <body>
    <h3>${title}</h3>
    <form id="todo-form">
      <input id="todo-input" placeholder="Add a task" />
      <button type="submit">Add</button>
    </form>
    <ul id="todo-list"></ul>
    <script src="/api/sandbox/sdk.js" crossorigin="anonymous"></script>
    <script>
      const FILE_PATH = 'todo-items.json';
      const form = document.getElementById('todo-form');
      const input = document.getElementById('todo-input');
      const list = document.getElementById('todo-list');
      let todos = [];

      async function readTodos() {
        const sdk = window.WebOS;
        if (!sdk?.app?.data?.read) return [];
        try {
          const out = await sdk.app.data.read({ path: FILE_PATH });
          const parsed = JSON.parse(String(out?.content || '[]'));
          return Array.isArray(parsed) ? parsed : [];
        } catch (_err) {
          return [];
        }
      }

      async function writeTodos() {
        const sdk = window.WebOS;
        if (!sdk?.app?.data?.write) return;
        await sdk.app.data.write({
          path: FILE_PATH,
          content: JSON.stringify(todos, null, 2)
        });
      }

      function render() {
        list.innerHTML = '';
        todos.forEach((item, index) => {
          const row = document.createElement('li');
          if (item.done) row.className = 'done';

          const toggle = document.createElement('input');
          toggle.type = 'checkbox';
          toggle.checked = Boolean(item.done);
          toggle.addEventListener('change', async () => {
            todos[index].done = toggle.checked;
            await writeTodos();
            render();
          });

          const label = document.createElement('span');
          label.textContent = String(item.text || '');

          const remove = document.createElement('button');
          remove.className = 'remove';
          remove.type = 'button';
          remove.textContent = 'Delete';
          remove.addEventListener('click', async () => {
            todos.splice(index, 1);
            await writeTodos();
            render();
          });

          row.appendChild(toggle);
          row.appendChild(label);
          row.appendChild(remove);
          list.appendChild(row);
        });
      }

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const text = String(input.value || '').trim();
        if (!text) return;
        todos.unshift({
          id: Date.now(),
          text,
          done: false
        });
        input.value = '';
        await writeTodos();
        render();
      });

      window.WebOS?.ready?.().then(async () => {
        todos = await readTodos();
        render();
      }).catch(() => {});
    </script>
  </body>
</html>`;
  }

  if (key === 'bookmark-manager') {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      body { margin: 0; padding: 12px; font-family: sans-serif; background: #0f172a; color: #e2e8f0; }
      form { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; margin-bottom: 10px; }
      input { border: 1px solid #334155; border-radius: 6px; padding: 8px; background: #111827; color: #e2e8f0; }
      button { border: 1px solid #334155; border-radius: 6px; background: #1e293b; color: #e2e8f0; padding: 7px 10px; cursor: pointer; }
      ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
      li { display: flex; align-items: center; gap: 8px; padding: 8px; border: 1px solid #334155; border-radius: 6px; background: #111827; }
      a { color: #93c5fd; text-decoration: none; }
      .remove { margin-left: auto; }
      .toolbar { display: flex; gap: 8px; margin-bottom: 10px; }
      .hint { font-size: 12px; color: #93c5fd; margin-bottom: 8px; }
    </style>
  </head>
  <body>
    <h3>${title}</h3>
    <div class="hint">Only HTTP/HTTPS URLs are accepted. Duplicate URLs are ignored.</div>
    <div class="toolbar">
      <button id="export-bookmarks" type="button">Export JSON</button>
      <button id="import-bookmarks" type="button">Import JSON</button>
      <input id="import-file" type="file" accept="application/json" hidden />
    </div>
    <form id="bookmark-form">
      <input id="bookmark-title" placeholder="Title" />
      <input id="bookmark-url" placeholder="https://example.com" />
      <button type="submit">Add</button>
    </form>
    <ul id="bookmark-list"></ul>
    <script src="/api/sandbox/sdk.js" crossorigin="anonymous"></script>
    <script>
      const FILE_PATH = 'bookmarks.json';
      const form = document.getElementById('bookmark-form');
      const titleInput = document.getElementById('bookmark-title');
      const urlInput = document.getElementById('bookmark-url');
      const exportButton = document.getElementById('export-bookmarks');
      const importButton = document.getElementById('import-bookmarks');
      const importFileInput = document.getElementById('import-file');
      const list = document.getElementById('bookmark-list');
      let bookmarks = [];

      async function readBookmarks() {
        const sdk = window.WebOS;
        if (!sdk?.app?.data?.read) return [];
        try {
          const out = await sdk.app.data.read({ path: FILE_PATH });
          const parsed = JSON.parse(String(out?.content || '[]'));
          return Array.isArray(parsed) ? parsed : [];
        } catch (_err) {
          return [];
        }
      }

      async function writeBookmarks() {
        const sdk = window.WebOS;
        if (!sdk?.app?.data?.write) return;
        await sdk.app.data.write({
          path: FILE_PATH,
          content: JSON.stringify(bookmarks, null, 2)
        });
      }

      function normalizeUrl(value) {
        const raw = String(value || '').trim();
        if (!raw) return null;
        const candidate = /^https?:\\/\\//i.test(raw) ? raw : ('https://' + raw);
        try {
          const parsed = new URL(candidate);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
          return parsed.toString();
        } catch (_err) {
          return null;
        }
      }

      function hasDuplicateUrl(url) {
        const target = String(url || '').trim().toLowerCase();
        return bookmarks.some((item) => String(item?.url || '').trim().toLowerCase() === target);
      }

      async function addBookmark(payload) {
        const title = String(payload?.title || '').trim();
        const url = normalizeUrl(payload?.url);
        if (!url || hasDuplicateUrl(url)) return false;
        bookmarks.unshift({
          id: Date.now() + Math.random(),
          title: title || url,
          url,
          createdAt: new Date().toISOString()
        });
        await writeBookmarks();
        render();
        return true;
      }

      function render() {
        list.innerHTML = '';
        bookmarks.forEach((item, index) => {
          const row = document.createElement('li');

          const link = document.createElement('a');
          link.href = String(item.url || '#');
          link.target = '_blank';
          link.rel = 'noreferrer';
          link.textContent = String(item.title || item.url || 'Untitled');

          const remove = document.createElement('button');
          remove.className = 'remove';
          remove.type = 'button';
          remove.textContent = 'Delete';
          remove.addEventListener('click', async () => {
            bookmarks.splice(index, 1);
            await writeBookmarks();
            render();
          });

          row.appendChild(link);
          row.appendChild(remove);
          list.appendChild(row);
        });
      }

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const added = await addBookmark({
          title: String(titleInput.value || '').trim(),
          url: String(urlInput.value || '')
        });
        if (!added) return;
        titleInput.value = '';
        urlInput.value = '';
      });

      exportButton.addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(bookmarks, null, 2)], { type: 'application/json' });
        const href = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = href;
        anchor.download = 'bookmarks.json';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(href);
      });

      importButton.addEventListener('click', () => importFileInput.click());

      importFileInput.addEventListener('change', async () => {
        const file = importFileInput.files && importFileInput.files[0] ? importFileInput.files[0] : null;
        if (!file) return;
        try {
          const text = await file.text();
          const parsed = JSON.parse(text);
          const rows = Array.isArray(parsed) ? parsed : [];
          for (const row of rows.slice(0, 2000)) {
            await addBookmark({
              title: String(row?.title || '').trim(),
              url: String(row?.url || '')
            });
          }
        } catch (_err) {}
        importFileInput.value = '';
      });

      window.WebOS?.ready?.().then(async () => {
        bookmarks = await readBookmarks();
        render();
      }).catch(() => {});
    </script>
  </body>
</html>`;
  }

  if (key === 'calculator') {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      body { margin: 0; padding: 12px; font-family: sans-serif; background: #0f172a; color: #e2e8f0; }
      .display { border: 1px solid #334155; border-radius: 8px; padding: 10px; min-height: 24px; background: #111827; font-size: 20px; margin-bottom: 10px; text-align: right; }
      .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
      button { border: 1px solid #334155; border-radius: 6px; background: #1e293b; color: #e2e8f0; padding: 10px; cursor: pointer; font-size: 14px; }
      .history { margin-top: 10px; border: 1px solid #334155; border-radius: 8px; background: #111827; max-height: 160px; overflow: auto; }
      .history-item { font-family: monospace; font-size: 12px; padding: 6px 10px; border-top: 1px solid #1f2937; }
      .history-item:first-child { border-top: 0; }
    </style>
  </head>
  <body>
    <h3>${title}</h3>
    <div id="display" class="display">0</div>
    <div class="grid" id="keys"></div>
    <div id="history" class="history"></div>
    <script src="/api/sandbox/sdk.js" crossorigin="anonymous"></script>
    <script>
      const HISTORY_PATH = 'calculator-history.json';
      const display = document.getElementById('display');
      const keys = document.getElementById('keys');
      const historyEl = document.getElementById('history');
      const buttons = ['7','8','9','/','4','5','6','*','1','2','3','-','0','.','=','+','C'];
      let expr = '';
      let history = [];

      function update() {
        display.textContent = expr || '0';
      }

      function renderHistory() {
        historyEl.innerHTML = '';
        history.slice(0, 30).forEach((row) => {
          const item = document.createElement('div');
          item.className = 'history-item';
          item.textContent = row;
          historyEl.appendChild(item);
        });
      }

      async function loadHistory() {
        const sdk = window.WebOS;
        if (!sdk?.app?.data?.read) return [];
        try {
          const out = await sdk.app.data.read({ path: HISTORY_PATH });
          const parsed = JSON.parse(String(out?.content || '[]'));
          return Array.isArray(parsed) ? parsed : [];
        } catch (_err) {
          return [];
        }
      }

      async function saveHistory() {
        const sdk = window.WebOS;
        if (!sdk?.app?.data?.write) return;
        await sdk.app.data.write({
          path: HISTORY_PATH,
          content: JSON.stringify(history.slice(0, 100), null, 2)
        });
      }

      async function evaluateExpression() {
        if (!expr.trim() || expr === 'Error') return;
        const original = expr;
        try {
          const safe = /^[0-9+\\-*/.()\\s]+$/.test(expr);
          if (!safe) return;
          const result = Function('"use strict"; return (' + expr + ')')();
          expr = String(Number.isFinite(result) ? result : 'Error');
        } catch (_err) {
          expr = 'Error';
        }
        if (expr !== 'Error') {
          history.unshift(original + ' = ' + expr);
          history = history.slice(0, 100);
          await saveHistory();
          renderHistory();
        }
        update();
      }

      buttons.forEach((label) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.addEventListener('click', () => {
          if (label === 'C') {
            expr = '';
            update();
            return;
          }
          if (label === '=') {
            evaluateExpression();
            return;
          }
          expr += label;
          update();
        });
        keys.appendChild(button);
      });

      document.addEventListener('keydown', (event) => {
        const key = event.key;
        if (/^[0-9]$/.test(key) || ['+', '-', '*', '/', '(', ')', '.'].includes(key)) {
          expr += key;
          update();
          return;
        }
        if (key === 'Enter') {
          event.preventDefault();
          evaluateExpression();
          return;
        }
        if (key === 'Backspace') {
          expr = expr.slice(0, -1);
          update();
          return;
        }
        if (key.toLowerCase() === 'c' || key === 'Escape') {
          expr = '';
          update();
        }
      });

      window.WebOS?.ready?.().then(async () => {
        history = await loadHistory();
        renderHistory();
      }).catch(() => {});

      update();
    </script>
  </body>
</html>`;
  }

  if (key === 'clipboard-history') {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      body { margin: 0; padding: 12px; font-family: sans-serif; background: #0f172a; color: #e2e8f0; }
      .row { display: flex; gap: 8px; margin-bottom: 10px; }
      textarea { width: 100%; min-height: 84px; border: 1px solid #334155; border-radius: 6px; padding: 8px; box-sizing: border-box; background: #111827; color: #e2e8f0; }
      button { border: 1px solid #334155; border-radius: 6px; background: #1e293b; color: #e2e8f0; padding: 7px 10px; cursor: pointer; }
      ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
      li { padding: 8px; border: 1px solid #334155; border-radius: 6px; background: #111827; }
      pre { margin: 0; white-space: pre-wrap; word-break: break-word; }
      .actions { margin-top: 6px; display: flex; gap: 6px; }
    </style>
  </head>
  <body>
    <h3>${title}</h3>
    <div style="font-size:12px;color:#93c5fd;margin-bottom:8px;">Manual add only. No automatic host clipboard capture.</div>
    <textarea id="clip-input" placeholder="Paste or type text"></textarea>
    <div class="row">
      <button id="capture" type="button">Add</button>
      <button id="clear-all" type="button">Clear All</button>
    </div>
    <ul id="clip-list"></ul>
    <script src="/api/sandbox/sdk.js" crossorigin="anonymous"></script>
    <script>
      const FILE_PATH = 'clipboard-history.json';
      const MAX_ENTRIES = 100;
      const input = document.getElementById('clip-input');
      const captureButton = document.getElementById('capture');
      const clearAllButton = document.getElementById('clear-all');
      const list = document.getElementById('clip-list');
      let history = [];

      async function readHistory() {
        const sdk = window.WebOS;
        if (!sdk?.app?.data?.read) return [];
        try {
          const out = await sdk.app.data.read({ path: FILE_PATH });
          const parsed = JSON.parse(String(out?.content || '[]'));
          return Array.isArray(parsed) ? parsed : [];
        } catch (_err) {
          return [];
        }
      }

      async function writeHistory() {
        const sdk = window.WebOS;
        if (!sdk?.app?.data?.write) return;
        await sdk.app.data.write({
          path: FILE_PATH,
          content: JSON.stringify(history, null, 2)
        });
      }

      function render() {
        list.innerHTML = '';
        history.forEach((item, index) => {
          const row = document.createElement('li');
          const text = document.createElement('pre');
          text.textContent = String(item.text || '');

          const actions = document.createElement('div');
          actions.className = 'actions';

          const copy = document.createElement('button');
          copy.type = 'button';
          copy.textContent = 'Copy';
          copy.addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText(String(item.text || ''));
            } catch (_err) {}
          });

          const remove = document.createElement('button');
          remove.type = 'button';
          remove.textContent = 'Delete';
          remove.addEventListener('click', async () => {
            history.splice(index, 1);
            await writeHistory();
            render();
          });

          actions.appendChild(copy);
          actions.appendChild(remove);
          row.appendChild(text);
          row.appendChild(actions);
          list.appendChild(row);
        });
      }

      async function addEntry(text) {
        const normalized = String(text || '').trim();
        if (!normalized) return;
        history.unshift({
          id: Date.now() + Math.random(),
          text: normalized,
          createdAt: new Date().toISOString()
        });
        history = history.slice(0, MAX_ENTRIES);
        await writeHistory();
        render();
      }

      captureButton.addEventListener('click', async () => {
        await addEntry(input.value);
        input.value = '';
      });

      clearAllButton.addEventListener('click', async () => {
        history = [];
        await writeHistory();
        render();
      });

      window.WebOS?.ready?.().then(async () => {
        history = await readHistory();
        if (history.length > MAX_ENTRIES) {
          history = history.slice(0, MAX_ENTRIES);
          await writeHistory();
        }
        render();
      }).catch(() => {});
    </script>
  </body>
</html>`;
  }

  if (key === 'widget-basic') {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      body { margin: 0; padding: 10px; font-family: sans-serif; background: #0b1220; color: #dbeafe; }
      .card { border: 1px solid #334155; border-radius: 8px; padding: 10px; }
      .metric { font-size: 24px; font-weight: 700; }
    </style>
  </head>
  <body>
    <div class="card">
      <div>${title}</div>
      <div id="metric" class="metric">--</div>
    </div>
    <script src="/api/sandbox/sdk.js" crossorigin="anonymous"></script>
    <script>
      async function tick() {
        try {
          const info = await window.WebOS.system.info();
          const cpu = Number(info?.cpu?.currentLoad || 0).toFixed(1);
          document.getElementById('metric').textContent = cpu + '% CPU';
        } catch (_err) {}
      }
      window.WebOS?.ready?.().then(() => {
        tick();
        setInterval(tick, 3000);
      }).catch(() => {});
    </script>
  </body>
</html>`;
  }

  if (key === 'server-monitor') {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      body { margin: 0; padding: 12px; font-family: sans-serif; background: #020617; color: #e2e8f0; }
      pre { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 10px; white-space: pre-wrap; }
    </style>
  </head>
  <body>
    <h3>${title}</h3>
    <pre id="out">Loading...</pre>
    <script src="/api/sandbox/sdk.js" crossorigin="anonymous"></script>
    <script>
      async function refresh() {
        try {
          const info = await window.WebOS.system.info();
          document.getElementById('out').textContent = JSON.stringify(info, null, 2);
        } catch (err) {
          document.getElementById('out').textContent = String(err?.message || err);
        }
      }
      window.WebOS?.ready?.().then(() => { refresh(); setInterval(refresh, 4000); }).catch(() => {});
    </script>
  </body>
</html>`;
  }

  if (key === 'markdown-editor') {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      body { margin: 0; height: 100vh; display: grid; grid-template-columns: 1fr 1fr; background: #0f172a; color: #e2e8f0; font-family: sans-serif; }
      textarea { border: 0; outline: 0; padding: 12px; resize: none; background: #111827; color: #e2e8f0; }
      pre { margin: 0; padding: 12px; overflow: auto; white-space: pre-wrap; border-left: 1px solid #334155; }
    </style>
  </head>
  <body>
    <textarea id="src" placeholder="# Markdown"></textarea>
    <pre id="preview"></pre>
    <script>
      const src = document.getElementById('src');
      const preview = document.getElementById('preview');
      function render() { preview.textContent = src.value; }
      src.addEventListener('input', render);
      render();
    </script>
  </body>
</html>`;
  }

  if (key === 'markdown-preview') {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      body { margin: 0; height: 100vh; display: grid; grid-template-rows: auto 1fr; background: #0f172a; color: #e2e8f0; font-family: sans-serif; }
      .toolbar { display: flex; gap: 8px; padding: 10px; border-bottom: 1px solid #334155; }
      .layout { display: grid; grid-template-columns: 1fr 1fr; min-height: 0; }
      textarea { border: 0; outline: 0; resize: none; padding: 12px; background: #111827; color: #e2e8f0; }
      .preview { border-left: 1px solid #334155; overflow: auto; padding: 12px; }
      .status { margin-left: auto; align-self: center; font-size: 12px; color: #93c5fd; }
      button { border: 1px solid #334155; border-radius: 6px; background: #1e293b; color: #e2e8f0; padding: 6px 10px; cursor: pointer; }
      @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } .preview { border-left: 0; border-top: 1px solid #334155; } }
    </style>
  </head>
  <body>
    <div class="toolbar">
      <button id="load-app-data" type="button">Load</button>
      <button id="save-app-data" type="button">Save</button>
      <span id="status" class="status">Ready</span>
    </div>
    <div class="layout">
      <textarea id="src" placeholder="# Markdown Preview\\n\\n- edit\\n- save\\n- reload"></textarea>
      <article id="preview" class="preview"></article>
    </div>
    <script src="/api/sandbox/sdk.js" crossorigin="anonymous"></script>
    <script>
      const FILE_PATH = 'document.md';
      const src = document.getElementById('src');
      const preview = document.getElementById('preview');
      const status = document.getElementById('status');

      function setStatus(text) { status.textContent = String(text || 'Ready'); }
      function escapeHtml(value) {
        return String(value || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }
      function renderMarkdown(raw) {
        const lines = String(raw || '').split(/\\r?\\n/);
        const out = [];
        let inList = false;
        for (const line of lines) {
          const text = String(line || '');
          if (/^\\s*[-*]\\s+/.test(text)) {
            if (!inList) {
              out.push('<ul>');
              inList = true;
            }
            out.push('<li>' + escapeHtml(text.replace(/^\\s*[-*]\\s+/, '')) + '</li>');
            continue;
          }
          if (inList) {
            out.push('</ul>');
            inList = false;
          }
          if (/^###\\s+/.test(text)) {
            out.push('<h3>' + escapeHtml(text.replace(/^###\\s+/, '')) + '</h3>');
          } else if (/^##\\s+/.test(text)) {
            out.push('<h2>' + escapeHtml(text.replace(/^##\\s+/, '')) + '</h2>');
          } else if (/^#\\s+/.test(text)) {
            out.push('<h1>' + escapeHtml(text.replace(/^#\\s+/, '')) + '</h1>');
          } else if (!text.trim()) {
            out.push('<p></p>');
          } else {
            out.push('<p>' + escapeHtml(text) + '</p>');
          }
        }
        if (inList) out.push('</ul>');
        preview.innerHTML = out.join('');
      }

      async function loadFromAppData() {
        const sdk = window.WebOS;
        if (!sdk?.app?.data?.read) return;
        try {
          const payload = await sdk.app.data.read({ path: FILE_PATH });
          src.value = String(payload?.content || '');
          renderMarkdown(src.value);
          setStatus('Loaded');
        } catch (_err) {
          setStatus('No saved file');
        }
      }
      async function saveToAppData() {
        const sdk = window.WebOS;
        if (!sdk?.app?.data?.write) return;
        await sdk.app.data.write({ path: FILE_PATH, content: String(src.value || '') });
        setStatus('Saved');
      }

      src.addEventListener('input', () => renderMarkdown(src.value));
      document.getElementById('load-app-data').addEventListener('click', () => loadFromAppData().catch(() => setStatus('Load failed')));
      document.getElementById('save-app-data').addEventListener('click', () => saveToAppData().catch(() => setStatus('Save failed')));
      window.WebOS?.ready?.().then(async () => {
        renderMarkdown(src.value);
        await loadFromAppData();
      }).catch(() => renderMarkdown(src.value));
    </script>
  </body>
</html>`;
  }

  if (key === 'csv-viewer') {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      body { margin: 0; height: 100vh; display: grid; grid-template-rows: auto auto 1fr; background: #0f172a; color: #e2e8f0; font-family: sans-serif; }
      .toolbar { display: flex; gap: 8px; padding: 10px; border-bottom: 1px solid #334155; }
      .status { margin-left: auto; align-self: center; font-size: 12px; color: #93c5fd; }
      button { border: 1px solid #334155; border-radius: 6px; background: #1e293b; color: #e2e8f0; padding: 6px 10px; cursor: pointer; }
      textarea { width: 100%; min-height: 120px; box-sizing: border-box; border: 0; border-bottom: 1px solid #334155; outline: 0; padding: 12px; background: #111827; color: #e2e8f0; resize: vertical; }
      .table-wrap { overflow: auto; padding: 10px; }
      table { border-collapse: collapse; min-width: 100%; }
      th, td { border: 1px solid #334155; padding: 6px 8px; text-align: left; white-space: nowrap; }
      th { background: #1e293b; position: sticky; top: 0; }
    </style>
  </head>
  <body>
    <div class="toolbar">
      <button id="load-app-data" type="button">Load</button>
      <button id="save-app-data" type="button">Save</button>
      <button id="import-csv-file" type="button">Import File</button>
      <button id="render-csv" type="button">Render Table</button>
      <span id="status" class="status">Ready</span>
    </div>
    <textarea id="csv-input" placeholder="name,score\\nalpha,10\\nbeta,20"></textarea>
    <div class="table-wrap">
      <table id="csv-table"></table>
    </div>
    <input id="csv-file-input" type="file" accept=".csv,text/csv" style="display:none" />
    <script src="/api/sandbox/sdk.js" crossorigin="anonymous"></script>
    <script>
      const FILE_PATH = 'table.csv';
      const status = document.getElementById('status');
      const input = document.getElementById('csv-input');
      const table = document.getElementById('csv-table');
      const fileInput = document.getElementById('csv-file-input');

      function setStatus(text) { status.textContent = String(text || 'Ready'); }
      function parseCsvLine(line) {
        const row = [];
        let current = '';
        let quoted = false;
        for (let i = 0; i < line.length; i += 1) {
          const ch = line[i];
          if (ch === '"') {
            if (quoted && line[i + 1] === '"') {
              current += '"';
              i += 1;
            } else {
              quoted = !quoted;
            }
            continue;
          }
          if (ch === ',' && !quoted) {
            row.push(current);
            current = '';
            continue;
          }
          current += ch;
        }
        row.push(current);
        return row;
      }
      function parseCsv(raw) {
        return String(raw || '')
          .split(/\\r?\\n/)
          .filter((line) => line.trim().length > 0)
          .map((line) => parseCsvLine(line));
      }
      function renderTable() {
        const rows = parseCsv(input.value);
        table.innerHTML = '';
        if (!rows.length) {
          setStatus('No rows');
          return;
        }
        const [head, ...body] = rows;
        const thead = document.createElement('thead');
        const htr = document.createElement('tr');
        head.forEach((cell) => {
          const th = document.createElement('th');
          th.textContent = String(cell || '');
          htr.appendChild(th);
        });
        thead.appendChild(htr);
        table.appendChild(thead);
        const tbody = document.createElement('tbody');
        body.forEach((row) => {
          const tr = document.createElement('tr');
          row.forEach((cell) => {
            const td = document.createElement('td');
            td.textContent = String(cell || '');
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        setStatus('Rendered ' + rows.length + ' rows');
      }
      async function loadFromAppData() {
        const sdk = window.WebOS;
        if (!sdk?.app?.data?.read) return;
        try {
          const payload = await sdk.app.data.read({ path: FILE_PATH });
          input.value = String(payload?.content || '');
          renderTable();
          setStatus('Loaded');
        } catch (_err) {
          setStatus('No saved csv');
        }
      }
      async function saveToAppData() {
        const sdk = window.WebOS;
        if (!sdk?.app?.data?.write) return;
        await sdk.app.data.write({ path: FILE_PATH, content: String(input.value || '') });
        setStatus('Saved');
      }

      document.getElementById('render-csv').addEventListener('click', renderTable);
      document.getElementById('load-app-data').addEventListener('click', () => loadFromAppData().catch(() => setStatus('Load failed')));
      document.getElementById('save-app-data').addEventListener('click', () => saveToAppData().catch(() => setStatus('Save failed')));
      document.getElementById('import-csv-file').addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async (event) => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        try {
          input.value = await file.text();
          renderTable();
          setStatus('Imported file: ' + String(file.name || 'input.csv'));
        } catch (_err) {
          setStatus('Import failed');
        } finally {
          fileInput.value = '';
        }
      });
      window.WebOS?.ready?.().then(async () => {
        await loadFromAppData();
        renderTable();
      }).catch(renderTable);
    </script>
  </body>
</html>`;
  }

  if (key === 'text-processor') {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      body { margin: 0; height: 100vh; display: grid; grid-template-rows: auto auto 1fr; background: #0f172a; color: #e2e8f0; font-family: sans-serif; }
      .toolbar, .ops { display: flex; gap: 8px; padding: 10px; border-bottom: 1px solid #334155; align-items: center; flex-wrap: wrap; }
      .status { margin-left: auto; font-size: 12px; color: #93c5fd; }
      textarea { width: 100%; border: 0; outline: 0; resize: none; background: #111827; color: #e2e8f0; padding: 12px; box-sizing: border-box; }
      input { border: 1px solid #334155; border-radius: 6px; background: #111827; color: #e2e8f0; padding: 7px 8px; }
      button { border: 1px solid #334155; border-radius: 6px; background: #1e293b; color: #e2e8f0; padding: 6px 10px; cursor: pointer; }
    </style>
  </head>
  <body>
    <div class="toolbar">
      <button id="load-app-data" type="button">Load</button>
      <button id="save-app-data" type="button">Save</button>
      <button id="to-uppercase" type="button">UPPERCASE</button>
      <button id="to-lowercase" type="button">lowercase</button>
      <button id="trim-lines" type="button">Trim Lines</button>
      <span id="status" class="status">Ready</span>
    </div>
    <div class="ops">
      <input id="find-text" type="text" placeholder="find" />
      <input id="replace-text" type="text" placeholder="replace" />
      <button id="replace-all" type="button">Replace All</button>
    </div>
    <textarea id="text-input" placeholder="Paste or type text..."></textarea>
    <script src="/api/sandbox/sdk.js" crossorigin="anonymous"></script>
    <script>
      const FILE_PATH = 'text.txt';
      const textInput = document.getElementById('text-input');
      const findText = document.getElementById('find-text');
      const replaceText = document.getElementById('replace-text');
      const status = document.getElementById('status');
      function setStatus(text) { status.textContent = String(text || 'Ready'); }

      async function loadFromAppData() {
        const sdk = window.WebOS;
        if (!sdk?.app?.data?.read) return;
        try {
          const payload = await sdk.app.data.read({ path: FILE_PATH });
          textInput.value = String(payload?.content || '');
          setStatus('Loaded');
        } catch (_err) {
          setStatus('No saved text');
        }
      }
      async function saveToAppData() {
        const sdk = window.WebOS;
        if (!sdk?.app?.data?.write) return;
        await sdk.app.data.write({ path: FILE_PATH, content: String(textInput.value || '') });
        setStatus('Saved');
      }
      function replaceAll() {
        const from = String(findText.value || '');
        if (!from) {
          setStatus('find text required');
          return;
        }
        const to = String(replaceText.value || '');
        textInput.value = String(textInput.value || '').split(from).join(to);
        setStatus('Replaced');
      }
      function trimLines() {
        textInput.value = String(textInput.value || '')
          .split(/\\r?\\n/)
          .map((line) => line.trimEnd())
          .join('\\n');
        setStatus('Trimmed line endings');
      }

      document.getElementById('load-app-data').addEventListener('click', () => loadFromAppData().catch(() => setStatus('Load failed')));
      document.getElementById('save-app-data').addEventListener('click', () => saveToAppData().catch(() => setStatus('Save failed')));
      document.getElementById('to-uppercase').addEventListener('click', () => {
        textInput.value = String(textInput.value || '').toUpperCase();
        setStatus('Uppercased');
      });
      document.getElementById('to-lowercase').addEventListener('click', () => {
        textInput.value = String(textInput.value || '').toLowerCase();
        setStatus('Lowercased');
      });
      document.getElementById('trim-lines').addEventListener('click', trimLines);
      document.getElementById('replace-all').addEventListener('click', replaceAll);
      window.WebOS?.ready?.().then(loadFromAppData).catch(() => {});
    </script>
  </body>
</html>`;
  }

  if (key === 'json-formatter') {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      body { margin: 0; height: 100vh; display: grid; grid-template-rows: auto auto auto 1fr; background: #0f172a; color: #e2e8f0; font-family: sans-serif; }
      .toolbar { display: flex; gap: 8px; padding: 10px; border-bottom: 1px solid #334155; }
      .host-row { display: flex; gap: 8px; padding: 0 10px 10px; border-bottom: 1px solid #334155; }
      .policy-row { display: flex; gap: 10px; padding: 0 10px 10px; border-bottom: 1px solid #334155; align-items: center; flex-wrap: wrap; }
      .policy-row label { display: inline-flex; gap: 6px; align-items: center; font-size: 12px; color: #93c5fd; }
      .policy-row input[type="checkbox"] { margin: 0; accent-color: #60a5fa; }
      .host-row input { border: 1px solid #334155; border-radius: 6px; background: #111827; color: #e2e8f0; padding: 7px 8px; min-width: 0; }
      .policy-row input[type="text"] { border: 1px solid #334155; border-radius: 6px; background: #111827; color: #e2e8f0; padding: 7px 8px; min-width: 220px; flex: 1; }
      .host-row #host-path { flex: 1.2; }
      .host-row #grant-id { flex: 1; }
      textarea { width: 100%; height: 100%; border: 0; outline: 0; resize: none; background: #111827; color: #e2e8f0; padding: 12px; box-sizing: border-box; }
      button { border: 1px solid #334155; border-radius: 6px; background: #1e293b; color: #e2e8f0; padding: 6px 10px; cursor: pointer; }
      .status { margin-left: auto; font-size: 12px; color: #93c5fd; align-self: center; }
    </style>
  </head>
  <body>
    <div class="toolbar">
      <button id="format" type="button">Format</button>
      <button id="minify" type="button">Minify</button>
      <button id="load-file" type="button">Load File</button>
      <button id="save-file" type="button">Save File</button>
      <span id="status" class="status">Ready</span>
    </div>
    <div class="host-row">
      <input id="host-path" type="text" placeholder="/allowed/root/path/data.json" />
      <input id="grant-id" type="text" placeholder="grantId (optional)" />
      <button id="read-host" type="button">Read Host</button>
      <button id="write-host" type="button">Write Host</button>
    </div>
    <div class="policy-row">
      <label><input id="overwrite-host" type="checkbox" /> overwrite existing</label>
      <label><input id="validate-json" type="checkbox" checked /> validate json before write</label>
      <label><input id="approve-overwrite" type="checkbox" /> overwrite approval</label>
      <input id="approval-reason" type="text" placeholder="approval reason (optional)" />
    </div>
    <textarea id="json" spellcheck="false" placeholder="{&quot;hello&quot;:&quot;world&quot;}"></textarea>
    <input id="file-input" type="file" accept=".json,.txt,.log,.md" style="display:none" />
    <script>
      const input = document.getElementById('json');
      const status = document.getElementById('status');
      const fileInput = document.getElementById('file-input');
      const hostPathEl = document.getElementById('host-path');
      const grantIdEl = document.getElementById('grant-id');
      const overwriteHostEl = document.getElementById('overwrite-host');
      const validateJsonEl = document.getElementById('validate-json');
      const approveOverwriteEl = document.getElementById('approve-overwrite');
      const approvalReasonEl = document.getElementById('approval-reason');
      function setStatus(text) { status.textContent = text; }
      function normalizeHostError(err) {
        const code = String(err?.code || '').trim().toUpperCase();
        const raw = String(err?.message || err || '').trim();
        if (code === 'FS_FILE_GRANT_REQUIRED') return 'Host access requires grantId';
        if (code === 'FS_FILE_GRANT_INVALID') return 'Grant is invalid or expired';
        if (code === 'FS_FILE_GRANT_SCOPE_MISMATCH') return 'Grant does not match selected host path';
        if (code === 'FS_FILE_GRANT_MODE_DENIED') return 'Grant does not allow this operation';
        if (code === 'FS_WRITE_OVERWRITE_APPROVAL_REQUIRED' || code === 'SANDBOX_FILE_WRITE_OVERWRITE_APPROVAL_REQUIRED') return 'Target exists. Enable overwrite and approval.';
        if (code === 'FS_WRITE_APPROVAL_REQUIRED' || code === 'SANDBOX_FILE_WRITE_APPROVAL_REQUIRED') return 'Overwrite approval is required for host write.';
        if (code === 'FS_PERMISSION_DENIED') return 'Path is outside allowed roots';
        if (code === 'FS_INVALID_PATH') return 'Host path is invalid';
        if (code) return code + ': ' + (raw || 'Host operation failed');
        return raw || 'Host operation failed';
      }
      function parseJsonIfNeeded() {
        if (!validateJsonEl.checked) return { ok: true };
        try {
          JSON.parse(String(input.value || '{}'));
          return { ok: true };
        } catch (_err) {
          return { ok: false, message: 'Invalid JSON. Disable validation to write raw text.' };
        }
      }
      document.getElementById('format').addEventListener('click', () => {
        try {
          input.value = JSON.stringify(JSON.parse(input.value || '{}'), null, 2);
          setStatus('Formatted');
        } catch (_err) { setStatus('Invalid JSON'); }
      });
      document.getElementById('minify').addEventListener('click', () => {
        try {
          input.value = JSON.stringify(JSON.parse(input.value || '{}'));
          setStatus('Minified');
        } catch (_err) { setStatus('Invalid JSON'); }
      });
      document.getElementById('load-file').addEventListener('click', () => {
        fileInput.click();
      });
      fileInput.addEventListener('change', async (event) => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        const text = await file.text().catch(() => '');
        if (!text) {
          setStatus('Failed to read file');
          fileInput.value = '';
          return;
        }
        input.value = text;
        setStatus('Loaded file: ' + String(file.name || 'input'));
        fileInput.value = '';
      });
      document.getElementById('save-file').addEventListener('click', () => {
        const blob = new Blob([String(input.value || '')], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'formatted.json';
        a.click();
        URL.revokeObjectURL(url);
        setStatus('Saved to download');
      });

      document.getElementById('read-host').addEventListener('click', async () => {
        const sdk = window.WebOS;
        const path = String(hostPathEl.value || '').trim();
        const grantId = String(grantIdEl.value || '').trim();
        if (!path) {
          setStatus('host path required');
          return;
        }
        if (!sdk?.files?.read) {
          setStatus('WebOS.files.read unavailable');
          return;
        }
        if (!grantId) {
          setStatus('grantId required for host read');
          return;
        }
        try {
          const payload = await sdk.files.read({
            path,
            grantId
          });
          input.value = String(payload?.content || '');
          setStatus('Host file loaded');
        } catch (err) {
          setStatus(normalizeHostError(err));
        }
      });

      document.getElementById('write-host').addEventListener('click', async () => {
        const sdk = window.WebOS;
        const path = String(hostPathEl.value || '').trim();
        const grantId = String(grantIdEl.value || '').trim();
        if (!path) {
          setStatus('host path required');
          return;
        }
        if (!sdk?.files?.write) {
          setStatus('WebOS.files.write unavailable');
          return;
        }
        if (!grantId) {
          setStatus('grantId required for host write');
          return;
        }
        const validation = parseJsonIfNeeded();
        if (!validation.ok) {
          setStatus(validation.message);
          return;
        }
        const overwrite = overwriteHostEl.checked;
        if (overwrite && !approveOverwriteEl.checked) {
          setStatus('Enable overwrite to request parent-owned approval');
          return;
        }
        try {
          await sdk.files.write({
            path,
            grantId,
            content: String(input.value || ''),
            overwrite
          });
          setStatus(overwrite ? 'Host file overwritten' : 'Host file written');
        } catch (err) {
          setStatus(normalizeHostError(err));
        }
      });
    </script>
  </body>
</html>`;
  }

  if (key === 'api-tester') {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      body { margin: 0; height: 100vh; display: grid; grid-template-rows: auto auto auto auto auto 1fr; background: #0f172a; color: #e2e8f0; font-family: sans-serif; }
      .row { display: flex; gap: 8px; padding: 10px; }
      input, select, textarea { border: 1px solid #334155; border-radius: 6px; background: #111827; color: #e2e8f0; padding: 8px; }
      input { flex: 1; }
      textarea { width: calc(100% - 20px); margin: 0 10px 10px; min-height: 76px; resize: vertical; box-sizing: border-box; }
      button { border: 1px solid #334155; border-radius: 6px; background: #1e293b; color: #e2e8f0; padding: 8px 10px; cursor: pointer; }
      pre { margin: 0; padding: 10px; overflow: auto; background: #020617; border-top: 1px solid #334155; }
      .status { margin-left: auto; color: #93c5fd; font-size: 12px; align-self: center; }
      .collection-row #request-name { min-width: 180px; }
      .collection-row #request-folder { min-width: 150px; }
      .collection-row #request-tags { min-width: 200px; }
      .history-row select { min-width: 160px; max-width: 320px; }
    </style>
  </head>
  <body>
    <div class="row">
      <select id="method">
        <option>GET</option>
        <option>POST</option>
        <option>PUT</option>
        <option>DELETE</option>
      </select>
      <input id="url" value="/api/system/overview" />
      <button id="send" type="button">Send</button>
      <button id="save" type="button">Save Response</button>
      <span id="status" class="status">Ready</span>
    </div>
    <div class="row collection-row">
      <input id="request-name" type="text" placeholder="request name (optional)" />
      <input id="request-folder" type="text" placeholder="folder (optional)" />
      <input id="request-tags" type="text" placeholder="tags: prod, health, admin" />
      <button id="save-request" type="button">Save Request</button>
    </div>
    <div class="row history-row">
      <select id="folder-filter">
        <option value="">all folders</option>
      </select>
      <select id="tag-filter">
        <option value="">all tags</option>
      </select>
      <select id="history-select">
        <option value="">request history</option>
      </select>
      <button id="rerun" type="button">Rerun Last</button>
    </div>
    <textarea id="headers" placeholder="Authorization: Bearer ...&#10;X-Trace-Id: sample">content-type: application/json</textarea>
    <textarea id="body" placeholder='{"key":"value"}'></textarea>
    <pre id="out">Ready</pre>
    <script src="/api/sandbox/sdk.js" crossorigin="anonymous"></script>
    <script>
      const HISTORY_FILE = 'request-history.json';
      const methodEl = document.getElementById('method');
      const urlEl = document.getElementById('url');
      const requestNameEl = document.getElementById('request-name');
      const requestFolderEl = document.getElementById('request-folder');
      const requestTagsEl = document.getElementById('request-tags');
      const folderFilterEl = document.getElementById('folder-filter');
      const tagFilterEl = document.getElementById('tag-filter');
      const historySelectEl = document.getElementById('history-select');
      const headersEl = document.getElementById('headers');
      const bodyEl = document.getElementById('body');
      const statusEl = document.getElementById('status');
      const out = document.getElementById('out');
      let lastResponse = null;
      let requestHistory = [];
      let filteredHistory = [];

      function setStatus(text) {
        statusEl.textContent = String(text || 'Ready');
      }

      function parseHeaders(rawValue) {
        const headers = {};
        const lines = String(rawValue || '').split(/\\r?\\n/);
        for (const line of lines) {
          const row = String(line || '').trim();
          if (!row) continue;
          const idx = row.indexOf(':');
          if (idx <= 0) continue;
          const key = row.slice(0, idx).trim();
          const value = row.slice(idx + 1).trim();
          if (!key) continue;
          headers[key] = value;
        }
        return headers;
      }

      function toHeaderText(headers) {
        const rows = [];
        for (const [key, value] of Object.entries(headers || {})) {
          rows.push(String(key) + ': ' + String(value || ''));
        }
        return rows.join('\\n');
      }

      function parseTagList(rawValue) {
        return String(rawValue || '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 10);
      }

      function toTagText(tags) {
        return Array.isArray(tags) ? tags.join(', ') : '';
      }

      function normalizeHistoryItem(item) {
        const row = item && typeof item === 'object' ? item : {};
        return {
          id: String(row.id || ''),
          name: String(row.name || '').trim(),
          folder: String(row.folder || '').trim(),
          tags: parseTagList(Array.isArray(row.tags) ? row.tags.join(',') : row.tags),
          method: String(row.method || 'GET').toUpperCase(),
          url: String(row.url || '').trim(),
          headersText: String(row.headersText || ''),
          body: String(row.body || ''),
          createdAt: String(row.createdAt || new Date().toISOString())
        };
      }

      function readCurrentRequest() {
        return normalizeHistoryItem({
          id: 'req-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
          name: String(requestNameEl.value || '').trim(),
          folder: String(requestFolderEl.value || '').trim(),
          tags: parseTagList(requestTagsEl.value),
          method: methodEl.value,
          url: String(urlEl.value || '').trim(),
          headersText: String(headersEl.value || '').trim(),
          body: String(bodyEl.value || ''),
          createdAt: new Date().toISOString()
        });
      }

      async function loadRequestHistory() {
        const sdk = window.WebOS;
        if (!sdk?.app?.data?.read) return [];
        try {
          const out = await sdk.app.data.read({ path: HISTORY_FILE });
          const parsed = JSON.parse(String(out?.content || '[]'));
          return Array.isArray(parsed) ? parsed.map(normalizeHistoryItem).filter((item) => item.url) : [];
        } catch (_err) {
          return [];
        }
      }

      async function writeRequestHistory() {
        const sdk = window.WebOS;
        if (!sdk?.app?.data?.write) return;
        await sdk.app.data.write({
          path: HISTORY_FILE,
          content: JSON.stringify(requestHistory.slice(0, 80), null, 2)
        });
      }

      function uniqueSorted(values) {
        return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
      }

      function renderFilterOptions(selectEl, values, placeholder) {
        const previous = String(selectEl.value || '');
        selectEl.innerHTML = '';
        const head = document.createElement('option');
        head.value = '';
        head.textContent = placeholder;
        selectEl.appendChild(head);

        values.forEach((value) => {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = value;
          selectEl.appendChild(option);
        });

        if (values.includes(previous)) {
          selectEl.value = previous;
        } else {
          selectEl.value = '';
        }
      }

      function renderCollectionFilters() {
        const folders = uniqueSorted(requestHistory.map((item) => String(item.folder || '').trim()));
        const tags = uniqueSorted(
          requestHistory.flatMap((item) => (Array.isArray(item.tags) ? item.tags : [])).map((item) => String(item || '').trim())
        );
        renderFilterOptions(folderFilterEl, folders, 'all folders');
        renderFilterOptions(tagFilterEl, tags, 'all tags');
      }

      function currentHistoryFilter() {
        return {
          folder: String(folderFilterEl.value || '').trim(),
          tag: String(tagFilterEl.value || '').trim()
        };
      }

      function matchesFilter(item, filter) {
        if (!item) return false;
        if (filter.folder && String(item.folder || '').trim() !== filter.folder) return false;
        if (filter.tag) {
          const tags = Array.isArray(item.tags) ? item.tags : [];
          if (!tags.includes(filter.tag)) return false;
        }
        return true;
      }

      function renderHistoryOptions() {
        const filter = currentHistoryFilter();
        filteredHistory = requestHistory.filter((item) => matchesFilter(item, filter));
        historySelectEl.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'request history';
        historySelectEl.appendChild(placeholder);

        filteredHistory.forEach((item, index) => {
          const option = document.createElement('option');
          option.value = String(index);
          const label = String(item.name || '').trim();
          const folder = String(item.folder || '').trim();
          const tags = Array.isArray(item.tags) ? item.tags : [];
          const tagText = tags.length ? ' #' + tags.join(' #') : '';
          option.textContent = (folder ? '[' + folder + '] ' : '') + (label ? label + ' · ' : '') + String(item.method || 'GET') + ' ' + String(item.url || '') + tagText;
          historySelectEl.appendChild(option);
        });
      }

      function applyHistoryItem(item) {
        if (!item) return;
        requestNameEl.value = String(item.name || '');
        requestFolderEl.value = String(item.folder || '');
        requestTagsEl.value = toTagText(item.tags);
        methodEl.value = String(item.method || 'GET');
        urlEl.value = String(item.url || '');
        headersEl.value = String(item.headersText || '');
        bodyEl.value = String(item.body || '');
      }

      function requestDedupKey(item) {
        return String(item.method || 'GET') + '|' + String(item.url || '') + '|' + String(item.headersText || '') + '|' + String(item.body || '');
      }

      async function rememberRequest(request) {
        if (!request?.url) return;
        const normalized = normalizeHistoryItem(request);
        const key = requestDedupKey(normalized);
        const next = [normalized];
        for (const item of requestHistory) {
          const existingKey = requestDedupKey(item);
          if (existingKey === key) continue;
          next.push(item);
          if (next.length >= 80) break;
        }
        requestHistory = next;
        renderCollectionFilters();
        renderHistoryOptions();
        await writeRequestHistory();
      }

      async function sendRequest(sendOptions = {}) {
        const method = methodEl.value;
        const url = String(urlEl.value || '').trim();
        if (!url) return;
        const headers = parseHeaders(headersEl.value);
        const body = String(bodyEl.value || '').trim();
        const requestOptions = { method, headers };
        if (body && method !== 'GET' && method !== 'HEAD') {
          requestOptions.body = body;
          const hasContentType = Object.keys(headers).some((key) => key.toLowerCase() === 'content-type');
          if (!hasContentType) requestOptions.headers['content-type'] = 'application/json';
        }
        try {
          setStatus('Sending...');
          const response = await fetch(url, requestOptions);
          const text = await response.text();
          let parsed = text;
          try { parsed = JSON.parse(text); } catch (_err) {}
          lastResponse = {
            method,
            url,
            status: response.status,
            responseHeaders: Object.fromEntries(response.headers.entries()),
            body: parsed,
            receivedAt: new Date().toISOString()
          };
          out.textContent = 'HTTP ' + response.status + '\\n\\n' + (typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2));
          if (sendOptions.remember !== false) {
            await rememberRequest({
              name: String(requestNameEl.value || '').trim(),
              folder: String(requestFolderEl.value || '').trim(),
              tags: parseTagList(requestTagsEl.value),
              method,
              url,
              headersText: toHeaderText(headers),
              body: String(body || ''),
              createdAt: new Date().toISOString()
            });
          }
          setStatus('Done');
        } catch (err) {
          const message = String(err?.message || err);
          out.textContent = 'Request failed: ' + message;
          setStatus('Failed');
        }
      }

      document.getElementById('send').addEventListener('click', () => sendRequest({ remember: true }));

      document.getElementById('save').addEventListener('click', async () => {
        if (!lastResponse) {
          setStatus('No response to save');
          return;
        }
        const sdk = window.WebOS;
        if (!sdk?.app?.data?.write) {
          setStatus('app.data.write permission unavailable');
          return;
        }
        try {
          const filePath = 'responses/response-' + Date.now() + '.json';
          await sdk.app.data.write({
            path: filePath,
            content: JSON.stringify(lastResponse, null, 2)
          });
          setStatus('Saved: ' + filePath);
        } catch (err) {
          setStatus('Save failed: ' + String(err?.message || err));
        }
      });

      document.getElementById('save-request').addEventListener('click', async () => {
        const request = readCurrentRequest();
        if (!request.url) {
          setStatus('URL required');
          return;
        }
        await rememberRequest(request);
        setStatus('Request saved');
      });

      document.getElementById('rerun').addEventListener('click', async () => {
        if (filteredHistory.length === 0) {
          setStatus('No saved request');
          return;
        }
        applyHistoryItem(filteredHistory[0]);
        await sendRequest({ remember: true });
      });

      historySelectEl.addEventListener('change', async (event) => {
        const index = Number(event.currentTarget.value);
        if (!Number.isInteger(index) || index < 0) return;
        applyHistoryItem(filteredHistory[index] || null);
        setStatus('Loaded request #' + String(index + 1));
      });

      folderFilterEl.addEventListener('change', () => {
        renderHistoryOptions();
      });

      tagFilterEl.addEventListener('change', () => {
        renderHistoryOptions();
      });

      window.WebOS?.ready?.().then(async () => {
        requestHistory = await loadRequestHistory();
        renderCollectionFilters();
        renderHistoryOptions();
      }).catch(() => {});
    </script>
  </body>
</html>`;
  }

  if (key === 'snippet-vault') {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      body { margin: 0; padding: 12px; background: #0f172a; color: #e2e8f0; font-family: sans-serif; }
      .row { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; margin-bottom: 8px; }
      .row.search { grid-template-columns: 1fr auto auto auto; }
      input, textarea { border: 1px solid #334155; border-radius: 6px; background: #111827; color: #e2e8f0; padding: 8px; }
      textarea { width: 100%; min-height: 120px; box-sizing: border-box; margin-bottom: 10px; }
      button { border: 1px solid #334155; border-radius: 6px; background: #1e293b; color: #e2e8f0; padding: 7px 10px; cursor: pointer; }
      ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
      li { border: 1px solid #334155; border-radius: 6px; padding: 8px; background: #111827; }
      .head { display: flex; justify-content: space-between; gap: 8px; align-items: center; margin-bottom: 6px; }
      .meta { font-size: 12px; color: #93c5fd; }
      .report { min-height: 18px; margin-bottom: 8px; }
      pre { margin: 6px 0 0; white-space: pre-wrap; word-break: break-word; }
    </style>
  </head>
  <body>
    <h3>${title}</h3>
    <div class="row">
      <input id="name" placeholder="snippet name" />
      <input id="tags" placeholder="tags (comma separated)" />
      <button id="save" type="button">Save</button>
    </div>
    <div class="row search">
      <input id="query" placeholder="search by name, tag, or content" />
      <select id="import-mode">
        <option value="merge">merge import</option>
        <option value="overwrite">overwrite import</option>
      </select>
      <button id="export" type="button">Export JSON</button>
      <button id="import" type="button">Import JSON</button>
    </div>
    <textarea id="content" placeholder="code snippet"></textarea>
    <ul id="list"></ul>
    <input id="import-file" type="file" accept="application/json,.json" style="display:none" />
    <div id="import-report" class="meta report"></div>
    <script src="/api/sandbox/sdk.js" crossorigin="anonymous"></script>
    <script>
      const FILE_PATH = 'snippets.json';
      const nameEl = document.getElementById('name');
      const tagsEl = document.getElementById('tags');
      const queryEl = document.getElementById('query');
      const importModeEl = document.getElementById('import-mode');
      const contentEl = document.getElementById('content');
      const listEl = document.getElementById('list');
      const importFileEl = document.getElementById('import-file');
      const importReportEl = document.getElementById('import-report');
      let snippets = [];

      function setImportReport(message) {
        if (!importReportEl) return;
        importReportEl.textContent = String(message || '');
      }

      async function readSnippets() {
        const sdk = window.WebOS;
        if (!sdk?.app?.data?.read) return [];
        try {
          const out = await sdk.app.data.read({ path: FILE_PATH });
          const parsed = JSON.parse(String(out?.content || '[]'));
          return Array.isArray(parsed) ? parsed : [];
        } catch (_err) {
          return [];
        }
      }

      async function writeSnippets() {
        const sdk = window.WebOS;
        if (!sdk?.app?.data?.write) return;
        await sdk.app.data.write({ path: FILE_PATH, content: JSON.stringify(snippets.slice(0, 300), null, 2) });
      }

      function render() {
        const query = String(queryEl.value || '').trim().toLowerCase();
        const rows = snippets.filter((item) => {
          if (!query) return true;
          const name = String(item?.name || '').toLowerCase();
          const content = String(item?.content || '').toLowerCase();
          const tags = Array.isArray(item?.tags) ? item.tags.join(' ').toLowerCase() : '';
          return name.includes(query) || content.includes(query) || tags.includes(query);
        });
        listEl.innerHTML = '';
        rows.forEach((item) => {
          const index = snippets.findIndex((row) => row.id === item.id);
          const li = document.createElement('li');
          const head = document.createElement('div');
          head.className = 'head';
          const title = document.createElement('strong');
          title.textContent = String(item.name || 'snippet');
          const meta = document.createElement('span');
          const tagsText = Array.isArray(item.tags) && item.tags.length ? '#' + item.tags.join(' #') : 'untagged';
          meta.className = 'meta';
          meta.textContent = tagsText;
          const pre = document.createElement('pre');
          pre.textContent = String(item.content || '');
          const del = document.createElement('button');
          del.textContent = 'Delete';
          del.type = 'button';
          del.addEventListener('click', async () => {
            if (index < 0) return;
            snippets.splice(index, 1);
            await writeSnippets();
            render();
          });
          head.appendChild(title);
          head.appendChild(meta);
          head.appendChild(del);
          li.appendChild(head);
          li.appendChild(pre);
          listEl.appendChild(li);
        });
      }

      document.getElementById('save').addEventListener('click', async () => {
        const name = String(nameEl.value || '').trim();
        const tags = String(tagsEl.value || '')
          .split(',')
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean)
          .slice(0, 8);
        const content = String(contentEl.value || '');
        if (!name || !content.trim()) return;
        snippets.unshift({ id: Date.now() + Math.random(), name, tags, content, createdAt: new Date().toISOString() });
        nameEl.value = '';
        tagsEl.value = '';
        contentEl.value = '';
        await writeSnippets();
        render();
      });

      queryEl.addEventListener('input', render);

      document.getElementById('export').addEventListener('click', () => {
        const payload = JSON.stringify(snippets, null, 2);
        const blob = new Blob([payload], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'snippets-export.json';
        a.click();
        URL.revokeObjectURL(url);
      });

      document.getElementById('import').addEventListener('click', () => {
        setImportReport('');
        importFileEl.click();
      });

      importFileEl.addEventListener('change', async (event) => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          const parsed = JSON.parse(String(text || '[]'));
          if (!Array.isArray(parsed)) return;
          const mode = String(importModeEl.value || 'merge').trim().toLowerCase();
          const previousCount = snippets.length;
          const merged = mode === 'overwrite' ? [] : [...snippets];
          let added = 0;
          let duplicate = 0;
          let skipped = 0;
          for (const row of parsed) {
            const name = String(row?.name || '').trim();
            const content = String(row?.content || '');
            if (!name || !content.trim()) {
              skipped += 1;
              continue;
            }
            const tags = Array.isArray(row?.tags)
              ? row.tags.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean).slice(0, 8)
              : [];
            const exists = merged.some((item) => item.name === name && item.content === content);
            if (exists) {
              duplicate += 1;
              continue;
            }
            merged.unshift({
              id: Date.now() + Math.random(),
              name,
              tags,
              content,
              createdAt: String(row?.createdAt || new Date().toISOString())
            });
            added += 1;
          }
          snippets = merged.slice(0, 300);
          await writeSnippets();
          render();
          const replaced = mode === 'overwrite' ? previousCount : 0;
          setImportReport(
            mode === 'overwrite'
              ? 'Import overwrite: added ' + added + ', duplicate ' + duplicate + ', skipped ' + skipped + ', replaced ' + replaced
              : 'Import merge: added ' + added + ', duplicate ' + duplicate + ', skipped ' + skipped
          );
        } catch (_err) {
          setImportReport('Import failed: invalid JSON file');
        } finally {
          importFileEl.value = '';
        }
      });

      window.WebOS?.ready?.().then(async () => {
        snippets = await readSnippets();
        render();
      }).catch(() => {});
    </script>
  </body>
</html>`;
  }

  return createDefaultHtmlTemplate({ appId, title });
}

function resolveManifestRequestBody(body = {}) {
  const requestBody = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const hasWrappedManifest = Object.prototype.hasOwnProperty.call(requestBody, 'manifest');
  const wrappedManifest = hasWrappedManifest ? requestBody.manifest : null;

  if (hasWrappedManifest && (!wrappedManifest || typeof wrappedManifest !== 'object' || Array.isArray(wrappedManifest))) {
    const err = new Error('Body "manifest" object is required.');
    err.code = 'PACKAGE_MANIFEST_REQUIRED';
    throw err;
  }

  const approvals = requestBody.approvals && typeof requestBody.approvals === 'object' && !Array.isArray(requestBody.approvals)
    ? requestBody.approvals
    : {};

  return {
    manifestInput: hasWrappedManifest ? wrappedManifest : requestBody,
    approvals,
    wrapped: hasWrappedManifest
  };
}

function compareMediaScopes(previousScopes = [], nextScopes = []) {
  const previous = Array.isArray(previousScopes) ? previousScopes : [];
  const next = Array.isArray(nextScopes) ? nextScopes : [];
  const previousSet = new Set(previous);
  const nextSet = new Set(next);

  return {
    previous,
    next,
    added: next.filter((scope) => !previousSet.has(scope)),
    removed: previous.filter((scope) => !nextSet.has(scope))
  };
}

function buildMediaScopeReview(manifest = {}, options = {}) {
  const previousScopes = packageRegistryService.normalizeManifestMediaScopes(options.previousManifest || {});
  const scopes = packageRegistryService.normalizeManifestMediaScopes(manifest, { strict: true });
  const approvalReceived = Boolean(options.approvalReceived);
  const scopeChanges = compareMediaScopes(previousScopes, scopes);
  const requiresApproval = scopes.length > 0;
  const blockers = requiresApproval && !approvalReceived
    ? [
        {
          code: 'PACKAGE_MEDIA_SCOPE_APPROVAL_REQUIRED',
          message: 'Media scopes require explicit approval before this update can be saved.',
          area: 'media'
        }
      ]
    : [];

  return {
    scopes,
    summary: {
      total: scopes.length,
      previous: previousScopes.length,
      added: scopeChanges.added.length,
      removed: scopeChanges.removed.length
    },
    requiresApproval,
    approvalReceived,
    blockers,
    changes: scopeChanges
  };
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
  const mediaScopes = packageRegistryService.normalizeManifestMediaScopes(input, { strict: true });
  const fileAssociations = packageRegistryService.normalizeManifestFileAssociations(input?.fileAssociations, { strict: true });
  const permissions = Array.isArray(input?.permissions)
    ? input.permissions.map((permission) => String(permission)).filter(Boolean)
    : [];
  const contributes = packageRegistryService.normalizeManifestContributes(
    input?.contributes,
    fileAssociations,
    { strict: true, permissions }
  );
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
    ...(runtimeFields.ui ? { ui: runtimeFields.ui } : {}),
    service: runtimeFields.service,
    healthcheck: runtimeFields.healthcheck,
    resources: runtimeFields.resources,
    icon: normalizedIcon,
    author: String(input?.author || '').trim(),
    repository: String(input?.repository || '').trim(),
    singleton: Boolean(input?.singleton),
    entry: runtimeProfile.appType === 'hybrid'
      ? (runtimeProfile.ui?.entry || entry)
      : (runtimeProfile.entry || entry),
    permissions,
    capabilities: Array.isArray(input?.capabilities)
      ? input.capabilities.map((capability) => String(capability)).filter(Boolean)
      : [],
    media: {
      scopes: mediaScopes
    },
    fileAssociations,
    contributes,
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
    const uiEntry = runtimeProfile.appType === 'hybrid'
      ? runtimeProfile.ui?.entry
      : runtimeProfile.entry;
    const entryPath = await resolvePackagePath(safeAppId, uiEntry || manifest.entry || DEFAULT_ENTRY).catch(() => '');
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
        message: `Entry file "${uiEntry || manifest.entry || DEFAULT_ENTRY}" was not found.`
      });
    }
  }

  const dependencies = normalizeManifestDependencies(manifest.dependencies);
  if (dependencies.length > 0) {
    const installed = await packageRegistryService.listSandboxApps();
    const installedMap = new Map(
      installed.map((item) => [
        String(item.id || '').trim(),
        String(item.version || '0.0.0').trim() || '0.0.0'
      ])
    );

    for (const dependency of dependencies) {
      const installedVersion = installedMap.get(dependency.id) || '';
      const exists = Boolean(installedVersion);
      const versionMatches = exists
        ? packageLifecycleService.matchesVersionRange(installedVersion, dependency.version || '*')
        : false;

      if (exists && versionMatches) {
        checks.push({
          id: `dependency.${dependency.id}`,
          level: 'pass',
          message: `Dependency "${dependency.id}" is installed (${installedVersion}).`,
          installedVersion,
          versionRange: dependency.version || '*'
        });
      } else if (exists && dependency.optional) {
        checks.push({
          id: `dependency.${dependency.id}`,
          level: 'warn',
          code: 'DEPENDENCY_VERSION_MISMATCH',
          message: `Optional dependency "${dependency.id}" version ${installedVersion} does not satisfy ${dependency.version || '*'}.`,
          installedVersion,
          versionRange: dependency.version || '*'
        });
      } else if (exists) {
        checks.push({
          id: `dependency.${dependency.id}`,
          level: 'fail',
          code: 'DEPENDENCY_VERSION_MISMATCH',
          message: `Required dependency "${dependency.id}" version ${installedVersion} does not satisfy ${dependency.version || '*'}.`,
          installedVersion,
          versionRange: dependency.version || '*'
        });
      } else if (dependency.optional) {
        checks.push({
          id: `dependency.${dependency.id}`,
          level: 'warn',
          message: `Optional dependency "${dependency.id}" is not installed.`,
          versionRange: dependency.version || '*'
        });
      } else {
        checks.push({
          id: `dependency.${dependency.id}`,
          level: 'fail',
          code: 'DEPENDENCY_MISSING',
          message: `Required dependency "${dependency.id}" is not installed.`,
          versionRange: dependency.version || '*'
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

function parseBooleanQuery(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function parseBoundedLimit(value, fallback = 20, max = 50) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(numeric)));
}

async function buildPackageOpsSummary(appId, options = {}) {
  const safeAppId = appPaths.assertSafeAppId(appId);
  const runtimeManager = options.runtimeManager || null;
  const refreshHealth = Boolean(options.refreshHealth);
  const eventsLimit = parseBoundedLimit(options.eventsLimit, 20, 50);

  const installedPackage = await packageRegistryService.getSandboxApp(safeAppId);
  if (!installedPackage) {
    const err = new Error('Package not found.');
    err.code = 'PACKAGE_NOT_FOUND';
    throw err;
  }

  const manifest = await readManifestRaw(safeAppId);

  let lifecycle = null;
  try {
    lifecycle = await packageLifecycleService.getLifecycle(safeAppId, manifest || {});
  } catch (err) {
    const wrapped = new Error('Failed to fetch package lifecycle.');
    wrapped.code = 'PACKAGE_LIFECYCLE_FETCH_FAILED';
    wrapped.cause = err;
    throw wrapped;
  }

  let recentRuntimeEvents = [];
  if (runtimeManager && typeof runtimeManager.getEvents === 'function') {
    try {
      const eventsResult = runtimeManager.getEvents(safeAppId, { limit: eventsLimit });
      recentRuntimeEvents = Array.isArray(eventsResult?.items) ? eventsResult.items : [];
    } catch (err) {
      const wrapped = new Error('Failed to fetch recent runtime events.');
      wrapped.code = 'PACKAGE_RUNTIME_EVENTS_FETCH_FAILED';
      wrapped.cause = err;
      throw wrapped;
    }
  }

  const runtimeStatus = runtimeManager?.getRuntimeStatusMap?.()[safeAppId] || null;
  let lastHealthReport = lifecycle?.lastQaReport || null;

  if (refreshHealth) {
    if (!runtimeManager) {
      const err = new Error('Runtime manager is not initialized.');
      err.code = 'PACKAGE_RUNTIME_MANAGER_UNAVAILABLE';
      throw err;
    }

    try {
      const report = await computePackageHealthReport(safeAppId, { runtimeManager });
      await packageLifecycleService.recordQaReport(safeAppId, {
        checkedAt: report.checkedAt,
        status: report.status,
        summary: `Package health check finished with status: ${report.status}.`,
        checks: report.checks
      });
      lastHealthReport = {
        checkedAt: report.checkedAt,
        status: report.status,
        summary: `Package health check finished with status: ${report.status}.`,
        checks: report.checks
      };
    } catch (err) {
      const wrapped = new Error('Failed to refresh package health report.');
      wrapped.code = 'PACKAGE_HEALTH_REPORT_FETCH_FAILED';
      wrapped.cause = err;
      throw wrapped;
    }
  }

  const safeguards = buildLifecycleSafeguards({
    operationType: 'ops-summary',
    existing: true,
    lifecycle,
    runtimeStatus,
    dependencyCompatibility: lastHealthReport
      ? { checks: Array.isArray(lastHealthReport.checks) ? lastHealthReport.checks : [] }
      : null,
    backupPlan: { required: false }
  });

  return {
    appId: safeAppId,
    runtimeStatus,
    lifecycle,
    localWorkspaceBridge: normalizeLocalWorkspaceBridgeSummary(lifecycle?.workspaceBridge),
    recentRuntimeEvents,
    lastHealthReport,
    lifecycleSafeguards: safeguards
  };
}

function parseBooleanBody(value) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

async function clearOpenWithDefaultsForRemovedApp(appId) {
  const normalizedAppId = String(appId || '').trim();
  if (!normalizedAppId) {
    return { removedExtensions: [] };
  }

  const current = await stateStore.readState('contextMenu');
  const table = current?.openWithByExtension && typeof current.openWithByExtension === 'object'
    ? current.openWithByExtension
    : {};
  const nextTable = {};
  const removedExtensions = [];

  for (const [extension, targetAppId] of Object.entries(table)) {
    if (String(targetAppId || '').trim() === normalizedAppId) {
      removedExtensions.push(extension);
      continue;
    }
    nextTable[extension] = targetAppId;
  }

  if (removedExtensions.length === 0) {
    return { removedExtensions };
  }

  await stateStore.writeState('contextMenu', {
    ...current,
    openWithByExtension: nextTable
  });

  return { removedExtensions };
}

function parseMultipartJsonField(value, fieldName) {
  if (value == null || typeof value === 'object') {
    return value;
  }

  const codePrefix = String(fieldName || 'FIELD')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toUpperCase();
  const raw = String(value || '').trim();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      const err = new Error(`${fieldName} must be a JSON object when provided as a multipart field.`);
      err.code = `${codePrefix}_INVALID`;
      throw err;
    }
    return parsed;
  } catch (err) {
    if (err.code) throw err;
    const wrapped = new Error(`${fieldName} must be valid JSON when provided as a multipart field.`);
    wrapped.code = `${codePrefix}_INVALID_JSON`;
    throw wrapped;
  }
}

async function resolveRegistryInstallTarget(body = {}) {
  const sourceId = String(body.sourceId || '').trim();
  const packageId = String(body.packageId || '').trim();
  const overwrite = parseBooleanBody(body.overwrite);
  const forcePolicyBypass = parseBooleanBody(body.forcePolicyBypass);
  let zipUrl = String(body.zipUrl || '').trim();
  let targetPackage = null;

  if (!zipUrl) {
    if (!sourceId || !packageId) {
      const err = new Error('Either zipUrl or (sourceId + packageId) is required.');
      err.code = 'REGISTRY_INSTALL_TARGET_REQUIRED';
      throw err;
    }

    const sources = await readRegistrySources();
    const source = sources.find((item) => item.id === sourceId);
    if (!source) {
      const err = new Error(`Registry source "${sourceId}" not found.`);
      err.code = 'REGISTRY_SOURCE_NOT_FOUND';
      throw err;
    }

    const packages = await fetchRegistryPackagesFromSource(source);
    targetPackage = packages.find((item) => item.id === packageId);
    if (!targetPackage) {
      const err = new Error(`Package "${packageId}" was not found in source "${sourceId}".`);
      err.code = 'REGISTRY_PACKAGE_NOT_FOUND';
      throw err;
    }

    if (!targetPackage.zipUrl) {
      const err = new Error(`Package "${packageId}" does not expose a zipUrl.`);
      err.code = 'REGISTRY_PACKAGE_ZIP_MISSING';
      throw err;
    }

    zipUrl = targetPackage.zipUrl;
  }

  return {
    sourceId,
    packageId,
    zipUrl,
    overwrite,
    forcePolicyBypass,
    targetPackage
  };
}

function buildPermissionReview(manifest = {}) {
  const permissionIds = Array.isArray(manifest.permissions)
    ? manifest.permissions.map((item) => String(item || '').trim()).filter(Boolean)
    : [];

  const catalogMap = new Map(CAPABILITY_CATALOG.map((item) => [item.id, item]));
  const permissions = permissionIds.map((permission) => {
    const metadata = catalogMap.get(permission);
    return {
      id: permission,
      category: metadata?.category || 'unknown',
      risk: metadata?.risk || 'unknown',
      summary: metadata?.summary || 'No capability catalog metadata available.',
      inCapabilityCatalog: Boolean(metadata)
    };
  });

  const riskCounts = {
    low: 0,
    medium: 0,
    high: 0,
    unknown: 0
  };
  for (const permission of permissions) {
    const risk = ['low', 'medium', 'high'].includes(permission.risk) ? permission.risk : 'unknown';
    riskCounts[risk] += 1;
  }

  const highestRisk = riskCounts.high > 0
    ? 'high'
    : riskCounts.medium > 0
      ? 'medium'
      : riskCounts.low > 0
        ? 'low'
        : (permissions.length > 0 ? 'unknown' : 'none');

  return {
    permissions,
    summary: {
      total: permissions.length,
      byRisk: riskCounts,
      highestRisk
    }
  };
}

function buildToolPackageReview(manifest = {}) {
  const runtimeProfile = normalizeRuntimeProfile(manifest);
  const permissionIds = new Set(
    Array.isArray(manifest.permissions)
      ? manifest.permissions.map((item) => String(item || '').trim()).filter(Boolean)
      : []
  );
  const isService = runtimeProfile.appType === 'service';
  const isHybrid = runtimeProfile.appType === 'hybrid';
  const isToolPackage = isService || isHybrid;
  const checks = [];

  if (!isToolPackage) {
    return {
      applies: false,
      status: 'pass',
      summary: 'Not a service or hybrid tool package.',
      checks
    };
  }

  checks.push({
    id: 'tool.runtime.type',
    status: isManagedRuntime(runtimeProfile) ? 'pass' : 'fail',
    label: 'Runtime type',
    detail: `${runtimeProfile.runtimeType} (${runtimeProfile.appType})`
  });
  checks.push({
    id: 'tool.runtime.command',
    status: runtimeProfile.command || runtimeProfile.runtimeType !== 'binary' ? 'pass' : 'warn',
    label: 'Runtime command',
    detail: runtimeProfile.command || (runtimeProfile.runtimeType === 'process-node'
      ? 'node (allowlisted default)'
      : runtimeProfile.runtimeType === 'process-python'
        ? 'python3 (allowlisted default)'
        : 'Binary runtime should declare an allowlisted command or executable entry.')
  });
  checks.push({
    id: 'tool.service.entry',
    status: runtimeProfile.entry || runtimeProfile.command ? 'pass' : 'fail',
    label: 'Managed service entry',
    detail: runtimeProfile.entry || runtimeProfile.command || 'Tool packages must declare runtime.entry or runtime.command for the managed service.'
  });
  if (isHybrid) {
    checks.push({
      id: 'tool.ui.entry',
      status: runtimeProfile.ui?.entry ? 'pass' : 'fail',
      label: 'Sandbox UI entry',
      detail: runtimeProfile.ui?.entry || 'Hybrid tool packages must declare ui.entry for the sandbox launch surface.'
    });
  }
  checks.push({
    id: 'tool.permission.runtime.process',
    status: permissionIds.has('runtime.process') ? 'pass' : 'fail',
    label: 'runtime.process permission',
    detail: permissionIds.has('runtime.process')
      ? 'Managed runtime permission is declared.'
      : 'Tool packages need runtime.process so the backend can start the local service.'
  });
  if (isHybrid) {
    checks.push({
      id: 'tool.permission.service.bridge',
      status: permissionIds.has('service.bridge') ? 'pass' : 'fail',
      label: 'service.bridge permission',
      detail: permissionIds.has('service.bridge')
        ? 'Sandbox UI can request its paired service through the bridge.'
        : 'Hybrid tool UIs need service.bridge to call the paired local service.'
    });
  }
  checks.push({
    id: 'tool.service.http',
    status: runtimeProfile.service?.http?.enabled ? 'pass' : 'warn',
    label: 'HTTP service bridge',
    detail: runtimeProfile.service?.http?.enabled
      ? 'service.http.enabled is true.'
      : 'Enable service.http.enabled when the sandbox UI talks to an HTTP service.'
  });
  checks.push({
    id: 'tool.service.lifecycle',
    status: 'pass',
    label: 'Service lifecycle',
    detail: `autoStart=${Boolean(runtimeProfile.service?.autoStart)}, restartPolicy=${runtimeProfile.service?.restartPolicy || 'never'}, maxRetries=${Number(runtimeProfile.service?.maxRetries || 0)}, restartDelayMs=${Number(runtimeProfile.service?.restartDelayMs || 0)}`
  });
  checks.push({
    id: 'tool.healthcheck',
    status: runtimeProfile.healthcheck?.type === 'none' ? 'warn' : 'pass',
    label: 'Healthcheck',
    detail: runtimeProfile.healthcheck?.type === 'http'
      ? `http ${runtimeProfile.healthcheck.path || '/'} every ${runtimeProfile.healthcheck.intervalMs}ms`
      : `${runtimeProfile.healthcheck?.type || 'none'}`
  });
  checks.push({
    id: 'tool.permission.network',
    status: permissionIds.has('network.outbound') ? 'warn' : 'pass',
    label: 'Network access',
    detail: permissionIds.has('network.outbound')
      ? 'Package declares outbound network access.'
      : 'No outbound network permission declared.'
  });
  checks.push({
    id: 'tool.permission.allowedRoots',
    status: permissionIds.has('host.allowedRoots.write')
      ? 'warn'
      : (permissionIds.has('host.allowedRoots.read') ? 'warn' : 'pass'),
    label: 'Allowed roots access',
    detail: permissionIds.has('host.allowedRoots.write')
      ? 'Package can request read/write awareness of configured allowedRoots.'
      : (permissionIds.has('host.allowedRoots.read')
          ? 'Package can request read awareness of configured allowedRoots.'
          : 'No allowedRoots host access permission declared.')
  });
  checks.push({
    id: 'tool.permission.appData',
    status: permissionIds.has('app.data.write') || permissionIds.has('app.data.read') ? 'pass' : 'warn',
    label: 'App data access',
    detail: permissionIds.has('app.data.write')
      ? 'Package can read/write its app-owned data directory.'
      : (permissionIds.has('app.data.read')
          ? 'Package can read its app-owned data directory.'
          : 'No explicit app data permission declared.')
  });

  const failCount = checks.filter((item) => item.status === 'fail').length;
  const warnCount = checks.filter((item) => item.status === 'warn').length;

  return {
    applies: true,
    status: failCount > 0 ? 'fail' : (warnCount > 0 ? 'warn' : 'pass'),
    summary: failCount > 0
      ? 'Tool package contract has blocking gaps.'
      : (warnCount > 0 ? 'Tool package contract needs review.' : 'Tool package contract is ready.'),
    runtimeType: runtimeProfile.runtimeType,
    serviceEntry: runtimeProfile.entry || '',
    uiEntry: runtimeProfile.ui?.entry || '',
    checks
  };
}

async function evaluateManifestDependencyCompatibility(manifest = {}) {
  const runtimeProfile = normalizeRuntimeProfile(manifest);
  const checks = [];
  const dependencies = normalizeManifestDependencies(manifest.dependencies);
  const installed = await packageRegistryService.listSandboxApps();
  const installedMap = new Map(
    installed.map((item) => [
      String(item.id || '').trim(),
      String(item.version || '0.0.0').trim() || '0.0.0'
    ])
  );

  for (const dependency of dependencies) {
    const installedVersion = installedMap.get(dependency.id) || '';
    const exists = Boolean(installedVersion);
    const versionRange = dependency.version || '*';
    const versionMatches = exists
      ? packageLifecycleService.matchesVersionRange(installedVersion, versionRange)
      : false;

    if (exists && versionMatches) {
      checks.push({
        id: `dependency.${dependency.id}`,
        level: 'pass',
        message: `Dependency "${dependency.id}" is installed (${installedVersion}).`,
        installedVersion,
        versionRange
      });
      continue;
    }
    if (exists && dependency.optional) {
      checks.push({
        id: `dependency.${dependency.id}`,
        level: 'warn',
        code: 'DEPENDENCY_VERSION_MISMATCH',
        message: `Optional dependency "${dependency.id}" version ${installedVersion} does not satisfy ${versionRange}.`,
        installedVersion,
        versionRange
      });
      continue;
    }
    if (exists) {
      checks.push({
        id: `dependency.${dependency.id}`,
        level: 'fail',
        code: 'DEPENDENCY_VERSION_MISMATCH',
        message: `Required dependency "${dependency.id}" version ${installedVersion} does not satisfy ${versionRange}.`,
        installedVersion,
        versionRange
      });
      continue;
    }
    if (dependency.optional) {
      checks.push({
        id: `dependency.${dependency.id}`,
        level: 'warn',
        message: `Optional dependency "${dependency.id}" is not installed.`,
        versionRange
      });
      continue;
    }
    checks.push({
      id: `dependency.${dependency.id}`,
      level: 'fail',
      code: 'DEPENDENCY_MISSING',
      message: `Required dependency "${dependency.id}" is not installed.`,
      versionRange
    });
  }

  if (dependencies.length === 0) {
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

  if (compatibility.requiredRuntimeTypes.length > 0) {
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

  const status = checks.some((check) => check.level === 'fail')
    ? 'fail'
    : checks.some((check) => check.level === 'warn')
      ? 'warn'
      : 'pass';

  return {
    status,
    serverVersion,
    dependencies,
    compatibility,
    checks
  };
}

function buildBackupPlanSummary(options = {}) {
  const overwrite = Boolean(options.overwrite);
  const hasExisting = Boolean(options.existing);
  const required = overwrite && hasExisting;
  return {
    required,
    reason: required ? 'overwrite-update' : 'not-required',
    note: required
      ? 'A backup snapshot should be created before overwrite/update execution.'
      : 'No overwrite snapshot is required for this operation.'
  };
}

function buildLifecycleSafeguards(options = {}) {
  const operationType = String(options.operationType || 'operation').trim() || 'operation';
  const existing = Boolean(options.existing);
  const lifecycle = options.lifecycle && typeof options.lifecycle === 'object' ? options.lifecycle : null;
  const runtimeStatus = options.runtimeStatus && typeof options.runtimeStatus === 'object' ? options.runtimeStatus : null;
  const dependencyCompatibility =
    options.dependencyCompatibility && typeof options.dependencyCompatibility === 'object'
      ? options.dependencyCompatibility
      : null;
  const backupPlan = options.backupPlan && typeof options.backupPlan === 'object' ? options.backupPlan : null;

  const checks = [];
  const backups = Array.isArray(lifecycle?.backups) ? lifecycle.backups : [];
  const backupCount = backups.length;
  const isRuntimeHot = ['running', 'starting', 'degraded'].includes(String(runtimeStatus?.status || '').toLowerCase());

  if (!existing) {
    checks.push({
      id: 'safeguard.lifecycle',
      level: 'pass',
      message: 'No prior lifecycle state found; fresh install path is clear.'
    });
  } else if (operationType === 'rollback') {
    if (backupCount === 0) {
      checks.push({
        id: 'safeguard.rollback.backups',
        level: 'fail',
        code: 'ROLLBACK_BACKUP_REQUIRED',
        message: 'Rollback requires at least one valid backup snapshot.'
      });
    } else {
      checks.push({
        id: 'safeguard.rollback.backups',
        level: 'pass',
        message: `Rollback snapshots available (${backupCount}).`
      });
    }
  } else if (backupPlan?.required && backupCount === 0) {
    checks.push({
      id: 'safeguard.update.backup-readiness',
      level: 'warn',
      code: 'UPDATE_BACKUP_RECOMMENDED',
      message: 'No historical backup found. Create a snapshot before overwrite/update.'
    });
  } else {
    checks.push({
      id: 'safeguard.backup-readiness',
      level: 'pass',
      message: backupCount > 0
        ? `Backup snapshots available (${backupCount}).`
        : 'No backup requirement for this operation.'
    });
  }

  if (isRuntimeHot && (operationType === 'update' || operationType === 'manifest-update' || operationType === 'rollback')) {
    checks.push({
      id: 'safeguard.runtime-hot',
      level: 'warn',
      code: 'RUNTIME_ACTIVE_DURING_CHANGE',
      message: `Runtime is currently ${runtimeStatus.status}. Consider stop/backup before ${operationType}.`
    });
  } else {
    checks.push({
      id: 'safeguard.runtime-hot',
      level: 'pass',
      message: 'Runtime active-change risk is acceptable.'
    });
  }

  const failedDependencyChecks = Array.isArray(dependencyCompatibility?.checks)
    ? dependencyCompatibility.checks.filter((check) => check.level === 'fail')
    : [];
  if (failedDependencyChecks.length > 0) {
    checks.push({
      id: 'safeguard.compatibility-critical',
      level: 'fail',
      code: 'DEPENDENCY_COMPATIBILITY_BLOCKED',
      message: `Critical dependency/compatibility failures detected (${failedDependencyChecks.length}).`
    });
  } else {
    checks.push({
      id: 'safeguard.compatibility-critical',
      level: 'pass',
      message: 'No critical dependency/compatibility failures detected.'
    });
  }

  const qaCheckedAtRaw = lifecycle?.lastQaReport?.checkedAt;
  const qaCheckedAt = qaCheckedAtRaw ? new Date(qaCheckedAtRaw) : null;
  const qaAgeHours = qaCheckedAt && !Number.isNaN(qaCheckedAt.getTime())
    ? Math.floor((Date.now() - qaCheckedAt.getTime()) / (1000 * 60 * 60))
    : null;
  if (qaAgeHours == null) {
    checks.push({
      id: 'safeguard.qa-recency',
      level: existing ? 'warn' : 'pass',
      message: existing
        ? 'No recent QA report found. Run health check before high-impact changes.'
        : 'QA recency not required for first install.'
    });
  } else if (qaAgeHours > 72) {
    checks.push({
      id: 'safeguard.qa-recency',
      level: 'warn',
      message: `Last QA report is ${qaAgeHours}h old. Refresh health diagnostics before change.`
    });
  } else {
    checks.push({
      id: 'safeguard.qa-recency',
      level: 'pass',
      message: `Last QA report is recent (${qaAgeHours}h).`
    });
  }

  const status = checks.some((check) => check.level === 'fail')
    ? 'fail'
    : checks.some((check) => check.level === 'warn')
      ? 'warn'
      : 'pass';

  return {
    status,
    checks,
    summary: status === 'fail'
      ? 'Lifecycle safeguards found blocking risks.'
      : status === 'warn'
        ? 'Lifecycle safeguards found warnings to review.'
        : 'Lifecycle safeguards are clear.'
  };
}

function toSafeguardBlockers(safeguards = null) {
  const checks = Array.isArray(safeguards?.checks) ? safeguards.checks : [];
  return checks
    .filter((check) => check.level === 'fail')
    .map((check) => ({
      code: check.code || 'LIFECYCLE_SAFEGUARD_FAILED',
      message: check.message || 'Lifecycle safeguard check failed.',
      area: 'lifecycleSafeguard'
    }));
}

function buildExternalOnboardingGuide(options = {}) {
  const manifest = options.manifest && typeof options.manifest === 'object' ? options.manifest : {};
  const operationType = String(options.operationType || 'create').trim() || 'create';
  const templateId = String(options.templateId || '').trim();
  const sourceId = String(options.sourceId || '').trim();
  const packageId = String(options.packageId || manifest.id || '').trim();
  const zipUrl = String(options.zipUrl || '').trim();
  const qualityGate = options.qualityGate && typeof options.qualityGate === 'object' ? options.qualityGate : null;
  const dependencyCompatibility =
    options.dependencyCompatibility && typeof options.dependencyCompatibility === 'object'
      ? options.dependencyCompatibility
      : null;

  const steps = [];

  steps.push({
    id: 'manifest.identity',
    status: manifest.id && manifest.title ? 'pass' : 'warn',
    label: 'Manifest identity (id/title) is set.',
    detail: manifest.id && manifest.title
      ? `${manifest.id} / ${manifest.title}`
      : 'Set both package id and title for third-party onboarding.'
  });

  steps.push({
    id: 'quality.gate',
    status: String(qualityGate?.status || '').toLowerCase() === 'fail'
      ? 'fail'
      : String(qualityGate?.status || '').toLowerCase() === 'warn'
        ? 'warn'
        : 'pass',
    label: 'Template quality gate review completed.',
    detail: qualityGate?.summary || 'No quality summary available.'
  });

  steps.push({
    id: 'compatibility.review',
    status: String(dependencyCompatibility?.status || '').toLowerCase() === 'fail'
      ? 'fail'
      : String(dependencyCompatibility?.status || '').toLowerCase() === 'warn'
        ? 'warn'
        : 'pass',
    label: 'Dependency and compatibility review completed.',
    detail: dependencyCompatibility?.status
      ? `Compatibility status: ${String(dependencyCompatibility.status).toUpperCase()}.`
      : 'No dependency/compatibility diagnostics available.'
  });

  const policyCompatibility = checkCompatibility(APP_API_POLICY.currentVersion);
  steps.push({
    id: 'app-api.policy',
    status: policyCompatibility.compatible ? 'pass' : 'fail',
    label: `App API policy ${APP_API_POLICY.currentVersion} is published for package clients.`,
    detail: policyCompatibility.reason
  });

  if (zipUrl) {
    steps.push({
      id: 'distribution.zip',
      status: 'pass',
      label: 'Distribution zip URL is available for install flow.',
      detail: zipUrl
    });
  } else {
    steps.push({
      id: 'distribution.zip',
      status: operationType === 'install' ? 'fail' : 'warn',
      label: 'Distribution zip URL should be prepared for third-party onboarding.',
      detail: 'Publish package zip and registry metadata before distribution.'
    });
  }

  const commands = [
    `curl -X POST /api/packages/wizard/preflight -d '{\"manifest\":{\"id\":\"${manifest.id || 'my-app'}\"}}'`,
    `curl -X POST /api/packages/registry/preflight -d '{\"sourceId\":\"${sourceId || 'your-source'}\",\"packageId\":\"${packageId || 'your-package'}\"}'`
  ];

  return {
    status: steps.some((item) => item.status === 'fail')
      ? 'fail'
      : steps.some((item) => item.status === 'warn')
        ? 'warn'
        : 'pass',
    summary: `Third-party onboarding checklist prepared for ${operationType} flow.`,
    source: {
      templateId: templateId || null,
      sourceId: sourceId || null,
      packageId: packageId || null
    },
    steps,
    commands
  };
}

function createLocalWorkspaceError(code, message, status = 400, details = null) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.details = details;
  return err;
}

function normalizeLocalWorkspaceMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (!mode) return 'readwrite';
  if (LOCAL_WORKSPACE_MODES.has(mode)) return mode;
  throw createLocalWorkspaceError(
    'LOCAL_WORKSPACE_MODE_INVALID',
    'localWorkspace.mode must be "read" or "readwrite".'
  );
}

function normalizeLocalWorkspaceBridgeSummary(input = {}, fallback = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const status = String(source.status || fallback.status || '').trim().toLowerCase() === 'inventory+local-workspace'
    ? 'inventory+local-workspace'
    : 'inventory-only';
  const pathValue = String(source.path || fallback.path || '').trim();
  const modeValue = String(source.mode || fallback.mode || '').trim().toLowerCase();
  const mode = modeValue === 'read' ? 'read' : (modeValue === 'readwrite' ? 'readwrite' : null);
  const requested = Boolean(
    Object.prototype.hasOwnProperty.call(source, 'requested')
      ? source.requested
      : fallback.requested
  );
  const rawUpdatedAt = source.updatedAt || fallback.updatedAt || null;
  let updatedAt = typeof rawUpdatedAt === 'string' && rawUpdatedAt.trim()
    ? rawUpdatedAt
    : null;

  if (status === 'inventory+local-workspace' && !updatedAt) {
    updatedAt = new Date().toISOString();
  } else if (status === 'inventory-only' && requested && !updatedAt) {
    updatedAt = new Date().toISOString();
  }

  return {
    requested,
    status,
    boundary: 'inventory-app-data',
    path: status === 'inventory+local-workspace' && pathValue ? pathValue : null,
    mode: status === 'inventory+local-workspace' ? (mode || 'readwrite') : null,
    updatedAt
  };
}

async function resolveLocalWorkspaceBridge(input, options = {}) {
  void options;
  const base = normalizeLocalWorkspaceBridgeSummary({
    requested: false,
    status: 'inventory-only'
  });

  if (input == null) {
    return base;
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw createLocalWorkspaceError(
      'LOCAL_WORKSPACE_INVALID',
      'localWorkspace must be an object when provided.'
    );
  }

  const enabled = !Object.prototype.hasOwnProperty.call(input, 'enabled') || parseBooleanBody(input.enabled);
  if (!enabled) {
    return {
      ...base,
      requested: true
    };
  }

  const rawPath = String(input.path || input.rootPath || '').trim();
  if (!rawPath) {
    throw createLocalWorkspaceError(
      'LOCAL_WORKSPACE_PATH_REQUIRED',
      'localWorkspace.path is required when local workspace bridge is enabled.'
    );
  }

  let absolutePath = '';
  try {
    absolutePath = resolveSafePath(rawPath);
  } catch (err) {
    throw createLocalWorkspaceError(
      'LOCAL_WORKSPACE_PATH_INVALID',
      err.message || 'localWorkspace.path is invalid.',
      400,
      { path: rawPath }
    );
  }

  const configPaths = await serverConfig.getPaths();
  const allowedRoots = Array.isArray(configPaths.allowedRoots) ? configPaths.allowedRoots : [];
  if (!isWithinAllowedRoots(absolutePath, allowedRoots)) {
    throw createLocalWorkspaceError(
      'LOCAL_WORKSPACE_PATH_NOT_ALLOWED',
      'localWorkspace.path must be inside allowed roots.',
      403,
      { path: absolutePath }
    );
  }

  if (isProtectedSystemPath(absolutePath, [configPaths.inventoryRoot])) {
    throw createLocalWorkspaceError(
      'LOCAL_WORKSPACE_PATH_SYSTEM_PROTECTED',
      'localWorkspace.path cannot target protected inventory system paths.',
      403,
      { path: absolutePath }
    );
  }

  const mode = normalizeLocalWorkspaceMode(input.mode);

  return normalizeLocalWorkspaceBridgeSummary({
    requested: true,
    status: 'inventory+local-workspace',
    path: absolutePath,
    mode,
    updatedAt: new Date().toISOString()
  });
}

function appendLocalWorkspaceBridgeNote(baseNote = '', bridge = null) {
  const note = String(baseNote || '').trim();
  const normalized = normalizeLocalWorkspaceBridgeSummary(bridge);
  if (normalized.status !== 'inventory+local-workspace') {
    return note || '';
  }
  const bridgeNote = `local-workspace-bridge:${normalized.mode}:${normalized.path}`;
  return note ? `${note} | ${bridgeNote}` : bridgeNote;
}

async function createLocalPackageFromManifest(manifestInput, options = {}) {
  const manifest = normalizeManifestInput(manifestInput || {});
  const localWorkspaceBridge = normalizeLocalWorkspaceBridgeSummary(options.localWorkspaceBridge);
  const appRoot = await appPaths.getAppRoot(manifest.id);
  if (await fs.pathExists(appRoot)) {
    const err = new Error(`Package "${manifest.id}" already exists.`);
    err.code = 'PACKAGE_ALREADY_EXISTS';
    throw err;
  }

  await fs.ensureDir(appRoot);
  await fs.writeJson(path.join(appRoot, 'manifest.json'), manifest, { spaces: 2 });
  const runtimeProfile = normalizeRuntimeProfile(manifest);
  if (runtimeProfile.appType === 'hybrid') {
    const serviceEntry = runtimeProfile.entry;
    const uiEntry = runtimeProfile.ui?.entry;
    if (serviceEntry) {
      const servicePath = await resolvePackagePath(manifest.id, serviceEntry);
      await fs.ensureDir(path.dirname(servicePath));
      await fs.writeFile(
        servicePath,
        createDefaultServiceTemplate({ appId: manifest.id, runtimeType: runtimeProfile.runtimeType }),
        'utf8'
      );
    }
    if (uiEntry) {
      const uiPath = await resolvePackagePath(manifest.id, uiEntry);
      await fs.ensureDir(path.dirname(uiPath));
      await fs.writeFile(
        uiPath,
        createHybridUiTemplate({ appId: manifest.id, title: manifest.title }),
        'utf8'
      );
    }
  } else if (manifest.entry) {
    const entryPath = await resolvePackagePath(manifest.id, manifest.entry);
    await fs.ensureDir(path.dirname(entryPath));
    if (runtimeProfile.appType === 'service') {
      await fs.writeFile(
        entryPath,
        createDefaultServiceTemplate({ appId: manifest.id, runtimeType: runtimeProfile.runtimeType }),
        'utf8'
      );
    } else {
      await fs.writeFile(
        entryPath,
        createTemplateEntryContent(options.templateId, { appId: manifest.id, title: manifest.title }),
        'utf8'
      );
    }
  }

  const created = await packageRegistryService.getSandboxApp(manifest.id);
  await packageLifecycleService.recordInstall(manifest.id, {
    manifest,
    reason: options.reason || 'create',
    source: options.source || 'local:create',
    workspaceBridge: localWorkspaceBridge,
    note: appendLocalWorkspaceBridgeNote(options.note, localWorkspaceBridge)
  });
  await auditService.log(
    'PACKAGES',
    `Create Package: ${manifest.id}`,
    {
      appId: manifest.id,
      localWorkspaceBridge,
      user: options.user || ''
    },
    'INFO'
  );

  return {
    package: created,
    manifest,
    localWorkspaceBridge
  };
}

async function buildWizardPreflight(manifestInput, options = {}) {
  const manifest = normalizeManifestInput(manifestInput || {});
  const appId = manifest.id;
  const templateId = String(options.templateId || '').trim();
  const localWorkspaceBridge = normalizeLocalWorkspaceBridgeSummary(options.localWorkspaceBridge);
  const existing = await packageRegistryService.getSandboxApp(appId);
  const runtimeManager = options.runtimeManager || null;
  const lifecycle = existing ? await packageLifecycleService.getLifecycle(appId).catch(() => null) : null;
  const runtimeStatus = runtimeManager?.getRuntimeStatusMap?.()[appId] || null;
  const permissionsReview = buildPermissionReview(manifest);
  const toolPackageReview = buildToolPackageReview(manifest);

  let qualityGate = null;
  try {
    qualityGate = await templateQualityGate.evaluate({
      templateId: templateId || 'wizard:custom',
      appId,
      manifest,
      allowFsMutation: false
    });
  } catch (err) {
    const wrapped = new Error('Failed to evaluate template quality gate during wizard preflight.');
    wrapped.code = err.code || 'PACKAGE_WIZARD_PREFLIGHT_QUALITY_GATE_FAILED';
    wrapped.cause = err;
    throw wrapped;
  }

  let dependencyCompatibility = null;
  try {
    dependencyCompatibility = await evaluateManifestDependencyCompatibility(manifest);
  } catch (err) {
    const wrapped = new Error('Failed to evaluate dependency and compatibility checks.');
    wrapped.code = 'PACKAGE_WIZARD_PREFLIGHT_COMPATIBILITY_CHECK_FAILED';
    wrapped.cause = err;
    throw wrapped;
  }

  const backupPlan = buildBackupPlanSummary({
    overwrite: false,
    existing
  });
  const lifecycleSafeguards = buildLifecycleSafeguards({
    operationType: 'create',
    existing: Boolean(existing),
    lifecycle,
    runtimeStatus,
    dependencyCompatibility,
    backupPlan
  });
  const onboarding = buildExternalOnboardingGuide({
    manifest,
    templateId,
    operationType: 'create',
    qualityGate,
    dependencyCompatibility
  });
  const blockers = [];

  if (existing) {
    blockers.push({
      code: 'PACKAGE_ALREADY_EXISTS',
      message: `Package "${appId}" already exists.`,
      area: 'operation'
    });
  }

  if (qualityGate?.status === 'fail') {
    blockers.push({
      code: 'TEMPLATE_QUALITY_GATE_FAILED',
      message: 'Quality gate produced blocking failures for this package manifest.',
      area: 'qualityGate'
    });
  }
  if (toolPackageReview.status === 'fail') {
    blockers.push({
      code: 'HYBRID_TOOL_PACKAGE_CONTRACT_FAILED',
      message: toolPackageReview.summary,
      area: 'toolPackage'
    });
  }

  blockers.push(...toSafeguardBlockers(lifecycleSafeguards));

  return {
    operation: {
      type: 'create',
      appId,
      templateId: templateId || null,
      localWorkspaceBridge,
      existing: existing
        ? {
            installed: true,
            id: existing.id,
            title: existing.title,
            version: String(existing.version || '0.0.0').trim() || '0.0.0'
          }
        : {
            installed: false
          }
    },
    permissionsReview,
    toolPackageReview,
    qualityGate,
    dependencyCompatibility,
    backupPlan,
    lifecycleSafeguards,
    onboarding,
    localWorkspaceBridge,
    executionReadiness: {
      ready: blockers.length === 0,
      blockers
    }
  };
}

async function buildZipImportPreflight(filePath, options = {}) {
  const body = options.body && typeof options.body === 'object' ? options.body : {};
  const incomingManifest = await readManifestFromZip(filePath);
  const appId = incomingManifest.id;
  const overwrite = parseBooleanBody(body.overwrite);
  const archiveHash = await computeFileHash(filePath);
  const existing = await packageRegistryService.getSandboxApp(appId);
  const localWorkspaceInput = parseMultipartJsonField(body.localWorkspace, 'localWorkspace');
  const localWorkspaceBridge = await resolveLocalWorkspaceBridge(localWorkspaceInput, {
    operationType: existing ? 'update-preflight' : 'install-preflight',
    appId
  });
  const lifecycle = existing ? await packageLifecycleService.getLifecycle(appId).catch(() => null) : null;
  const runtimeManager = options.runtimeManager || null;
  const runtimeStatus = runtimeManager?.getRuntimeStatusMap?.()[appId] || null;
  const permissionsReview = buildPermissionReview(incomingManifest);
  const toolPackageReview = buildToolPackageReview(incomingManifest);

  let qualityGateReport = null;
  try {
    qualityGateReport = await templateQualityGate.evaluate({
      templateId: 'upload:zip',
      appId,
      manifest: incomingManifest,
      allowFsMutation: false
    });
  } catch (err) {
    const wrapped = new Error('Failed to evaluate template quality gate during import preflight.');
    wrapped.code = err.code || 'PACKAGE_IMPORT_PREFLIGHT_QUALITY_GATE_FAILED';
    wrapped.cause = err;
    throw wrapped;
  }

  let dependencyCompatibility = null;
  try {
    dependencyCompatibility = await evaluateManifestDependencyCompatibility(incomingManifest);
  } catch (err) {
    const wrapped = new Error('Failed to evaluate dependency and compatibility checks.');
    wrapped.code = 'PACKAGE_IMPORT_PREFLIGHT_COMPATIBILITY_CHECK_FAILED';
    wrapped.cause = err;
    throw wrapped;
  }

  const backupPlan = buildBackupPlanSummary({
    overwrite,
    existing
  });
  const operationType = existing ? 'update' : 'install';
  const lifecycleSafeguards = buildLifecycleSafeguards({
    operationType,
    existing: Boolean(existing),
    lifecycle,
    runtimeStatus,
    dependencyCompatibility,
    backupPlan
  });
  const onboarding = buildExternalOnboardingGuide({
    manifest: incomingManifest,
    operationType,
    sourceId: 'upload',
    packageId: appId,
    qualityGate: qualityGateReport,
    dependencyCompatibility
  });
  const blockers = [];

  if (existing && !overwrite) {
    blockers.push({
      code: 'PACKAGE_ALREADY_EXISTS',
      message: `Package "${appId}" already exists. Set overwrite=true to perform update.`,
      area: 'operation'
    });
  }

  if (qualityGateReport?.status === 'fail') {
    blockers.push({
      code: 'TEMPLATE_QUALITY_GATE_FAILED',
      message: 'Quality gate produced blocking failures for this package manifest.',
      area: 'qualityGate'
    });
  }
  if (toolPackageReview.status === 'fail') {
    blockers.push({
      code: 'HYBRID_TOOL_PACKAGE_CONTRACT_FAILED',
      message: toolPackageReview.summary,
      area: 'toolPackage'
    });
  }

  blockers.push(...toSafeguardBlockers(lifecycleSafeguards));

  const preflight = {
    operation: {
      type: operationType,
      appId,
      overwrite,
      archiveHash,
      source: 'upload:zip',
      localWorkspaceBridge,
      existing: existing
        ? {
            installed: true,
            id: existing.id,
            title: existing.title,
            version: String(existing.version || '0.0.0').trim() || '0.0.0',
            lifecycle: lifecycle
              ? {
                  channel: lifecycle.channel || lifecycle.current?.channel || 'stable',
                  currentVersion: lifecycle.current?.version || null
                }
              : null
          }
        : {
            installed: false
          }
    },
    permissionsReview,
    toolPackageReview,
    qualityGate: qualityGateReport,
    dependencyCompatibility,
    backupPlan,
    lifecycleSafeguards,
    onboarding,
    localWorkspaceBridge,
    updatePolicy: {
      evaluated: false
    },
    executionReadiness: {
      ready: blockers.length === 0,
      blockers
    }
  };
  const approvalAction = operationType === 'install' ? 'package.import' : 'package.update';
  const targetHash = createLifecycleApprovalTargetHash(approvalAction, {
    source: 'upload:zip',
    archiveHash,
    manifestId: incomingManifest.id,
    manifestHash: computeObjectHash('package-import-manifest-v1', incomingManifest),
    existingAppId: existing?.id || null,
    existingVersion: existing?.version || null,
    requestedOverwrite: overwrite,
    localWorkspaceBridge,
    lifecycleSafeguards,
    blockers
  });
  return attachLifecycleApproval(preflight, {
    userId: options.userId,
    targetId: appId,
    action: approvalAction,
    targetHash
  });
}

function mapPreflightStatusToHttpStatus(err) {
  if (Number.isInteger(err?.status)) {
    return err.status;
  }
  if (
    err.code === 'APP_ID_INVALID' ||
    err.code === 'REGISTRY_INSTALL_TARGET_REQUIRED' ||
    err.code === 'REGISTRY_PACKAGE_ZIP_MISSING' ||
    err.code === 'REGISTRY_PACKAGE_TOO_LARGE' ||
    err.code === 'REGISTRY_PACKAGE_ZIP_URL_INVALID' ||
    err.code === 'REGISTRY_PACKAGE_DOWNLOAD_TIMEOUT' ||
    err.code === 'REGISTRY_PACKAGE_DOWNLOAD_FAILED' ||
    err.code === 'LOCAL_WORKSPACE_INVALID' ||
    err.code === 'LOCAL_WORKSPACE_INVALID_JSON' ||
    err.code === 'RUNTIME_PROFILE_INVALID' ||
    err.code?.startsWith('PACKAGE_') ||
    err.code?.startsWith('TEMPLATE_QUALITY_')
  ) {
    return 400;
  }
  if (err.code === 'REGISTRY_SOURCE_NOT_FOUND' || err.code === 'REGISTRY_PACKAGE_NOT_FOUND') {
    return 404;
  }
  return 500;
}

function mapWizardStatusToHttpStatus(err) {
  if (Number.isInteger(err?.status)) {
    return err.status;
  }
  if (err.code === 'PACKAGE_ALREADY_EXISTS') {
    return 409;
  }
  if (
    err.code === 'PACKAGE_MANIFEST_REQUIRED' ||
    err.code === 'APP_ID_INVALID' ||
    err.code === 'RUNTIME_PROFILE_INVALID' ||
    err.code?.startsWith('PACKAGE_') ||
    err.code?.startsWith('TEMPLATE_QUALITY_')
  ) {
    return 400;
  }
  return 500;
}

function buildManifestValidation(runtimeError = null) {
  const checks = [
    {
      id: 'manifest.structure',
      status: 'pass',
      message: 'Manifest payload shape is valid.'
    }
  ];

  if (runtimeError) {
    checks.push({
      id: 'manifest.runtime',
      status: 'fail',
      code: runtimeError.code || 'RUNTIME_PROFILE_INVALID',
      message: runtimeError.message || 'Runtime profile is invalid.'
    });
  } else {
    checks.push({
      id: 'manifest.runtime',
      status: 'pass',
      message: 'Runtime profile is valid.'
    });
  }

  return { checks };
}

router.get('/', async (req, res) => {
  try {
    const packages = await packageRegistryService.listSandboxApps();
    const runtimeManager = req.app.get('runtimeManager');
    const runtimeStatusMap = runtimeManager?.getRuntimeStatusMap
      ? runtimeManager.getRuntimeStatusMap()
      : {};
    const lifecycleMap = await buildLifecycleMap(packages);
    res.json({
      success: true,
      packages: packages.map((pkg) => ({
        ...pkg,
        runtimeStatus: runtimeStatusMap[pkg.id] || null,
        workspaceBridge: lifecycleMap.get(pkg.id)?.workspaceBridge || normalizeLocalWorkspaceBridgeSummary()
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

router.post('/wizard/preflight', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (!body.manifest || typeof body.manifest !== 'object') {
      return res.status(400).json({
        error: true,
        code: 'PACKAGE_MANIFEST_REQUIRED',
        message: 'Body "manifest" object is required.'
      });
    }

    const localWorkspaceBridge = await resolveLocalWorkspaceBridge(body.localWorkspace, {
      operationType: 'create-preflight',
      appId: body.manifest?.id
    });

    const preflight = await buildWizardPreflight(body.manifest, {
      templateId: body.templateId,
      localWorkspaceBridge,
      runtimeManager: req.app.get('runtimeManager')
    });

    return res.json({
      success: true,
      preflight,
      validation: buildManifestValidation()
    });
  } catch (err) {
    return res.status(mapWizardStatusToHttpStatus(err)).json({
      error: true,
      code: err.code || 'PACKAGE_WIZARD_PREFLIGHT_FAILED',
      message: err.message,
      validation: err.code === 'RUNTIME_PROFILE_INVALID' ? buildManifestValidation(err) : undefined
    });
  }
});

router.post('/wizard/create', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (!body.manifest || typeof body.manifest !== 'object') {
      return res.status(400).json({
        error: true,
        code: 'PACKAGE_MANIFEST_REQUIRED',
        message: 'Body "manifest" object is required.'
      });
    }

    const localWorkspaceBridge = await resolveLocalWorkspaceBridge(body.localWorkspace, {
      operationType: 'create',
      appId: body.manifest?.id
    });

    const created = await createLocalPackageFromManifest(body.manifest, {
      user: req.user?.username,
      reason: 'create',
      source: 'local:create',
      templateId: body.templateId,
      localWorkspaceBridge
    });

    return res.status(201).json({
      success: true,
      package: created.package,
      manifest: created.manifest,
      localWorkspaceBridge: created.localWorkspaceBridge,
      onboarding: buildExternalOnboardingGuide({
        manifest: created.manifest,
        templateId: body.templateId,
        operationType: 'create'
      }),
      validation: buildManifestValidation()
    });
  } catch (err) {
    return res.status(mapWizardStatusToHttpStatus(err)).json({
      error: true,
      code: err.code || 'PACKAGE_WIZARD_CREATE_FAILED',
      message: err.message,
      validation: err.code === 'RUNTIME_PROFILE_INVALID' ? buildManifestValidation(err) : undefined
    });
  }
});

router.post('/', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const localWorkspaceBridge = await resolveLocalWorkspaceBridge(body.localWorkspace, {
      operationType: 'create',
      appId: body.id
    });

    const created = await createLocalPackageFromManifest(req.body || {}, {
      user: req.user?.username,
      reason: 'create',
      source: 'local:create',
      localWorkspaceBridge
    });

    return res.status(201).json({
      success: true,
      package: created.package,
      localWorkspaceBridge: created.localWorkspaceBridge
    });
  } catch (err) {
    const status = mapWizardStatusToHttpStatus(err);
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

router.post(`/${APP_ID_ROUTE}/delete/preflight`, async (req, res) => {
  try {
    const appId = appPaths.assertSafeAppId(req.params.id);
    const preflight = await buildPackageDeletePreflight(appId, {
      userId: req.user?.username
    });

    return res.json({
      success: true,
      preflight
    });
  } catch (err) {
    const status =
      err.code === 'APP_ID_INVALID'
        ? 400
        : err.code === 'PACKAGE_NOT_FOUND'
          ? 404
          : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'PACKAGE_DELETE_PREFLIGHT_FAILED',
      message: err.message
    });
  }
});

router.post(`/${APP_ID_ROUTE}/delete/approve`, async (req, res) => {
  try {
    const appId = appPaths.assertSafeAppId(req.params.id);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const operationId = String(body.operationId || '').trim();
    if (!operationId) {
      return res.status(400).json({
        error: true,
        code: 'PACKAGE_DELETE_OPERATION_ID_REQUIRED',
        message: 'Body "operationId" is required.'
      });
    }

    const approval = operationApprovalService.approveOperation({
      operationId,
      userId: req.user?.username,
      action: 'package.delete',
      targetId: appId,
      typedConfirmation: body.typedConfirmation
    });

    return res.json({
      success: true,
      approval
    });
  } catch (err) {
    const status =
      err.code === 'APP_ID_INVALID'
        ? 400
        : err.code === 'OPERATION_APPROVAL_NOT_FOUND' ||
            err.code === 'OPERATION_APPROVAL_EXPIRED' ||
            err.code === 'OPERATION_APPROVAL_USER_MISMATCH' ||
            err.code === 'OPERATION_APPROVAL_ACTION_MISMATCH' ||
            err.code === 'OPERATION_APPROVAL_TARGET_MISMATCH' ||
            err.code === 'OPERATION_APPROVAL_CONFIRMATION_MISMATCH'
          ? 400
          : err.code === 'OPERATION_APPROVAL_ALREADY_APPROVED' ||
              err.code === 'OPERATION_APPROVAL_ALREADY_CONSUMED'
            ? 409
          : 500;
    return res.status(status).json({
      error: true,
      code:
        err.code === 'APP_ID_INVALID'
          ? err.code
          : err.code === 'OPERATION_APPROVAL_ALREADY_APPROVED'
            ? 'PACKAGE_DELETE_APPROVAL_ALREADY_APPROVED'
            : err.code === 'OPERATION_APPROVAL_ALREADY_CONSUMED'
              ? 'PACKAGE_DELETE_APPROVAL_ALREADY_CONSUMED'
              : 'PACKAGE_DELETE_APPROVAL_INVALID',
      message: err.message
    });
  }
});

router.delete(`/${APP_ID_ROUTE}`, async (req, res) => {
  let approvalContext = null;
  let auditTarget = null;
  let auditRecoverability = null;
  let auditReason = '';
  let auditUser = req.user?.username;
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

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const approval = body.approval && typeof body.approval === 'object' && !Array.isArray(body.approval)
      ? body.approval
      : null;
    auditReason = String(body.reason || '').trim();

    if (!approval || !String(approval.operationId || '').trim() || !String(approval.nonce || '').trim()) {
      const preflight = await buildPackageDeletePreflight(appId, {
        userId: req.user?.username
      });
      return res.status(428).json({
        error: true,
        code: 'PACKAGE_DELETE_APPROVAL_REQUIRED',
        message: 'Package delete requires a scoped approval nonce.',
        preflight
      });
    }

    const currentManifest = await readManifestRaw(appId);
    const currentTargetHash = await computePackageDeleteTargetHash(appId, currentManifest);
    const requestedTargetHash = String(approval.targetHash || '').trim();
    if (requestedTargetHash && requestedTargetHash !== currentTargetHash) {
      const preflight = await buildPackageDeletePreflight(appId, {
        userId: req.user?.username
      });
      return res.status(428).json({
        error: true,
        code: 'PACKAGE_DELETE_APPROVAL_INVALID',
        message: 'Package delete approval target hash does not match the current package state.',
        preflight
      });
    }

    try {
      approvalContext = operationApprovalService.consumeApproval({
        operationId: approval.operationId,
        nonce: approval.nonce,
        userId: req.user?.username,
        action: 'package.delete',
        targetId: appId,
        targetHash: currentTargetHash
      });
    } catch (approvalErr) {
      const preflight = await buildPackageDeletePreflight(appId, {
        userId: req.user?.username
      });
      return res.status(428).json({
        error: true,
        code: 'PACKAGE_DELETE_APPROVAL_INVALID',
        message: approvalErr.message,
        preflight
      });
    }

    auditTarget = approvalContext.target;
    auditRecoverability = approvalContext.metadata?.recoverability || null;

    await runtimeManager?.stopApp?.(appId).catch(() => {});
    await fs.remove(appRoot);
    await fs.remove(await appPaths.getAppDataRoot(appId)).catch(() => {});
    await packageLifecycleService.deleteLifecycle(appId).catch(() => {});
    const associationCleanup = await clearOpenWithDefaultsForRemovedApp(appId).catch((err) => ({
      error: err.message,
      removedExtensions: []
    }));
    await auditService.log(
      'PACKAGES',
      'package.delete',
      buildPackageDeleteApprovalAudit({
        operationId: approvalContext.operationId,
        target: auditTarget,
        targetHash: approvalContext.targetHash,
        recoverability: auditRecoverability,
        approvedAt: approvalContext.approvedAt,
        consumedAt: approvalContext.consumedAt,
        expiresAt: approvalContext.expiresAt,
        reason: auditReason,
        user: auditUser,
        result: {
          status: 'success',
          openWithDefaultsRemoved: associationCleanup.removedExtensions || [],
          openWithCleanupError: associationCleanup.error || ''
        }
      }),
      'WARN'
    );
    return res.json({
      success: true,
      associationCleanup
    });
  } catch (err) {
    if (approvalContext) {
      await auditService.log(
        'PACKAGES',
        'package.delete',
        buildPackageDeleteApprovalAudit({
          operationId: approvalContext.operationId,
          target: auditTarget || approvalContext.target,
          targetHash: approvalContext.targetHash,
          recoverability: auditRecoverability || approvalContext.metadata?.recoverability,
          approvedAt: approvalContext.approvedAt,
          consumedAt: approvalContext.consumedAt,
          expiresAt: approvalContext.expiresAt,
          reason: auditReason,
          user: auditUser,
          result: {
            status: 'failure',
            code: err.code || 'PACKAGE_DELETE_FAILED',
            message: err.message
          }
        }),
        'ERROR'
      ).catch(() => {});
    }
    const status = err.code === 'APP_ID_INVALID' ? 400 : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'PACKAGE_DELETE_FAILED',
      message: err.message
    });
  }
});

router.post(`/${APP_ID_ROUTE}/export-ticket`, async (req, res) => {
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

    const ticket = fileTicketService.createTicket({
      scope: 'package.export',
      user: req.user?.username,
      appId,
      path: appRoot
    });

    await auditService.log(
      'PACKAGES',
      `Issue Package Export Ticket: ${appId}`,
      {
        appId,
        scope: ticket.scope,
        expiresAt: new Date(ticket.expiresAt).toISOString(),
        user: req.user?.username
      },
      'INFO'
    );

    return res.status(201).json({
      success: true,
      ticket: ticket.ticket,
      url: `/api/packages/${encodeURIComponent(appId)}/export?ticket=${encodeURIComponent(ticket.ticket)}`,
      scope: ticket.scope,
      appId,
      expiresAt: new Date(ticket.expiresAt).toISOString(),
      ttlMs: ticket.expiresAt - ticket.createdAt
    });
  } catch (err) {
    const status = err.code === 'APP_ID_INVALID' ? 400 : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'PACKAGE_EXPORT_TICKET_CREATE_FAILED',
      message: err.message
    });
  }
});

router.get(`/${APP_ID_ROUTE}/export`, async (req, res) => {
  try {
    const appId = appPaths.assertSafeAppId(req.params.id);
    return sendPackageExport(appId, req.user?.username, res);
  } catch (err) {
    const status = err.code === 'APP_ID_INVALID' ? 400 : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'PACKAGE_EXPORT_FAILED',
      message: err.message
    });
  }
});

router.post('/lifecycle/approve', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const action = String(body.action || '').trim();
    const targetId = appPaths.assertSafeAppId(body.targetId || body.appId);
    const operationId = String(body.operationId || '').trim();
    const typedConfirmation = String(body.typedConfirmation || '').trim();
    const allowedActions = new Set([
      'package.install',
      'package.update',
      'package.import',
      'package.rollback',
      'package.manifest.update'
    ]);

    if (!allowedActions.has(action)) {
      return res.status(400).json({
        error: true,
        code: 'PACKAGE_LIFECYCLE_APPROVAL_ACTION_INVALID',
        message: 'Package lifecycle approval action is invalid.'
      });
    }
    if (!operationId) {
      return res.status(400).json({
        error: true,
        code: 'PACKAGE_LIFECYCLE_APPROVAL_OPERATION_REQUIRED',
        message: 'Body "operationId" is required.'
      });
    }

    const approval = operationApprovalService.approveOperation({
      operationId,
      userId: req.user?.username,
      action,
      targetId,
      typedConfirmation
    });

    await logLifecycleApprovalAudit(action, {
      operationId,
      appId: targetId,
      user: req.user?.username,
      approval: {
        approved: true,
        expiresAt: approval.expiresAt
      },
      result: { status: 'approved' }
    }, 'WARN');

    return res.json({
      success: true,
      approval
    });
  } catch (err) {
    const status =
      err.code === 'OPERATION_APPROVAL_ALREADY_APPROVED'
        ? 409
        : (err.code === 'APP_ID_INVALID' ? 400 : 400);
    return res.status(status).json({
      error: true,
      code: err.code === 'OPERATION_APPROVAL_ALREADY_APPROVED'
        ? 'PACKAGE_LIFECYCLE_APPROVAL_ALREADY_APPROVED'
        : 'PACKAGE_LIFECYCLE_APPROVAL_INVALID',
      message: err.message
    });
  }
});

router.post('/import/preflight', upload.single('package'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: true,
        code: 'PACKAGE_IMPORT_FILE_REQUIRED',
        message: 'Upload file field "package" is required.'
      });
    }

    const preflight = await buildZipImportPreflight(req.file.path, {
      body: req.body,
      userId: req.user?.username,
      runtimeManager: req.app.get('runtimeManager')
    });

    return res.json({
      success: true,
      preflight,
      validation: buildManifestValidation()
    });
  } catch (err) {
    return res.status(mapPreflightStatusToHttpStatus(err)).json({
      error: true,
      code: err.code || 'PACKAGE_IMPORT_PREFLIGHT_FAILED',
      message: err.message,
      validation: err.code === 'RUNTIME_PROFILE_INVALID' ? buildManifestValidation(err) : undefined
    });
  } finally {
    if (req.file?.path) {
      await fs.remove(req.file.path).catch(() => {});
    }
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
    const localWorkspaceInput = parseMultipartJsonField(req.body?.localWorkspace, 'localWorkspace');
    const existing = await packageRegistryService.getSandboxApp(appId);
    const localWorkspaceBridge = await resolveLocalWorkspaceBridge(localWorkspaceInput, {
      operationType: existing ? 'update' : 'install',
      appId
    });
    const approval = parseMultipartJsonField(req.body?.approval, 'approval') || {};
    const preflight = await buildZipImportPreflight(req.file.path, {
      body: req.body,
      userId: req.user?.username,
      runtimeManager
    });
    let approvalContext = null;
    try {
      approvalContext = consumeLifecycleApproval({
        approval,
        action: preflight.action,
        targetId: appId,
        targetHash: preflight.targetHash,
        userId: req.user?.username
      });
    } catch (approvalErr) {
      return res.status(approvalErr.status || 428).json({
        error: true,
        code: approvalErr.code || 'PACKAGE_IMPORT_APPROVAL_INVALID',
        message: approvalErr.message,
        preflight
      });
    }
    const runtimeStatus = runtimeManager?.getRuntimeStatusMap?.()[appId] || null;
    const wasRunning = runtimeStatus && ['running', 'starting', 'degraded'].includes(runtimeStatus.status);

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
      backupId: backup?.id || null,
      workspaceBridge: localWorkspaceBridge,
      note: appendLocalWorkspaceBridgeNote('', localWorkspaceBridge)
    });

    if (wasRunning) {
      await runtimeManager?.startApp?.(installed.id).catch(() => {});
    }

    await auditService.log(
      'PACKAGES',
      `Import Package: ${installed.id}`,
      {
        appId: installed.id,
        overwrite,
        localWorkspaceBridge,
        backupId: backup?.id || null,
        operationId: approvalContext.operationId,
        approval: {
          operationId: approvalContext.operationId,
          nonceConsumed: true,
          approvedAt: approvalContext.approvedAt,
          consumedAt: approvalContext.consumedAt,
          targetHash: approvalContext.targetHash
        },
        user: req.user?.username
      },
      'INFO'
    );

    return res.status(201).json({
      success: true,
      package: installed,
      localWorkspaceBridge
    });
  } catch (err) {
    const status = err.code === 'PACKAGE_ALREADY_EXISTS'
      ? 409
      : (
        err.code === 'APP_ID_INVALID' ||
        err.code?.startsWith('PACKAGE_') ||
        err.code === 'LOCAL_WORKSPACE_INVALID' ||
        err.code === 'LOCAL_WORKSPACE_INVALID_JSON' ||
        err.code === 'RUNTIME_PROFILE_INVALID'
          ? 400
          : 500
      );
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
    const installedMap = new Map(installedApps.map((item) => [item.id, item]));
    const lifecycleMap = await buildLifecycleMap(installedApps);

    const results = await Promise.all(
      enabledSources.map(async (source) => {
        try {
          const packages = await fetchRegistryPackagesFromSource(source);
          return {
            source,
            ok: true,
            packages: packages.map((pkg) => ({
              ...pkg,
              installed: installedMap.has(pkg.id),
              installedVersion: installedMap.get(pkg.id)?.version || '',
              targetChannel: channelUpdatePolicyService.normalizeChannel(
                lifecycleMap.get(pkg.id)?.channel || lifecycleMap.get(pkg.id)?.current?.channel || 'stable'
              ),
              updatePolicy: installedMap.has(pkg.id)
                ? channelUpdatePolicyService.evaluateCandidate({
                  installedVersion: installedMap.get(pkg.id)?.version || '0.0.0',
                  candidateVersion: pkg.version,
                  targetChannel: lifecycleMap.get(pkg.id)?.channel || lifecycleMap.get(pkg.id)?.current?.channel || 'stable',
                  candidateChannel: pkg.release?.channel || 'stable',
                  publishedAt: pkg.release?.publishedAt,
                  rolloutDelayMs: pkg.release?.rolloutDelayMs
                })
                : null
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

router.get('/registry/updates', async (req, res) => {
  try {
    const sourceId = String(req.query.source || '').trim();
    const includeBlocked = String(req.query.includeBlocked || '').toLowerCase() === 'true';
    const sources = await readRegistrySources();
    const enabledSources = sourceId
      ? sources.filter((item) => item.id === sourceId)
      : sources.filter((item) => item.enabled !== false);

    const installedApps = await packageRegistryService.listSandboxApps();
    const installedMap = new Map(installedApps.map((item) => [item.id, item]));
    const lifecycleMap = await buildLifecycleMap(installedApps);

    const sourceResults = await Promise.all(
      enabledSources.map(async (source) => {
        try {
          const packages = await fetchRegistryPackagesFromSource(source);
          return {
            sourceId: source.id,
            ok: true,
            packages
          };
        } catch (err) {
          return {
            sourceId: source.id,
            ok: false,
            error: err.message,
            packages: []
          };
        }
      })
    );

    const failedSources = sourceResults.filter((item) => !item.ok).map((item) => ({
      sourceId: item.sourceId,
      error: item.error
    }));

    const candidatesById = new Map();
    for (const sourceResult of sourceResults) {
      if (!sourceResult.ok) continue;
      for (const pkg of sourceResult.packages) {
        if (!installedMap.has(pkg.id)) continue;
        const current = candidatesById.get(pkg.id) || [];
        current.push({
          id: pkg.id,
          version: pkg.version,
          channel: pkg.release?.channel || 'stable',
          publishedAt: pkg.release?.publishedAt || '',
          rolloutDelayMs: pkg.release?.rolloutDelayMs,
          zipUrl: pkg.zipUrl,
          sourceId: pkg.source?.id || sourceResult.sourceId || ''
        });
        candidatesById.set(pkg.id, current);
      }
    }

    const updates = [];
    for (const [appId, candidates] of candidatesById.entries()) {
      const installed = installedMap.get(appId);
      const lifecycle = lifecycleMap.get(appId);
      const targetChannel = lifecycle?.channel || lifecycle?.current?.channel || 'stable';
      const summary = channelUpdatePolicyService.selectBestUpdate({
        installedVersion: installed?.version || '0.0.0',
        targetChannel,
        candidates
      });

      if (!summary.hasUpdate && !includeBlocked) {
        continue;
      }

      updates.push({
        appId,
        installedVersion: installed?.version || '0.0.0',
        targetChannel: channelUpdatePolicyService.normalizeChannel(targetChannel, 'stable'),
        hasUpdate: summary.hasUpdate,
        selected: summary.selected,
        evaluations: summary.evaluations
      });
    }

    return res.json({
      success: true,
      updates,
      failedSources
    });
  } catch (err) {
    return res.status(500).json({
      error: true,
      code: 'REGISTRY_UPDATES_FETCH_FAILED',
      message: err.message
    });
  }
});

router.post('/registry/preflight', async (req, res) => {
  let tempZipFile = '';
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const target = await resolveRegistryInstallTarget(body);
    tempZipFile = await downloadRegistryPackageZip(target.zipUrl);
    const archiveHash = await computeFileHash(tempZipFile);

    const incomingManifest = await readManifestFromZip(tempZipFile);
    const appId = incomingManifest.id;
    const existing = await packageRegistryService.getSandboxApp(appId);
    const localWorkspaceBridge = await resolveLocalWorkspaceBridge(body.localWorkspace, {
      operationType: existing ? 'update-preflight' : 'install-preflight',
      appId
    });
    const lifecycle = existing ? await packageLifecycleService.getLifecycle(appId).catch(() => null) : null;

    const permissionsReview = buildPermissionReview(incomingManifest);
    const toolPackageReview = buildToolPackageReview(incomingManifest);

    let qualityGateReport = null;
    try {
      qualityGateReport = await templateQualityGate.evaluate({
        templateId: target.sourceId ? `registry:${target.sourceId}` : 'registry:direct-url',
        appId,
        manifest: incomingManifest,
        allowFsMutation: false
      });
    } catch (err) {
      const wrapped = new Error('Failed to evaluate template quality gate during preflight.');
      wrapped.code = err.code || 'REGISTRY_PREFLIGHT_QUALITY_GATE_FAILED';
      wrapped.cause = err;
      throw wrapped;
    }

    let dependencyCompatibility = null;
    try {
      dependencyCompatibility = await evaluateManifestDependencyCompatibility(incomingManifest);
    } catch (err) {
      const wrapped = new Error('Failed to evaluate dependency and compatibility checks.');
      wrapped.code = 'REGISTRY_PREFLIGHT_COMPATIBILITY_CHECK_FAILED';
      wrapped.cause = err;
      throw wrapped;
    }

    let updatePolicy = null;
    if (existing) {
      const policy = channelUpdatePolicyService.evaluateCandidate({
        installedVersion: String(existing.version || '0.0.0').trim() || '0.0.0',
        candidateVersion: incomingManifest.version,
        targetChannel: lifecycle?.channel || lifecycle?.current?.channel || 'stable',
        candidateChannel: target.targetPackage?.release?.channel || incomingManifest.release?.channel || 'stable',
        publishedAt: target.targetPackage?.release?.publishedAt || '',
        rolloutDelayMs: target.targetPackage?.release?.rolloutDelayMs
      });
      updatePolicy = {
        evaluated: true,
        policy
      };
    }

    const backupPlan = buildBackupPlanSummary({
      overwrite: target.overwrite,
      existing
    });
    const runtimeManager = req.app.get('runtimeManager');
    const runtimeStatus = runtimeManager?.getRuntimeStatusMap?.()[appId] || null;
    const lifecycleSafeguards = buildLifecycleSafeguards({
      operationType: existing ? 'update' : 'install',
      existing: Boolean(existing),
      lifecycle,
      runtimeStatus,
      dependencyCompatibility,
      backupPlan
    });
    const onboarding = buildExternalOnboardingGuide({
      manifest: incomingManifest,
      operationType: existing ? 'update' : 'install',
      sourceId: target.sourceId,
      packageId: target.packageId || incomingManifest.id,
      zipUrl: target.zipUrl,
      qualityGate: qualityGateReport,
      dependencyCompatibility
    });
    const operationType = existing ? 'update' : 'install';
    const blockers = [];

    if (existing && !target.overwrite) {
      blockers.push({
        code: 'PACKAGE_ALREADY_EXISTS',
        message: `Package "${appId}" already exists. Set overwrite=true to perform update.`,
        area: 'operation'
      });
    }

    if (qualityGateReport?.status === 'fail') {
      blockers.push({
        code: 'TEMPLATE_QUALITY_GATE_FAILED',
        message: 'Quality gate produced blocking failures for this package manifest.',
        area: 'qualityGate'
      });
    }
    if (toolPackageReview.status === 'fail') {
      blockers.push({
        code: 'HYBRID_TOOL_PACKAGE_CONTRACT_FAILED',
        message: toolPackageReview.summary,
        area: 'toolPackage'
      });
    }

    if (updatePolicy?.evaluated && updatePolicy.policy && !updatePolicy.policy.allowed) {
      if (!target.forcePolicyBypass) {
        blockers.push({
          code: 'REGISTRY_UPDATE_POLICY_BLOCKED',
          message: `Update is blocked by channel policy (${updatePolicy.policy.blockedReason || 'policy-blocked'}).`,
          area: 'updatePolicy'
        });
      } else {
        const adminUsername = await getAdminUsername();
        const isAdminUser = Boolean(adminUsername) && req.user?.username === adminUsername;
        if (!isAdminUser) {
          blockers.push({
            code: 'REGISTRY_UPDATE_POLICY_BYPASS_FORBIDDEN',
            message: 'Only admin can bypass channel update policy.',
            area: 'updatePolicy'
          });
        }
      }
    }

    blockers.push(...toSafeguardBlockers(lifecycleSafeguards));

    const preflight = {
        operation: {
          type: operationType,
          appId,
          overwrite: target.overwrite,
          localWorkspaceBridge,
          sourceId: target.sourceId || null,
          packageId: target.packageId || null,
          zipUrl: target.zipUrl,
          archiveHash,
          existing: existing
            ? {
                installed: true,
                id: existing.id,
                title: existing.title,
                version: String(existing.version || '0.0.0').trim() || '0.0.0',
                lifecycle: lifecycle
                  ? {
                      channel: lifecycle.channel || lifecycle.current?.channel || 'stable',
                      currentVersion: lifecycle.current?.version || null
                    }
                  : null
              }
            : {
                installed: false
              }
        },
        permissionsReview,
        toolPackageReview,
        qualityGate: qualityGateReport,
        dependencyCompatibility,
        backupPlan,
        lifecycleSafeguards,
        onboarding,
        localWorkspaceBridge,
        updatePolicy: updatePolicy || {
          evaluated: false
        },
        executionReadiness: {
          ready: blockers.length === 0,
          blockers
        }
      };
    const targetHash = createLifecycleApprovalTargetHash(getLifecycleApprovalAction(operationType), {
      source: target.sourceId ? `registry:${target.sourceId}` : 'registry:direct-url',
      sourceId: target.sourceId || null,
      packageId: target.packageId || null,
      zipUrl: target.zipUrl,
      registryMetadata: target.targetPackage || null,
      archiveHash,
      manifestId: incomingManifest.id,
      manifestHash: computeObjectHash('package-registry-manifest-v1', incomingManifest),
      existingAppId: existing?.id || null,
      existingVersion: existing?.version || null,
      requestedOverwrite: target.overwrite,
      forcePolicyBypass: target.forcePolicyBypass,
      localWorkspaceBridge,
      lifecycleSafeguards,
      updatePolicy,
      blockers
    });

    return res.json({
      success: true,
      preflight: attachLifecycleApproval(preflight, {
        userId: req.user?.username,
        targetId: appId,
        action: getLifecycleApprovalAction(operationType),
        targetHash
      })
    });
  } catch (err) {
    return res.status(mapPreflightStatusToHttpStatus(err)).json({
      error: true,
      code: err.code || 'REGISTRY_PREFLIGHT_FAILED',
      message: err.message
    });
  } finally {
    if (tempZipFile) {
      await fs.remove(tempZipFile).catch(() => {});
    }
  }
});

router.post('/registry/install', async (req, res) => {
  let tempZipFile = '';
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const sourceId = String(body.sourceId || '').trim();
    const packageId = String(body.packageId || '').trim();
    const overwrite = String(body.overwrite || '').toLowerCase() === 'true' || body.overwrite === true;
    const forcePolicyBypass = String(body.forcePolicyBypass || '').toLowerCase() === 'true' || body.forcePolicyBypass === true;
    let zipUrl = String(body.zipUrl || '').trim();
    let targetPackage = null;

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
      targetPackage = packages.find((item) => item.id === packageId);
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
    const archiveHash = await computeFileHash(tempZipFile);
    const runtimeManager = req.app.get('runtimeManager');
    const incomingManifest = await readManifestFromZip(tempZipFile);
    const appId = incomingManifest.id;
    const existing = await packageRegistryService.getSandboxApp(appId);
    const localWorkspaceBridge = await resolveLocalWorkspaceBridge(body.localWorkspace, {
      operationType: existing ? 'update' : 'install',
      appId
    });
    const runtimeStatus = runtimeManager?.getRuntimeStatusMap?.()[appId] || null;
    const wasRunning = runtimeStatus && ['running', 'starting', 'degraded'].includes(runtimeStatus.status);
    const lifecycle = existing ? await packageLifecycleService.getLifecycle(appId).catch(() => null) : null;
    const dependencyCompatibility = await evaluateManifestDependencyCompatibility(incomingManifest);
    const backupPlan = buildBackupPlanSummary({ overwrite, existing });
    const lifecycleSafeguards = buildLifecycleSafeguards({
      operationType: existing ? 'update' : 'install',
      existing: Boolean(existing),
      lifecycle,
      runtimeStatus,
      dependencyCompatibility,
      backupPlan
    });

    let updatePolicy = null;
    if (overwrite && existing && targetPackage) {
      const policy = channelUpdatePolicyService.evaluateCandidate({
        installedVersion: String(existing.version || '0.0.0').trim() || '0.0.0',
        candidateVersion: incomingManifest.version,
        targetChannel: lifecycle?.channel || lifecycle?.current?.channel || 'stable',
        candidateChannel: targetPackage.release?.channel || incomingManifest.release?.channel || 'stable',
        publishedAt: targetPackage.release?.publishedAt || '',
        rolloutDelayMs: targetPackage.release?.rolloutDelayMs
      });
      updatePolicy = {
        evaluated: true,
        policy
      };

      if (!policy.allowed && !forcePolicyBypass) {
        return res.status(409).json({
          error: true,
          code: 'REGISTRY_UPDATE_POLICY_BLOCKED',
          message: `Update blocked by channel policy (${policy.blockedReason || 'policy-blocked'}).`,
          policy
        });
      }

      if (!policy.allowed && forcePolicyBypass) {
        const adminUsername = await getAdminUsername();
        const isAdminUser = Boolean(adminUsername) && req.user?.username === adminUsername;
        if (!isAdminUser) {
          return res.status(403).json({
            error: true,
            code: 'REGISTRY_UPDATE_POLICY_BYPASS_FORBIDDEN',
            message: 'Only admin can bypass channel update policy.',
            policy
          });
        }
      }
    }
    const operationType = existing ? 'update' : 'install';
    const toolPackageReview = buildToolPackageReview(incomingManifest);
    const blockers = toSafeguardBlockers(lifecycleSafeguards);
    if (toolPackageReview.status === 'fail') {
      blockers.push({
        code: 'HYBRID_TOOL_PACKAGE_CONTRACT_FAILED',
        message: toolPackageReview.summary,
        area: 'toolPackage'
      });
    }
    const preflight = attachLifecycleApproval({
      operation: {
        type: operationType,
        appId,
        overwrite,
        localWorkspaceBridge,
        sourceId: sourceId || null,
        packageId: packageId || null,
        zipUrl,
        archiveHash,
        existing: existing
          ? {
              installed: true,
              id: existing.id,
              title: existing.title,
              version: String(existing.version || '0.0.0').trim() || '0.0.0'
            }
          : { installed: false }
      },
      permissionsReview: buildPermissionReview(incomingManifest),
      toolPackageReview,
      dependencyCompatibility,
      backupPlan,
      lifecycleSafeguards,
      localWorkspaceBridge,
      updatePolicy: updatePolicy || { evaluated: false },
      executionReadiness: {
        ready: blockers.length === 0,
        blockers
      }
    }, {
      userId: req.user?.username,
      targetId: appId,
      action: getLifecycleApprovalAction(operationType),
      targetHash: createLifecycleApprovalTargetHash(getLifecycleApprovalAction(operationType), {
        source: sourceId ? `registry:${sourceId}` : 'registry:direct-url',
        sourceId: sourceId || null,
        packageId: packageId || null,
        zipUrl,
        registryMetadata: targetPackage || null,
        archiveHash,
        manifestId: incomingManifest.id,
        manifestHash: computeObjectHash('package-registry-manifest-v1', incomingManifest),
        existingAppId: existing?.id || null,
        existingVersion: existing?.version || null,
        requestedOverwrite: overwrite,
        forcePolicyBypass,
        localWorkspaceBridge,
        lifecycleSafeguards,
        updatePolicy,
        blockers
      })
    });
    let approvalContext = null;
    try {
      approvalContext = consumeLifecycleApproval({
        approval: normalizeApprovalPayload(body),
        action: preflight.action,
        targetId: appId,
        targetHash: preflight.targetHash,
        userId: req.user?.username
      });
    } catch (approvalErr) {
      return res.status(approvalErr.status || 428).json({
        error: true,
        code: approvalErr.code || 'REGISTRY_PACKAGE_APPROVAL_INVALID',
        message: approvalErr.message,
        preflight
      });
    }

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
      backupId: backup?.id || null,
      workspaceBridge: localWorkspaceBridge,
      note: appendLocalWorkspaceBridgeNote('', localWorkspaceBridge)
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
        localWorkspaceBridge,
        backupId: backup?.id || null,
        operationId: approvalContext.operationId,
        approval: {
          operationId: approvalContext.operationId,
          nonceConsumed: true,
          approvedAt: approvalContext.approvedAt,
          consumedAt: approvalContext.consumedAt,
          targetHash: approvalContext.targetHash
        },
        user: req.user?.username
      },
      'INFO'
    );

    return res.status(201).json({
      success: true,
      package: installed,
      localWorkspaceBridge
    });
  } catch (err) {
    const status = Number.isInteger(err.status)
      ? err.status
      : (
      err.code === 'APP_ID_INVALID' ||
      err.code?.startsWith('PACKAGE_') ||
      err.code === 'REGISTRY_PACKAGE_TOO_LARGE' ||
      err.code === 'REGISTRY_PACKAGE_ZIP_URL_INVALID' ||
      err.code === 'REGISTRY_PACKAGE_DOWNLOAD_TIMEOUT' ||
      err.code === 'REGISTRY_PACKAGE_DOWNLOAD_FAILED' ||
      err.code === 'RUNTIME_PROFILE_INVALID'
        ? 400
        : 500
      );
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
  try {
    const catalog = await templateCatalogService.getCatalog();
    return res.json({
      success: true,
      version: catalog.version,
      source: catalog.source,
      namespace: catalog.namespace,
      templates: catalog.templates
    });
  } catch (err) {
    return res.status(500).json({
      error: true,
      code: err.code || templateCatalogService.CATALOG_LOAD_ERROR_CODE,
      message: err.message || 'Failed to load ecosystem template catalog.'
    });
  }
});

router.post('/ecosystem/templates/:templateId/quality-check', async (req, res) => {
  let manifest = null;
  try {
    const template = await templateCatalogService.getTemplate(req.params.templateId);
    if (!template) {
      return res.status(404).json({
        error: true,
        code: 'ECOSYSTEM_TEMPLATE_NOT_FOUND',
        message: 'Requested ecosystem template was not found.'
      });
    }

    manifest = buildTemplateManifestInput(template, req.body || {});
    const report = await templateQualityGate.evaluate({
      templateId: template.id,
      appId: manifest.id,
      manifest,
      allowFsMutation: false
    });

    return res.json({
      success: true,
      template: {
        id: template.id,
        namespace: template.namespace
      },
      report,
      validation: buildManifestValidation()
    });
  } catch (err) {
    const status =
      err.code === 'APP_ID_INVALID' ||
      err.code?.startsWith('PACKAGE_') ||
      err.code === 'RUNTIME_PROFILE_INVALID' ||
      err.code?.startsWith('TEMPLATE_QUALITY_')
        ? 400
        : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'ECOSYSTEM_TEMPLATE_QUALITY_CHECK_FAILED',
      message: err.message,
      validation: err.code === 'RUNTIME_PROFILE_INVALID' ? buildManifestValidation(err) : undefined
    });
  }
});

router.post('/ecosystem/templates/:templateId/scaffold', async (req, res) => {
  let manifest = null;
  try {
    const template = await templateCatalogService.getTemplate(req.params.templateId);
    if (!template) {
      return res.status(404).json({
        error: true,
        code: 'ECOSYSTEM_TEMPLATE_NOT_FOUND',
        message: 'Requested ecosystem template was not found.'
      });
    }

    manifest = buildTemplateManifestInput(template, req.body || {});

    const appRoot = await appPaths.getAppRoot(manifest.id);
    if (await fs.pathExists(appRoot)) {
      return res.status(409).json({
        error: true,
        code: 'PACKAGE_ALREADY_EXISTS',
        message: `Package "${manifest.id}" already exists.`
      });
    }

    const report = await templateQualityGate.evaluate({
      templateId: template.id,
      appId: manifest.id,
      manifest,
      allowFsMutation: false
    });
    if (report.status === 'fail') {
      return res.status(409).json({
        error: true,
        code: 'TEMPLATE_QUALITY_GATE_FAILED',
        message: 'Template scaffold blocked by quality gate.',
        report
      });
    }

    const forceRequested = req.body?.force === true || String(req.body?.force || '').toLowerCase() === 'true';
    const adminUsername = await getAdminUsername();
    const isAdminUser = Boolean(adminUsername) && req.user?.username === adminUsername;
    if (report.status === 'warn' && !forceRequested) {
      return res.status(409).json({
        error: true,
        code: 'TEMPLATE_QUALITY_WARN_REVIEW_REQUIRED',
        message: 'Quality gate produced warnings. Set force=true as admin to proceed.',
        report
      });
    }
    if (report.status === 'warn' && forceRequested && !isAdminUser) {
      return res.status(403).json({
        error: true,
        code: 'TEMPLATE_QUALITY_FORCE_FORBIDDEN',
        message: 'Only admin can bypass warn-level template quality checks.',
        report
      });
    }

    await fs.ensureDir(appRoot);
    await fs.writeJson(path.join(appRoot, 'manifest.json'), manifest, { spaces: 2 });

    const runtimeProfile = normalizeRuntimeProfile(manifest);
    if (runtimeProfile.appType === 'hybrid') {
      const serviceEntry = runtimeProfile.entry;
      const uiEntry = runtimeProfile.ui?.entry;
      if (serviceEntry) {
        const servicePath = await resolvePackagePath(manifest.id, serviceEntry);
        await fs.ensureDir(path.dirname(servicePath));
        await fs.writeFile(
          servicePath,
          createDefaultServiceTemplate({ appId: manifest.id, runtimeType: runtimeProfile.runtimeType }),
          'utf8'
        );
      }
      if (uiEntry) {
        const uiPath = await resolvePackagePath(manifest.id, uiEntry);
        await fs.ensureDir(path.dirname(uiPath));
        await fs.writeFile(
          uiPath,
          createHybridUiTemplate({ appId: manifest.id, title: manifest.title }),
          'utf8'
        );
      }
    } else {
      const entryPath = await resolvePackagePath(manifest.id, manifest.entry);
      await fs.ensureDir(path.dirname(entryPath));
      if (runtimeProfile.appType === 'service') {
        await fs.writeFile(
          entryPath,
          createDefaultServiceTemplate({ appId: manifest.id, runtimeType: runtimeProfile.runtimeType }),
          'utf8'
        );
      } else {
        await fs.writeFile(
          entryPath,
          createTemplateEntryContent(template.id, { appId: manifest.id, title: manifest.title }),
          'utf8'
        );
      }
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
      source: `ecosystem:${template.id}`,
      qaReport: report
    });

    await auditService.log(
      'PACKAGES',
      `Scaffold Ecosystem Template: ${template.id} -> ${manifest.id}`,
      {
        templateId: template.id,
        appId: manifest.id,
        qualityStatus: report.status,
        qualityScore: report.score,
        forceBypass: report.status === 'warn' && forceRequested,
        user: req.user?.username
      },
      'INFO'
    );

    const created = await packageRegistryService.getSandboxApp(manifest.id);
    return res.status(201).json({
      success: true,
      template: {
        id: template.id,
        namespace: template.namespace
      },
      package: created,
      report,
      validation: buildManifestValidation()
    });
  } catch (err) {
    const status =
      err.code === 'APP_ID_INVALID' ||
      err.code?.startsWith('PACKAGE_') ||
      err.code === 'RUNTIME_PROFILE_INVALID' ||
      err.code?.startsWith('TEMPLATE_QUALITY_')
        ? 400
        : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'ECOSYSTEM_TEMPLATE_SCAFFOLD_FAILED',
      message: err.message,
      validation: err.code === 'RUNTIME_PROFILE_INVALID' ? buildManifestValidation(err) : undefined
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

router.get(`/${APP_ID_ROUTE}/backup-policy`, async (req, res) => {
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
    const policy = await packageLifecycleService.getBackupPolicy(appId);
    return res.json({
      success: true,
      appId,
      backupPolicy: policy.backupPolicy
    });
  } catch (err) {
    const status = err.code === 'APP_ID_INVALID' ? 400 : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'PACKAGE_BACKUP_POLICY_READ_FAILED',
      message: err.message
    });
  }
});

router.put(`/${APP_ID_ROUTE}/backup-policy`, async (req, res) => {
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
    const lifecycle = await packageLifecycleService.setBackupPolicy(appId, req.body || {});
    await auditService.log(
      'PACKAGES',
      `Set Package Backup Policy: ${appId}`,
      {
        appId,
        backupPolicy: lifecycle.backupPolicy,
        user: req.user?.username
      },
      'INFO'
    );

    return res.json({
      success: true,
      appId,
      backupPolicy: lifecycle.backupPolicy,
      lifecycle
    });
  } catch (err) {
    const status =
      err.code === 'APP_ID_INVALID' ||
      err.code === 'PACKAGE_BACKUP_POLICY_REQUIRED_FIELD' ||
      err.code === 'PACKAGE_BACKUP_POLICY_INVALID_MAX_BACKUPS' ||
      err.code === 'PACKAGE_BACKUP_POLICY_INVALID_SCHEDULE' ||
      err.code === 'PACKAGE_BACKUP_POLICY_INVALID_SCHEDULE_INTERVAL' ||
      err.code === 'PACKAGE_BACKUP_POLICY_INVALID_SCHEDULE_TIME'
        ? 400
        : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'PACKAGE_BACKUP_POLICY_UPDATE_FAILED',
      message: err.message
    });
  }
});

router.get(`/${APP_ID_ROUTE}/ops-summary`, async (req, res) => {
  try {
    const appId = appPaths.assertSafeAppId(req.params.id);
    const refreshHealth = parseBooleanQuery(req.query.refreshHealth);
    const eventsLimit = parseBoundedLimit(req.query.eventsLimit, 20, 50);
    const runtimeManager = req.app.get('runtimeManager');

    const summary = await buildPackageOpsSummary(appId, {
      runtimeManager,
      refreshHealth,
      eventsLimit
    });

    return res.json({
      success: true,
      summary
    });
  } catch (err) {
    const status =
      err.code === 'APP_ID_INVALID'
        ? 400
        : err.code === 'PACKAGE_NOT_FOUND'
          ? 404
          : err.code === 'PACKAGE_RUNTIME_MANAGER_UNAVAILABLE'
            ? 503
            : err.code === 'PACKAGE_LIFECYCLE_FETCH_FAILED' ||
                err.code === 'PACKAGE_RUNTIME_EVENTS_FETCH_FAILED' ||
                err.code === 'PACKAGE_HEALTH_REPORT_FETCH_FAILED'
              ? 500
              : 500;

    return res.status(status).json({
      error: true,
      code: err.code || 'PACKAGE_OPS_SUMMARY_FETCH_FAILED',
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

router.get(`/${APP_ID_ROUTE}/backup-jobs`, async (req, res) => {
  try {
    const appId = appPaths.assertSafeAppId(req.params.id);
    const limit = parseBoundedLimit(req.query.limit, 20, 50);
    const result = await packageLifecycleService.listBackupJobs(appId, { limit });
    return res.json({
      success: true,
      appId,
      jobs: result.jobs
    });
  } catch (err) {
    const status = err.code === 'APP_ID_INVALID' ? 400 : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'PACKAGE_BACKUP_JOBS_FETCH_FAILED',
      message: err.message
    });
  }
});

router.post(`/${APP_ID_ROUTE}/backup-jobs`, async (req, res) => {
  try {
    const appId = appPaths.assertSafeAppId(req.params.id);
    const note = String(req.body?.note || '').trim();
    const result = await packageLifecycleService.createBackupJob(appId, { note });

    await auditService.log(
      'PACKAGES',
      `Create Package Backup Job: ${appId}`,
      {
        appId,
        jobId: result.job.id,
        note: result.job.note,
        user: req.user?.username
      },
      'INFO'
    );

    return res.status(201).json({
      success: true,
      appId,
      job: result.job
    });
  } catch (err) {
    const status =
      err.code === 'APP_ID_INVALID' || err.code === 'PACKAGE_NOT_FOUND'
        ? 400
        : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'PACKAGE_BACKUP_JOB_CREATE_FAILED',
      message: err.message
    });
  }
});

router.post(`/${APP_ID_ROUTE}/backup-jobs/:jobId/cancel`, async (req, res) => {
  try {
    const appId = appPaths.assertSafeAppId(req.params.id);
    const jobId = String(req.params.jobId || '').trim();
    const result = await packageLifecycleService.cancelBackupJob(appId, jobId);

    await auditService.log(
      'PACKAGES',
      `Cancel Package Backup Job: ${appId}`,
      {
        appId,
        jobId: result.job.id,
        user: req.user?.username
      },
      'WARN'
    );

    return res.json({
      success: true,
      appId,
      job: result.job
    });
  } catch (err) {
    const status =
      err.code === 'APP_ID_INVALID' || err.code === 'PACKAGE_BACKUP_JOB_ID_REQUIRED'
        ? 400
        : err.code === 'PACKAGE_BACKUP_JOB_NOT_FOUND'
          ? 404
          : err.code === 'PACKAGE_BACKUP_JOB_NOT_CANCELABLE'
            ? 409
            : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'PACKAGE_BACKUP_JOB_CANCEL_FAILED',
      message: err.message
    });
  }
});

router.post(`/${APP_ID_ROUTE}/rollback/preflight`, async (req, res) => {
  try {
    const appId = appPaths.assertSafeAppId(req.params.id);
    const backupId = String(req.body?.backupId || '').trim();
    const lifecycle = await packageLifecycleService.getLifecycle(appId).catch(() => null);
    const runtimeManager = req.app.get('runtimeManager');
    const runtimeStatus = runtimeManager?.getRuntimeStatusMap?.()[appId] || null;
    const backups = Array.isArray(lifecycle?.backups) ? lifecycle.backups : [];
    const selectedBackup = backupId ? backups.find((item) => item.id === backupId) || null : null;

    const safeguards = buildLifecycleSafeguards({
      operationType: 'rollback',
      existing: true,
      lifecycle,
      runtimeStatus,
      dependencyCompatibility: null,
      backupPlan: { required: true, reason: 'rollback' }
    });

    const blockers = [
      ...toSafeguardBlockers(safeguards),
      ...(backupId && !selectedBackup
        ? [{
            code: 'PACKAGE_BACKUP_NOT_FOUND',
            message: `Backup "${backupId}" was not found.`,
            area: 'rollback'
          }]
        : [])
    ];

    const preflight = {
        operation: {
          type: 'rollback',
          appId,
          backupId: backupId || null
        },
        availableBackups: backups,
        selectedBackup,
        lifecycleSafeguards: safeguards,
        executionReadiness: {
          ready: blockers.length === 0,
          blockers
        }
      };
    const currentManifest = await readManifestRaw(appId).catch(() => null);
    const targetHash = createLifecycleApprovalTargetHash('package.rollback', {
      appId,
      backupId: backupId || null,
      selectedBackup,
      currentManifestHash: currentManifest ? computeObjectHash('package-rollback-current-manifest-v1', currentManifest) : null,
      runtimeStatus,
      lifecycleSafeguards: safeguards,
      blockers
    });

    return res.json({
      success: true,
      preflight: attachLifecycleApproval(preflight, {
        userId: req.user?.username,
        targetId: appId,
        action: 'package.rollback',
        targetHash
      })
    });
  } catch (err) {
    const status =
      err.code === 'APP_ID_INVALID' || err.code === 'PACKAGE_NOT_FOUND'
        ? 400
        : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'PACKAGE_ROLLBACK_PREFLIGHT_FAILED',
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
    const rollbackPreflightLifecycle = await packageLifecycleService.getLifecycle(appId).catch(() => null);
    const backups = Array.isArray(rollbackPreflightLifecycle?.backups) ? rollbackPreflightLifecycle.backups : [];
    const selectedBackup = backups.find((item) => item.id === backupId) || null;
    const rollbackPreflight = buildLifecycleSafeguards({
      operationType: 'rollback',
      existing: true,
      lifecycle: rollbackPreflightLifecycle,
      runtimeStatus,
      dependencyCompatibility: null,
      backupPlan: { required: true, reason: 'rollback' }
    });
    const rollbackBlockers = [
      ...toSafeguardBlockers(rollbackPreflight),
      ...(!selectedBackup
        ? [{
            code: 'PACKAGE_BACKUP_NOT_FOUND',
            message: `Backup "${backupId}" was not found.`,
            area: 'rollback'
          }]
        : [])
    ];
    const currentManifest = await readManifestRaw(appId).catch(() => null);
    const preflight = attachLifecycleApproval({
      operation: {
        type: 'rollback',
        appId,
        backupId
      },
      availableBackups: backups,
      selectedBackup,
      lifecycleSafeguards: rollbackPreflight,
      executionReadiness: {
        ready: rollbackBlockers.length === 0,
        blockers: rollbackBlockers
      }
    }, {
      userId: req.user?.username,
      targetId: appId,
      action: 'package.rollback',
      targetHash: createLifecycleApprovalTargetHash('package.rollback', {
        appId,
        backupId,
        selectedBackup,
        currentManifestHash: currentManifest ? computeObjectHash('package-rollback-current-manifest-v1', currentManifest) : null,
        runtimeStatus,
        lifecycleSafeguards: rollbackPreflight,
        blockers: rollbackBlockers
      })
    });
    let approvalContext = null;
    try {
      approvalContext = consumeLifecycleApproval({
        approval: normalizeApprovalPayload(req.body || {}),
        action: 'package.rollback',
        targetId: appId,
        targetHash: preflight.targetHash,
        userId: req.user?.username
      });
    } catch (approvalErr) {
      return res.status(approvalErr.status || 428).json({
        error: true,
        code: approvalErr.code || 'PACKAGE_ROLLBACK_APPROVAL_INVALID',
        message: approvalErr.message,
        preflight
      });
    }

    if (rollbackBlockers.length > 0) {
      return res.status(400).json({
        error: true,
        code: 'PACKAGE_ROLLBACK_GUARD_BLOCKED',
        message: 'Rollback is blocked by lifecycle safeguards.',
        executionReadiness: {
          ready: false,
          blockers: rollbackBlockers
        },
        lifecycleSafeguards: rollbackPreflight
      });
    }

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
      {
        appId,
        backupId,
        operationId: approvalContext.operationId,
        approval: {
          operationId: approvalContext.operationId,
          nonceConsumed: true,
          approvedAt: approvalContext.approvedAt,
          consumedAt: approvalContext.consumedAt,
          targetHash: approvalContext.targetHash
        },
        user: req.user?.username
      },
      'WARN'
    );

    return res.json({
      success: true,
      restored,
      lifecycleSafeguards: rollbackPreflight
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

router.post(`/${APP_ID_ROUTE}/manifest/preflight`, async (req, res) => {
  try {
    const routeAppId = appPaths.assertSafeAppId(req.params.id);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const manifestInput = body.manifest;
    const approvals = body.approvals && typeof body.approvals === 'object' && !Array.isArray(body.approvals)
      ? body.approvals
      : {};

    if (!manifestInput || typeof manifestInput !== 'object' || Array.isArray(manifestInput)) {
      return res.status(400).json({
        error: true,
        code: 'PACKAGE_MANIFEST_REQUIRED',
        message: 'Body "manifest" object is required.'
      });
    }

    const manifest = normalizeManifestInput(manifestInput, routeAppId);
    if (manifest.id !== routeAppId) {
      return res.status(400).json({
        error: true,
        code: 'PACKAGE_ID_MISMATCH',
        message: 'Manifest id must match route id.',
        executionReadiness: {
          ready: false,
          blockers: [
            {
              code: 'PACKAGE_ID_MISMATCH',
              message: 'Manifest id must match route id.',
              area: 'manifest'
            }
          ]
        }
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

    const permissionsReview = buildPermissionReview(manifest);
    const toolPackageReview = buildToolPackageReview(manifest);
    const previousManifest = await readManifestRaw(routeAppId);
    const lifecycle = await packageLifecycleService.getLifecycle(routeAppId).catch(() => null);
    const runtimeManager = req.app.get('runtimeManager');
    const runtimeStatus = runtimeManager?.getRuntimeStatusMap?.()[routeAppId] || null;
    const mediaScopeReview = buildMediaScopeReview(manifest, {
      previousManifest,
      approvalReceived: approvals.mediaScopesAccepted === true
    });

    let dependencyCompatibility = null;
    try {
      dependencyCompatibility = await evaluateManifestDependencyCompatibility(manifest);
    } catch (err) {
      const wrapped = new Error('Failed to evaluate dependency and compatibility checks.');
      wrapped.code = 'PACKAGE_MANIFEST_PREFLIGHT_COMPATIBILITY_CHECK_FAILED';
      wrapped.cause = err;
      throw wrapped;
    }

    const blockers = [];
    blockers.push(...mediaScopeReview.blockers);
    if (toolPackageReview.status === 'fail') {
      blockers.push({
        code: 'HYBRID_TOOL_PACKAGE_CONTRACT_FAILED',
        message: toolPackageReview.summary,
        area: 'toolPackage'
      });
    }
    let runtimeProfile = null;
    try {
      runtimeProfile = normalizeRuntimeProfile(manifest);
      assertValidRuntimeProfile(manifest, runtimeProfile);
    } catch (err) {
      blockers.push({
        code: err.code || 'RUNTIME_PROFILE_INVALID',
        message: err.message,
        area: 'runtime'
      });
    }

    const uiEntry = runtimeProfile?.appType === 'hybrid'
      ? runtimeProfile.ui?.entry
      : runtimeProfile?.entry;
    const shouldValidateUiEntry = runtimeProfile && runtimeProfile.appType !== 'service';
    if (shouldValidateUiEntry) {
      const entryPath = await resolvePackagePath(routeAppId, uiEntry || manifest.entry);
      if (!(await fs.pathExists(entryPath))) {
        blockers.push({
          code: 'PACKAGE_ENTRY_NOT_FOUND',
          message: `Entry file "${uiEntry || manifest.entry}" does not exist.`,
          area: 'entry'
        });
      }
    }

    const compatibilityFailures = Array.isArray(dependencyCompatibility?.checks)
      ? dependencyCompatibility.checks.filter((check) => check.level === 'fail')
      : [];
    for (const failure of compatibilityFailures) {
      blockers.push({
        code: failure.code || 'PACKAGE_DEPENDENCY_COMPATIBILITY_FAILED',
        message: failure.message || 'Dependency or compatibility check failed.',
        area: String(failure.id || '').startsWith('dependency.') ? 'dependency' : 'compatibility'
      });
    }

    const lifecycleSafeguards = buildLifecycleSafeguards({
      operationType: 'manifest-update',
      existing: true,
      lifecycle,
      runtimeStatus,
      dependencyCompatibility,
      backupPlan: { required: true, reason: 'manifest-update' }
    });
    blockers.push(...toSafeguardBlockers(lifecycleSafeguards));

    const preflight = {
        operation: {
          type: 'manifest-update',
          appId: routeAppId
        },
        permissionsReview,
        toolPackageReview,
        mediaScopeReview,
        dependencyCompatibility,
        lifecycleSafeguards,
        onboarding: buildExternalOnboardingGuide({
          manifest,
          operationType: 'manifest-update',
          dependencyCompatibility
        }),
        executionReadiness: {
          ready: blockers.length === 0,
          blockers
        }
      };
    const targetHash = createLifecycleApprovalTargetHash('package.manifest.update', {
      appId: routeAppId,
      previousManifestHash: previousManifest ? computeObjectHash('package-manifest-previous-v1', previousManifest) : null,
      incomingManifestHash: computeObjectHash('package-manifest-incoming-v1', manifest),
      permissionsReview,
      toolPackageReview,
      mediaScopeReview,
      dependencyCompatibility,
      runtimeProfile,
      lifecycleSafeguards,
      blockers
    });

    return res.json({
      success: true,
      preflight: attachLifecycleApproval(preflight, {
        userId: req.user?.username,
        targetId: routeAppId,
        action: 'package.manifest.update',
        targetHash
      })
    });
  } catch (err) {
    const status =
      err.code === 'PACKAGE_NOT_FOUND'
        ? 404
        :
      err.code === 'APP_ID_INVALID' ||
      err.code === 'PACKAGE_MANIFEST_REQUIRED' ||
      err.code === 'PACKAGE_ID_MISMATCH' ||
      err.code === 'RUNTIME_PROFILE_INVALID' ||
      err.code?.startsWith('PACKAGE_')
        ? 400
        : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'PACKAGE_MANIFEST_PREFLIGHT_FAILED',
      message: err.message
    });
  }
});

router.put(`/${APP_ID_ROUTE}/manifest`, async (req, res) => {
  try {
    const routeAppId = appPaths.assertSafeAppId(req.params.id);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { manifestInput, approvals } = resolveManifestRequestBody(body);
    const manifest = normalizeManifestInput(manifestInput, routeAppId);
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
    const mediaScopeReview = buildMediaScopeReview(manifest, {
      previousManifest,
      approvalReceived: approvals.mediaScopesAccepted === true
    });
    if (mediaScopeReview.requiresApproval && !mediaScopeReview.approvalReceived) {
      return res.status(400).json({
        error: true,
        code: 'PACKAGE_MEDIA_SCOPE_APPROVAL_REQUIRED',
        message: 'Media scopes require explicit approval before this update can be saved.',
        mediaScopeReview
      });
    }
    const runtimeProfile = normalizeRuntimeProfile(manifest);
    assertValidRuntimeProfile(manifest, runtimeProfile);
    const uiEntry = runtimeProfile.appType === 'hybrid'
      ? runtimeProfile.ui?.entry
      : runtimeProfile.entry;
    const shouldValidateUiEntry = runtimeProfile.appType !== 'service';
    const entryPath = await resolvePackagePath(routeAppId, uiEntry || manifest.entry);
    if (shouldValidateUiEntry && !(await fs.pathExists(entryPath))) {
      return res.status(400).json({
        error: true,
        code: 'PACKAGE_ENTRY_NOT_FOUND',
        message: `Entry file "${uiEntry || manifest.entry}" does not exist.`
      });
    }
    let dependencyCompatibility = null;
    try {
      dependencyCompatibility = await evaluateManifestDependencyCompatibility(manifest);
    } catch (err) {
      const wrapped = new Error('Failed to evaluate dependency and compatibility checks.');
      wrapped.code = 'PACKAGE_MANIFEST_COMPATIBILITY_CHECK_FAILED';
      wrapped.cause = err;
      throw wrapped;
    }
    const runtimeManager = req.app.get('runtimeManager');
    const runtimeStatus = runtimeManager?.getRuntimeStatusMap?.()[routeAppId] || null;
    const lifecycle = await packageLifecycleService.getLifecycle(routeAppId).catch(() => null);
    const lifecycleSafeguards = buildLifecycleSafeguards({
      operationType: 'manifest-update',
      existing: true,
      lifecycle,
      runtimeStatus,
      dependencyCompatibility,
      backupPlan: { required: true, reason: 'manifest-update' }
    });
    const permissionsReview = buildPermissionReview(manifest);
    const toolPackageReview = buildToolPackageReview(manifest);
    const blockers = [
      ...mediaScopeReview.blockers,
      ...toSafeguardBlockers(lifecycleSafeguards)
    ];
    if (toolPackageReview.status === 'fail') {
      blockers.push({
        code: 'HYBRID_TOOL_PACKAGE_CONTRACT_FAILED',
        message: toolPackageReview.summary,
        area: 'toolPackage'
      });
    }
    const preflight = attachLifecycleApproval({
      operation: {
        type: 'manifest-update',
        appId: routeAppId
      },
      permissionsReview,
      toolPackageReview,
      mediaScopeReview,
      dependencyCompatibility,
      lifecycleSafeguards,
      onboarding: buildExternalOnboardingGuide({
        manifest,
        operationType: 'manifest-update',
        dependencyCompatibility
      }),
      executionReadiness: {
        ready: blockers.length === 0,
        blockers
      }
    }, {
      userId: req.user?.username,
      targetId: routeAppId,
      action: 'package.manifest.update',
      targetHash: createLifecycleApprovalTargetHash('package.manifest.update', {
        appId: routeAppId,
        previousManifestHash: previousManifest ? computeObjectHash('package-manifest-previous-v1', previousManifest) : null,
        incomingManifestHash: computeObjectHash('package-manifest-incoming-v1', manifest),
        permissionsReview,
        toolPackageReview,
        mediaScopeReview,
        dependencyCompatibility,
        runtimeProfile,
        lifecycleSafeguards,
        blockers
      })
    });
    let approvalContext = null;
    try {
      approvalContext = consumeLifecycleApproval({
        approval: normalizeApprovalPayload(body),
        action: 'package.manifest.update',
        targetId: routeAppId,
        targetHash: preflight.targetHash,
        userId: req.user?.username
      });
    } catch (approvalErr) {
      return res.status(approvalErr.status || 428).json({
        error: true,
        code: approvalErr.code || 'PACKAGE_MANIFEST_APPROVAL_INVALID',
        message: approvalErr.message,
        preflight
      });
    }
    if (blockers.length > 0) {
      return res.status(400).json({
        error: true,
        code: 'PACKAGE_MANIFEST_GUARD_BLOCKED',
        message: 'Manifest update is blocked by package lifecycle safeguards.',
        preflight
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
      {
        appId: routeAppId,
        user: req.user?.username,
        operationId: approvalContext.operationId,
        approval: {
          operationId: approvalContext.operationId,
          nonceConsumed: true,
          approvedAt: approvalContext.approvedAt,
          consumedAt: approvalContext.consumedAt,
          targetHash: approvalContext.targetHash
        },
        mediaScopeChanges: mediaScopeReview.changes,
        mediaScopeApproval: {
          required: mediaScopeReview.requiresApproval,
          received: mediaScopeReview.approvalReceived,
          accepted: approvals.mediaScopesAccepted === true
        }
      },
      'INFO'
    );

    const updated = await packageRegistryService.getSandboxApp(routeAppId);
    return res.json({
      success: true,
      package: updated,
      manifest,
      mediaScopeReview,
      validation: buildManifestValidation()
    });
  } catch (err) {
    const status = err.code === 'APP_ID_INVALID' || err.code?.startsWith('PACKAGE_') || err.code === 'RUNTIME_PROFILE_INVALID' ? 400 : 500;
    return res.status(status).json({
      error: true,
      code: err.code || 'PACKAGE_MANIFEST_UPDATE_FAILED',
      message: err.message,
      validation: err.code === 'RUNTIME_PROFILE_INVALID' ? buildManifestValidation(err) : undefined
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

    const normalizedPath = normalizeRelativePath(requestedPath);
    if (normalizedPath === 'manifest.json') {
      return res.status(400).json({
        error: true,
        code: 'PACKAGE_MANIFEST_WRITE_FORBIDDEN',
        message: 'manifest.json cannot be edited with this endpoint.'
      });
    }

    const targetFile = await resolvePackagePath(appId, requestedPath);
    await fs.ensureDir(path.dirname(targetFile));
    await fs.writeFile(targetFile, String(body.content || ''), 'utf8');

    await auditService.log(
      'PACKAGES',
      `Write Package File: ${appId}`,
      { appId, path: normalizedPath, user: req.user?.username },
      'INFO'
    );

    return res.json({
      success: true,
      file: {
        path: normalizedPath
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

    const normalizedPath = normalizeRelativePath(requestedPath);
    if (createType === 'file' && normalizedPath === 'manifest.json') {
      return res.status(400).json({
        error: true,
        code: 'PACKAGE_MANIFEST_CREATE_FORBIDDEN',
        message: 'manifest.json cannot be created with this endpoint.'
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
      { appId, path: normalizedPath, type: createType, user: req.user?.username },
      'INFO'
    );

    return res.status(201).json({
      success: true,
      type: createType,
      path: normalizedPath
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
