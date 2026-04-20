const RUNTIME_TYPE_MAP = {
  sandbox: 'sandbox-html',
  'sandbox-html': 'sandbox-html',
  'process-node': 'process-node',
  'process-python': 'process-python',
  binary: 'binary'
};

const APP_TYPES = new Set(['app', 'service', 'hybrid']);
const RESTART_POLICIES = new Set(['never', 'on-failure', 'always']);
const HEALTHCHECK_TYPES = new Set(['none', 'process', 'http']);

function toPosixRelativePath(value = '') {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
}

function normalizeRuntimeType(value) {
  const key = String(value || '').trim().toLowerCase();
  if (!key) return 'sandbox-html';
  return RUNTIME_TYPE_MAP[key] || 'sandbox-html';
}

function hasRuntimeType(value) {
  const key = String(value || '').trim().toLowerCase();
  return Boolean(key && RUNTIME_TYPE_MAP[key]);
}

function normalizeAppType(value, runtimeType) {
  const appType = String(value || '').trim().toLowerCase();
  if (APP_TYPES.has(appType)) {
    return appType;
  }
  return runtimeType === 'sandbox-html' ? 'app' : 'service';
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function normalizeRestartPolicy(value, fallback) {
  const policy = String(value || '').trim().toLowerCase();
  if (RESTART_POLICIES.has(policy)) {
    return policy;
  }
  return fallback;
}

function normalizeRuntimeProfile(manifest = {}) {
  const runtimeRaw = manifest.runtime && typeof manifest.runtime === 'object'
    ? manifest.runtime
    : {};
  const runtimeType = normalizeRuntimeType(
    typeof manifest.runtime === 'string' ? manifest.runtime : runtimeRaw.type
  );
  const appType = normalizeAppType(manifest.type, runtimeType);

  const manifestEntry = manifest.entry;
  const entryFromRuntime = runtimeRaw.entry;
  const entryFromManifestString = typeof manifestEntry === 'string' ? manifestEntry : '';
  const entryFromManifestApp = manifestEntry && typeof manifestEntry === 'object' ? manifestEntry.app : '';
  const entryFromManifestService = manifestEntry && typeof manifestEntry === 'object' ? manifestEntry.service : '';
  const defaultEntry = runtimeType === 'sandbox-html'
    ? (entryFromManifestApp || entryFromManifestString || '')
    : (entryFromManifestService || entryFromManifestString || entryFromManifestApp || '');
  const entry = toPosixRelativePath(entryFromRuntime || defaultEntry || '');
  const runtimeCommand = String(runtimeRaw.command || '').trim();
  const runtimeCwd = toPosixRelativePath(runtimeRaw.cwd || '.');
  const args = normalizeStringArray(runtimeRaw.args);

  const serviceRaw = manifest.service && typeof manifest.service === 'object'
    ? manifest.service
    : {};
  const defaultRestartPolicy = runtimeType === 'sandbox-html' ? 'never' : 'on-failure';
  const service = {
    enabled: appType !== 'app' || runtimeType !== 'sandbox-html',
    autoStart: Boolean(serviceRaw.autoStart),
    restartPolicy: normalizeRestartPolicy(serviceRaw.restartPolicy, defaultRestartPolicy),
    maxRetries: Number.isFinite(Number(serviceRaw.maxRetries)) ? Number(serviceRaw.maxRetries) : 3,
    restartDelayMs: Number.isFinite(Number(serviceRaw.restartDelayMs)) ? Number(serviceRaw.restartDelayMs) : 1000
  };

  const healthcheckRaw = manifest.healthcheck && typeof manifest.healthcheck === 'object'
    ? manifest.healthcheck
    : {};
  const healthcheck = {
    type: String(healthcheckRaw.type || (runtimeType === 'sandbox-html' ? 'none' : 'process')).trim() || 'none',
    intervalMs: Number.isFinite(Number(healthcheckRaw.intervalMs)) ? Number(healthcheckRaw.intervalMs) : 10000,
    timeoutMs: Number.isFinite(Number(healthcheckRaw.timeoutMs)) ? Number(healthcheckRaw.timeoutMs) : 2000,
    path: String(healthcheckRaw.path || '').trim()
  };

  const resourcesRaw = manifest.resources && typeof manifest.resources === 'object'
    ? manifest.resources
    : {};
  const resources = {
    memoryMb: Number.isFinite(Number(resourcesRaw.memoryMb)) ? Number(resourcesRaw.memoryMb) : 0,
    cpuPercent: Number.isFinite(Number(resourcesRaw.cpuPercent)) ? Number(resourcesRaw.cpuPercent) : 0
  };

  return {
    runtimeType,
    appType,
    entry,
    command: runtimeCommand,
    cwd: runtimeCwd || '.',
    args,
    service,
    healthcheck,
    resources
  };
}

function assertValidRuntimeProfile(manifest = {}, profile = normalizeRuntimeProfile(manifest)) {
  const runtimeInput = manifest.runtime;
  if (typeof runtimeInput === 'string' && runtimeInput.trim() && !hasRuntimeType(runtimeInput)) {
    const err = new Error(`Unsupported runtime type: ${runtimeInput}`);
    err.code = 'RUNTIME_PROFILE_INVALID';
    throw err;
  }
  if (runtimeInput && typeof runtimeInput === 'object' && runtimeInput.type && !hasRuntimeType(runtimeInput.type)) {
    const err = new Error(`Unsupported runtime type: ${runtimeInput.type}`);
    err.code = 'RUNTIME_PROFILE_INVALID';
    throw err;
  }

  if (!APP_TYPES.has(profile.appType)) {
    const err = new Error(`Unsupported app type: ${profile.appType}`);
    err.code = 'RUNTIME_PROFILE_INVALID';
    throw err;
  }

  if (profile.appType !== 'service' && !profile.entry) {
    const err = new Error('Runtime entry is required.');
    err.code = 'RUNTIME_PROFILE_INVALID';
    throw err;
  }

  if (isManagedRuntime(profile)) {
    if (!profile.entry && !profile.command) {
      const err = new Error('Managed runtime requires entry or command.');
      err.code = 'RUNTIME_PROFILE_INVALID';
      throw err;
    }
  }

  if (!RESTART_POLICIES.has(profile.service?.restartPolicy)) {
    const err = new Error(`Unsupported restart policy: ${profile.service?.restartPolicy}`);
    err.code = 'RUNTIME_PROFILE_INVALID';
    throw err;
  }
  if (!Number.isFinite(Number(profile.service?.maxRetries)) || Number(profile.service.maxRetries) < 0) {
    const err = new Error('service.maxRetries must be a non-negative number.');
    err.code = 'RUNTIME_PROFILE_INVALID';
    throw err;
  }
  if (!Number.isFinite(Number(profile.service?.restartDelayMs)) || Number(profile.service.restartDelayMs) < 0) {
    const err = new Error('service.restartDelayMs must be a non-negative number.');
    err.code = 'RUNTIME_PROFILE_INVALID';
    throw err;
  }

  if (!HEALTHCHECK_TYPES.has(profile.healthcheck?.type || 'none')) {
    const err = new Error(`Unsupported healthcheck type: ${profile.healthcheck?.type}`);
    err.code = 'RUNTIME_PROFILE_INVALID';
    throw err;
  }
  if ((profile.healthcheck?.type || 'none') === 'http' && !String(profile.healthcheck?.path || '').trim()) {
    const err = new Error('healthcheck.path is required when healthcheck.type is "http".');
    err.code = 'RUNTIME_PROFILE_INVALID';
    throw err;
  }
  if (!Number.isFinite(Number(profile.healthcheck?.intervalMs)) || Number(profile.healthcheck.intervalMs) <= 0) {
    const err = new Error('healthcheck.intervalMs must be greater than 0.');
    err.code = 'RUNTIME_PROFILE_INVALID';
    throw err;
  }
  if (!Number.isFinite(Number(profile.healthcheck?.timeoutMs)) || Number(profile.healthcheck.timeoutMs) <= 0) {
    const err = new Error('healthcheck.timeoutMs must be greater than 0.');
    err.code = 'RUNTIME_PROFILE_INVALID';
    throw err;
  }

  return profile;
}

function toManifestRuntimeFields(profile) {
  const runtime = {
    type: profile.runtimeType
  };

  if (profile.entry) runtime.entry = profile.entry;
  if (profile.command) runtime.command = profile.command;
  if (profile.cwd && profile.cwd !== '.') runtime.cwd = profile.cwd;
  if (Array.isArray(profile.args) && profile.args.length > 0) {
    runtime.args = profile.args;
  }

  return {
    type: profile.appType,
    runtime,
    service: {
      autoStart: Boolean(profile.service?.autoStart),
      restartPolicy: profile.service?.restartPolicy || 'never',
      maxRetries: Number.isFinite(Number(profile.service?.maxRetries)) ? Number(profile.service.maxRetries) : 3,
      restartDelayMs: Number.isFinite(Number(profile.service?.restartDelayMs)) ? Number(profile.service.restartDelayMs) : 1000
    },
    healthcheck: {
      type: profile.healthcheck?.type || 'none',
      intervalMs: Number.isFinite(Number(profile.healthcheck?.intervalMs)) ? Number(profile.healthcheck.intervalMs) : 10000,
      timeoutMs: Number.isFinite(Number(profile.healthcheck?.timeoutMs)) ? Number(profile.healthcheck.timeoutMs) : 2000,
      path: String(profile.healthcheck?.path || '').trim()
    },
    resources: {
      memoryMb: Number.isFinite(Number(profile.resources?.memoryMb)) ? Number(profile.resources.memoryMb) : 0,
      cpuPercent: Number.isFinite(Number(profile.resources?.cpuPercent)) ? Number(profile.resources.cpuPercent) : 0
    }
  };
}

function getRuntimeCommand(profile) {
  if (profile.runtimeType === 'process-node') return profile.command || 'node';
  if (profile.runtimeType === 'process-python') return profile.command || 'python3';
  if (profile.runtimeType === 'binary') return profile.command || profile.entry || '';
  return '';
}

function isManagedRuntime(profileOrType) {
  const runtimeType = typeof profileOrType === 'string'
    ? normalizeRuntimeType(profileOrType)
    : normalizeRuntimeType(profileOrType?.runtimeType);
  return runtimeType === 'process-node' || runtimeType === 'process-python' || runtimeType === 'binary';
}

function sanitizeProfileForClient(profile) {
  return {
    runtimeType: profile.runtimeType,
    appType: profile.appType,
    entry: profile.entry,
    command: profile.command,
    cwd: profile.cwd,
    args: Array.isArray(profile.args) ? [...profile.args] : [],
    service: { ...profile.service },
    healthcheck: { ...profile.healthcheck },
    resources: { ...profile.resources }
  };
}

module.exports = {
  normalizeRuntimeType,
  normalizeRuntimeProfile,
  assertValidRuntimeProfile,
  toManifestRuntimeFields,
  getRuntimeCommand,
  isManagedRuntime,
  sanitizeProfileForClient,
  toPosixRelativePath
};
