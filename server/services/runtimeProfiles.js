const RUNTIME_TYPE_MAP = {
  sandbox: 'sandbox-html',
  'sandbox-html': 'sandbox-html',
  'process-node': 'process-node',
  'process-python': 'process-python',
  binary: 'binary'
};

const APP_TYPES = new Set(['app', 'widget', 'service', 'hybrid', 'developer']);
const RESTART_POLICIES = new Set(['never', 'on-failure', 'always']);
const HEALTHCHECK_TYPES = new Set(['none', 'process', 'http']);
const MAX_HEALTHCHECK_PATH_LENGTH = 2048;

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

function assertValidServicePath(value, fieldName) {
  const servicePath = String(value || '').trim();
  if (!servicePath) {
    const err = new Error(`${fieldName} is required when healthcheck.type is "http".`);
    err.code = 'RUNTIME_PROFILE_INVALID';
    throw err;
  }
  if (servicePath.length > MAX_HEALTHCHECK_PATH_LENGTH) {
    const err = new Error(`${fieldName} is too long.`);
    err.code = 'RUNTIME_PROFILE_INVALID';
    throw err;
  }
  if (!servicePath.startsWith('/')) {
    const err = new Error(`${fieldName} must start with "/".`);
    err.code = 'RUNTIME_PROFILE_INVALID';
    throw err;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(servicePath) || servicePath.startsWith('//') || servicePath.includes('\\')) {
    const err = new Error(`${fieldName} must be relative to the package service.`);
    err.code = 'RUNTIME_PROFILE_INVALID';
    throw err;
  }
  if (/[\u0000-\u001f\u007f]/.test(servicePath)) {
    const err = new Error(`${fieldName} cannot contain control characters.`);
    err.code = 'RUNTIME_PROFILE_INVALID';
    throw err;
  }
  const pathname = servicePath.split(/[?#]/)[0];
  let decodedPathname = pathname;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch (_err) {
    const err = new Error(`${fieldName} contains invalid encoding.`);
    err.code = 'RUNTIME_PROFILE_INVALID';
    throw err;
  }
  if (decodedPathname.split('/').some((segment) => segment === '..')) {
    const err = new Error(`${fieldName} cannot contain parent traversal.`);
    err.code = 'RUNTIME_PROFILE_INVALID';
    throw err;
  }
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
  const uiRaw = manifest.ui && typeof manifest.ui === 'object'
    ? manifest.ui
    : {};
  const runtimeType = normalizeRuntimeType(
    typeof manifest.runtime === 'string' ? manifest.runtime : (runtimeRaw.type || runtimeRaw.runtimeType)
  );
  const appType = normalizeAppType(manifest.type || manifest.appType, runtimeType);
  const uiRuntimeType = normalizeRuntimeType(uiRaw.type || 'sandbox-html');

  const manifestEntry = manifest.entry;
  const entryFromRuntime = runtimeRaw.entry;
  const entryFromManifestString = typeof manifestEntry === 'string' ? manifestEntry : '';
  const entryFromManifestApp = manifestEntry && typeof manifestEntry === 'object' ? manifestEntry.app : '';
  const entryFromManifestService = manifestEntry && typeof manifestEntry === 'object' ? manifestEntry.service : '';
  const defaultEntry = runtimeType === 'sandbox-html'
    ? (entryFromManifestApp || entryFromManifestString || '')
    : (entryFromManifestService || entryFromManifestString || entryFromManifestApp || '');
  const entry = toPosixRelativePath(entryFromRuntime || defaultEntry || '');
  const uiEntry = toPosixRelativePath(
    uiRaw.entry ||
    entryFromManifestApp ||
    (appType === 'hybrid' ? '' : (runtimeType === 'sandbox-html' ? entry : ''))
  );
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
    restartDelayMs: Number.isFinite(Number(serviceRaw.restartDelayMs)) ? Number(serviceRaw.restartDelayMs) : 1000,
    http: {
      enabled: Boolean(serviceRaw.http?.enabled)
    }
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
    ui: {
      runtimeType: uiRuntimeType,
      entry: uiEntry
    },
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
  const runtimeObjectType = runtimeInput && typeof runtimeInput === 'object'
    ? (runtimeInput.type || runtimeInput.runtimeType)
    : '';
  if (runtimeObjectType && !hasRuntimeType(runtimeObjectType)) {
    const err = new Error(`Unsupported runtime type: ${runtimeObjectType}`);
    err.code = 'RUNTIME_PROFILE_INVALID';
    throw err;
  }

  if (!APP_TYPES.has(profile.appType)) {
    const err = new Error(`Unsupported app type: ${profile.appType}`);
    err.code = 'RUNTIME_PROFILE_INVALID';
    throw err;
  }

  if (profile.appType !== 'service' && !profile.entry) {
    if (profile.appType === 'hybrid' && profile.ui?.entry) {
      // Hybrid packages launch their UI from ui.entry and run their service from runtime.entry.
    } else {
      const err = new Error('Runtime entry is required.');
      err.code = 'RUNTIME_PROFILE_INVALID';
      throw err;
    }
  }

  if (profile.appType === 'hybrid') {
    if (profile.ui?.runtimeType !== 'sandbox-html') {
      const err = new Error('Hybrid package UI must use sandbox-html.');
      err.code = 'RUNTIME_PROFILE_INVALID';
      throw err;
    }
    if (!profile.ui?.entry) {
      const err = new Error('Hybrid package ui.entry is required.');
      err.code = 'RUNTIME_PROFILE_INVALID';
      throw err;
    }
    if (!isManagedRuntime(profile)) {
      const err = new Error('Hybrid package runtime must be process-node, process-python, or binary.');
      err.code = 'RUNTIME_PROFILE_INVALID';
      throw err;
    }
  } else if (profile.appType !== 'service' && !profile.entry) {
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
  if ((profile.healthcheck?.type || 'none') === 'http') {
    assertValidServicePath(profile.healthcheck?.path, 'healthcheck.path');
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
    ...(profile.appType === 'hybrid'
      ? {
          ui: {
            type: profile.ui?.runtimeType || 'sandbox-html',
            entry: profile.ui?.entry || ''
          }
        }
      : {}),
    service: {
      autoStart: Boolean(profile.service?.autoStart),
      restartPolicy: profile.service?.restartPolicy || 'never',
      maxRetries: Number.isFinite(Number(profile.service?.maxRetries)) ? Number(profile.service.maxRetries) : 3,
      restartDelayMs: Number.isFinite(Number(profile.service?.restartDelayMs)) ? Number(profile.service.restartDelayMs) : 1000,
      ...(profile.service?.http?.enabled ? { http: { enabled: true } } : {})
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
    ui: profile.ui ? { ...profile.ui } : { runtimeType: 'sandbox-html', entry: '' },
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
