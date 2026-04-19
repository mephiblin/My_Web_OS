const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const auditService = require('../services/auditService');

router.use(auth);
// Get latest logs
router.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const type = req.query.type; // Optional filter: SYSTEM, FS, AUTH
    
    let logs = await auditService.getLogs(limit);
    
    if (type && type !== 'ALL') {
      logs = logs.filter(l => l.type === type);
    }
    
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
