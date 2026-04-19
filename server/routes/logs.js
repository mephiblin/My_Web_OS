const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const auditService = require('../services/auditService');

router.use(auth);
// Get latest logs
router.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const category = req.query.category || req.query.type; // Backward compatibility
    const level = req.query.level;
    const search = req.query.search;
    
    const logs = await auditService.getLogs({ limit, category, level, search });
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clear logs (Optional)
router.delete('/', async (req, res) => {
  // logic to clear audit.json if needed
  res.json({ message: 'Log clearing not implemented for safety' });
});

module.exports = router;
