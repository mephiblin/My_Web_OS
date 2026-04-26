const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const rateLimit = require('express-rate-limit');
const serverConfig = require('./config/serverConfig');
const ServiceManager = require('./services/serviceManager');

dotenv.config();


const { initTerminalService } = require('./services/terminal');

const indexService = require('./services/indexService');
const trashService = require('./services/trashService');
const shareService = require('./services/shareService');
const auditService = require('./services/auditService');
const runtimeManager = require('./services/runtimeManager');
const mediaLibraryPaths = require('./utils/mediaLibraryPaths');
const { redactUrl } = require('./utils/urlRedaction');

const fsRouter = require('./routes/fs');
const sysRouter = require('./routes/system');
const authRouter = require('./routes/auth');
const dockerRouter = require('./routes/docker');
const settingsRouter = require('./routes/settings');
const cloudRouter = require('./routes/cloud');
const mediaRouter = require('./routes/media');
const logsRouter = require('./routes/logs');
const packagesRouter = require('./routes/packages');
const shareRouter = require('./routes/share');
const servicesRouter = require('./routes/services');
const sandboxRouter = require('./routes/sandbox');
const runtimeRouter = require('./routes/runtime');
const transferRouter = require('./routes/transfer');
const aiRouter = require('./routes/ai');

async function bootstrap() {
  const config = await serverConfig.getAll();
  const validation = await serverConfig.validate({ strict: false });
  if (!validation.ok) {
    console.warn(`[CONFIG] Missing required keys: ${validation.missing.join(', ')}`);
  }

  const serviceManager = new ServiceManager();
  serviceManager.register(indexService);
  serviceManager.register(trashService);
  serviceManager.register(shareService);
  serviceManager.register(auditService);
  serviceManager.register(runtimeManager);
  await serviceManager.startAll();

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: config.server.corsOrigin,
      methods: ['GET', 'POST']
    }
  });

  // Initialize Terminal Service
  initTerminalService(io);

  // Middleware
  app.disable('x-powered-by');
  if (config.server.trustProxyHops > 0) {
    app.set('trust proxy', config.server.trustProxyHops);
  }
  if (config.server.nodeEnv === 'production') {
    app.use(helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false
    }));
  }
  app.use(cors({ origin: config.server.corsOrigin }));
  app.use(express.json());

  // Request Logger for Debugging
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`[REQ] ${req.method} ${redactUrl(req.originalUrl || req.url)} - ${res.statusCode} (${duration}ms)`);
    });
    next();
  });

  // Rate Limiting (must be BEFORE routes to take effect)
  const limiter = rateLimit({
    windowMs: config.server.rateLimitWindowMs,
    max: config.server.rateLimitMax
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
  app.use('/api/packages', packagesRouter);
  app.use('/api/share', shareRouter);
  app.use('/api/services', servicesRouter);
  app.use('/api/sandbox', sandboxRouter);
  app.use('/api/runtime', runtimeRouter);
  app.use('/api/transfer', transferRouter);
  app.use('/api/ai', aiRouter);

  app.set('serviceManager', serviceManager);
  app.set('runtimeManager', runtimeManager);

  app.use('/api/inventory-files', (_req, res) => {
    res.status(410).json({
      error: true,
      code: 'INVENTORY_STATIC_DISABLED',
      message: 'Direct inventory file serving is disabled. Use package, sandbox, or system APIs.',
      details: null
    });
  });
  await mediaLibraryPaths.ensureMediaLibraryStructure();
  const mediaLibraryRoot = await mediaLibraryPaths.getMediaLibraryRoot();
  app.use('/api/media-library-files', express.static(mediaLibraryRoot));

  // Basic Route
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      services: serviceManager.getStatusSnapshot()
    });
  });

  // Socket.io connection
  io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
    });
  });

  const port = config.server.port;
  server.listen(port, () => {
    console.log(`Web OS Server running on port ${port}`);
  });

  // Graceful Shutdown
  async function shutdown() {
    console.log('\n[SERVER] Shutting down gracefully...');

    // Stop managed services first
    try {
      await serviceManager.stopAll();
    } catch (err) {
      console.error('[SERVER] Service shutdown reported errors:', err.details || err.message);
    }

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
}

bootstrap().catch((err) => {
  console.error('[SERVER] Bootstrap failed:', err);
  process.exit(1);
});
