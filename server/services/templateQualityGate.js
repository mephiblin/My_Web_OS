const fs = require('fs-extra');
const path = require('path');

const packageRegistryService = require('./packageRegistryService');
const packageLifecycleService = require('./packageLifecycleService');
const inventoryPaths = require('../utils/inventoryPaths');
const { normalizeRuntimeProfile, assertValidRuntimeProfile, isManagedRuntime } = require('./runtimeProfiles');

const ROOT_PACKAGE_JSON_PATH = path.join(__dirname, '../../package.json');
const BACKUPS_DIR_NAME = 'package-backups';

const HIGH_RISK_PERMISSIONS = new Set([
  'fs.host.read',
  'fs.host.write',
  'fs.host.execute',
  'terminal.exec',
  'system.shell',
  'system.process.manage'
]);

const PASS_THRESHOLD = 85;
const WARN_THRESHOLD = 70;

function nowIso() {
  return new Date().toISOString();
}

function pushCheck(checks, options) {
  checks.push({
    id: options.id,
    level: options.level,
    message: options.message,
    weight: Number.isFinite(Number(options.weight)) ? Number(options.weight) : 0,
    category: String(options.category || '').trim(),
    code: options.code ? String(options.code) : undefined,
    details: options.details && typeof options.details === 'object' ? options.details : undefined
  });
}

function addRecommendation(recommendations, message) {
  const value = String(message || '').trim();
  if (!value) return;
  recommendations.add(value);
}

