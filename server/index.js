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

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/fs', fsRouter);
app.use('/api/system', sysRouter);
app.use('/api/auth', authRouter);
app.use('/api/docker', dockerRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/cloud', cloudRouter);
app.use('/api/media', mediaRouter);

// Static files for Inventory
app.use('/api/inventory-files', express.static(path.join(__dirname, 'storage/inventory')));




// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

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
