const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const cloudService = require('../services/cloudService');

router.use(auth);
// Get available cloud providers
router.get('/providers', async (req, res) => {
  const providers = await cloudService.listProviders();
  res.json(providers);
});

// Get currently configured remotes
router.get('/remotes', async (req, res) => {
  const remotes = await cloudService.listRemotes();
  res.json(remotes);
});

// Setup a new cloud remote
router.post('/setup', async (req, res) => {
  const { name, provider } = req.body;
  if (!name || !provider) {
    return res.status(400).json({ error: 'Name and provider are required' });
  }
  const result = await cloudService.setupRemote(name, provider);
  res.json(result);
});

// List entries in a remote
router.get('/list', async (req, res) => {
  const { remote, path: remotePath } = req.query;
  try {
    const items = await cloudService.listEntries(remote, remotePath || '');
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

// Read file content from a remote
router.get('/read', async (req, res) => {
  const { remote, path: remotePath } = req.query;
  try {
    const content = await cloudService.getFileContent(remote, remotePath);
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

// Setup a new WebDAV connection
router.post('/add-webdav', async (req, res) => {
  const { name, url, user, pass } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'Name and URL are required' });
  try {
    await cloudService.addWebDAV(name, url, user, pass);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

module.exports = router;
