const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const auditService = require('../services/auditService');
const {
  sanitizeContainerId,
  runDockerCommand,
  classifyDockerError,
  parseDockerJsonLines
} = require('../services/dockerService');

router.use(auth);

function sendDockerError(res, err, fallbackCode) {
  const mapped = classifyDockerError(err, fallbackCode);
  return res.status(mapped.status).json({
    error: true,
    code: mapped.code,
    message: mapped.message
  });
}

/**
 * GET /api/docker/containers
 */
router.get('/containers', async (req, res) => {
  try {
    const output = await runDockerCommand('docker ps -a --format "{{json .}}"');
    if (!output) return res.json({ containers: [] });
    const containers = parseDockerJsonLines(output);
    res.json({ containers });
  } catch (err) {
    const mapped = classifyDockerError(err, 'DOCKER_CONTAINERS_FETCH_FAILED');
    res.json({
      containers: [],
      error: true,
      code: mapped.code,
      message: mapped.message
    });
  }
});

/**
 * GET /api/docker/logs?id=<container>&tail=200
 */
router.get('/logs', async (req, res) => {
  try {
    const id = sanitizeContainerId(String(req.query.id || '').trim());
    if (!id) {
      return res.status(400).json({ error: true, code: 'DOCKER_CONTAINER_ID_INVALID', message: 'Invalid container ID.' });
    }
    const tail = Number.isFinite(Number(req.query.tail)) ? Math.max(20, Math.min(1000, Number(req.query.tail))) : 200;
    const output = await runDockerCommand(`docker logs --tail ${tail} ${id} 2>&1`);
    const lines = output ? output.split('\n').filter(Boolean) : [];
    return res.json({ success: true, id, lines });
  } catch (err) {
    return sendDockerError(res, err, 'DOCKER_LOGS_FETCH_FAILED');
  }
});

/**
 * GET /api/docker/volumes
 */
router.get('/volumes', async (_req, res) => {
  try {
    const output = await runDockerCommand('docker volume ls --format "{{json .}}"');
    const volumes = parseDockerJsonLines(output);
    return res.json({ success: true, volumes });
  } catch (err) {
    return sendDockerError(res, err, 'DOCKER_VOLUMES_FETCH_FAILED');
  }
});

/**
 * GET /api/docker/images
 */
router.get('/images', async (_req, res) => {
  try {
    const output = await runDockerCommand('docker image ls --format "{{json .}}"');
    const images = parseDockerJsonLines(output);
    return res.json({ success: true, images });
  } catch (err) {
    return sendDockerError(res, err, 'DOCKER_IMAGES_FETCH_FAILED');
  }
});

/**
 * GET /api/docker/compose/projects
 */
router.get('/compose/projects', async (_req, res) => {
  try {
    const output = await runDockerCommand('docker compose ls --format json');
    const projects = parseDockerJsonLines(output);
    return res.json({ success: true, projects });
  } catch (err) {
    return sendDockerError(res, err, 'DOCKER_COMPOSE_FETCH_FAILED');
  }
});

/**
 * POST /api/docker/start
 */
router.post('/start', async (req, res) => {
  try {
    const id = sanitizeContainerId(req.body.id);
    if (!id) {
      return res.status(400).json({
        error: true,
        code: 'DOCKER_CONTAINER_ID_INVALID',
        message: 'Invalid container ID.'
      });
    }
    await runDockerCommand(`docker start ${id}`);
    await auditService.log('SYSTEM', 'Docker: Start Container', { containerId: id, user: req.user?.username }, 'INFO');
    res.json({ success: true, message: `Container ${id} started.` });
  } catch (err) {
    return sendDockerError(res, err, 'DOCKER_CONTAINER_START_FAILED');
  }
});

/**
 * POST /api/docker/stop
 */
router.post('/stop', async (req, res) => {
  try {
    const id = sanitizeContainerId(req.body.id);
    if (!id) {
      return res.status(400).json({
        error: true,
        code: 'DOCKER_CONTAINER_ID_INVALID',
        message: 'Invalid container ID.'
      });
    }
    await runDockerCommand(`docker stop ${id}`);
    await auditService.log('SYSTEM', 'Docker: Stop Container', { containerId: id, user: req.user?.username }, 'INFO');
    res.json({ success: true, message: `Container ${id} stopped.` });
  } catch (err) {
    return sendDockerError(res, err, 'DOCKER_CONTAINER_STOP_FAILED');
  }
});

/**
 * POST /api/docker/restart
 */
router.post('/restart', async (req, res) => {
  try {
    const id = sanitizeContainerId(req.body.id);
    if (!id) {
      return res.status(400).json({
        error: true,
        code: 'DOCKER_CONTAINER_ID_INVALID',
        message: 'Invalid container ID.'
      });
    }
    await runDockerCommand(`docker restart ${id}`);
    await auditService.log('SYSTEM', 'Docker: Restart Container', { containerId: id, user: req.user?.username }, 'WARNING');
    res.json({ success: true, message: `Container ${id} restarted.` });
  } catch (err) {
    return sendDockerError(res, err, 'DOCKER_CONTAINER_RESTART_FAILED');
  }
});

/**
 * DELETE /api/docker/remove
 */
router.delete('/remove', async (req, res) => {
  try {
    const id = sanitizeContainerId(req.body.id);
    if (!id) {
      return res.status(400).json({
        error: true,
        code: 'DOCKER_CONTAINER_ID_INVALID',
        message: 'Invalid container ID.'
      });
    }
    await runDockerCommand(`docker rm -f ${id}`);
    await auditService.log('SYSTEM', 'Docker: Remove Container', { containerId: id, user: req.user?.username }, 'WARNING');
    res.json({ success: true, message: `Container ${id} removed.` });
  } catch (err) {
    return sendDockerError(res, err, 'DOCKER_CONTAINER_REMOVE_FAILED');
  }
});

module.exports = router;
