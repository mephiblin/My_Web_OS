const crypto = require('crypto');

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const operations = new Map();

function nowMs() {
  return Date.now();
}

function toIso(ms) {
  return new Date(ms).toISOString();
}

function createId(prefix) {
  if (typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
}

function normalizeUserId(value) {
  return String(value || '').trim() || 'unknown';
}

function normalizeTarget(target = {}) {
  return {
    type: String(target.type || '').trim(),
    id: String(target.id || '').trim(),
    label: String(target.label || target.id || '').trim()
  };
}

function cleanupExpired() {
  const current = nowMs();
  for (const [operationId, record] of operations.entries()) {
    if (!record || record.expiresAtMs <= current) {
      operations.delete(operationId);
    }
  }
}

function createApprovalError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function assertActiveOperation(record) {
  if (!record) {
    throw createApprovalError('OPERATION_APPROVAL_NOT_FOUND', 'Approval operation was not found.');
  }
  if (record.expiresAtMs <= nowMs()) {
    operations.delete(record.operationId);
    throw createApprovalError('OPERATION_APPROVAL_EXPIRED', 'Approval operation has expired.');
  }
}

const operationApprovalService = {
  DEFAULT_TTL_MS,

  createOperation(input = {}) {
    cleanupExpired();
    const ttlMs = Number.isFinite(Number(input.ttlMs)) && Number(input.ttlMs) > 0
      ? Number(input.ttlMs)
      : DEFAULT_TTL_MS;
    const createdAtMs = nowMs();
    const expiresAtMs = createdAtMs + ttlMs;
    const target = normalizeTarget(input.target);
    const action = String(input.action || '').trim();
    const userId = normalizeUserId(input.userId);
    const operationId = createId(`${action || 'operation'}:${target.id || 'target'}`);

    const record = {
      operationId,
      action,
      userId,
      target,
      targetHash: String(input.targetHash || '').trim(),
      typedConfirmation: String(input.typedConfirmation || '').trim(),
      metadata: input.metadata && typeof input.metadata === 'object' ? { ...input.metadata } : {},
      createdAt: toIso(createdAtMs),
      expiresAt: toIso(expiresAtMs),
      expiresAtMs,
      nonce: null,
      approvedAt: null,
      consumedAt: null
    };

    operations.set(operationId, record);
    return { ...record };
  },

  approveOperation(input = {}) {
    cleanupExpired();
    const operationId = String(input.operationId || '').trim();
    const record = operations.get(operationId);
    assertActiveOperation(record);

    const userId = normalizeUserId(input.userId);
    const action = String(input.action || '').trim();
    const targetId = String(input.targetId || '').trim();
    if (record.userId !== userId) {
      throw createApprovalError('OPERATION_APPROVAL_USER_MISMATCH', 'Approval operation belongs to a different user.');
    }
    if (action && record.action !== action) {
      throw createApprovalError('OPERATION_APPROVAL_ACTION_MISMATCH', 'Approval operation is scoped to a different action.');
    }
    if (targetId && record.target.id !== targetId) {
      throw createApprovalError('OPERATION_APPROVAL_TARGET_MISMATCH', 'Approval operation is scoped to a different target.');
    }
    if (record.consumedAt) {
      throw createApprovalError('OPERATION_APPROVAL_ALREADY_CONSUMED', 'Approval operation has already been consumed.');
    }
    if (record.nonce || record.approvedAt) {
      throw createApprovalError('OPERATION_APPROVAL_ALREADY_APPROVED', 'Approval operation has already been approved.');
    }

    const typedConfirmation = String(input.typedConfirmation || '').trim();
    if (record.typedConfirmation && typedConfirmation !== record.typedConfirmation) {
      throw createApprovalError('OPERATION_APPROVAL_CONFIRMATION_MISMATCH', 'Typed confirmation does not match the target.');
    }

    const nonce = createId('approval-nonce');
    record.nonce = nonce;
    record.approvedAt = new Date().toISOString();
    operations.set(operationId, record);

    return {
      operationId: record.operationId,
      nonce,
      expiresAt: record.expiresAt
    };
  },

  consumeApproval(input = {}) {
    cleanupExpired();
    const operationId = String(input.operationId || '').trim();
    const record = operations.get(operationId);
    assertActiveOperation(record);

    const userId = normalizeUserId(input.userId);
    const action = String(input.action || '').trim();
    const targetId = String(input.targetId || '').trim();
    const targetHash = String(input.targetHash || '').trim();
    const nonce = String(input.nonce || '').trim();

    if (record.userId !== userId) {
      throw createApprovalError('OPERATION_APPROVAL_USER_MISMATCH', 'Approval nonce belongs to a different user.');
    }
    if (record.action !== action) {
      throw createApprovalError('OPERATION_APPROVAL_ACTION_MISMATCH', 'Approval nonce is scoped to a different action.');
    }
    if (record.target.id !== targetId) {
      throw createApprovalError('OPERATION_APPROVAL_TARGET_MISMATCH', 'Approval nonce is scoped to a different target.');
    }
    if (!record.nonce || record.nonce !== nonce) {
      throw createApprovalError('OPERATION_APPROVAL_NONCE_INVALID', 'Approval nonce is invalid.');
    }
    if (record.targetHash !== targetHash) {
      throw createApprovalError('OPERATION_APPROVAL_TARGET_CHANGED', 'Approval target changed after preflight.');
    }

    record.consumedAt = new Date().toISOString();
    operations.delete(operationId);

    return {
      operationId: record.operationId,
      action: record.action,
      userId: record.userId,
      target: { ...record.target },
      targetHash: record.targetHash,
      typedConfirmation: record.typedConfirmation,
      createdAt: record.createdAt,
      approvedAt: record.approvedAt,
      consumedAt: record.consumedAt,
      expiresAt: record.expiresAt,
      metadata: { ...record.metadata }
    };
  },

  _resetForTests() {
    operations.clear();
  }
};

module.exports = operationApprovalService;
