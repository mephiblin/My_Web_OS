const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const { verifyToken } = require('./auth');

const ENV_PATH = path.join(__dirname, '../../.env');

// Parse .env file
async function readEnv() {
  try {
    const raw = await fs.readFile(ENV_PATH, 'utf-8');
    const lines = raw.split('\n');
    const env = {};
    for (const line of lines) {
      if (!line || line.startsWith('#')) continue;
      const [key, ...valParts] = line.split('=');
      if (key) {
        env[key.trim()] = valParts.join('=').trim();
      }
    }
    return env;
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

// Write .env file
async function writeEnv(envObj) {
  const lines = [];
  for (const [key, val] of Object.entries(envObj)) {
    lines.push(`${key}=${val}`);
  }
  await fs.writeFile(ENV_PATH, lines.join('\n'));
}

router.get('/', verifyToken, async (req, res) => {
  try {
    const env = await readEnv();
    // In a real prod setup we'd maybe strip JWT_SECRET, but OS admin has full rights.
    res.json({ success: true, settings: env });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/', verifyToken, async (req, res) => {
  try {
    const updates = req.body; // e.g. { ADMIN_USERNAME: 'newadmin', PORT: 3000 }
    const current = await readEnv();
    
    const merged = { ...current, ...updates };
    await writeEnv(merged);

    // Some vars are cached in process.env, let's update them
    for (const [key, val] of Object.entries(updates)) {
      process.env[key] = val;
    }

    res.json({ success: true, message: 'Settings saved successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