function asArrayOfStrings(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

async function getServerVersion() {
  const rootPackage = await fs.readJson(ROOT_PACKAGE_JSON_PATH).catch(() => null);
  return String(rootPackage?.version || '0.0.0').trim() || '0.0.0';
}

function hasBlockingFailure(checks) {
  return checks.some((check) => check.level === 'fail' && check.details?.blocking);
}

function calculateScore(checks) {
  const scoredChecks = checks.filter((check) => Number(check.weight) > 0);
  const totalWeight = scoredChecks.reduce((sum, check) => sum + Number(check.weight), 0);
  if (totalWeight <= 0) return 100;

  const earned = scoredChecks.reduce((sum, check) => {
    const level = String(check.level || '').toLowerCase();
    if (level === 'pass') return sum + Number(check.weight);
    if (level === 'warn') return sum + Number(check.weight) * 0.5;
    return sum;
  }, 0);

  return Math.max(0, Math.min(100, Math.round((earned / totalWeight) * 100)));
}

function toBlockingIssues(checks) {
  return checks
    .filter((check) => check.level === 'fail' && check.details?.blocking)
    .map((check) => ({
      id: check.id,
      code: check.code || 'TEMPLATE_QUALITY_BLOCKING_FAILURE',
      message: check.message
    }));
}

function checkPermissions(manifest, runtimeProfile, checks, recommendations) {
  const permissions = asArrayOfStrings(manifest.permissions);

  if (permissions.length === 0) {
    pushCheck(checks, {
      id: 'permissions.scope',
      level: 'pass',
      message: 'No extra permissions requested.',
      weight: 20,
      category: 'permissions'
    });
  } else if (permissions.length <= 6) {
    pushCheck(checks, {
      id: 'permissions.scope',
      level: 'pass',
      message: `Permission count is within recommended range (${permissions.length}).`,
      weight: 20,
      category: 'permissions'
    });
  } else {
    pushCheck(checks, {
      id: 'permissions.scope',
      level: 'warn',
      message: `Permission count is high (${permissions.length}). Review least-privilege scope.`,
      weight: 20,
      category: 'permissions'
    });
    addRecommendation(recommendations, 'Reduce permission scope to least privilege.');
  }

  const highRiskPermissions = permissions.filter((permission) => HIGH_RISK_PERMISSIONS.has(permission));
  if (highRiskPermissions.length > 0) {
    pushCheck(checks, {
      id: 'permissions.high-risk',
      level: 'warn',
      code: 'TEMPLATE_QUALITY_HIGH_RISK_PERMISSION',
      message: `High-risk permissions detected: ${highRiskPermissions.join(', ')}.`,
      weight: 10,
      category: 'permissions',
      details: { highRiskPermissions }
    });
    addRecommendation(recommendations, 'Replace high-risk host permissions with package-owned storage permissions when possible.');
  } else {
    pushCheck(checks, {
      id: 'permissions.high-risk',
      level: 'pass',
      message: 'No high-risk host permissions detected.',
      weight: 10,
      category: 'permissions'
    });
  }

  const runtimeType = runtimeProfile.runtimeType;
  const hasHostPermission = permissions.some(
    (permission) => permission.startsWith('fs.host.') || permission.startsWith('terminal.') || permission.startsWith('system.shell')
  );

  if (runtimeType === 'sandbox-html' && hasHostPermission) {
    pushCheck(checks, {
      id: 'permissions.runtime-fit',
      level: 'warn',
      code: 'TEMPLATE_QUALITY_PERMISSION_RUNTIME_MISMATCH',
      message: 'Sandbox UI runtime requests host-level permissions. Validate host/sandbox boundary.',
      weight: 10,
      category: 'permissions'
    });
    addRecommendation(recommendations, 'For sandbox-html apps, avoid host-level permissions unless a bridge contract explicitly requires them.');
  } else {
    pushCheck(checks, {
      id: 'permissions.runtime-fit',
      level: 'pass',
      message: 'Permission profile matches runtime intent.',
      weight: 10,
      category: 'permissions'
    });
  }
}

async function checkRecoverability(appId, runtimeProfile, checks, recommendations, options = {}) {
  const allowFsMutation = options.allowFsMutation !== false;
  if (!isManagedRuntime(runtimeProfile)) {
    pushCheck(checks, {
      id: 'recoverability.runtime-policy',
      level: 'pass',
      message: 'Managed runtime recoverability policy is not required for this runtime type.',
      weight: 15,
      category: 'recoverability'
    });
    pushCheck(checks, {
      id: 'recoverability.healthcheck',
      level: 'pass',
      message: 'Managed runtime healthcheck requirement is not applicable.',
      weight: 10,
      category: 'recoverability'
    });
  } else {
    const restartPolicy = String(runtimeProfile.service?.restartPolicy || '').trim().toLowerCase();
    const maxRetries = Number(runtimeProfile.service?.maxRetries || 0);
    const restartDelayMs = Number(runtimeProfile.service?.restartDelayMs || 0);
    const hasRecoverablePolicy = restartPolicy !== 'never' && maxRetries > 0 && restartDelayMs >= 0;

    if (!hasRecoverablePolicy) {
      pushCheck(checks, {
        id: 'recoverability.runtime-policy',
        level: 'fail',
        code: 'TEMPLATE_QUALITY_RECOVERABILITY_POLICY_REQUIRED',
        message: 'Managed runtime requires recoverable restart policy (not "never", retries > 0).',
        weight: 15,
        category: 'recoverability',
        details: { blocking: true, restartPolicy, maxRetries, restartDelayMs }
      });
      addRecommendation(recommendations, 'Set service.restartPolicy to on-failure/always and configure retries.');
    } else {
      pushCheck(checks, {
        id: 'recoverability.runtime-policy',
        level: 'pass',
        message: 'Recoverability restart policy is configured for managed runtime.',
        weight: 15,
        category: 'recoverability'
      });
    }

    const healthcheckType = String(runtimeProfile.healthcheck?.type || 'none').trim().toLowerCase();
    if (healthcheckType === 'none') {
      pushCheck(checks, {
        id: 'recoverability.healthcheck',
        level: 'fail',
        code: 'TEMPLATE_QUALITY_HEALTHCHECK_REQUIRED',
        message: 'Managed runtime requires a healthcheck type other than "none".',
        weight: 10,
        category: 'recoverability',
        details: { blocking: true, healthcheckType }
      });
      addRecommendation(recommendations, 'Add process or HTTP healthcheck for managed runtime templates.');
    } else {
      pushCheck(checks, {
        id: 'recoverability.healthcheck',
        level: 'pass',
        message: `Healthcheck is configured (${healthcheckType}).`,
        weight: 10,
        category: 'recoverability'
      });
    }
  }

  try {
    const roots = await inventoryPaths.ensureInventoryStructure();
    const backupsRoot = path.join(roots.systemDir, BACKUPS_DIR_NAME, appId);
    if (allowFsMutation) {
      await fs.ensureDir(backupsRoot);
    } else {
      const backupParentDir = path.dirname(backupsRoot);
      const parentExists = await fs.pathExists(backupParentDir);
      if (!parentExists) {
        const err = new Error('Backup parent directory is not available.');
        err.code = 'TEMPLATE_QUALITY_BACKUP_PATH_UNAVAILABLE';
        throw err;
      }
    }
    pushCheck(checks, {
      id: 'recoverability.backup-path',
      level: 'pass',
      message: 'Backup path is writable for rollback snapshots.',
      weight: 10,
      category: 'recoverability'
    });
  } catch (err) {
    pushCheck(checks, {
      id: 'recoverability.backup-path',
      level: 'fail',
      code: 'TEMPLATE_QUALITY_BACKUP_PATH_UNAVAILABLE',
      message: 'Backup path could not be prepared for rollback snapshots.',
      weight: 10,
      category: 'recoverability',
      details: { blocking: true, reason: err.message }
    });
    addRecommendation(recommendations, 'Ensure server storage/inventory/system is writable before scaffolding templates.');
  }
}

async function checkCompatibility(manifest, runtimeProfile, checks, recommendations) {
  const dependencies = packageLifecycleService.normalizeDependencies(manifest.dependencies);
  const compatibility = packageLifecycleService.normalizeCompatibility(manifest.compatibility);
  const installedPackages = await packageRegistryService.listSandboxApps().catch(() => []);
  const installedMap = new Map(
    installedPackages.map((item) => [
      String(item.id || '').trim(),
      String(item.version || '0.0.0').trim() || '0.0.0'
    ])
  );

  const missingRequired = [];
  const missingOptional = [];
  const versionMismatchesRequired = [];
  const versionMismatchesOptional = [];

  for (const dependency of dependencies) {
    const installedVersion = installedMap.get(dependency.id) || '';
    const exists = Boolean(installedVersion);
    const range = dependency.version || '*';
    const versionMatches = exists
      ? packageLifecycleService.matchesVersionRange(installedVersion, range)
      : false;

    if (!exists && dependency.optional) {
      missingOptional.push(dependency.id);
    } else if (!exists) {
      missingRequired.push(dependency.id);
    } else if (!versionMatches && dependency.optional) {
      versionMismatchesOptional.push(`${dependency.id}@${installedVersion} !~ ${range}`);
    } else if (!versionMatches) {
      versionMismatchesRequired.push(`${dependency.id}@${installedVersion} !~ ${range}`);
    }
  }

  if (missingRequired.length > 0 || versionMismatchesRequired.length > 0) {
    const messages = [];
    if (missingRequired.length > 0) {
      messages.push(`Required dependencies missing: ${missingRequired.join(', ')}.`);
    }
    if (versionMismatchesRequired.length > 0) {
      messages.push(`Required dependency version mismatch: ${versionMismatchesRequired.join(', ')}.`);
    }

    pushCheck(checks, {
      id: 'compatibility.dependencies',
      level: 'fail',
      code: 'TEMPLATE_QUALITY_DEPENDENCY_MISSING',
      message: messages.join(' '),
      weight: 10,
      category: 'compatibility',
      details: {
        blocking: true,
        missingRequired,
        missingOptional,
        versionMismatchesRequired,
        versionMismatchesOptional
      }
    });
    addRecommendation(recommendations, 'Install required dependencies and align installed versions with declared SemVer ranges before scaffold.');
  } else if (missingOptional.length > 0 || versionMismatchesOptional.length > 0) {
    const messages = [];
    if (missingOptional.length > 0) {
      messages.push(`Optional dependencies missing: ${missingOptional.join(', ')}.`);
    }
    if (versionMismatchesOptional.length > 0) {
      messages.push(`Optional dependency version mismatch: ${versionMismatchesOptional.join(', ')}.`);
    }

    pushCheck(checks, {
      id: 'compatibility.dependencies',
      level: 'warn',
      message: messages.join(' '),
      weight: 10,
      category: 'compatibility',
      details: {
        missingOptional,
        versionMismatchesOptional
      }
    });
  } else {
    pushCheck(checks, {
      id: 'compatibility.dependencies',
      level: 'pass',
      message: 'Dependency requirements are satisfied.',
      weight: 10,
      category: 'compatibility'
    });
  }

  const serverVersion = await getServerVersion();
  const minServerVersion = String(compatibility.minServerVersion || '').trim();
  const maxServerVersion = String(compatibility.maxServerVersion || '').trim();

  let versionIssue = '';
  if (minServerVersion && packageLifecycleService.compareVersions(serverVersion, minServerVersion) < 0) {
    versionIssue = `Server version ${serverVersion} is lower than minimum ${minServerVersion}.`;
  }
  if (!versionIssue && maxServerVersion && packageLifecycleService.compareVersions(serverVersion, maxServerVersion) > 0) {
    versionIssue = `Server version ${serverVersion} is higher than maximum ${maxServerVersion}.`;
  }

  if (versionIssue) {
    pushCheck(checks, {
      id: 'compatibility.server-version',
      level: 'fail',
      code: 'TEMPLATE_QUALITY_SERVER_VERSION_MISMATCH',
      message: versionIssue,
      weight: 10,
      category: 'compatibility',
      details: { blocking: true, serverVersion, minServerVersion, maxServerVersion }
    });
    addRecommendation(recommendations, 'Adjust compatibility.minServerVersion/maxServerVersion or upgrade/downgrade server version.');
  } else {
    pushCheck(checks, {
      id: 'compatibility.server-version',
      level: 'pass',
      message: `Server version ${serverVersion} satisfies compatibility constraints.`,
      weight: 10,
      category: 'compatibility',
      details: { serverVersion, minServerVersion, maxServerVersion }
    });
  }

  const requiredRuntimeTypes = Array.isArray(compatibility.requiredRuntimeTypes)
    ? compatibility.requiredRuntimeTypes.map((item) => String(item || '').trim()).filter(Boolean)
    : [];

  if (requiredRuntimeTypes.length > 0 && !requiredRuntimeTypes.includes(runtimeProfile.runtimeType)) {
    pushCheck(checks, {
      id: 'compatibility.runtime-type',
      level: 'fail',
      code: 'TEMPLATE_QUALITY_RUNTIME_TYPE_MISMATCH',
      message: `Runtime type "${runtimeProfile.runtimeType}" is not in requiredRuntimeTypes.`,
      weight: 5,
      category: 'compatibility',
      details: { blocking: true, requiredRuntimeTypes, runtimeType: runtimeProfile.runtimeType }
    });
    addRecommendation(recommendations, 'Update compatibility.requiredRuntimeTypes or select a compatible runtime type.');
  } else {
    pushCheck(checks, {
      id: 'compatibility.runtime-type',
      level: 'pass',
      message: 'Runtime type is compatible.',
      weight: 5,
      category: 'compatibility'
    });
  }
}

const templateQualityGate = {
  async evaluate(options = {}) {
    const manifest = options.manifest && typeof options.manifest === 'object' ? options.manifest : null;
    if (!manifest) {
      const err = new Error('Manifest payload is required for template quality check.');
      err.code = 'TEMPLATE_QUALITY_MANIFEST_REQUIRED';
      throw err;
    }

    const appId = String(options.appId || manifest.id || 'template-preview').trim() || 'template-preview';
    const templateId = String(options.templateId || '').trim();
    const checks = [];
    const recommendations = new Set();
    let runtimeProfile = null;

    try {
      runtimeProfile = normalizeRuntimeProfile(manifest);
      assertValidRuntimeProfile(manifest, runtimeProfile);
      pushCheck(checks, {
        id: 'runtime.profile',
        level: 'pass',
        message: 'Runtime profile is valid.',
        weight: 10,
        category: 'recoverability'
      });
    } catch (err) {
      pushCheck(checks, {
        id: 'runtime.profile',
        level: 'fail',
        code: err.code || 'RUNTIME_PROFILE_INVALID',
        message: err.message || 'Runtime profile is invalid.',
        weight: 10,
        category: 'recoverability',
        details: { blocking: true }
      });
      addRecommendation(recommendations, 'Fix runtime profile fields before scaffolding this template.');
    }

    if (runtimeProfile) {
      checkPermissions(manifest, runtimeProfile, checks, recommendations);
      await checkRecoverability(appId, runtimeProfile, checks, recommendations, {
        allowFsMutation: options.allowFsMutation !== false
      });
      await checkCompatibility(manifest, runtimeProfile, checks, recommendations);
    }

    const blockingIssues = toBlockingIssues(checks);
    const score = calculateScore(checks);
    const status = blockingIssues.length > 0 || score < WARN_THRESHOLD
      ? 'fail'
      : score >= PASS_THRESHOLD
        ? 'pass'
        : 'warn';

    if (status === 'warn') {
      addRecommendation(recommendations, 'Review warnings before publishing this template to ecosystem users.');
    } else if (status === 'fail' && !hasBlockingFailure(checks)) {
      addRecommendation(recommendations, 'Raise score above 70 to meet minimum template quality policy.');
    }

    return {
      status,
      score,
      checkedAt: nowIso(),
      templateId,
      appId,
      checks,
      blockingIssues,
      recommendations: Array.from(recommendations)
    };
  }
};

module.exports = templateQualityGate;
