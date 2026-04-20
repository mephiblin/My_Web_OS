const fs = require('fs-extra');
const path = require('path');
const AdmZip = require('adm-zip');

const appPaths = require('../utils/appPaths');
const inventoryPaths = require('../utils/inventoryPaths');

const FILE_NAME = 'package-lifecycle.json';
const BACKUPS_DIR_NAME = 'package-backups';
const CHANNELS = new Set(['stable', 'beta', 'alpha', 'canary']);
const MAX_HISTORY = 50;
const MAX_BACKUPS = 20;

function nowIso() {
  return new Date().toISOString();
}

function toPosixPath(value = '') {
  return String(value).split(path.sep).join('/');
}

function normalizeZipEntryPath(value = '') {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
}

function toSafeVersion(value) {
  const clean = String(value || '0.0.0').trim();
  const normalized = clean.replace(/[^a-zA-Z0-9._-]/g, '_');
  return normalized || '0.0.0';
}

function normalizeChannel(value, fallback = 'stable') {
  const channel = String(value || '').trim().toLowerCase();
  if (CHANNELS.has(channel)) {
    return channel;
  }
  return fallback;
}

function normalizeDependencies(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') {
        const id = item.trim();
        return id ? { id, version: '*', optional: false } : null;
      }
      if (!item || typeof item !== 'object') return null;
      const id = String(item.id || item.name || '').trim();
      if (!id) return null;
      return {
        id,
        version: String(item.version || item.range || '*').trim() || '*',
        optional: Boolean(item.optional)
      };
    })
    .filter(Boolean);
}

function normalizeCompatibility(value) {
  if (!value || typeof value !== 'object') {
    return {
      minServerVersion: '',
      maxServerVersion: '',
      requiredRuntimeTypes: []
    };
  }

  const runtimeTypes = Array.isArray(value.requiredRuntimeTypes)
    ? value.requiredRuntimeTypes.map((item) => String(item || '').trim()).filter(Boolean)
    : [];

  return {
    minServerVersion: String(value.minServerVersion || '').trim(),
    maxServerVersion: String(value.maxServerVersion || '').trim(),
    requiredRuntimeTypes: runtimeTypes
  };
}

function defaultSnapshot() {
  return {
    version: 1,
    updatedAt: nowIso(),
    apps: {}
  };
}

function normalizeHistoryItem(item = {}) {
  return {
    version: String(item.version || '0.0.0').trim() || '0.0.0',
    channel: normalizeChannel(item.channel, 'stable'),
    installedAt: typeof item.installedAt === 'string' ? item.installedAt : nowIso(),
    source: String(item.source || '').trim(),
    reason: String(item.reason || 'install').trim(),
    backupId: item.backupId ? String(item.backupId) : null,
    note: String(item.note || '').trim()
  };
}

function normalizeBackupItem(item = {}) {
  return {
    id: String(item.id || '').trim(),
    fileName: String(item.fileName || '').trim(),
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : nowIso(),
    version: String(item.version || '0.0.0').trim() || '0.0.0',
    note: String(item.note || '').trim()
  };
}

function normalizeLifecycleEntry(item = {}) {
  const history = Array.isArray(item.history)
    ? item.history.map((entry) => normalizeHistoryItem(entry)).slice(-MAX_HISTORY)
    : [];
  const backups = Array.isArray(item.backups)
    ? item.backups
      .map((entry) => normalizeBackupItem(entry))
      .filter((entry) => entry.id && entry.fileName)
      .slice(-MAX_BACKUPS)
    : [];

  return {
    channel: normalizeChannel(item.channel, 'stable'),
    current: item.current
      ? {
        version: String(item.current.version || '0.0.0').trim() || '0.0.0',
        channel: normalizeChannel(item.current.channel, 'stable'),
        installedAt: typeof item.current.installedAt === 'string' ? item.current.installedAt : nowIso(),
        source: String(item.current.source || '').trim(),
        reason: String(item.current.reason || 'install').trim()
      }
      : null,
    history,
    backups,
    lastQaReport: item.lastQaReport && typeof item.lastQaReport === 'object'
      ? {
        checkedAt: typeof item.lastQaReport.checkedAt === 'string' ? item.lastQaReport.checkedAt : nowIso(),
        status: String(item.lastQaReport.status || 'unknown'),
        summary: String(item.lastQaReport.summary || '').trim(),
        checks: Array.isArray(item.lastQaReport.checks) ? item.lastQaReport.checks : []
      }
      : null,
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : nowIso()
  };
}

