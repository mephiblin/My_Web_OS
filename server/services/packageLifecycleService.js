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
const MAX_BACKUPS_LIMIT = 100;
const MAX_BACKUP_JOBS = 60;
const BACKUP_SCHEDULE_INTERVALS = new Set(['manual', 'daily', 'weekly', 'monthly']);
const DEFAULT_BACKUP_TIME = '00:00';
const SCHEDULE_TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const runningBackupJobs = new Set();
let lifecycleMutationQueue = Promise.resolve();

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

function normalizeBackupPolicy(value = {}) {
  const rawSchedule = value?.schedule;
  return {
    maxBackups: normalizeBackupMaxBackups(value),
    schedule: normalizeBackupSchedule(rawSchedule, value)
  };
}

function normalizeBackupMaxBackups(value = {}) {
  const raw = Number(value?.maxBackups);
  const maxBackups = Number.isFinite(raw)
    ? Math.max(1, Math.min(MAX_BACKUPS_LIMIT, Math.floor(raw)))
    : MAX_BACKUPS;

  return maxBackups;
}

function normalizeBackupTime(value) {
  const normalized = String(value || '').trim();
  if (SCHEDULE_TIME_RE.test(normalized)) {
    return normalized;
  }
  return DEFAULT_BACKUP_TIME;
}

function normalizeBackupSchedule(value = {}, fallback = {}) {
  const fallbackSchedule = normalizeBackupScheduleDefaults(fallback);
  const source = value && typeof value === 'object'
    ? value
    : {};

  const intervalRaw = String(
    Object.prototype.hasOwnProperty.call(source, 'interval')
      ? source.interval
      : fallbackSchedule.interval
  ).trim().toLowerCase();

  const interval = BACKUP_SCHEDULE_INTERVALS.has(intervalRaw)
    ? intervalRaw
    : fallbackSchedule.interval;

  const enabledSource = Object.prototype.hasOwnProperty.call(source, 'enabled')
    ? Boolean(source.enabled)
    : fallbackSchedule.enabled;

  const timeOfDaySource = Object.prototype.hasOwnProperty.call(source, 'timeOfDay')
    ? source.timeOfDay
    : fallbackSchedule.timeOfDay;

  const timezoneSource = Object.prototype.hasOwnProperty.call(source, 'timezone')
    ? String(source.timezone || '').trim()
    : fallbackSchedule.timezone;

  return {
    enabled: interval === 'manual'
      ? false
      : enabledSource,
    interval,
    timeOfDay: normalizeBackupTime(timeOfDaySource),
    timezone: timezoneSource || 'local',
    lastRunAt: fallbackSchedule.lastRunAt ? String(fallbackSchedule.lastRunAt) : null,
    nextRunAt: fallbackSchedule.nextRunAt ? String(fallbackSchedule.nextRunAt) : null
  };
}

function normalizeBackupScheduleDefaults(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const intervalRaw = String(source.interval || 'manual').trim().toLowerCase();
  return {
    enabled: Boolean(source.enabled),
    interval: BACKUP_SCHEDULE_INTERVALS.has(intervalRaw) ? intervalRaw : 'manual',
    timeOfDay: normalizeBackupTime(source.timeOfDay || DEFAULT_BACKUP_TIME),
    timezone: String(source.timezone || 'local').trim() || 'local',
    lastRunAt: typeof source.lastRunAt === 'string' ? source.lastRunAt : null,
    nextRunAt: typeof source.nextRunAt === 'string' ? source.nextRunAt : null
  };
}

