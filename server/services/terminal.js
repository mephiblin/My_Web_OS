const os = require('os');

let pty = null;
try {
  pty = require('node-pty');
} catch (_err) {
  pty = null;
}

const sessions = new Map();

/**
 * Terminal Service
 * Manages node-pty sessions and syncs them with Socket.io.
 */
function initTerminalService(io) {
  io.on('connection', (socket) => {
    socket.on('terminal:init', ({ cols, rows }) => {
      if (!pty) {
        socket.emit('terminal:output', 'Terminal service is running in fallback mode because node-pty is unavailable.\r\n');
        socket.emit('terminal:exit', { exitCode: 0, signal: null });
        return;
      }

      const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
      
      const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: cols || 80,
        rows: rows || 24,
        cwd: process.env.HOME || process.env.USERPROFILE,
        env: process.env
      });

      const sessionId = socket.id;
      sessions.set(sessionId, ptyProcess);

      ptyProcess.onData((data) => {
        socket.emit('terminal:output', data);
      });

      ptyProcess.onExit(({ exitCode, signal }) => {
        socket.emit('terminal:exit', { exitCode, signal });
        sessions.delete(sessionId);
      });

      console.log(`Terminal session started for socket ${socket.id}`);
    });

    socket.on('terminal:input', (data) => {
      const ptyProcess = sessions.get(socket.id);
      if (ptyProcess) {
        ptyProcess.write(data);
      }
    });

    socket.on('terminal:resize', ({ cols, rows }) => {
      const ptyProcess = sessions.get(socket.id);
      if (ptyProcess) {
        ptyProcess.resize(cols, rows);
      }
    });

    socket.on('disconnect', () => {
      const ptyProcess = sessions.get(socket.id);
      if (ptyProcess) {
        ptyProcess.kill();
        sessions.delete(socket.id);
        console.log(`Terminal session killed for socket ${socket.id}`);
      }
    });
  });
}
function getActiveSessions() {
  return sessions;
}

module.exports = { initTerminalService, getActiveSessions };