function normalizeSnapshot(input) {
  if (!input || typeof input !== 'object') {
    return defaultSnapshot();
  }

  const apps = {};
  for (const [appId, item] of Object.entries(input.apps || {})) {
    try {
      appPaths.assertSafeAppId(appId);
      apps[appId] = normalizeLifecycleEntry(item);
    } catch (_err) {
      // Skip invalid ids.
    }
  }

  return {
    version: Number.isFinite(Number(input.version)) ? Number(input.version) : 1,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : nowIso(),
    apps
  };
}

async function getStateFilePath() {
  const roots = await inventoryPaths.ensureInventoryStructure();
  return path.join(roots.systemDir, FILE_NAME);
}

async function getBackupsRootDir() {
  const roots = await inventoryPaths.ensureInventoryStructure();
  const dir = path.join(roots.systemDir, BACKUPS_DIR_NAME);
  await fs.ensureDir(dir);
  return dir;
}

async function readAll() {
  const filePath = await getStateFilePath();
  if (!(await fs.pathExists(filePath))) {
    const initial = defaultSnapshot();
    await fs.writeJson(filePath, initial, { spaces: 2 });
    return initial;
  }

  try {
    const payload = await fs.readJson(filePath);
    return normalizeSnapshot(payload);
  } catch (_err) {
    const backupPath = `${filePath}.corrupt-${Date.now()}.json`;
    await fs.copy(filePath, backupPath).catch(() => {});
    const initial = defaultSnapshot();
    await fs.writeJson(filePath, initial, { spaces: 2 });
    return initial;
  }
}

async function writeAll(snapshot) {
  const filePath = await getStateFilePath();
  const normalized = normalizeSnapshot(snapshot);
  normalized.updatedAt = nowIso();
  await fs.writeJson(filePath, normalized, { spaces: 2 });
  return normalized;
}

async function updateAppLifecycle(appId, updater) {
  const safeAppId = appPaths.assertSafeAppId(appId);
  const snapshot = await readAll();
  const current = normalizeLifecycleEntry(snapshot.apps[safeAppId] || {});
  const next = updater(current) || current;
  const normalized = normalizeLifecycleEntry(next);
  normalized.updatedAt = nowIso();
  snapshot.apps[safeAppId] = normalized;
  await writeAll(snapshot);
  return normalized;
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
    const entryDir = path.dirname(toPosixPath(childRelativePath));
    const zipDir = entryDir === '.' ? '' : entryDir;
    zip.addLocalFile(path.join(rootPath, childRelativePath), zipDir);
  }
}

