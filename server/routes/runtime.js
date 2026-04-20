const express = require('express');
const auth = require('../middleware/auth');

const router = express.Router();
router.use(auth);

function getManager(req, res) {
  const manager = req.app.get('runtimeManager');
  if (manager) return manager;

  res.status(503).json({
    error: true,
    code: 'RUNTIME_MANAGER_UNAVAILABLE',
    message: 'Runtime manager is not initialized.'
  });
  return null;
}

function handleError(res, err) {
  const status =
    err.code === 'RUNTIME_APP_NOT_FOUND'
      ? 404
      : err.code === 'RUNTIME_NOT_MANAGED' ||
          err.code === 'RUNTIME_COMMAND_REQUIRED' ||
          err.code === 'RUNTIME_COMMAND_NOT_ALLOWED' ||
          err.code === 'RUNTIME_ENTRY_NOT_FOUND' ||
          err.code === 'RUNTIME_PROFILE_INVALID'
        ? 400
        : 500;

  return res.status(status).json({
    error: true,
    code: err.code || 'RUNTIME_REQUEST_FAILED',
    message: err.message
  });
}

router.get('/apps', async (req, res) => {
  const manager = getManager(req, res);
  if (!manager) return;

  try {
    const apps = await manager.listApps();
    return res.json({
      success: true,
      apps
    });
  } catch (err) {
    return handleError(res, err);
  }
});

router.get('/apps/:id', async (req, res) => {
  const manager = getManager(req, res);
  if (!manager) return;

  try {
    const app = await manager.getApp(req.params.id);
    return res.json({
      success: true,
      app
    });
  } catch (err) {
    return handleError(res, err);
  }
});

router.get('/apps/:id/validate', async (req, res) => {
  const manager = getManager(req, res);
  if (!manager) return;

  try {
    const validation = await manager.validateApp(req.params.id);
    return res.json({
      success: true,
      validation
    });
  } catch (err) {
    return handleError(res, err);
  }
});

router.post('/apps/:id/start', async (req, res) => {
  const manager = getManager(req, res);
  if (!manager) return;

  try {
    const app = await manager.startApp(req.params.id);
    return res.json({
      success: true,
      app
    });
  } catch (err) {
    return handleError(res, err);
  }
});

router.post('/apps/:id/stop', async (req, res) => {
  const manager = getManager(req, res);
  if (!manager) return;

  try {
    const app = await manager.stopApp(req.params.id);
    return res.json({
      success: true,
      app
    });
  } catch (err) {
    return handleError(res, err);
  }
});

router.post('/apps/:id/restart', async (req, res) => {
  const manager = getManager(req, res);
  if (!manager) return;

  try {
    const app = await manager.restartApp(req.params.id);
    return res.json({
      success: true,
      app
    });
  } catch (err) {
    return handleError(res, err);
  }
});

router.post('/apps/:id/recover', async (req, res) => {
  const manager = getManager(req, res);
  if (!manager) return;

  try {
    const result = await manager.recoverApp(req.params.id);
    return res.json({
      success: true,
      action: result.action,
      app: result.app
    });
  } catch (err) {
    return handleError(res, err);
  }
});

router.get('/apps/:id/logs', async (req, res) => {
  const manager = getManager(req, res);
  if (!manager) return;

  try {
    const app = await manager.getApp(req.params.id);
    const limit = Number.isFinite(Number(req.query.limit)) ? Number(req.query.limit) : 200;
    const cursor = req.query.cursor;
    const result = manager.getLogs(req.params.id, { limit, cursor });
    return res.json({
      success: true,
      app,
      logs: result.items,
      cursor: result.cursor
    });
  } catch (err) {
    return handleError(res, err);
  }
});

router.get('/apps/:id/events', async (req, res) => {
  const manager = getManager(req, res);
  if (!manager) return;

  try {
    const app = await manager.getApp(req.params.id);
    const limit = Number.isFinite(Number(req.query.limit)) ? Number(req.query.limit) : 200;
    const cursor = req.query.cursor;
    const result = manager.getEvents(req.params.id, { limit, cursor });
    return res.json({
      success: true,
      app,
      events: result.items,
      cursor: result.cursor
    });
  } catch (err) {
    return handleError(res, err);
  }
});

module.exports = router;
