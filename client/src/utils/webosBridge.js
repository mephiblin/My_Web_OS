import { apiFetch } from './api.js';

function createUnavailableActionError(action) {
  const err = new Error(`${action} is not available in the current bridge context.`);
  err.code = 'WEBOS_BRIDGE_ACTION_UNAVAILABLE';
  return err;
}

function parseSemVer(value) {
  const match = String(value || '').trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function compareSemVer(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

export function createWebOSBridge(options = {}) {
  const openAppById = typeof options.openAppById === 'function' ? options.openAppById : null;

  async function fetchRuntimeCapabilities() {
    const payload = await apiFetch('/api/packages/runtime/capabilities');
    return Array.isArray(payload?.capabilities) ? payload.capabilities : [];
  }

  async function fetchApiPolicy(clientVersion = '0.1.0') {
    const version = encodeURIComponent(String(clientVersion || '').trim() || '0.1.0');
    const payload = await apiFetch(`/api/system/app-api-policy?clientVersion=${version}`);
    return payload?.policy || null;
  }

  return {
    version: '0.1.0',
    capabilities: {
      apps: true,
      packages: true,
      runtime: true,
      system: true,
      sandbox: true,
      describeRuntime: fetchRuntimeCapabilities
    },
    sdk: {
      describeCapabilities: fetchRuntimeCapabilities,
      getApiPolicy: fetchApiPolicy,
      checkApiCompatibility: async (clientVersion = '0.1.0') => {
        const version = String(clientVersion || '').trim() || '0.1.0';
        const payload = await apiFetch(`/api/system/app-api-policy?clientVersion=${encodeURIComponent(version)}`);
        if (payload?.compatibility) {
          return payload.compatibility;
        }

        const policy = payload?.policy || null;
        const parsedClient = parseSemVer(version);
        const parsedMin = parseSemVer(policy?.minimumSupportedVersion || '');
        const parsedCurrent = parseSemVer(policy?.currentVersion || '');
        if (!parsedClient || !parsedMin || !parsedCurrent) {
          return {
            compatible: false,
            level: 'blocked',
            reason: 'Invalid API policy or client version.'
          };
        }
        if (compareSemVer(parsedClient, parsedMin) < 0 || parsedClient.major !== parsedCurrent.major) {
          return {
            compatible: false,
            level: 'blocked',
            reason: 'Client version is not supported by current API policy.'
          };
        }
        return {
          compatible: true,
          level: 'pass',
          reason: 'Client version is compatible.'
        };
      },
      describeSandboxApp: async (appId) => {
        const normalizedId = encodeURIComponent(String(appId || '').trim());
        if (!normalizedId) {
          throw createUnavailableActionError('sdk.describeSandboxApp');
        }
        const payload = await apiFetch(`/api/sandbox/${normalizedId}/capabilities`);
        return {
          appId: payload?.appId || String(appId || '').trim(),
          declaredPermissions: Array.isArray(payload?.declaredPermissions) ? payload.declaredPermissions : [],
          capabilities: Array.isArray(payload?.capabilities) ? payload.capabilities : []
        };
      }
    },
    apps: {
      list: async () => {
        const payload = await apiFetch('/api/system/apps');
        return Array.isArray(payload) ? payload : [];
      },
      open: async (appId, data = null) => {
        if (!openAppById) {
          throw createUnavailableActionError('apps.open');
        }
        return openAppById(appId, data);
      }
    },
    packages: {
      listInstalled: async () => {
        const payload = await apiFetch('/api/packages');
        return Array.isArray(payload?.packages) ? payload.packages : [];
      }
    },
    runtime: {
      listApps: async () => {
        const payload = await apiFetch('/api/runtime/apps');
        return Array.isArray(payload?.apps) ? payload.apps : [];
      }
    },
    system: {
      overview: async () => apiFetch('/api/system/overview')
    }
  };
}

export function installWebOSBridge(options = {}) {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const bridge = createWebOSBridge(options);
  window.WebOS = bridge;

  return () => {
    if (window.WebOS === bridge) {
      delete window.WebOS;
    }
  };
}
