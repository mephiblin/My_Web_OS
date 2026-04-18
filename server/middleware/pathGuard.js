const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const ALLOWED_ROOTS = JSON.parse(process.env.ALLOWED_ROOTS || '[]');

/**
 * Path Guard Middleware
 * Prevents directory traversal attacks and restricts access to allowed roots.
 */
const pathGuard = (req, res, next) => {
  let requestedPath = req.query.path || req.body.path;
  
  if (!requestedPath) {
    return next(); // Some routes might not require a path
  }

  // Normalize and resolve path
  const absolutePath = path.resolve(requestedPath);
  
  // Check if the path starts with any allowed roots
  const isAllowed = ALLOWED_ROOTS.some(root => {
    const absoluteRoot = path.resolve(root);
    return absolutePath.startsWith(absoluteRoot);
  });

  if (!isAllowed) {
    return res.status(403).json({
      error: true,
      code: 'FS_PERMISSION_DENIED',
      message: 'Access to this path is restricted.'
    });
  }

  req.safePath = absolutePath;
  next();
};

module.exports = pathGuard;