function compareVersions(a, b) {
  const parse = (version) => String(version || '')
    .split('.')
    .map((part) => Number(part.replace(/[^0-9].*$/, '')) || 0)
    .slice(0, 3);

  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < 3; index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const packageLifecycleService = {
  CHANNELS: Array.from(CHANNELS),

  normalizeDependencies,
  normalizeCompatibility,
  compareVersions,

  async getLifecycle(appId, manifest = null) {
    const safeAppId = appPaths.assertSafeAppId(appId);
    const snapshot = await readAll();
    const entry = normalizeLifecycleEntry(snapshot.apps[safeAppId] || {});

    return {
      appId: safeAppId,
      ...entry,
      dependencies: normalizeDependencies(manifest?.dependencies),
      compatibility: normalizeCompatibility(manifest?.compatibility)
    };
  },

  async setChannel(appId, channel) {
    const nextChannel = normalizeChannel(channel, 'stable');
    return updateAppLifecycle(appId, (current) => ({
      ...current,
      channel: nextChannel,
      current: current.current
        ? {
          ...current.current,
          channel: nextChannel
        }
        : null
    }));
  },

  async recordInstall(appId, options = {}) {
    const safeAppId = appPaths.assertSafeAppId(appId);
    const manifest = options.manifest && typeof options.manifest === 'object'
      ? options.manifest
      : await fs.readJson(await appPaths.getManifestFile(safeAppId)).catch(() => ({}));

    const version = String(options.version || manifest.version || '0.0.0').trim() || '0.0.0';
    const existingChannel = options.currentChannel || options.channel;
    const channelFromManifest = manifest.release && typeof manifest.release === 'object'
      ? manifest.release.channel
      : '';

    return updateAppLifecycle(safeAppId, (current) => {
      const channel = normalizeChannel(existingChannel || channelFromManifest || current.channel || 'stable', 'stable');
      const nextHistory = [
        ...current.history,
        normalizeHistoryItem({
          version,
          channel,
          installedAt: options.installedAt || nowIso(),
          source: String(options.source || '').trim(),
          reason: String(options.reason || 'install').trim(),
          backupId: options.backupId || null,
          note: String(options.note || '').trim()
        })
      ].slice(-MAX_HISTORY);

      const next = {
        ...current,
        channel,
        current: {
          version,
          channel,
          installedAt: options.installedAt || nowIso(),
          source: String(options.source || '').trim(),
          reason: String(options.reason || 'install').trim()
        },
        history: nextHistory
      };

      if (options.qaReport && typeof options.qaReport === 'object') {
        next.lastQaReport = {
          checkedAt: options.qaReport.checkedAt || nowIso(),
          status: String(options.qaReport.status || 'unknown'),
          summary: String(options.qaReport.summary || '').trim(),
          checks: Array.isArray(options.qaReport.checks) ? options.qaReport.checks : []
        };
      }

      return next;
    });
  },

  async recordQaReport(appId, report = {}) {
    return updateAppLifecycle(appId, (current) => ({
      ...current,
      lastQaReport: {
        checkedAt: report.checkedAt || nowIso(),
        status: String(report.status || 'unknown'),
        summary: String(report.summary || '').trim(),
        checks: Array.isArray(report.checks) ? report.checks : []
      }
    }));
  },

  async createBackup(appId, options = {}) {
    const safeAppId = appPaths.assertSafeAppId(appId);
    const appRoot = await appPaths.getAppRoot(safeAppId);
    if (!(await fs.pathExists(appRoot))) {
      const err = new Error('Package not found.');
      err.code = 'PACKAGE_NOT_FOUND';
      throw err;
    }

    const manifest = await fs.readJson(await appPaths.getManifestFile(safeAppId)).catch(() => ({}));
    const version = String(options.version || manifest.version || '0.0.0').trim() || '0.0.0';
    const backupId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fileName = `${backupId}-${toSafeVersion(version)}.zip`;

    const backupsRoot = await getBackupsRootDir();
    const appBackupsDir = path.join(backupsRoot, safeAppId);
    await fs.ensureDir(appBackupsDir);

    const zip = new AdmZip();
    await addDirectoryToZip(zip, appRoot);
    const backupPath = path.join(appBackupsDir, fileName);
    zip.writeZip(backupPath);

    const backupEntry = normalizeBackupItem({
      id: backupId,
      fileName,
      createdAt: nowIso(),
      version,
      note: String(options.note || '').trim()
    });

    await updateAppLifecycle(safeAppId, (current) => ({
      ...current,
      backups: [...current.backups, backupEntry].slice(-MAX_BACKUPS)
    }));

    return backupEntry;
  },

  async restoreBackup(appId, backupId) {
    const safeAppId = appPaths.assertSafeAppId(appId);
    const snapshot = await readAll();
    const current = normalizeLifecycleEntry(snapshot.apps[safeAppId] || {});
    const targetBackup = current.backups.find((item) => item.id === backupId);
    if (!targetBackup) {
      const err = new Error('Backup not found.');
      err.code = 'PACKAGE_BACKUP_NOT_FOUND';
      throw err;
    }

    const backupsRoot = await getBackupsRootDir();
    const backupPath = path.join(backupsRoot, safeAppId, targetBackup.fileName);
    if (!(await fs.pathExists(backupPath))) {
      const err = new Error('Backup archive file not found.');
      err.code = 'PACKAGE_BACKUP_FILE_NOT_FOUND';
      throw err;
    }

    const appRoot = await appPaths.getAppRoot(safeAppId);
    await fs.remove(appRoot);
    await fs.ensureDir(appRoot);

    const zip = new AdmZip(backupPath);
    const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
    for (const entry of entries) {
      const relativePath = normalizeZipEntryPath(entry.entryName);
      if (!relativePath) continue;
      const targetFile = appPaths.ensureWithinRoot(appRoot, path.join(appRoot, relativePath));
      await fs.ensureDir(path.dirname(targetFile));
      await fs.writeFile(targetFile, zip.readFile(entry));
    }

    const manifest = await fs.readJson(await appPaths.getManifestFile(safeAppId)).catch(() => null);
    if (!manifest || typeof manifest !== 'object') {
      const err = new Error('Backup restore did not produce a valid manifest.');
      err.code = 'PACKAGE_BACKUP_INVALID';
      throw err;
    }

    await this.recordInstall(safeAppId, {
      manifest,
      reason: 'rollback',
      source: `backup:${targetBackup.id}`,
      note: 'Rollback completed from backup.'
    });

    return {
      appId: safeAppId,
      backup: targetBackup,
      version: String(manifest.version || '0.0.0')
    };
  }
};

module.exports = packageLifecycleService;
