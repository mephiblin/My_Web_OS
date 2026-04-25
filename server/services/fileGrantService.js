const FILE_GRANT_TTL_MS = 60 * 60 * 1000;
const grantStore = new Map();

function normalizeGrantMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'readwrite') return 'readwrite';
  return 'read';
}

function grantModeSatisfies(grantedMode, requiredMode) {
  const need = normalizeGrantMode(requiredMode);
  if (need === 'read') {
    return grantedMode === 'read' || grantedMode === 'readwrite';
  }
  return grantedMode === 'readwrite';
}

function pruneExpiredGrants(now = Date.now()) {
  for (const [grantId, grant] of grantStore.entries()) {
    if (!grant || grant.expiresAt <= now) {
      grantStore.delete(grantId);
    }
  }
}

function createGrant(options = {}) {
  pruneExpiredGrants();
  const now = Date.now();
  const grantId = `fg_${now.toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const record = {
    id: grantId,
    appId: String(options.appId || '').trim() || null,
    source: String(options.source || '').trim() || 'file-station',
    scope: 'single-file',
    mode: normalizeGrantMode(options.mode),
    path: String(options.path || '').trim(),
    user: String(options.user || '').trim() || null,
    expiresOnWindowClose: true,
    createdAt: now,
    expiresAt: now + FILE_GRANT_TTL_MS
  };
  grantStore.set(grantId, record);
  return record;
}

function consumeGrant(grantId, options = {}) {
  pruneExpiredGrants();
  const normalizedGrantId = String(grantId || '').trim();
  if (!normalizedGrantId) {
    const err = new Error('A valid file grant id is required.');
    err.code = 'FS_FILE_GRANT_REQUIRED';
    throw err;
  }

  const grant = grantStore.get(normalizedGrantId);
  if (!grant) {
    const err = new Error('File grant is invalid or expired.');
    err.code = 'FS_FILE_GRANT_INVALID';
    throw err;
  }

  const requiredPath = String(options.path || '').trim();
  if (requiredPath && grant.path !== requiredPath) {
    const err = new Error('File grant does not match this path.');
    err.code = 'FS_FILE_GRANT_SCOPE_MISMATCH';
    throw err;
  }

  if (!grantModeSatisfies(grant.mode, options.requiredMode || 'read')) {
    const err = new Error('File grant does not allow this operation.');
    err.code = 'FS_FILE_GRANT_MODE_DENIED';
    throw err;
  }

  const expectedAppId = String(options.appId || '').trim();
  if (expectedAppId && grant.appId && grant.appId !== expectedAppId) {
    const err = new Error('File grant app id does not match.');
    err.code = 'FS_FILE_GRANT_APP_MISMATCH';
    throw err;
  }

  const expectedUser = String(options.user || '').trim();
  if (expectedUser && grant.user && grant.user !== expectedUser) {
    const err = new Error('File grant user does not match.');
    err.code = 'FS_FILE_GRANT_USER_MISMATCH';
    throw err;
  }

  return grant;
}

function listActiveGrants(options = {}) {
  pruneExpiredGrants();
  const expectedUser = String(options.user || '').trim();
  const expectedSource = String(options.source || '').trim();
  const now = Date.now();
  const items = [];

  for (const grant of grantStore.values()) {
    if (!grant || grant.expiresAt <= now) continue;
    if (expectedUser && grant.user && grant.user !== expectedUser) continue;
    if (expectedSource && grant.source !== expectedSource) continue;
    items.push({ ...grant });
  }

  items.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return items;
}

module.exports = {
  createGrant,
  consumeGrant,
  normalizeGrantMode,
  listActiveGrants
};
