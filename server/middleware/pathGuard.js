const serverConfig = require('../config/serverConfig');
const {
  resolveSafePath,
  isWithinAllowedRoots,
  isProtectedSystemPath,
  assertWithinAllowedRealRoots
} = require('../utils/pathPolicy');

/**
 * Path Guard Middleware
 * Prevents directory traversal attacks and restricts access to allowed roots.
 */
const pathGuard = async (req, res, next) => {
  const requestedPath = req.query.path || req.body.path;
  
  if (!requestedPath) {
    return next(); // Some routes might not require a path
  }

  try {
    const absolutePath = resolveSafePath(requestedPath);
    const { allowedRoots, inventoryRoot } = await serverConfig.getPaths();

    if (isProtectedSystemPath(absolutePath, [inventoryRoot])) {
      return res.status(403).json({
        error: true,
        code: 'FS_SYSTEM_PROTECTED',
        message: 'System inventory is protected. Use the system or package APIs.',
        details: null
      });
    }

    if (!isWithinAllowedRoots(absolutePath, allowedRoots)) {
      return res.status(403).json({
        error: true,
        code: 'FS_PERMISSION_DENIED',
        message: 'Access to this path is restricted.',
        details: null
      });
    }

    await assertWithinAllowedRealRoots(absolutePath, allowedRoots);

    req.safePath = absolutePath;
    next();
  } catch (err) {
    const code = err.code || 'FS_INVALID_PATH';
    return res.status(err.status || 400).json({
      error: true,
      code,
      message: err.message || 'Invalid path provided.',
      details: null
    });
  }
};

module.exports = pathGuard;
