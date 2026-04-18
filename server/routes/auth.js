const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// For this local Web OS, we'll use a hardcoded admin credential or first-run setup.
// Here we'll just use 'admin' / 'admin123' for demonstration.
const ADMIN_USER = {
  username: 'admin',
  passwordHash: bcrypt.hashSync('admin123', 8)
};

/**
 * POST /api/auth/login
 */
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (username !== ADMIN_USER.username || !bcrypt.compareSync(password, ADMIN_USER.passwordHash)) {
    return res.status(401).json({ error: true, message: 'Invalid credentials' });
  }

  const token = jwt.sign({ username }, process.env.JWT_SECRET, {
    expiresIn: '24h'
  });

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
