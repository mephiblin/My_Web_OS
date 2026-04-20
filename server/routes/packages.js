const express = require('express');

const auth = require('../middleware/auth');
const packageRegistryService = require('../services/packageRegistryService');

const router = express.Router();
router.use(auth);

router.get('/', async (_req, res) => {
  try {
    const packages = await packageRegistryService.listSandboxApps();
    res.json({
      success: true,
      packages
    });
  } catch (err) {
    res.status(500).json({
      error: true,
      message: err.message
    });
  }
});

module.exports = router;
