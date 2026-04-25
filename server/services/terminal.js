const os = require('os');
const jwt = require('jsonwebtoken');
const auditService = require('./auditService');

let pty = null;
try {
  pty = require('node-pty');
} catch (_err) {
  pty = null;
}

const sessions = new Map();

function sanitizeCommand(command) {
  const value = String(command || '').replace(/\s+/g, ' ').trim();
  return value.slice(0, 280);
}

function resolveSocketUser(socket) {
  const token =
    String(socket.handshake?.auth?.token || '').trim()
    || String(socket.handshake?.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();

  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (_err) {
    return null;
  }
}

/**
 * Terminal Service
 * Manages node-pty sessions and syncs them with Socket.io.
 */
function initTerminalService(io) {
  io.on('connection', (socket) => {
    const user = resolveSocketUser(socket);
    socket.data = socket.data || {};
    socket.data.user = user || null;

    socket.on('terminal:init', ({ cols, rows } = {}) => {
      if (!socket.data.user?.username) {
        auditService.log(
          'SYSTEM',
          'Terminal: Session Rejected (Auth Required)',
          { socketId: socket.id },
          'WARNING'
        ).catch(() => {});
        socket.emit('terminal:output', 'Authentication required. Please sign in again.\r\n');
        socket.emit('terminal:exit', { exitCode: 1, signal: 'AUTH_REQUIRED' });
        socket.disconnect(true);
        return;
      }

      if (!pty) {
        auditService.log(
          'SYSTEM',
          'Terminal: Fallback Session Initialized',
          { socketId: socket.id, user: socket.data.user.username },
          'WARNING'
        ).catch(() => {});
        socket.emit('terminal:output', 'Terminal service is running in fallback mode because node-pty is unavailable.\r\n');
        socket.emit('terminal:exit', { exitCode: 0, signal: null });
        return;
      }

      const existing = sessions.get(socket.id);
      if (existing) {
        try {
          existing.kill();
        } catch (_err) {}
        sessions.delete(socket.id);
      }

      const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
      
      const terminalEnv = {
        ...process.env,
        LANG: process.env.LANG || 'C.UTF-8',
        LC_ALL: process.env.LC_ALL || process.env.LANG || 'C.UTF-8',
        TERM: process.env.TERM || 'xterm-256color'
      };

      const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: cols || 80,
        rows: rows || 24,
        cwd: process.env.HOME || process.env.USERPROFILE,
        env: terminalEnv
      });

      const sessionId = socket.id;
      sessions.set(sessionId, ptyProcess);
      auditService.log(
        'SYSTEM',
        'Terminal: Session Started',
        { socketId: sessionId, user: socket.data.user.username },
        'INFO'
      ).catch(() => {});

      ptyProcess.onData((data) => {
        socket.emit('terminal:output', data);
      });

      ptyProcess.onExit(({ exitCode, signal }) => {
        socket.emit('terminal:exit', { exitCode, signal });
        sessions.delete(sessionId);
        auditService.log(
          'SYSTEM',
          'Terminal: Session Ended',
          { socketId: sessionId, exitCode, signal, user: socket.data.user?.username || null },
          exitCode === 0 ? 'INFO' : 'WARNING'
        ).catch(() => {});
      });

      socket.emit('terminal:ready', {
        shell,
        cwd: process.env.HOME || process.env.USERPROFILE || ''
      });
      console.log(`Terminal session started for socket ${socket.id}`);
    });

    socket.on('terminal:input', (data) => {
      const ptyProcess = sessions.get(socket.id);
      if (ptyProcess) {
        ptyProcess.write(data);
      }
    });

    socket.on('terminal:approval', (payload = {}) => {
      const command = sanitizeCommand(payload.command);
      const approved = payload.approved === true;
      if (!command) return;
      auditService.log(
        'SYSTEM',
        approved ? 'Terminal: Risky Command Approved' : 'Terminal: Risky Command Rejected',
        {
          socketId: socket.id,
          user: socket.data.user?.username || null,
          command
        },
        approved ? 'WARNING' : 'INFO'
      ).catch(() => {});
    });

    socket.on('terminal:resize', ({ cols, rows } = {}) => {
      const ptyProcess = sessions.get(socket.id);
      if (ptyProcess) {
        const nextCols = Number.isFinite(Number(cols)) ? Math.max(10, Number(cols)) : 80;
        const nextRows = Number.isFinite(Number(rows)) ? Math.max(5, Number(rows)) : 24;
        ptyProcess.resize(nextCols, nextRows);
      }
    });

    socket.on('disconnect', () => {
      const ptyProcess = sessions.get(socket.id);
      if (ptyProcess) {
        ptyProcess.kill();
        sessions.delete(socket.id);
        auditService.log(
          'SYSTEM',
          'Terminal: Session Killed On Disconnect',
          { socketId: socket.id, user: socket.data.user?.username || null },
          'WARNING'
        ).catch(() => {});
        console.log(`Terminal session killed for socket ${socket.id}`);
      }
    });
  });
}
function getActiveSessions() {
  return sessions;
}

module.exports = { initTerminalService, getActiveSessions };
