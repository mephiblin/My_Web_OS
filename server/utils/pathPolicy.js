const path = require('path');

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

module.exports = {
  resolveSafePath,
  isWithinAllowedRoots,
  isProtectedSystemPath,
  isSafeLeafName
};