function parseBackupPolicyPatch(input = {}, currentPolicy = {}) {
  const payload = input && typeof input === 'object' ? input : {};
  const hasMaxBackups = Object.prototype.hasOwnProperty.call(payload, 'maxBackups');
  const hasSchedule = Object.prototype.hasOwnProperty.call(payload, 'schedule');

  if (!hasMaxBackups && !hasSchedule) {
    const err = new Error('Either "maxBackups" or "schedule" is required.');
    err.code = 'PACKAGE_BACKUP_POLICY_REQUIRED_FIELD';
    throw err;
  }

  const current = normalizeBackupPolicy(currentPolicy);
  const next = {
    maxBackups: current.maxBackups,
    schedule: current.schedule
  };

  if (hasMaxBackups) {
    const raw = Number(payload.maxBackups);
    if (!Number.isFinite(raw)) {
      const err = new Error('Body "maxBackups" must be a number.');
      err.code = 'PACKAGE_BACKUP_POLICY_INVALID_MAX_BACKUPS';
      throw err;
    }

    next.maxBackups = Math.max(1, Math.min(MAX_BACKUPS_LIMIT, Math.floor(raw)));
  }

  if (hasSchedule) {
    if (!payload.schedule || typeof payload.schedule !== 'object') {
      const err = new Error('Body "schedule" must be an object.');
      err.code = 'PACKAGE_BACKUP_POLICY_INVALID_SCHEDULE';
      throw err;
    }

    if (Object.keys(payload.schedule).length === 0) {
      const err = new Error('Body "schedule" must define at least one field.');
      err.code = 'PACKAGE_BACKUP_POLICY_INVALID_SCHEDULE';
      throw err;
    }

    const hasInterval = Object.prototype.hasOwnProperty.call(payload.schedule, 'interval');
    const hasEnabled = Object.prototype.hasOwnProperty.call(payload.schedule, 'enabled');
    const hasTime = Object.prototype.hasOwnProperty.call(payload.schedule, 'timeOfDay');

    if (hasInterval) {
      const interval = String(payload.schedule.interval || '').trim().toLowerCase();
      if (!BACKUP_SCHEDULE_INTERVALS.has(interval)) {
        const err = new Error('Body "schedule.interval" must be one of "manual", "daily", "weekly", "monthly".');
        err.code = 'PACKAGE_BACKUP_POLICY_INVALID_SCHEDULE_INTERVAL';
        throw err;
      }
    }

    if (hasTime) {
      const candidate = String(payload.schedule.timeOfDay || '').trim();
      if (candidate && !SCHEDULE_TIME_RE.test(candidate)) {
        const err = new Error('Body "schedule.timeOfDay" must be "HH:mm".');
        err.code = 'PACKAGE_BACKUP_POLICY_INVALID_SCHEDULE_TIME';
        throw err;
      }
    }

    if (!hasInterval && !hasEnabled && !hasTime && !Object.prototype.hasOwnProperty.call(payload.schedule, 'timezone')) {
      const err = new Error('Body "schedule" must define at least one supported field.');
      err.code = 'PACKAGE_BACKUP_POLICY_INVALID_SCHEDULE';
      throw err;
    }

    next.schedule = normalizeBackupSchedule(payload.schedule, current.schedule);
  }

  return next;
}

function normalizeBackupJobItem(item = {}) {
  const status = String(item.status || 'queued').trim().toLowerCase();
  const allowed = new Set(['queued', 'running', 'completed', 'failed', 'canceled']);
  const normalizedStatus = allowed.has(status) ? status : 'queued';
  const error =
    item.error && typeof item.error === 'object'
      ? {
        code: String(item.error.code || '').trim(),
        message: String(item.error.message || '').trim()
      }
      : null;

  return {
    id: String(item.id || '').trim(),
    status: normalizedStatus,
    note: String(item.note || '').trim(),
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : nowIso(),
    startedAt: typeof item.startedAt === 'string' ? item.startedAt : null,
    finishedAt: typeof item.finishedAt === 'string' ? item.finishedAt : null,
    backupId: item.backupId ? String(item.backupId).trim() : null,
    error: error && error.code && error.message ? error : null
  };
}

