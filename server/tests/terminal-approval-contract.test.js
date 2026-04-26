const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'terminal-test-secret';

const operationApprovalService = require('../services/operationApprovalService');
const terminalService = require('../services/terminal');

function signToken(username) {
  return jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

class MockSocket extends EventEmitter {
  constructor(id, username = 'admin') {
    super();
    this.id = id;
    this.data = {};
    this.handshake = {
      auth: { token: signToken(username) },
      headers: { 'user-agent': 'terminal-contract-test' },
      address: '127.0.0.1'
    };
    this.emitted = [];
    this.disconnected = false;
  }

  emit(event, ...args) {
    if (event.startsWith('terminal:')) {
      this.emitted.push({ event, args });
      return true;
    }
    return super.emit(event, ...args);
  }

  clientEmit(event, payload) {
    return EventEmitter.prototype.emit.call(this, event, payload);
  }

  disconnect() {
    this.disconnected = true;
  }

  findEvent(event) {
    return this.emitted.find((item) => item.event === event)?.args?.[0] || null;
  }
}

function createIo(socket) {
  return {
    on(event, handler) {
      assert.equal(event, 'connection');
      handler(socket);
    }
  };
}

function createFakePty() {
  const writes = [];
  const processes = [];
  return {
    writes,
    processes,
    spawn(shell, args, options) {
      const proc = {
        shell,
        args,
        options,
        killed: false,
        dataHandler: null,
        exitHandler: null,
        write(data) {
          writes.push(data);
        },
        resize(cols, rows) {
          this.options.cols = cols;
          this.options.rows = rows;
        },
        kill() {
          this.killed = true;
        },
        onData(handler) {
          this.dataHandler = handler;
        },
        onExit(handler) {
          this.exitHandler = handler;
        }
      };
      processes.push(proc);
      return proc;
    }
  };
}

test('terminal init and input are blocked until a session approval nonce is consumed', () => {
  operationApprovalService._resetForTests();
  terminalService._resetForTests();
  const fakePty = createFakePty();
  terminalService._setPtyForTests(fakePty);
  const socket = new MockSocket('socket-terminal-block', 'admin');
  terminalService.initTerminalService(createIo(socket));

  socket.clientEmit('terminal:init', { cols: 80, rows: 24 });
  const error = socket.findEvent('terminal:error');
  assert.equal(error?.code, 'TERMINAL_SESSION_APPROVAL_REQUIRED', JSON.stringify(socket.emitted));
  assert.equal(fakePty.processes.length, 0);

  socket.clientEmit('terminal:input', 'echo should-not-write\n');
  const inputError = socket.emitted.filter((item) => item.event === 'terminal:error').at(-1)?.args?.[0];
  assert.equal(inputError?.code, 'TERMINAL_SESSION_APPROVAL_REQUIRED', JSON.stringify(socket.emitted));
  assert.deepEqual(fakePty.writes, []);
});

test('terminal session approval is consumed once before PTY spawn', () => {
  operationApprovalService._resetForTests();
  terminalService._resetForTests();
  const fakePty = createFakePty();
  terminalService._setPtyForTests(fakePty);
  const socket = new MockSocket('socket-terminal-ok', 'admin');
  terminalService.initTerminalService(createIo(socket));

  socket.clientEmit('terminal:session-preflight', { cols: 90, rows: 30 });
  const preflight = socket.findEvent('terminal:session-preflight');
  assert.equal(preflight?.action, 'terminal.session', JSON.stringify(socket.emitted));
  assert.equal(preflight?.target?.id, socket.id, JSON.stringify(preflight));
  assert.ok(preflight?.operationId, JSON.stringify(preflight));
  assert.ok(preflight?.targetHash, JSON.stringify(preflight));

  socket.clientEmit('terminal:session-approve', {
    operationId: preflight.operationId,
    typedConfirmation: 'admin',
    cols: 90,
    rows: 30
  });
  const approval = socket.findEvent('terminal:session-approval');
  assert.equal(approval?.operationId, preflight.operationId, JSON.stringify(socket.emitted));
  assert.ok(approval?.nonce, JSON.stringify(approval));

  socket.clientEmit('terminal:init', {
    cols: 90,
    rows: 30,
    approval: {
      operationId: approval.operationId,
      nonce: approval.nonce,
      targetHash: preflight.targetHash
    }
  });
  assert.equal(fakePty.processes.length, 1);
  assert.equal(terminalService.getActiveSessions().has(socket.id), true);
  assert.ok(socket.findEvent('terminal:ready'), JSON.stringify(socket.emitted));

  socket.clientEmit('terminal:input', 'echo ok\n');
  assert.deepEqual(fakePty.writes, ['echo ok\n']);

  const replaySocket = new MockSocket('socket-terminal-ok', 'admin');
  terminalService.initTerminalService(createIo(replaySocket));
  replaySocket.clientEmit('terminal:init', {
    cols: 90,
    rows: 30,
    approval: {
      operationId: approval.operationId,
      nonce: approval.nonce,
      targetHash: preflight.targetHash
    }
  });
  const replayError = replaySocket.findEvent('terminal:error');
  assert.equal(replayError?.code, 'TERMINAL_SESSION_APPROVAL_INVALID', JSON.stringify(replaySocket.emitted));
});

test('terminal app access approval can start multiple NexusTerm shell sockets', () => {
  operationApprovalService._resetForTests();
  terminalService._resetForTests();
  const fakePty = createFakePty();
  terminalService._setPtyForTests(fakePty);
  const appInstanceId = 'nexus-term-test-run';

  const approvalSocket = new MockSocket('socket-terminal-app-approval', 'admin');
  terminalService.initTerminalService(createIo(approvalSocket));
  approvalSocket.clientEmit('terminal:app-access-preflight', { appInstanceId });
  const preflight = approvalSocket.findEvent('terminal:app-access-preflight');
  assert.equal(preflight?.action, 'terminal.appAccess', JSON.stringify(approvalSocket.emitted));
  assert.equal(preflight?.target?.id, appInstanceId, JSON.stringify(preflight));
  assert.ok(preflight?.operationId, JSON.stringify(preflight));

  approvalSocket.clientEmit('terminal:app-access-approve', {
    appInstanceId,
    operationId: preflight.operationId,
    typedConfirmation: 'admin'
  });
  const grant = approvalSocket.findEvent('terminal:app-access-grant');
  assert.equal(grant?.appInstanceId, appInstanceId, JSON.stringify(approvalSocket.emitted));
  assert.ok(grant?.grantId, JSON.stringify(grant));

  const firstShell = new MockSocket('socket-terminal-app-shell-1', 'admin');
  terminalService.initTerminalService(createIo(firstShell));
  firstShell.clientEmit('terminal:init', {
    cols: 100,
    rows: 28,
    appAccess: {
      grantId: grant.grantId,
      appInstanceId
    }
  });
  assert.equal(fakePty.processes.length, 1);
  assert.ok(firstShell.findEvent('terminal:ready'), JSON.stringify(firstShell.emitted));

  const secondShell = new MockSocket('socket-terminal-app-shell-2', 'admin');
  terminalService.initTerminalService(createIo(secondShell));
  secondShell.clientEmit('terminal:init', {
    cols: 90,
    rows: 24,
    appAccess: {
      grantId: grant.grantId,
      appInstanceId
    }
  });
  assert.equal(fakePty.processes.length, 2);
  assert.ok(secondShell.findEvent('terminal:ready'), JSON.stringify(secondShell.emitted));

  secondShell.clientEmit('terminal:input', 'echo app-access-ok\n');
  assert.deepEqual(fakePty.writes, ['echo app-access-ok\n']);

  const wrongAppSocket = new MockSocket('socket-terminal-app-wrong', 'admin');
  terminalService.initTerminalService(createIo(wrongAppSocket));
  wrongAppSocket.clientEmit('terminal:init', {
    cols: 90,
    rows: 24,
    appAccess: {
      grantId: grant.grantId,
      appInstanceId: 'other-nexus-term-run'
    }
  });
  const wrongAppError = wrongAppSocket.findEvent('terminal:error');
  assert.equal(wrongAppError?.code, 'TERMINAL_APP_ACCESS_INVALID', JSON.stringify(wrongAppSocket.emitted));
});
