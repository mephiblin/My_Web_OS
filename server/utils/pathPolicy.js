const path = require('path');
const fs = require('fs/promises');

function toComparablePath(value) {
  return path.resolve(value).replace(/[\\/]+/g, path.sep).toLowerCase();
}

function resolveSafePath(inputPath) {
  if (typeof inputPath !== 'string' || inputPath.trim() === '') {
    const err = new Error('A valid path is required.');
    err.code = 'FS_INVALID_PATH';
    throw err;
  }
  return path.resolve(inputPath);
}

function isWithinAllowedRoots(targetPath, allowedRoots) {
  if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) return false;

  const normalizedTarget = toComparablePath(targetPath);

  return allowedRoots.some((root) => {
    const normalizedRoot = toComparablePath(root);
    return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`);
  });
}

function isProtectedSystemPath(targetPath, protectedRoots) {
  if (!Array.isArray(protectedRoots) || protectedRoots.length === 0) return false;

  const normalizedTarget = toComparablePath(targetPath);

  return protectedRoots.some((root) => {
    const normalizedRoot = toComparablePath(root);
    return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`);
  });
}

function isSafeLeafName(name) {
  if (typeof name !== 'string') return false;
  if (name.trim() === '') return false;
  if (name.includes('..')) return false;
  if (name.includes('/') || name.includes('\\')) return false;
  return true;
}

async function realpathSafe(inputPath) {
  return fs.realpath(resolveSafePath(inputPath));
}

async function pathExists(inputPath) {
  try {
    await fs.access(inputPath);
    return true;
  } catch (err) {
    if (err && err.code === 'ENOENT') return false;
    throw err;
  }
}

async function resolvePolicyRealPath(targetPath) {
  const resolvedTarget = resolveSafePath(targetPath);
  if (await pathExists(resolvedTarget)) {
    return realpathSafe(resolvedTarget);
  }

  const missingSegments = [];
  let currentPath = resolvedTarget;

  while (!(await pathExists(currentPath))) {
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      const err = new Error('No existing parent path was found.');
      err.code = 'FS_PATH_NOT_FOUND';
      throw err;
    }
    missingSegments.unshift(path.basename(currentPath));
    currentPath = parentPath;
  }

  const realParent = await realpathSafe(currentPath);
  return path.join(realParent, ...missingSegments);
}

async function pathHasSymlinkSegment(targetPath, rootPath) {
  const resolvedTarget = resolveSafePath(targetPath);
  const resolvedRoot = resolveSafePath(rootPath);
  const relative = path.relative(resolvedRoot, resolvedTarget);

  if (relative === '') return false;
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;

  let currentPath = resolvedRoot;
  const segments = relative.split(path.sep).filter(Boolean);

  for (const segment of segments) {
    currentPath = path.join(currentPath, segment);

    try {
      const stat = await fs.lstat(currentPath);
      if (stat.isSymbolicLink()) return true;
    } catch (err) {
      if (err && err.code === 'ENOENT') return false;
      throw err;
    }
  }

  return false;
}

async function isWithinAllowedRealRoots(targetPath, allowedRoots, options = {}) {
  if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) return false;

  const allowSymlinks = options.allowSymlinks === true;
  const resolvedTarget = resolveSafePath(targetPath);
  const targetRealPath = await resolvePolicyRealPath(resolvedTarget);

  for (const root of allowedRoots) {
    const resolvedRoot = resolveSafePath(root);
    let rootRealPath;

    try {
      rootRealPath = await realpathSafe(resolvedRoot);
    } catch (err) {
      if (err && err.code === 'ENOENT') continue;
      throw err;
    }

    if (!isWithinAllowedRoots(targetRealPath, [rootRealPath])) continue;
    if (!allowSymlinks && await pathHasSymlinkSegment(resolvedTarget, resolvedRoot)) continue;

    return true;
  }

  return false;
}

async function assertWithinAllowedRealRoots(targetPath, allowedRoots, options = {}) {
  const isAllowed = await isWithinAllowedRealRoots(targetPath, allowedRoots, options);
  if (isAllowed) return true;

  const err = new Error('Access to this path is restricted.');
  err.status = 403;
  err.code = 'FS_PERMISSION_DENIED';
  throw err;
}

module.exports = {
  resolveSafePath,
  isWithinAllowedRoots,
  isProtectedSystemPath,
  isSafeLeafName,
  realpathSafe,
  resolvePolicyRealPath,
  pathHasSymlinkSegment,
  isWithinAllowedRealRoots,
  assertWithinAllowedRealRoots
};
