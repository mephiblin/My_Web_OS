const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const serverConfig = require('../config/serverConfig');

const MUTABLE_KEYS = [
  'PORT',
  'NODE_ENV',
  'JWT_SECRET',
  'ALLOWED_ROOTS',
  'INITIAL_PATH',
  'INDEX_DEPTH',
  'ADMIN_USERNAME',
  'ADMIN_PASSWORD',
  'CORS_ORIGIN',
  'RATE_LIMIT_WINDOW_MS',
  'RATE_LIMIT_MAX'
];

router.get('/', auth, async (req, res) => {
  try {
    const settings = await serverConfig.getPublicSettings();
    res.json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ error: true, message: error.message });
  }
});

router.put('/', auth, async (req, res) => {
  try {
    const updates = req.body && typeof req.body === 'object' ? req.body : {};
    const invalidKeys = Object.keys(updates).filter((key) => !MUTABLE_KEYS.includes(key));

    if (invalidKeys.length > 0) {
      return res.status(400).json({
        error: true,
        code: 'CONFIG_UPDATE_REJECTED',
        message: `Unsupported settings keys: ${invalidKeys.join(', ')}`,
        details: { invalidKeys }
      });
    }

    const result = await serverConfig.update(updates, { mutableKeys: MUTABLE_KEYS });

    res.json({
      success: true,
      message: 'Settings saved successfully',
      updatedKeys: result.updatedKeys,
      restartRequired: true
    });
  } catch (error) {
    res.status(500).json({ error: true, message: error.message });
  }
});

module.exports = router;
