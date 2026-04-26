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
  getAppAccessGrant = () => null,
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

  function currentAppAccessGrant() {
    const grant = typeof getAppAccessGrant === 'function' ? getAppAccessGrant() : null;
    if (!grant?.grantId || !grant?.appInstanceId) return null;
    return {
      grantId: grant.grantId,
      appInstanceId: grant.appInstanceId
    };
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

  async function startSessionWithAppAccess() {
    if (!socket || state.sessionStarting || state.initialized) return false;
    const appAccess = currentAppAccessGrant();
    if (!appAccess) return false;
    emitState({
      sessionStarting: true,
      sessionError: '',
      sessionPreflight: null
    });
    try {
      socket.emit('terminal:init', {
        ...currentSize(),
        appAccess
      });
      return true;
    } catch (err) {
      const sessionError = err.message || 'Terminal session start failed.';
      emitState({ sessionError });
      writeTerminalLine(`\r\n\x1b[31m[terminal] ${sessionError}\x1b[0m`);
      return false;
    } finally {
      emitState({ sessionStarting: false });
    }
  }

  async function requestSessionStart() {
    if (await startSessionWithAppAccess()) return;
    requestSessionPreflight();
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
      if (state.sessionRequested) requestSessionStart();
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
    if (socket.connected) requestSessionStart();
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

export function createTerminalAppAccessClient({
  getToken = () => localStorage.getItem('web_os_token'),
  apiBase = API_BASE
} = {}) {
  let socket = null;

  function connectSocket() {
    if (socket) return socket;
    socket = io(apiBase, {
      auth: { token: getToken() },
      reconnection: true,
      reconnectionAttempts: 4,
      reconnectionDelay: 600
    });
    return socket;
  }

  function waitForConnect(timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const activeSocket = connectSocket();
      if (activeSocket.connected) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Terminal approval socket connection timed out.'));
      }, timeoutMs);
      const onConnect = () => {
        cleanup();
        resolve();
      };
      const onConnectError = (error) => {
        cleanup();
        reject(new Error(error?.message || 'Terminal approval socket connection failed.'));
      };
      function cleanup() {
        clearTimeout(timer);
        activeSocket.off('connect', onConnect);
        activeSocket.off('connect_error', onConnectError);
      }
      activeSocket.once('connect', onConnect);
      activeSocket.once('connect_error', onConnectError);
    });
  }

  function waitForSocketEvent(eventName, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      if (!socket) {
        reject(new Error('Terminal approval socket is not connected.'));
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

  async function requestPreflight(appInstanceId) {
    await waitForConnect();
    socket.emit('terminal:app-access-preflight', { appInstanceId });
    return waitForSocketEvent('terminal:app-access-preflight');
  }

  async function approveAccess(preflight, typedConfirmation) {
    await waitForConnect();
    socket.emit('terminal:app-access-approve', {
      appInstanceId: preflight?.evidence?.appInstanceId || preflight?.target?.id,
      operationId: preflight?.operationId,
      typedConfirmation
    });
    return waitForSocketEvent('terminal:app-access-grant');
  }

  function disconnect() {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
  }

  return {
    requestPreflight,
    approveAccess,
    disconnect
  };
}
