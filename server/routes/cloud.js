const express = require('express');
const router = express.Router();
const cloudService = require('../services/cloudService');

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

// Mount (serve) a remote
router.post('/mount', async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Remote name is required' });
  }
  const result = await cloudService.mountRemote(name);
  res.json(result);
});

module.exports = router;
