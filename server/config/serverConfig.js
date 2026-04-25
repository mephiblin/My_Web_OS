const fs = require('fs').promises;
const path = require('path');
const dotenv = require('dotenv');
const { detectPreferredPlaces } = require('../services/userDirs');

const DEFAULTS_PATH = path.join(__dirname, 'defaults.json');
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SERVER_ROOT = path.join(PROJECT_ROOT, 'server');
const ENV_PATH = path.join(PROJECT_ROOT, '.env');

const SENSITIVE_KEYS = new Set(['JWT_SECRET', 'ADMIN_PASSWORD']);
const REQUIRED_KEYS = ['JWT_SECRET'];
const UI_SETTINGS_KEYS = [
  'PORT',
  'NODE_ENV',
  'JWT_SECRET',
  'ALLOWED_ROOTS',
  'INITIAL_PATH',
  'INDEX_DEPTH',
  'ADMIN_USERNAME',
  'ADMIN_PASSWORD',
  'CORS_ORIGIN',
  'RATE_LIMIT_WINDOW_MS',
  'RATE_LIMIT_MAX',
  'TRUST_PROXY_HOPS'
];

let cachedDefaults = null;
let cachedEnv = null;
let cachedResolved = null;

function parseAllowedRoots(value, fallback = []) {
  if (Array.isArray(value)) return value.map(String).map(v => v.trim()).filter(Boolean);
  if (typeof value !== 'string' || value.trim() === '') return fallback;

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map(String).map(v => v.trim()).filter(Boolean);
    }
  } catch (_err) {
    // Fall back to comma-separated list parsing.
  }

  return value
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

function parseCorsOrigin(value, fallback = '*') {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return fallback;
  if (value.trim() === '*') return '*';

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map(String).map(v => v.trim()).filter(Boolean);
    }
  } catch (_err) {
    // Fall back to comma-separated list parsing.
  }

  const list = value
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);

  return list.length <= 1 ? (list[0] || fallback) : list;
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeComparablePath(value) {
  return path.resolve(String(value || '')).replace(/[\\/]+/g, path.sep).toLowerCase();
}

function getByPath(obj, keyPath) {
  return keyPath.split('.').reduce((acc, key) => (acc ? acc[key] : undefined), obj);
}

