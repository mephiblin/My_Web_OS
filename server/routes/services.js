const express = require('express');
const auth = require('../middleware/auth');

const router = express.Router();
router.use(auth);

function getManager(req, res) {
  const manager = req.app.get('serviceManager');
  if (manager) return manager;

  res.status(503).json({
    error: true,
    code: 'SERVICE_MANAGER_UNAVAILABLE',
    message: 'Service manager is not initialized.'
  });
  return null;
}

router.get('/', async (req, res) => {
  const manager = getManager(req, res);
  if (!manager) return;

  res.json({
    success: true,
    services: manager.getStatusSnapshot()
  });
});

router.post('/:name/restart', async (req, res) => {
  const manager = getManager(req, res);
  if (!manager) return;

  try {
    const status = await manager.restart(req.params.name);
    res.json({
      success: true,
      status
    });
  } catch (err) {
    if (err.code === 'SERVICE_NOT_FOUND') {
      return res.status(404).json({
        error: true,
        code: err.code,
        message: err.message
      });
    }

    return res.status(500).json({
      error: true,
      message: err.message
    });
  }
});

module.exports = router;
