const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  // For initial development/local use, we might want to skip this or simplify it.
  // But for the blueprint, we need it.
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: true,
      code: 'AUTH_REQUIRED',
      message: 'Authentication required.'
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({
      error: true,
      code: 'AUTH_INVALID',
      message: 'Invalid or expired token.'
    });
  }
};

module.exports = authMiddleware;
