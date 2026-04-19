const express = require('express');
const router = express.Router();
const shareService = require('../services/shareService');
const auth = require('../middleware/auth');
const fs = require('fs-extra');
const path = require('path');
const auditService = require('../services/auditService');

// ==========================
// PUBLIC ENDPOINTS (No Auth)
// ==========================

router.get('/info/:id', (req, res) => {
  const share = shareService.getShare(req.params.id);
  if (!share) return res.status(404).json({ error: true, message: 'Invalid or expired link' });
  
  res.json({
    id: share.id,
    name: share.name,
    createdAt: share.createdAt,
    expiryDate: share.expiryDate
  });
});

router.get('/download/:id', async (req, res) => {
  const share = shareService.getShare(req.params.id);
  if (!share) return res.status(404).json({ error: true, message: 'Invalid or expired link' });

  try {
     const stats = await fs.stat(share.path);
     if (stats.isDirectory()) {
         return res.status(400).json({ error: true, message: 'Cannot download directory' });
     }
     res.download(share.path, share.name);
     auditService.log('SHARE', 'DOWNLOAD', { shareId: share.id, path: share.path, ip: req.ip });
  } catch (err) {
     res.status(500).json({ error: true, message: 'File access error' });
  }
});

// ==========================
// PROTECTED ENDPOINTS (Auth)
// ==========================

router.use(auth);

const pathGuard = require('../middleware/pathGuard');

router.post('/create', pathGuard, async (req, res) => {
  const targetPath = req.safePath; 
  if (!targetPath) return res.status(400).json({ error: true, message: 'Path is required' });

  try {
    const { expiryHours } = req.body;
    const hours = parseInt(expiryHours) || 0;
    
    const linkId = await shareService.createShare(targetPath, hours);
    res.json({ success: true, linkId });
  } catch (e) {
    res.status(500).json({ error: true, message: e.message });
  }
});

module.exports = router;