function createLifecycleError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function createBackupJobId() {
  return `backupjob-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeLifecycleEntry(item = {}) {
  const backupPolicy = normalizeBackupPolicy(item.backupPolicy);
  const history = Array.isArray(item.history)
    ? item.history.map((entry) => normalizeHistoryItem(entry)).slice(-MAX_HISTORY)
    : [];
  const backups = Array.isArray(item.backups)
    ? item.backups
      .map((entry) => normalizeBackupItem(entry))
      .filter((entry) => entry.id && entry.fileName)
      .slice(-backupPolicy.maxBackups)
    : [];
  const backupJobs = Array.isArray(item.backupJobs)
    ? item.backupJobs
      .map((entry) => normalizeBackupJobItem(entry))
      .filter((entry) => entry.id)
      .slice(-MAX_BACKUP_JOBS)
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
    backupPolicy,
    backupJobs,
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

async function updateLifecycleSnapshot(updater) {
  const operation = async () => {
    const snapshot = await readAll();
    const result = updater(snapshot);
    await writeAll(snapshot);
    return result;
  };

  const task = lifecycleMutationQueue.then(operation, operation);
  lifecycleMutationQueue = task.catch(() => {});
  return task;
}

async function updateAppLifecycle(appId, updater) {
  const safeAppId = appPaths.assertSafeAppId(appId);
  return updateLifecycleSnapshot((snapshot) => {
    const current = normalizeLifecycleEntry(snapshot.apps[safeAppId] || {});
    const next = updater(current) || current;
    const normalized = normalizeLifecycleEntry(next);
    normalized.updatedAt = nowIso();
    snapshot.apps[safeAppId] = normalized;
    return normalized;
  });
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
  const left = parseSemVer(a);
  const right = parseSemVer(b);
  if (!left || !right) {
    const parse = (version) => String(version || '')
      .split('.')
      .map((part) => Number(part.replace(/[^0-9].*$/, '')) || 0)
      .slice(0, 3);
    const leftParts = parse(a);
    const rightParts = parse(b);
    for (let index = 0; index < 3; index += 1) {
      const diff = (leftParts[index] || 0) - (rightParts[index] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  }
  return compareSemVer(left, right);
}

function stripVersionPrefix(value = '') {
  return String(value || '').trim().replace(/^v/i, '');
}

function parseSemVer(value) {
  const raw = stripVersionPrefix(value);
  const match = raw.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  const major = Number(match[1] || 0);
  const minor = Number(match[2] || 0);
  const patch = Number(match[3] || 0);
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) {
    return null;
  }

  const prereleaseRaw = String(match[4] || '').trim();
  const prerelease = prereleaseRaw
    ? prereleaseRaw.split('.').filter(Boolean).map((segment) => (
      /^\d+$/.test(segment)
        ? { type: 'number', value: Number(segment) }
        : { type: 'string', value: segment }
    ))
    : [];

  const segmentCount = raw.split('-')[0].split('.').length;

  return {
    major,
    minor,
    patch,
    prerelease,
    segmentCount
  };
}

function compareSemVer(left, right) {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;

  const leftPre = left.prerelease || [];
  const rightPre = right.prerelease || [];
  if (leftPre.length === 0 && rightPre.length === 0) return 0;
  if (leftPre.length === 0) return 1;
  if (rightPre.length === 0) return -1;

  const maxLen = Math.max(leftPre.length, rightPre.length);
  for (let index = 0; index < maxLen; index += 1) {
    const a = leftPre[index];
    const b = rightPre[index];
    if (!a && b) return -1;
    if (a && !b) return 1;
    if (!a && !b) return 0;
    if (a.type === b.type) {
      if (a.value < b.value) return -1;
      if (a.value > b.value) return 1;
      continue;
    }
    if (a.type === 'number') return -1;
    return 1;
  }

  return 0;
}

function hasPreReleaseMention(rangeValue = '') {
  return /-[0-9A-Za-z]/.test(String(rangeValue || ''));
}

function matchesComparator(version, comparator, target) {
  const cmp = compareSemVer(version, target);
  if (comparator === '>') return cmp > 0;
  if (comparator === '>=') return cmp >= 0;
  if (comparator === '<') return cmp < 0;
  if (comparator === '<=') return cmp <= 0;
  return cmp === 0;
}

function incrementForCaret(base) {
  if (base.major > 0) {
    return { major: base.major + 1, minor: 0, patch: 0, prerelease: [], segmentCount: 3 };
  }
  if (base.minor > 0) {
    return { major: 0, minor: base.minor + 1, patch: 0, prerelease: [], segmentCount: 3 };
  }
  return { major: 0, minor: 0, patch: base.patch + 1, prerelease: [], segmentCount: 3 };
}

function incrementForTilde(base) {
  if (base.segmentCount <= 1) {
    return { major: base.major + 1, minor: 0, patch: 0, prerelease: [], segmentCount: 3 };
  }
  return { major: base.major, minor: base.minor + 1, patch: 0, prerelease: [], segmentCount: 3 };
}

function parseRangeToken(token) {
  const trimmed = String(token || '').trim();
  if (!trimmed) return [];
  if (trimmed === '*' || trimmed.toLowerCase() === 'x') return [{ kind: 'any' }];

  const opMatch = trimmed.match(/^(<=|>=|<|>|=)?\s*(.+)$/);
  if (!opMatch) return [{ kind: 'invalid' }];

  const operator = opMatch[1] || '';
  const versionText = stripVersionPrefix(opMatch[2]);
  if (!versionText) return [{ kind: 'invalid' }];

  if (versionText.startsWith('^')) {
    const base = parseSemVer(versionText.slice(1));
    if (!base) return [{ kind: 'invalid' }];
    return [
      { kind: 'cmp', op: '>=', version: base },
      { kind: 'cmp', op: '<', version: incrementForCaret(base) }
    ];
  }

  if (versionText.startsWith('~')) {
    const base = parseSemVer(versionText.slice(1));
    if (!base) return [{ kind: 'invalid' }];
    return [
      { kind: 'cmp', op: '>=', version: base },
      { kind: 'cmp', op: '<', version: incrementForTilde(base) }
    ];
  }

  if (operator) {
    const parsed = parseSemVer(versionText);
    if (!parsed) return [{ kind: 'invalid' }];
    return [{ kind: 'cmp', op: operator || '=', version: parsed }];
  }

  const exact = parseSemVer(versionText);
  if (!exact) return [{ kind: 'invalid' }];
  if (exact.segmentCount >= 3 || exact.prerelease.length > 0) {
    return [{ kind: 'cmp', op: '=', version: exact }];
  }
  if (exact.segmentCount === 1) {
    return [
      { kind: 'cmp', op: '>=', version: { ...exact, minor: 0, patch: 0, prerelease: [], segmentCount: 3 } },
      { kind: 'cmp', op: '<', version: { major: exact.major + 1, minor: 0, patch: 0, prerelease: [], segmentCount: 3 } }
    ];
  }
  return [
    { kind: 'cmp', op: '>=', version: { ...exact, patch: 0, prerelease: [], segmentCount: 3 } },
    { kind: 'cmp', op: '<', version: { major: exact.major, minor: exact.minor + 1, patch: 0, prerelease: [], segmentCount: 3 } }
  ];
}

function matchesVersionRange(version, range) {
  const parsedVersion = parseSemVer(version);
  if (!parsedVersion) return false;

  const normalizedRange = String(range || '*').trim();
  if (!normalizedRange || normalizedRange === '*' || normalizedRange.toLowerCase() === 'x') {
    return true;
  }

  if (parsedVersion.prerelease.length > 0 && !hasPreReleaseMention(normalizedRange)) {
    return false;
  }

  const groups = normalizedRange.split('||').map((item) => item.trim()).filter(Boolean);
  if (groups.length === 0) return true;

  for (const group of groups) {
    const tokens = group
      .replace(/,/g, ' ')
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean);

    if (tokens.length === 0) return true;

    let groupOk = true;
    for (const token of tokens) {
      const comparators = parseRangeToken(token);
      if (comparators.length === 0) continue;

      for (const comparator of comparators) {
        if (comparator.kind === 'any') continue;
        if (comparator.kind === 'invalid') {
          groupOk = false;
          break;
        }
        if (!matchesComparator(parsedVersion, comparator.op, comparator.version)) {
          groupOk = false;
          break;
        }
      }

      if (!groupOk) break;
    }

    if (groupOk) return true;
  }

  return false;
}

const packageLifecycleService = {
  CHANNELS: Array.from(CHANNELS),

  normalizeDependencies,
  normalizeCompatibility,
  compareVersions,
  matchesVersionRange,

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

  async getBackupPolicy(appId) {
    const safeAppId = appPaths.assertSafeAppId(appId);
    const lifecycle = await this.getLifecycle(safeAppId);
    return {
      appId: safeAppId,
      backupPolicy: normalizeBackupPolicy(lifecycle.backupPolicy)
    };
  },

  async deleteLifecycle(appId) {
    const safeAppId = appPaths.assertSafeAppId(appId);
    await updateLifecycleSnapshot((snapshot) => {
      if (snapshot.apps && typeof snapshot.apps === 'object') {
        delete snapshot.apps[safeAppId];
      }
    });
    return {
      appId: safeAppId,
      removed: true
    };
  },

  async setBackupPolicy(appId, policy = {}) {
    const safeAppId = appPaths.assertSafeAppId(appId);
    const current = await this.getLifecycle(safeAppId);
    const nextPolicy = parseBackupPolicyPatch(policy, current.backupPolicy);
    return updateAppLifecycle(safeAppId, (current) => {
      const merged = Array.isArray(current.backups) ? current.backups : [];
      const limited = merged.slice(-nextPolicy.maxBackups);
      return {
        ...current,
        backupPolicy: nextPolicy,
        backups: limited
      };
    });
  },

  async listBackupJobs(appId, options = {}) {
    const safeAppId = appPaths.assertSafeAppId(appId);
    const lifecycle = await this.getLifecycle(safeAppId);
    const limit = Number.isFinite(Number(options.limit))
      ? Math.max(1, Math.min(100, Number(options.limit)))
      : 50;
    const items = [...(Array.isArray(lifecycle.backupJobs) ? lifecycle.backupJobs : [])]
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .slice(0, limit);
    return {
      appId: safeAppId,
      jobs: items
    };
  },

  async createBackupJob(appId, options = {}) {
    const safeAppId = appPaths.assertSafeAppId(appId);
    const appRoot = await appPaths.getAppRoot(safeAppId);
    if (!(await fs.pathExists(appRoot))) {
      throw createLifecycleError('PACKAGE_NOT_FOUND', 'Package not found.');
    }

    const job = normalizeBackupJobItem({
      id: createBackupJobId(),
      status: 'queued',
      note: String(options.note || '').trim(),
      createdAt: nowIso(),
      startedAt: null,
      finishedAt: null
    });

    await updateAppLifecycle(safeAppId, (current) => ({
      ...current,
      backupJobs: [...current.backupJobs, job].slice(-MAX_BACKUP_JOBS)
    }));

    setTimeout(() => {
      this.processBackupJobs(safeAppId).catch(() => {});
    }, 0);

    return {
      appId: safeAppId,
      job
    };
  },

  async cancelBackupJob(appId, jobId) {
    const safeAppId = appPaths.assertSafeAppId(appId);
    const safeJobId = String(jobId || '').trim();
    if (!safeJobId) {
      throw createLifecycleError('PACKAGE_BACKUP_JOB_ID_REQUIRED', 'Backup job id is required.');
    }

    let canceled = null;
    await updateAppLifecycle(safeAppId, (current) => {
      const jobs = Array.isArray(current.backupJobs) ? [...current.backupJobs] : [];
      const index = jobs.findIndex((item) => item.id === safeJobId);
      if (index < 0) {
        throw createLifecycleError('PACKAGE_BACKUP_JOB_NOT_FOUND', 'Backup job not found.');
      }

      const target = normalizeBackupJobItem(jobs[index]);
      if (target.status !== 'queued') {
        throw createLifecycleError(
          'PACKAGE_BACKUP_JOB_NOT_CANCELABLE',
          `Backup job cannot be canceled in "${target.status}" status.`
        );
      }

      canceled = normalizeBackupJobItem({
        ...target,
        status: 'canceled',
        finishedAt: nowIso(),
        error: {
          code: 'PACKAGE_BACKUP_JOB_CANCELED',
          message: 'Backup job was canceled before execution.'
        }
      });
      jobs[index] = canceled;
      return {
        ...current,
        backupJobs: jobs
      };
    });

    return {
      appId: safeAppId,
      job: canceled
    };
  },

  async processBackupJobs(appId) {
    const safeAppId = appPaths.assertSafeAppId(appId);
    if (runningBackupJobs.has(safeAppId)) {
      return;
    }

    const { jobs } = await this.listBackupJobs(safeAppId, { limit: MAX_BACKUP_JOBS });
    const queued = [...jobs]
      .filter((item) => item.status === 'queued')
      .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())[0];
    if (!queued) {
      return;
    }

    runningBackupJobs.add(safeAppId);
    const queuedId = queued.id;
    try {
      await updateAppLifecycle(safeAppId, (current) => {
        const nextJobs = (Array.isArray(current.backupJobs) ? current.backupJobs : []).map((item) => (
          item.id === queuedId && item.status === 'queued'
            ? normalizeBackupJobItem({
              ...item,
              status: 'running',
              startedAt: nowIso(),
              finishedAt: null,
              error: null
            })
            : item
        ));
        return {
          ...current,
          backupJobs: nextJobs
        };
      });

      const latestJobs = await this.listBackupJobs(safeAppId, { limit: MAX_BACKUP_JOBS });
      const latestJob = latestJobs.jobs.find((item) => item.id === queuedId);
      if (!latestJob || latestJob.status !== 'running') {
        return;
      }

      const backup = await this.createBackup(safeAppId, {
        note: queued.note || `Backup job ${queuedId}`
      });

      await updateAppLifecycle(safeAppId, (current) => {
        const nextJobs = (Array.isArray(current.backupJobs) ? current.backupJobs : []).map((item) => (
          item.id === queuedId
            ? normalizeBackupJobItem({
              ...item,
              status: 'completed',
              finishedAt: nowIso(),
              backupId: backup.id,
              error: null
            })
            : item
        ));
        return {
          ...current,
          backupJobs: nextJobs
        };
      });
    } catch (err) {
      await updateAppLifecycle(safeAppId, (current) => {
        const nextJobs = (Array.isArray(current.backupJobs) ? current.backupJobs : []).map((item) => (
          item.id === queuedId
            ? normalizeBackupJobItem({
              ...item,
              status: 'failed',
              finishedAt: nowIso(),
              error: {
                code: String(err?.code || 'PACKAGE_BACKUP_JOB_FAILED'),
                message: String(err?.message || 'Backup job failed.')
              }
            })
            : item
        ));
        return {
          ...current,
          backupJobs: nextJobs
        };
      }).catch(() => {});
    } finally {
      runningBackupJobs.delete(safeAppId);
      setTimeout(() => {
        this.processBackupJobs(safeAppId).catch(() => {});
      }, 0);
    }
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

    let removedBackups = [];
    await updateAppLifecycle(safeAppId, (current) => ({
      ...current,
      backupPolicy: normalizeBackupPolicy(current.backupPolicy),
      backups: (() => {
        const merged = [...current.backups, backupEntry];
        const keepCount = normalizeBackupPolicy(current.backupPolicy).maxBackups;
        const kept = merged.slice(-keepCount);
        removedBackups = merged.slice(0, Math.max(0, merged.length - kept.length));
        return kept;
      })()
    }));

    for (const stale of removedBackups) {
      const stalePath = path.join(appBackupsDir, stale.fileName || '');
      await fs.remove(stalePath).catch(() => {});
    }

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
