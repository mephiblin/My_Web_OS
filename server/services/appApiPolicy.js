const APP_API_POLICY = Object.freeze({
  name: 'webos-app-api',
  currentVersion: '0.1.0',
  minimumSupportedVersion: '0.1.0',
  compatibility: {
    strategy: 'major-minor-stable',
    rules: [
      'Patch updates are backward compatible within the same minor version.',
      'Minor updates may add optional capabilities without breaking existing calls.',
      'Major updates may remove deprecated calls and require migration.'
    ]
  },
  deprecations: [
    {
      id: 'none',
      status: 'active',
      summary: 'No deprecated app API methods at this time.'
    }
  ],
  updatedAt: '2026-04-24'
});

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

function checkCompatibility(clientVersion) {
  const parsedClient = parseSemVer(clientVersion);
  const parsedCurrent = parseSemVer(APP_API_POLICY.currentVersion);
  const parsedMinimum = parseSemVer(APP_API_POLICY.minimumSupportedVersion);

  if (!parsedClient || !parsedCurrent || !parsedMinimum) {
    return {
      compatible: false,
      level: 'blocked',
      reason: 'Invalid semantic version format.'
    };
  }

  if (compareSemVer(parsedClient, parsedMinimum) < 0) {
    return {
      compatible: false,
      level: 'blocked',
      reason: `Client API version ${clientVersion} is below minimum supported ${APP_API_POLICY.minimumSupportedVersion}.`
    };
  }

  if (parsedClient.major !== parsedCurrent.major) {
    return {
      compatible: false,
      level: 'blocked',
      reason: `Client major version ${parsedClient.major} does not match current major ${parsedCurrent.major}.`
    };
  }

  if (parsedClient.minor > parsedCurrent.minor) {
    return {
      compatible: false,
      level: 'warn',
      reason: `Client minor version ${parsedClient.minor} is newer than server minor ${parsedCurrent.minor}.`
    };
  }

  return {
    compatible: true,
    level: parsedClient.minor < parsedCurrent.minor ? 'warn' : 'pass',
    reason: parsedClient.minor < parsedCurrent.minor
      ? 'Client API version is older but still compatible.'
      : 'Client API version is compatible.'
  };
}

module.exports = {
  APP_API_POLICY,
  checkCompatibility
};
