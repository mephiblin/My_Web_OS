import { io } from 'socket.io-client';
import { API_BASE } from '../../../../utils/constants.js';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

function createInitialState() {
  return {
    initialized: false,
    connected: false,
    sessionRequested: false,
    sessionStarting: false,
    sessionError: '',
    sessionPreflight: null
  };
}

function normalizeSize(size = {}) {
  return {
    cols: Number.isFinite(Number(size.cols)) ? Number(size.cols) : DEFAULT_COLS,
    rows: Number.isFinite(Number(size.rows)) ? Number(size.rows) : DEFAULT_ROWS
  };
}

export function createTerminalSessionClient({
  getTerminalSize,
  write,
  writeln,
  getToken = () => localStorage.getItem('web_os_token'),
  apiBase = API_BASE,
  onStateChange = () => {}
} = {}) {
  let socket = null;
  let hasConnectedOnce = false;
  let commandBuffer = '';
  const state = createInitialState();

  function emitState(patch = {}) {
    Object.assign(state, patch);
    onStateChange({ ...state });
  }

  function currentSize() {
    return normalizeSize(typeof getTerminalSize === 'function' ? getTerminalSize() : {});
  }

  function writeTerminalLine(message) {
    if (typeof writeln === 'function') {
      writeln(message);
    }
  }

  function writeTerminal(data) {
    if (typeof write === 'function') {
      write(data);
    }
  }

  function waitForSocketEvent(eventName, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      if (!socket) {
        reject(new Error('Terminal socket is not connected.'));
        return;
      }
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`${eventName} timed out.`));
      }, timeoutMs);
      const onSuccess = (payload) => {
        cleanup();
        resolve(payload || {});
      };
      const onError = (payload = {}) => {
        cleanup();
        reject(new Error(payload.message || 'Terminal approval failed.'));
      };
      function cleanup() {
        clearTimeout(timer);
        socket.off(eventName, onSuccess);
        socket.off('terminal:error', onError);
      }
      socket.once(eventName, onSuccess);
      socket.once('terminal:error', onError);
    });
  }

  async function requestSessionPreflight() {
    if (!socket || state.sessionStarting || state.initialized) return;
    emitState({
      sessionStarting: true,
      sessionError: '',
      sessionPreflight: null
    });
    try {
      socket.emit('terminal:session-preflight', currentSize());
      const preflight = await waitForSocketEvent('terminal:session-preflight');
      emitState({ sessionPreflight: preflight });
    } catch (err) {
      const sessionError = err.message || 'Terminal session preflight failed.';
      emitState({ sessionError });
      writeTerminalLine(`\r\n\x1b[31m[terminal] ${sessionError}\x1b[0m`);
    } finally {
      emitState({ sessionStarting: false });
    }
  }

  async function approveAndStartSession(typedConfirmation) {
    if (!socket || state.sessionStarting || state.initialized || !state.sessionPreflight) return;
    emitState({
      sessionStarting: true,
      sessionError: ''
    });
    try {
      const sizing = currentSize();
      const preflight = state.sessionPreflight;
      socket.emit('terminal:session-approve', {
        ...sizing,
        operationId: preflight.operationId,
        typedConfirmation
      });
      const approval = await waitForSocketEvent('terminal:session-approval');
      socket.emit('terminal:init', {
        ...sizing,
        approval: {
          operationId: approval.operationId,
          nonce: approval.nonce,
          targetHash: approval.targetHash || preflight.targetHash
        }
      });
    } catch (err) {
      const sessionError = err.message || 'Terminal session approval failed.';
      emitState({ sessionError });
      writeTerminalLine(`\r\n\x1b[31m[terminal] ${sessionError}\x1b[0m`);
    } finally {
      emitState({ sessionStarting: false });
    }
  }

  function connectSocket() {
    if (socket) return socket;
    socket = io(apiBase, {
      auth: { token: getToken() },
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 600
    });

    socket.on('connect', () => {
      emitState({
        connected: true,
        initialized: false,
        sessionPreflight: null
      });
      writeTerminalLine(hasConnectedOnce
        ? '\x1b[32mReconnected to Web OS Terminal. Starting a new local shell...\x1b[0m'
        : '\x1b[32mConnected to Web OS Terminal\x1b[0m'
      );
      hasConnectedOnce = true;
      if (state.sessionRequested) requestSessionPreflight();
      commandBuffer = '';
    });

    socket.on('disconnect', (reason) => {
      writeTerminalLine(`\r\n\x1b[33m[terminal] disconnected: ${reason}\x1b[0m`);
      emitState({ connected: false, initialized: false });
    });

    socket.on('connect_error', (error) => {
      writeTerminalLine(`\r\n\x1b[31m[terminal] connection failed: ${error?.message || 'unknown error'}\x1b[0m`);
    });

    socket.on('terminal:output', (data) => {
      writeTerminal(data);
    });

    socket.on('terminal:ready', ({ cwd } = {}) => {
      emitState({
        initialized: true,
        sessionError: '',
        sessionPreflight: null
      });
      if (cwd) {
        writeTerminalLine(`\r\n\x1b[36m[terminal] local shell ready: ${cwd}\x1b[0m`);
      }
    });

    socket.on('terminal:error', ({ message } = {}) => {
      if (message) emitState({ sessionError: message });
    });

    socket.on('terminal:exit', ({ exitCode, signal }) => {
      writeTerminalLine(`\r\n\x1b[33m[terminal] session ended (exit=${exitCode}, signal=${signal || '-'})\x1b[0m`);
      emitState({ initialized: false });
    });

    return socket;
  }

  function requestSession() {
    emitState({ sessionRequested: true });
    if (!socket) {
      connectSocket();
      return;
    }
    if (socket.connected) requestSessionPreflight();
  }

  function sendInput(data) {
    if (!socket || !state.initialized) return;

    if (data === '\r') {
      socket.emit('terminal:input', data);
      commandBuffer = '';
      return;
    }

    if (data === '\u007f') {
      if (commandBuffer.length > 0) {
        commandBuffer = commandBuffer.slice(0, -1);
      }
      socket.emit('terminal:input', data);
      return;
    }

    if (data === '\u0003') {
      commandBuffer = '';
      socket.emit('terminal:input', data);
      return;
    }

    if (data === '\u0015') {
      commandBuffer = '';
      socket.emit('terminal:input', data);
      return;
    }

    if (data.length === 1 && data >= ' ') {
      commandBuffer += data;
    }

    socket.emit('terminal:input', data);
  }

  function resize(size = currentSize()) {
    if (socket && state.initialized) {
      socket.emit('terminal:resize', normalizeSize(size));
    }
  }

  function disconnect() {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    emitState({ connected: false, initialized: false });
  }

  return {
    getState: () => ({ ...state }),
    requestSession,
    requestSessionPreflight,
    approveAndStartSession,
    connectSocket,
    sendInput,
    resize,
    disconnect
  };
}
