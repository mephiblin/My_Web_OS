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
      if (err) return reject(err);
      resolve(stdout.trim());
    });
  });
}

/**
 * GET /api/docker/containers
 */
router.get('/containers', async (req, res) => {
  try {
    const output = await runCmd('docker ps -a --format "{{json .}}"');
    if (!output) return res.json({ containers: [] });
    const containers = output.split('\n').map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
    res.json({ containers });
  } catch (err) {
    res.json({ containers: [], error: 'Docker not available or not running.' });
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
