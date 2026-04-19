const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Fetch from environment variables. Fallbacks shouldn't be hardcoded passwords.
const ADMIN_USER = {
  username: process.env.ADMIN_USERNAME,
  passwordHash: bcrypt.hashSync(process.env.ADMIN_PASSWORD || '', 8)
};

const auditService = require('../services/auditService');

/**
 * POST /api/auth/login
 */
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (username !== ADMIN_USER.username || !bcrypt.compareSync(password, ADMIN_USER.passwordHash)) {
    await auditService.log('CONNECTION', 'Login failed', { 
      user: username || 'unknown',
      ip: req.ip || req.headers['x-forwarded-for'],
      reason: 'Invalid credentials'
    }, 'WARNING');
    return res.status(401).json({ error: true, message: 'Invalid credentials' });
  }

  const token = jwt.sign({ username }, process.env.JWT_SECRET, {
    expiresIn: '24h'
  });

  await auditService.log('CONNECTION', 'User logged in', { user: username }, 'INFO');

  res.json({ success: true, token });
});

/**
 * GET /api/auth/verify
 */
router.get('/verify', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send();

  const token = authHeader.split(' ')[1];
  try {
    jwt.verify(token, process.env.JWT_SECRET);
    res.json({ success: true });
  } catch (err) {
    res.status(401).send();
  }
});

module.exports = router;
