const os = require('os');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const auditService = require('./auditService');
const operationApprovalService = require('./operationApprovalService');

let pty = null;
try {
  pty = require('node-pty');
} catch (_err) {
  pty = null;
}

const sessions = new Map();
const terminalAccessGrants = new Map();
const TERMINAL_APP_ACCESS_TTL_MS = 8 * 60 * 60 * 1000;

function sanitizeCommand(command) {
  const value = String(command || '').replace(/\s+/g, ' ').trim();
  return value.slice(0, 280);
}

function stableJsonStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function computeTerminalTargetHash(targetEvidence = {}) {
  const hash = crypto.createHash('sha256');
  hash.update('terminal-session-target-v1\0');
  hash.update(stableJsonStringify(targetEvidence));
  return `sha256:${hash.digest('hex')}`;
}

function createTerminalAccessGrantId() {
  if (typeof crypto.randomUUID === 'function') {
    return `terminal-app-access-${crypto.randomUUID()}`;
  }
  return `terminal-app-access-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
}

function cleanupExpiredTerminalAccessGrants() {
  const current = Date.now();
  for (const [grantId, grant] of terminalAccessGrants.entries()) {
    if (!grant || grant.expiresAtMs <= current) {
      terminalAccessGrants.delete(grantId);
    }
  }
}

function normalizeAppInstanceId(value) {
  return String(value || '').trim().slice(0, 160);
}

function createTerminalError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
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

function buildSessionTarget(socket, payload = {}) {
  const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
  const cwd = process.env.HOME || process.env.USERPROFILE || '';
  const cols = Number.isFinite(Number(payload.cols)) ? Math.max(10, Number(payload.cols)) : 80;
  const rows = Number.isFinite(Number(payload.rows)) ? Math.max(5, Number(payload.rows)) : 24;
  const username = socket.data?.user?.username || '';
  const target = {
    type: 'terminal.session',
    id: socket.id,
    label: `Terminal session ${socket.id}`
  };
  const evidence = {
    user: username,
    socketId: socket.id,
    shell,
    cwd,
    cols,
    rows,
    client: {
      address: socket.handshake?.address || socket.conn?.remoteAddress || '',
      userAgent: socket.handshake?.headers?.['user-agent'] || ''
    }
  };
  return {
    action: 'terminal.session',
    target,
    targetHash: computeTerminalTargetHash(evidence),
    evidence,
    shell,
    cwd,
    cols,
    rows
  };
}

function buildAppAccessTarget(socket, payload = {}) {
  const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
  const cwd = process.env.HOME || process.env.USERPROFILE || '';
  const username = socket.data?.user?.username || '';
  const appInstanceId = normalizeAppInstanceId(payload.appInstanceId);
  const target = {
    type: 'terminal.appAccess',
    id: appInstanceId,
    label: `NexusTerm ${appInstanceId || 'app session'}`
  };
  const evidence = {
    user: username,
    appId: 'nexus-term',
    appInstanceId,
    shell,
    cwd,
    client: {
      address: socket.handshake?.address || socket.conn?.remoteAddress || '',
      userAgent: socket.handshake?.headers?.['user-agent'] || ''
    }
  };
  return {
    action: 'terminal.appAccess',
    target,
    targetHash: computeTerminalTargetHash(evidence),
    evidence,
    shell,
    cwd,
    appInstanceId
  };
}

function buildTerminalPreflight(socket, payload = {}) {
  const targetContext = buildSessionTarget(socket, payload);
  const operation = operationApprovalService.createOperation({
    action: targetContext.action,
    userId: socket.data.user.username,
    target: targetContext.target,
    targetHash: targetContext.targetHash,
    typedConfirmation: socket.data.user.username,
    metadata: {
      evidence: targetContext.evidence
    }
  });

  return {
    operationId: operation.operationId,
    action: targetContext.action,
    target: targetContext.target,
    riskLevel: 'high',
    impact: [
      'A privileged interactive shell will be opened on the host.',
      'Commands typed into this terminal can change real host state.'
    ],
    recoverability: {
      sessionCanBeClosed: true,
      commandRollbackNotGuaranteed: true
    },
    approval: {
      required: true,
      typedConfirmation: socket.data.user.username,
      expiresAt: operation.expiresAt
    },
    targetHash: targetContext.targetHash,
    evidence: targetContext.evidence
  };
}

function buildTerminalAppAccessPreflight(socket, payload = {}) {
  const targetContext = buildAppAccessTarget(socket, payload);
  if (!targetContext.appInstanceId) {
    throw createTerminalError('TERMINAL_APP_ACCESS_APP_REQUIRED', 'Terminal app access requires an app instance id.');
  }

  const operation = operationApprovalService.createOperation({
    action: targetContext.action,
    userId: socket.data.user.username,
    target: targetContext.target,
    targetHash: targetContext.targetHash,
    typedConfirmation: '',
    metadata: {
      evidence: targetContext.evidence
    }
  });

  return {
    operationId: operation.operationId,
    action: targetContext.action,
    target: targetContext.target,
    riskLevel: 'high',
    impact: [
      'NexusTerm will be allowed to open local shell tabs for this app session.',
      'Commands typed into any shell tab can change real host files and services.'
    ],
    recoverability: {
      appCanBeClosed: true,
      commandRollbackNotGuaranteed: true
    },
    approval: {
      required: true,
      mode: 'acknowledge',
      typedConfirmation: '',
      expiresAt: operation.expiresAt
    },
    targetHash: targetContext.targetHash,
    evidence: targetContext.evidence
  };
}

function emitTerminalApprovalError(socket, code, message, preflight = null) {
  socket.emit('terminal:error', {
    code,
    message,
    preflight
  });
  socket.emit('terminal:output', `${message}\r\n`);
}

function isApprovedSession(socket) {
  return Boolean(
    socket.data?.terminalSessionApproval?.operationId
    || socket.data?.terminalSessionApproval?.appAccessGrantId
  );
}

function createTerminalAccessGrant({ userId, appInstanceId, operationId, targetHash }) {
  cleanupExpiredTerminalAccessGrants();
  const createdAtMs = Date.now();
  const expiresAtMs = createdAtMs + TERMINAL_APP_ACCESS_TTL_MS;
  const grant = {
    grantId: createTerminalAccessGrantId(),
    userId,
    appId: 'nexus-term',
    appInstanceId,
    operationId,
    targetHash,
    createdAt: new Date(createdAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    expiresAtMs
  };
  terminalAccessGrants.set(grant.grantId, grant);
  return { ...grant };
}

function validateTerminalAccessGrant(socket, payload = {}) {
  cleanupExpiredTerminalAccessGrants();
  const grantId = String(payload.grantId || '').trim();
  const appInstanceId = normalizeAppInstanceId(payload.appInstanceId);
  const grant = terminalAccessGrants.get(grantId);
  if (!grant) {
    throw createTerminalError('TERMINAL_APP_ACCESS_NOT_FOUND', 'Terminal app access grant was not found or has expired.');
  }
  if (grant.userId !== socket.data.user.username) {
    throw createTerminalError('TERMINAL_APP_ACCESS_USER_MISMATCH', 'Terminal app access belongs to a different user.');
  }
  if (grant.appInstanceId !== appInstanceId) {
    throw createTerminalError('TERMINAL_APP_ACCESS_APP_MISMATCH', 'Terminal app access belongs to a different NexusTerm instance.');
  }
  return { ...grant };
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

    socket.on('terminal:session-preflight', (payload = {}) => {
      if (!socket.data.user?.username) {
        auditService.log(
          'SYSTEM',
          'Terminal: Session Preflight Rejected (Auth Required)',
          { socketId: socket.id },
          'WARNING'
        ).catch(() => {});
        emitTerminalApprovalError(socket, 'TERMINAL_AUTH_REQUIRED', 'Authentication required. Please sign in again.');
        return;
      }

      const preflight = buildTerminalPreflight(socket, payload);
      auditService.log(
        'SYSTEM',
        'Terminal: Session Preflight Created',
        {
          socketId: socket.id,
          user: socket.data.user.username,
          operationId: preflight.operationId,
          targetHash: preflight.targetHash
        },
        'WARNING'
      ).catch(() => {});
      socket.emit('terminal:session-preflight', preflight);
    });

    socket.on('terminal:session-approve', (payload = {}) => {
      if (!socket.data.user?.username) {
        emitTerminalApprovalError(socket, 'TERMINAL_AUTH_REQUIRED', 'Authentication required. Please sign in again.');
        return;
      }

      const targetContext = buildSessionTarget(socket, payload);
      try {
        const approval = operationApprovalService.approveOperation({
          operationId: payload.operationId,
          userId: socket.data.user.username,
          action: 'terminal.session',
          targetId: socket.id,
          typedConfirmation: payload.typedConfirmation
        });
        auditService.log(
          'SYSTEM',
          'Terminal: Session Approved',
          {
            socketId: socket.id,
            user: socket.data.user.username,
            operationId: approval.operationId,
            targetHash: targetContext.targetHash
          },
          'WARNING'
        ).catch(() => {});
        socket.emit('terminal:session-approval', {
          ...approval,
          targetHash: targetContext.targetHash
        });
      } catch (err) {
        auditService.log(
          'SYSTEM',
          'Terminal: Session Approval Rejected',
          {
            socketId: socket.id,
            user: socket.data.user.username,
            code: err.code || 'TERMINAL_SESSION_APPROVAL_INVALID'
          },
          'WARNING'
        ).catch(() => {});
        emitTerminalApprovalError(socket, 'TERMINAL_SESSION_APPROVAL_INVALID', err.message);
      }
    });

    socket.on('terminal:app-access-preflight', (payload = {}) => {
      if (!socket.data.user?.username) {
        auditService.log(
          'SYSTEM',
          'Terminal: App Access Preflight Rejected (Auth Required)',
          { socketId: socket.id },
          'WARNING'
        ).catch(() => {});
        emitTerminalApprovalError(socket, 'TERMINAL_AUTH_REQUIRED', 'Authentication required. Please sign in again.');
        return;
      }

      try {
        const preflight = buildTerminalAppAccessPreflight(socket, payload);
        auditService.log(
          'SYSTEM',
          'Terminal: App Access Preflight Created',
          {
            socketId: socket.id,
            user: socket.data.user.username,
            operationId: preflight.operationId,
            appInstanceId: preflight.evidence.appInstanceId,
            targetHash: preflight.targetHash
          },
          'WARNING'
        ).catch(() => {});
        socket.emit('terminal:app-access-preflight', preflight);
      } catch (err) {
        emitTerminalApprovalError(socket, err.code || 'TERMINAL_APP_ACCESS_PREFLIGHT_INVALID', err.message);
      }
    });

    socket.on('terminal:app-access-approve', (payload = {}) => {
      if (!socket.data.user?.username) {
        emitTerminalApprovalError(socket, 'TERMINAL_AUTH_REQUIRED', 'Authentication required. Please sign in again.');
        return;
      }

      const targetContext = buildAppAccessTarget(socket, payload);
      try {
        if (!targetContext.appInstanceId) {
          throw createTerminalError('TERMINAL_APP_ACCESS_APP_REQUIRED', 'Terminal app access requires an app instance id.');
        }
        const approval = operationApprovalService.approveOperation({
          operationId: payload.operationId,
          userId: socket.data.user.username,
          action: 'terminal.appAccess',
          targetId: targetContext.appInstanceId,
          typedConfirmation: payload.typedConfirmation
        });
        const grant = createTerminalAccessGrant({
          userId: socket.data.user.username,
          appInstanceId: targetContext.appInstanceId,
          operationId: approval.operationId,
          targetHash: targetContext.targetHash
        });
        auditService.log(
          'SYSTEM',
          'Terminal: App Access Approved',
          {
            socketId: socket.id,
            user: socket.data.user.username,
            operationId: approval.operationId,
            appInstanceId: grant.appInstanceId,
            grantId: grant.grantId,
            targetHash: targetContext.targetHash
          },
          'WARNING'
        ).catch(() => {});
        socket.emit('terminal:app-access-grant', grant);
      } catch (err) {
        auditService.log(
          'SYSTEM',
          'Terminal: App Access Approval Rejected',
          {
            socketId: socket.id,
            user: socket.data.user.username,
            code: err.code || 'TERMINAL_APP_ACCESS_APPROVAL_INVALID'
          },
          'WARNING'
        ).catch(() => {});
        emitTerminalApprovalError(socket, 'TERMINAL_APP_ACCESS_APPROVAL_INVALID', err.message);
      }
    });

    socket.on('terminal:init', ({ cols, rows, approval, appAccess } = {}) => {
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

      const targetContext = buildSessionTarget(socket, { cols, rows });
      let approvalContext = null;
      let appAccessContext = null;

      if (appAccess?.grantId) {
        try {
          appAccessContext = validateTerminalAccessGrant(socket, appAccess);
        } catch (err) {
          auditService.log(
            'SYSTEM',
            'Terminal: Session Rejected (App Access Invalid)',
            {
              socketId: socket.id,
              user: socket.data.user.username,
              code: err.code || 'TERMINAL_APP_ACCESS_INVALID'
            },
            'WARNING'
          ).catch(() => {});
          emitTerminalApprovalError(socket, 'TERMINAL_APP_ACCESS_INVALID', err.message);
          return;
        }
        socket.data.terminalSessionApproval = {
          appAccessGrantId: appAccessContext.grantId,
          operationId: appAccessContext.operationId,
          targetHash: appAccessContext.targetHash,
          appInstanceId: appAccessContext.appInstanceId,
          approvedAt: appAccessContext.createdAt
        };
      } else {
        if (
          !approval ||
          !String(approval.operationId || '').trim() ||
          !String(approval.nonce || '').trim() ||
          !String(approval.targetHash || '').trim()
        ) {
          const preflight = buildTerminalPreflight(socket, { cols, rows });
          auditService.log(
            'SYSTEM',
            'Terminal: Session Rejected (Approval Required)',
            { socketId: socket.id, user: socket.data.user.username, operationId: preflight.operationId },
            'WARNING'
          ).catch(() => {});
          emitTerminalApprovalError(socket, 'TERMINAL_SESSION_APPROVAL_REQUIRED', 'Terminal session requires a scoped approval nonce.', preflight);
          return;
        }

        try {
          if (String(approval.targetHash || '').trim() !== targetContext.targetHash) {
            throw createTerminalError('TERMINAL_SESSION_APPROVAL_TARGET_CHANGED', 'Terminal session approval target changed after preflight.');
          }
          approvalContext = operationApprovalService.consumeApproval({
            operationId: approval.operationId,
            nonce: approval.nonce,
            userId: socket.data.user.username,
            action: 'terminal.session',
            targetId: socket.id,
            targetHash: targetContext.targetHash
          });
        } catch (err) {
          auditService.log(
            'SYSTEM',
            'Terminal: Session Rejected (Approval Invalid)',
            {
              socketId: socket.id,
              user: socket.data.user.username,
              code: err.code || 'TERMINAL_SESSION_APPROVAL_INVALID'
            },
            'WARNING'
          ).catch(() => {});
          emitTerminalApprovalError(socket, 'TERMINAL_SESSION_APPROVAL_INVALID', err.message);
          return;
        }

        socket.data.terminalSessionApproval = {
          operationId: approvalContext.operationId,
          targetHash: approvalContext.targetHash,
          consumedAt: approvalContext.consumedAt
        };
      }

      if (!pty) {
        auditService.log(
          'SYSTEM',
          'Terminal: Fallback Session Initialized',
          {
            socketId: socket.id,
            user: socket.data.user.username,
            operationId: approvalContext?.operationId || appAccessContext?.operationId || null,
            appAccessGrantId: appAccessContext?.grantId || null
          },
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

      const terminalEnv = {
        ...process.env,
        LANG: process.env.LANG || 'C.UTF-8',
        LC_ALL: process.env.LC_ALL || process.env.LANG || 'C.UTF-8',
        TERM: process.env.TERM || 'xterm-256color'
      };

      const ptyProcess = pty.spawn(targetContext.shell, [], {
        name: 'xterm-color',
        cols: targetContext.cols,
        rows: targetContext.rows,
        cwd: targetContext.cwd,
        env: terminalEnv
      });

      const sessionId = socket.id;
      sessions.set(sessionId, ptyProcess);
      auditService.log(
        'SYSTEM',
        'Terminal: Session Started',
        {
          socketId: sessionId,
          user: socket.data.user.username,
          operationId: approvalContext?.operationId || appAccessContext?.operationId || null,
          appAccessGrantId: appAccessContext?.grantId || null,
          approval: {
            nonceConsumed: Boolean(approvalContext),
            consumedAt: approvalContext?.consumedAt || null,
            targetHash: approvalContext?.targetHash || appAccessContext?.targetHash || null
          }
        },
        'INFO'
      ).catch(() => {});

      ptyProcess.onData((data) => {
        socket.emit('terminal:output', data);
      });

      ptyProcess.onExit(({ exitCode, signal }) => {
        socket.emit('terminal:exit', { exitCode, signal });
        sessions.delete(sessionId);
        socket.data.terminalSessionApproval = null;
        auditService.log(
          'SYSTEM',
          'Terminal: Session Ended',
          { socketId: sessionId, exitCode, signal, user: socket.data.user?.username || null },
          exitCode === 0 ? 'INFO' : 'WARNING'
        ).catch(() => {});
      });

      socket.emit('terminal:ready', {
        shell: targetContext.shell,
        cwd: targetContext.cwd
      });
      console.log(`Terminal session started for socket ${socket.id}`);
    });

    socket.on('terminal:input', (data) => {
      const ptyProcess = sessions.get(socket.id);
      if (!isApprovedSession(socket)) {
        auditService.log(
          'SYSTEM',
          'Terminal: Input Rejected (Session Approval Required)',
          { socketId: socket.id, user: socket.data.user?.username || null },
          'WARNING'
        ).catch(() => {});
        socket.emit('terminal:error', {
          code: 'TERMINAL_SESSION_APPROVAL_REQUIRED',
          message: 'Terminal input requires an approved terminal session.'
        });
        return;
      }
      if (ptyProcess) {
        ptyProcess.write(data);
      }
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
        socket.data.terminalSessionApproval = null;
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

function _setPtyForTests(nextPty) {
  pty = nextPty;
}

function _resetForTests() {
  for (const ptyProcess of sessions.values()) {
    try {
      ptyProcess.kill();
    } catch (_err) {}
  }
  sessions.clear();
  terminalAccessGrants.clear();
}

module.exports = {
  initTerminalService,
  getActiveSessions,
  buildSessionTarget,
  buildAppAccessTarget,
  _setPtyForTests,
  _resetForTests
};