function firstDefined() {
  for (let i = 0; i < arguments.length; i += 1) {
    const value = arguments[i];
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

function maskIfSensitive(key, value) {
  if (SENSITIVE_KEYS.has(key)) {
    return value ? '********' : '';
  }
  return value !== undefined && value !== null ? value : '';
}

function toEnvValue(key, value) {
  if (value === undefined || value === null) return '';
  if (key === 'ALLOWED_ROOTS' && Array.isArray(value)) {
    return JSON.stringify(value);
  }
  return String(value);
}

async function readDefaults() {
  if (cachedDefaults) return cachedDefaults;
  const content = await fs.readFile(DEFAULTS_PATH, 'utf8');
  cachedDefaults = JSON.parse(content);
  return cachedDefaults;
}

async function readEnvFile() {
  try {
    const content = await fs.readFile(ENV_PATH, 'utf8');
    return dotenv.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

async function writeEnvFile(envObj) {
  const lines = Object.entries(envObj).map(([key, value]) => `${key}=${value}`);
  await fs.writeFile(ENV_PATH, `${lines.join('\n')}\n`, 'utf8');
}

function buildResolved(envObj, defaults) {
  const fallbackPlaces = detectPreferredPlaces();
  let allowedRoots = parseAllowedRoots(
    envObj.ALLOWED_ROOTS,
    (defaults.paths.allowedRoots && defaults.paths.allowedRoots.length > 0)
      ? defaults.paths.allowedRoots
      : fallbackPlaces.allowedRoots
  );
  const projectRootComparable = normalizeComparablePath(PROJECT_ROOT);
  const legacyWorkspaceLock =
    Array.isArray(allowedRoots) &&
    allowedRoots.length === 1 &&
    normalizeComparablePath(allowedRoots[0]) === projectRootComparable &&
    Array.isArray(fallbackPlaces.allowedRoots) &&
    fallbackPlaces.allowedRoots.length > 0;
  if (legacyWorkspaceLock) {
    allowedRoots = fallbackPlaces.allowedRoots;
  }
  const homePath = fallbackPlaces.homePath ? path.resolve(fallbackPlaces.homePath) : '';
  const hasHomeRoot = homePath
    ? allowedRoots.some((root) => normalizeComparablePath(root) === normalizeComparablePath(homePath))
    : false;
  const shouldAutoIncludeHome =
    Boolean(homePath) &&
    !hasHomeRoot &&
    allowedRoots.length > 0 &&
    allowedRoots.every((root) => {
      const normalizedRoot = normalizeComparablePath(root);
      const normalizedHome = normalizeComparablePath(homePath);
      return normalizedRoot === normalizedHome || normalizedRoot.startsWith(`${normalizedHome}${path.sep}`);
    });
  if (shouldAutoIncludeHome) {
    allowedRoots = [...allowedRoots, homePath];
  }
  const corsOrigin = parseCorsOrigin(envObj.CORS_ORIGIN, defaults.server.corsOrigin || '*');
  const envInitialPath = typeof envObj.INITIAL_PATH === 'string' && envObj.INITIAL_PATH.trim()
    ? envObj.INITIAL_PATH
    : '';
  const initialPathRaw = envInitialPath
    ? (legacyWorkspaceLock ? fallbackPlaces.initialPath : envInitialPath)
    : (defaults.paths.initialPath && String(defaults.paths.initialPath).trim() && defaults.paths.initialPath !== '/'
      ? defaults.paths.initialPath
      : fallbackPlaces.initialPath);

  return {
    server: {
      port: parseNumber(envObj.PORT, defaults.server.port),
      nodeEnv: envObj.NODE_ENV || defaults.server.nodeEnv,
      corsOrigin,
      rateLimitWindowMs: parseNumber(envObj.RATE_LIMIT_WINDOW_MS, defaults.server.rateLimitWindowMs),
      rateLimitMax: parseNumber(envObj.RATE_LIMIT_MAX, defaults.server.rateLimitMax),
      trustProxyHops: Math.max(0, parseNumber(envObj.TRUST_PROXY_HOPS, defaults.server.trustProxyHops || 0))
    },
    auth: {
      adminUsername: envObj.ADMIN_USERNAME || defaults.auth.adminUsername,
      jwtSecret: envObj.JWT_SECRET || '',
      adminPassword: envObj.ADMIN_PASSWORD || ''
    },
    paths: {
      projectRoot: PROJECT_ROOT,
      serverRoot: SERVER_ROOT,
      configRoot: path.join(PROJECT_ROOT, 'config'),
      serverConfigRoot: path.join(SERVER_ROOT, 'config'),
      dataRoot: path.join(PROJECT_ROOT, 'data'),
      storageRoot: path.join(PROJECT_ROOT, 'storage'),
      serverStorageRoot: path.join(SERVER_ROOT, 'storage'),
      inventoryRoot: path.join(SERVER_ROOT, 'storage', 'inventory'),
      initialPath: initialPathRaw,
      allowedRoots,
      indexDepth: parseNumber(envObj.INDEX_DEPTH, defaults.paths.indexDepth)
    }
  };
}

function toUISettings(rawEnv, resolved) {
  const values = {
    PORT: firstDefined(rawEnv.PORT, String(resolved.server.port)),
    NODE_ENV: firstDefined(rawEnv.NODE_ENV, resolved.server.nodeEnv),
    JWT_SECRET: firstDefined(rawEnv.JWT_SECRET, ''),
    ALLOWED_ROOTS: firstDefined(rawEnv.ALLOWED_ROOTS, JSON.stringify(resolved.paths.allowedRoots)),
    INITIAL_PATH: firstDefined(rawEnv.INITIAL_PATH, resolved.paths.initialPath),
    INDEX_DEPTH: firstDefined(rawEnv.INDEX_DEPTH, String(resolved.paths.indexDepth)),
    ADMIN_USERNAME: firstDefined(rawEnv.ADMIN_USERNAME, resolved.auth.adminUsername),
    ADMIN_PASSWORD: firstDefined(rawEnv.ADMIN_PASSWORD, ''),
    CORS_ORIGIN:
      firstDefined(
        rawEnv.CORS_ORIGIN,
      (Array.isArray(resolved.server.corsOrigin)
        ? resolved.server.corsOrigin.join(',')
        : String(resolved.server.corsOrigin))
      ),
    RATE_LIMIT_WINDOW_MS: firstDefined(rawEnv.RATE_LIMIT_WINDOW_MS, String(resolved.server.rateLimitWindowMs)),
    RATE_LIMIT_MAX: firstDefined(rawEnv.RATE_LIMIT_MAX, String(resolved.server.rateLimitMax)),
    TRUST_PROXY_HOPS: firstDefined(rawEnv.TRUST_PROXY_HOPS, String(resolved.server.trustProxyHops))
  };

  return UI_SETTINGS_KEYS.reduce((acc, key) => {
    acc[key] = maskIfSensitive(key, values[key]);
    return acc;
  }, {});
}

async function loadAll() {
  const [defaults, envFromFile] = await Promise.all([readDefaults(), readEnvFile()]);
  // Runtime environment (e.g. Docker Compose env) should override .env file values.
  const mergedEnv = { ...envFromFile, ...process.env };
  const resolved = buildResolved(mergedEnv, defaults);

  // Keep legacy modules that still read process.env working during migration.
  Object.assign(process.env, mergedEnv);

  cachedEnv = mergedEnv;
  cachedResolved = resolved;

  return { defaults, env: mergedEnv, resolved };
}

const serverConfig = {
  async reload() {
    return loadAll();
  },

  async getAll() {
    if (!cachedResolved || !cachedEnv || !cachedDefaults) {
      await loadAll();
    }
    return {
      env: { ...cachedEnv },
      defaults: cachedDefaults,
      server: cachedResolved.server,
      auth: cachedResolved.auth,
      paths: cachedResolved.paths
    };
  },

  async get(keyPath) {
    const full = await this.getAll();
    return getByPath(full, keyPath);
  },

  async getPaths() {
    const full = await this.getAll();
    return full.paths;
  },

  async getPublicSettings() {
    const full = await this.getAll();
    return toUISettings(full.env, full);
  },

  getSensitiveKeys() {
    return Array.from(SENSITIVE_KEYS);
  },

  async validate(options = {}) {
    const { strict = false } = options;
    const full = await this.getAll();
    const missing = REQUIRED_KEYS.filter((key) => {
      const value = full.env[key];
      return value === undefined || value === null || String(value).trim() === '';
    });

    if (missing.length > 0 && strict) {
      const err = new Error(`Missing required configuration keys: ${missing.join(', ')}`);
      err.code = 'CONFIG_VALIDATION_FAILED';
      throw err;
    }

    return { ok: missing.length === 0, missing };
  },

  async update(partial, options = {}) {
    const updates = partial && typeof partial === 'object' ? partial : {};
    const mutableKeys = options.mutableKeys || null;
    const current = await readEnvFile();
    const next = { ...current };
    const updatedKeys = [];
    const skippedSensitiveKeys = [];
    const invalidKeys = [];

    for (const [key, value] of Object.entries(updates)) {
      if (mutableKeys && !mutableKeys.includes(key)) {
        invalidKeys.push(key);
        continue;
      }

      if (SENSITIVE_KEYS.has(key) && (value === '********' || String(value || '').trim() === '')) {
        skippedSensitiveKeys.push(key);
        continue;
      }

      next[key] = toEnvValue(key, value);
      updatedKeys.push(key);
    }

    if (updatedKeys.length > 0) {
      await writeEnvFile(next);
      Object.assign(process.env, next);
    }

    await this.reload();

    return {
      updatedKeys,
      skippedSensitiveKeys,
      invalidKeys
    };
  }
};

module.exports = serverConfig;
