const express = require('express');
const router = express.Router();
const fs = require('fs-extra');
const path = require('path');
const pathGuard = require('../middleware/pathGuard');
const auth = require('../middleware/auth');

// Note: In a real-world scenario, you'd add auth middleware here:
// router.use(auth);
router.use(pathGuard);

/**
 * GET /api/fs/list
 * List directory contents
 */
router.get('/list', async (req, res) => {
  try {
    const targetPath = req.safePath;
    const stats = await fs.stat(targetPath);

    if (!stats.isDirectory()) {
      return res.status(400).json({ error: true, message: 'Path is not a directory.' });
    }

    const files = await fs.readdir(targetPath);
    const details = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(targetPath, file);
        try {
          const fileStats = await fs.stat(filePath);
          return {
            name: file,
            path: filePath,
            isDirectory: fileStats.isDirectory(),
            size: fileStats.size,
            mtime: fileStats.mtime,
            birthtime: fileStats.birthtime,
          };
        } catch (err) {
          return { name: file, error: 'Could not retrieve stats' };
        }
      })
    );

    res.json({ path: targetPath, items: details });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * GET /api/fs/read
 * Read file content
 */
router.get('/read', async (req, res) => {
  try {
    const targetPath = req.safePath;
    const stats = await fs.stat(targetPath);

    if (stats.isDirectory()) {
      return res.status(400).json({ error: true, message: 'Cannot read a directory as a file.' });
    }

    const content = await fs.readFile(targetPath, 'utf8');
    res.json({ path: targetPath, content });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * POST /api/fs/write
 * Create or update file content
 */
router.post('/write', async (req, res) => {
  try {
    const targetPath = req.safePath;
    const { content } = req.body;

    await fs.writeFile(targetPath, content || '', 'utf8');
    res.json({ success: true, message: 'File saved successfully.' });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * DELETE /api/fs/delete
 * Delete file or directory
 */
router.delete('/delete', async (req, res) => {
  try {
    const targetPath = req.safePath;
    await fs.remove(targetPath);
    res.json({ success: true, message: 'Item deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * POST /api/fs/create-dir
 * Create a new directory
 */
router.post('/create-dir', async (req, res) => {
  try {
    const targetPath = req.safePath;
    await fs.ensureDir(targetPath);
    res.json({ success: true, message: 'Directory created successfully.' });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

module.exports = router;
