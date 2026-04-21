const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const auth = require('../middleware/auth');

router.use(auth);

// Security: Sanitize container IDs to prevent command injection
function sanitizeId(id) {
  if (!id || typeof id !== 'string') return null;
  // Docker container IDs/names: alphanumeric, hyphens, underscores, dots only
  if (!/^[a-zA-Z0-9_.\-]+$/.test(id)) return null;
  return id;
}

function runCmd(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        const wrapped = new Error(stderr?.trim() || err.message || 'Docker command failed.');
        wrapped.code = 'DOCKER_COMMAND_FAILED';
        return reject(wrapped);
      }
      resolve(stdout.trim());
    });
  });
}

function parseJsonLines(output) {
  if (!output) return [];
  return output
    .split('\n')
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * GET /api/docker/containers
 */
router.get('/containers', async (req, res) => {
  try {
    const output = await runCmd('docker ps -a --format "{{json .}}"');
    if (!output) return res.json({ containers: [] });
    const containers = parseJsonLines(output);
    res.json({ containers });
  } catch (err) {
    res.json({ containers: [], error: 'Docker not available or not running.' });
  }
});

/**
 * GET /api/docker/logs?id=<container>&tail=200
 */
router.get('/logs', async (req, res) => {
  try {
    const id = sanitizeId(String(req.query.id || '').trim());
    if (!id) {
      return res.status(400).json({ error: true, code: 'DOCKER_CONTAINER_ID_INVALID', message: 'Invalid container ID.' });
    }
    const tail = Number.isFinite(Number(req.query.tail)) ? Math.max(20, Math.min(1000, Number(req.query.tail))) : 200;
    const output = await runCmd(`docker logs --tail ${tail} ${id} 2>&1`);
    const lines = output ? output.split('\n').filter(Boolean) : [];
    return res.json({ success: true, id, lines });
  } catch (err) {
    return res.status(500).json({ error: true, code: 'DOCKER_LOGS_FETCH_FAILED', message: err.message });
  }
});

/**
 * GET /api/docker/volumes
 */
router.get('/volumes', async (_req, res) => {
  try {
    const output = await runCmd('docker volume ls --format "{{json .}}"');
    const volumes = parseJsonLines(output);
    return res.json({ success: true, volumes });
  } catch (err) {
    return res.status(500).json({ error: true, code: 'DOCKER_VOLUMES_FETCH_FAILED', message: err.message });
  }
});

/**
 * GET /api/docker/compose/projects
 */
router.get('/compose/projects', async (_req, res) => {
  try {
    const output = await runCmd('docker compose ls --format json');
    const projects = parseJsonLines(output);
    return res.json({ success: true, projects });
  } catch (err) {
    return res.status(500).json({ error: true, code: 'DOCKER_COMPOSE_FETCH_FAILED', message: err.message });
  }
});

/**
 * POST /api/docker/start
 */
router.post('/start', async (req, res) => {
  try {
    const id = sanitizeId(req.body.id);
    if (!id) return res.status(400).json({ error: true, message: 'Invalid container ID.' });
    await runCmd(`docker start ${id}`);
    res.json({ success: true, message: `Container ${id} started.` });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * POST /api/docker/stop
 */
router.post('/stop', async (req, res) => {
  try {
    const id = sanitizeId(req.body.id);
    if (!id) return res.status(400).json({ error: true, message: 'Invalid container ID.' });
    await runCmd(`docker stop ${id}`);
    res.json({ success: true, message: `Container ${id} stopped.` });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * POST /api/docker/restart
 */
router.post('/restart', async (req, res) => {
  try {
    const id = sanitizeId(req.body.id);
    if (!id) return res.status(400).json({ error: true, message: 'Invalid container ID.' });
    await runCmd(`docker restart ${id}`);
    res.json({ success: true, message: `Container ${id} restarted.` });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * DELETE /api/docker/remove
 */
router.delete('/remove', async (req, res) => {
  try {
    const id = sanitizeId(req.body.id);
    if (!id) return res.status(400).json({ error: true, message: 'Invalid container ID.' });
    await runCmd(`docker rm -f ${id}`);
    res.json({ success: true, message: `Container ${id} removed.` });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

module.exports = router;
