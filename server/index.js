const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const rateLimit = require('express-rate-limit');
const path = require('path');


const { initTerminalService } = require('./services/terminal');

dotenv.config();

const indexService = require('./services/indexService');
const trashService = require('./services/trashService');
const shareService = require('./services/shareService');

// Initialize Services
indexService.init();
trashService.init();
shareService.init();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Initialize Terminal Service
initTerminalService(io);


const fsRouter = require('./routes/fs');
const sysRouter = require('./routes/system');
const authRouter = require('./routes/auth');
const dockerRouter = require('./routes/docker');
const settingsRouter = require('./routes/settings');
const cloudRouter = require('./routes/cloud');
const mediaRouter = require('./routes/media');
const logsRouter = require('./routes/logs');
const shareRouter = require('./routes/share');

// Middleware
// app.use(helmet());
app.use(cors());
app.use(express.json());

// Request Logger for Debugging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[REQ] ${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// Rate Limiting (must be BEFORE routes to take effect)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 10000
});
app.use('/api/', limiter);

// Routes
app.use('/api/fs', fsRouter);
app.use('/api/system', sysRouter);
app.use('/api/auth', authRouter);
app.use('/api/docker', dockerRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/cloud', cloudRouter);
app.use('/api/media', mediaRouter);
app.use('/api/logs', logsRouter);
app.use('/api/share', shareRouter);

// Static files for Inventory
app.use('/api/inventory-files', express.static(path.join(__dirname, 'storage/inventory')));

// Basic Route
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Socket.io connection
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Web OS Server running on port ${PORT}`);
});

// Graceful Shutdown
async function shutdown() {
  console.log('\n[SERVER] Shutting down gracefully...');
  
  // Stop background services
  await indexService.close();
  
  // Kill all terminal sessions
  const { getActiveSessions } = require('./services/terminal');
  if (getActiveSessions) {
    const sessions = getActiveSessions();
    for (const [id, pty] of sessions) {
      pty.kill();
      console.log(`[TERMINAL] Killed session ${id}`);
    }
  }
  
  server.close(() => {
    console.log('[SERVER] Closed');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('[SERVER] Could not close in time, forcing shutdown');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
