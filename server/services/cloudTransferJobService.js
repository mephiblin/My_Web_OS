const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs-extra');
const serverConfig = require('../config/serverConfig');
const cloudService = require('./cloudService');
const operationApprovalService = require('./operationApprovalService');
const auditService = require('./auditService');
const {
  resolveSafePath,
  isWithinAllowedRoots,
  isProtectedSystemPath,
  isSafeLeafName,
  assertWithinAllowedRealRoots
} = require('../utils/pathPolicy');

const CONFIG_PATH = process.env.RCLONE_CONFIG || path.join(__dirname, '../../config/rclone.conf');
const DEFAULT_JOB_STORE_FILE = path.join(__dirname, '../storage/cloud-transfer-jobs.json');
const DEFAULT_PROVIDER_RETRY_MS = 15 * 60 * 1000;
const RCLONE_RETRY_FLAGS = [
  '--retries', process.env.RCLONE_RETRIES || '3',
  '--low-level-retries', process.env.RCLONE_LOW_LEVEL_RETRIES || '5',
  '--retries-sleep', process.env.RCLONE_RETRIES_SLEEP || '10s'
];
const FINISHED_STATUSES = new Set(['completed', 'failed', 'retryable_failed', 'interrupted', 'canceled']);
const ACTIVE_STATUSES = new Set(['queued', 'running', 'backoff', 'paused_by_quota']);
const APPROVAL_ACTION = 'cloud.transfer.overwrite';

function nowIso() {
  return new Date().toISOString();
}

function createCloudTransferError(code, message, status = 400, details = null) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.details = details;
  return err;
}

function createJobId() {
  if (typeof crypto.randomUUID === 'function') {
    return `cloud-transfer-${crypto.randomUUID()}`;
  }
  return `cloud-transfer-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function redactSensitiveOutput(value) {
  return String(value || '')
    .replace(/\b(authorization)\s*[:=]\s*(bearer\s+)?[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/\b(token|grantId|ticket|code|secret|password|pass|nonce)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/--(password|pass|token|secret|authorization)(?:=|\s+)[^\s]+/gi, '--$1 [REDACTED]');
}

function summarizeOutput(value, maxLength = 500) {
  return redactSensitiveOutput(value).replace(/\s+/g, ' ').trim().slice(0, maxLength) || null;
}

function inferProviderFromRemote(remote = '') {
  const value = String(remote || '').toLowerCase();
  if (value.includes('drive') || value.includes('gdrive') || value.includes('google')) return 'drive';
  if (value.includes('webdav') || value.includes('dav')) return 'webdav';
  if (value.includes('s3')) return 's3';
  return value || 'unknown';
}

function sanitizeRemoteName(name) {
  const value = text(name);
  if (!value || !/^[a-zA-Z0-9_\-]+$/.test(value)) return null;
  return value;
}

function sanitizeRemotePath(value) {
  const normalized = text(value).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized) return '';
  if (/[;|&$`\\!><]/.test(normalized)) return null;
  if (normalized.split('/').some((segment) => segment === '..')) return null;
  return normalized.replace(/\/+/g, '/');
}

function normalizeTargetPath(remotePath, fileName, sourcePath = '') {
  const safeRemotePath = sanitizeRemotePath(remotePath);
  if (safeRemotePath === null) {
    throw createCloudTransferError('CLOUD_TRANSFER_INVALID_TARGET', 'Remote target path is invalid.', 400);
  }

  const requestedFileName = text(fileName);
  if (requestedFileName) {
    if (!isSafeLeafName(requestedFileName)) {
      throw createCloudTransferError('CLOUD_TRANSFER_INVALID_TARGET', 'Remote file name is invalid.', 400);
    }
    return safeRemotePath
      ? `${safeRemotePath.replace(/\/+$/, '')}/${requestedFileName}`
      : requestedFileName;
  }

  if (!safeRemotePath || safeRemotePath.endsWith('/')) {
    const sourceName = path.basename(sourcePath || '');
    if (!isSafeLeafName(sourceName)) {
      throw createCloudTransferError('CLOUD_TRANSFER_INVALID_TARGET', 'Remote file name is invalid.', 400);
    }
    return safeRemotePath ? `${safeRemotePath}${sourceName}` : sourceName;
  }

  const leaf = path.posix.basename(safeRemotePath);
  if (!isSafeLeafName(leaf)) {
    throw createCloudTransferError('CLOUD_TRANSFER_INVALID_TARGET', 'Remote target path is invalid.', 400);
  }
  return safeRemotePath;
}

function hashTargetEvidence(evidence) {
  return crypto.createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
}

function stableConflictEvidence(evidence = {}) {
  return {
    exists: evidence.exists === true,
    path: text(evidence.path),
    size: evidence.size ?? null,
    modTime: evidence.modTime || null,
    isDirectory: evidence.isDirectory === true
  };
}

function cloneJob(job) {
  if (!job) return null;
  const error = job.error ? { ...job.error } : null;
  return {
    id: job.id,
    type: 'cloud-transfer',
    scope: 'cloud-transfer',
    status: job.status,
    sourcePath: job.sourcePath,
    sourceRealPath: job.sourceRealPath,
    remote: job.remote,
    remotePath: job.remotePath,
    targetPath: job.remotePath,
    fileName: job.fileName,
    provider: job.provider,
    overwrite: job.overwrite === true,
    approval: job.approval ? { ...job.approval } : null,
    conflict: job.conflict ? { ...job.conflict } : null,
    rclone: job.rclone ? { ...job.rclone } : null,
    nextRetryAt: job.nextRetryAt || null,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    progress: job.progress ? { ...job.progress } : { transferredBytes: 0, totalBytes: null, percent: 0, updatedAt: nowIso() },
    error,
    errors: error ? [error] : []
  };
}

function serializeJob(job) {
  const cloned = cloneJob(job);
  if (!cloned) return null;
  delete cloned.errors;
  return cloned;
}

function normalizeStoredJob(item) {
  if (!item || typeof item !== 'object') return null;
  const id = text(item.id);
  const remotePath = text(item.remotePath || item.targetPath || item.path);
  if (!id || !remotePath) return null;
  return {
    id,
    status: text(item.status).toLowerCase() || 'queued',
    sourcePath: String(item.sourcePath || ''),
    sourceRealPath: String(item.sourceRealPath || ''),
    remote: text(item.remote),
    remotePath,
    fileName: text(item.fileName || path.posix.basename(remotePath)),
    provider: text(item.provider) || inferProviderFromRemote(item.remote),
    overwrite: item.overwrite === true,
    approval: item.approval && typeof item.approval === 'object' ? { ...item.approval } : null,
    conflict: item.conflict && typeof item.conflict === 'object' ? { ...item.conflict } : null,
    rclone: item.rclone && typeof item.rclone === 'object' ? { ...item.rclone } : null,
    nextRetryAt: item.nextRetryAt || null,
    createdAt: item.createdAt || nowIso(),
    startedAt: item.startedAt || null,
    endedAt: item.endedAt || null,
    progress: item.progress && typeof item.progress === 'object'
      ? { ...item.progress }
      : { transferredBytes: 0, totalBytes: null, percent: 0, updatedAt: nowIso() },
    error: item.error && typeof item.error === 'object' ? { ...item.error } : null,
    child: null,
    cancelRequested: false,
    cancelRequestedAt: null
  };
}

function mapProviderPolicy(err, provider) {
  const details = err?.details && typeof err.details === 'object' ? err.details : {};
  const haystack = [
    err?.message,
    details.stderrSummary,
    details.stdoutSummary,
    details.exitCode,
    provider
  ].map((item) => String(item || '').toLowerCase()).join(' ');

  if (provider === 'drive' || haystack.includes('google') || haystack.includes('drive')) {
    if (/\b403\b|\b429\b|quota|rate limit|ratelimit|user rate limit|daily limit|storage quota/.test(haystack)) {
      const quotaLike = /quota|daily limit|storage quota/.test(haystack);
      return {
        status: quotaLike ? 'paused_by_quota' : 'backoff',
        code: quotaLike ? 'CLOUD_PROVIDER_QUOTA' : 'CLOUD_PROVIDER_BACKOFF',
        message: quotaLike
          ? 'Cloud provider quota paused this transfer.'
          : 'Cloud provider rate limit requires retry backoff.',
        retryable: true
      };
    }
  }

  if (provider === 'webdav' || haystack.includes('webdav') || haystack.includes('dav')) {
    if (/timeout|timed out|429|503|rate limit|too many requests|temporarily unavailable|connection reset|econnreset|etimedout/.test(haystack)) {
      return {
        status: 'backoff',
        code: 'CLOUD_PROVIDER_BACKOFF',
        message: 'Cloud provider asked the transfer to retry later.',
        retryable: true
      };
    }
  }
  return null;
}

function mapRuntimeError(err, job) {
  if (err?.code === 'CLOUD_TRANSFER_CANCELED') {
    return {
      status: 'canceled',
      error: {
        code: 'CLOUD_TRANSFER_CANCELED',
        message: 'Cloud transfer was canceled.',
        details: err.details || null
      }
    };
  }
  const providerPolicy = mapProviderPolicy(err, job?.provider || inferProviderFromRemote(job?.remote));
  if (providerPolicy) {
    return {
      status: providerPolicy.status,
      nextRetryAt: new Date(Date.now() + DEFAULT_PROVIDER_RETRY_MS).toISOString(),
      error: {
        code: providerPolicy.code,
        message: providerPolicy.message,
        details: {
          ...(err?.details || {}),
          provider: job?.provider || inferProviderFromRemote(job?.remote),
          retryable: providerPolicy.retryable
        }
      }
    };
  }
  if (err?.code === 'ENOENT') {
    return {
      status: 'failed',
      error: {
        code: 'CLOUD_TRANSFER_SOURCE_NOT_FOUND',
        message: 'Source path was not found.',
        details: null
      }
    };
  }
  return {
    status: err?.status === 429 ? 'retryable_failed' : 'failed',
    nextRetryAt: err?.status === 429 ? new Date(Date.now() + DEFAULT_PROVIDER_RETRY_MS).toISOString() : null,
    error: {
      code: err?.code || 'CLOUD_TRANSFER_FAILED',
      message: err?.message || 'Cloud transfer failed.',
      details: err?.details || null
    }
  };
}

async function validateSourcePath(sourcePath) {
  let absolutePath;
  try {
    absolutePath = resolveSafePath(sourcePath);
  } catch (_err) {
    throw createCloudTransferError('CLOUD_TRANSFER_INVALID_SOURCE', 'Source path is invalid.', 400);
  }

  const { paths } = await serverConfig.getAll();
  if (isProtectedSystemPath(absolutePath, [paths.inventoryRoot])) {
    throw createCloudTransferError('CLOUD_TRANSFER_SOURCE_NOT_ALLOWED', 'Source path is protected by system boundary.', 403, {
      path: absolutePath
    });
  }
  if (!isWithinAllowedRoots(absolutePath, paths.allowedRoots)) {
    throw createCloudTransferError('CLOUD_TRANSFER_SOURCE_NOT_ALLOWED', 'Source path is outside allowed roots.', 403, {
      path: absolutePath
    });
  }

  try {
    await assertWithinAllowedRealRoots(absolutePath, paths.allowedRoots);
  } catch (err) {
    throw createCloudTransferError(
      err?.code === 'FS_PATH_NOT_FOUND' ? 'CLOUD_TRANSFER_SOURCE_NOT_FOUND' : 'CLOUD_TRANSFER_SOURCE_NOT_ALLOWED',
      err?.code === 'FS_PATH_NOT_FOUND' ? 'Source path was not found.' : 'Source path is outside allowed roots.',
      err?.status || 403,
      { path: absolutePath }
    );
  }

  let stat;
  try {
    stat = await fs.lstat(absolutePath);
  } catch (err) {
    if (err?.code === 'ENOENT') {
      throw createCloudTransferError('CLOUD_TRANSFER_SOURCE_NOT_FOUND', 'Source path was not found.', 404);
    }
    throw err;
  }
  if (stat.isDirectory()) {
    throw createCloudTransferError('CLOUD_TRANSFER_DIRECTORY_UNSUPPORTED', 'Directory cloud transfer is not supported yet.', 400);
  }
  if (!stat.isFile()) {
    throw createCloudTransferError('CLOUD_TRANSFER_SOURCE_NOT_FILE', 'Source path must be a regular file.', 400);
  }

  const realPath = await fs.realpath(absolutePath);
  return {
    inputPath: absolutePath,
    realPath,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    fileName: path.basename(absolutePath)
  };
}

async function ensureRemoteExists(remote) {
  const remotes = await cloudService.listRemotes();
  if (!remotes.some((item) => item.name === remote)) {
    throw createCloudTransferError('CLOUD_TRANSFER_INVALID_REMOTE', 'Cloud remote was not found.', 404, { remote });
  }
}

function runRclone(args = [], job = null) {
  return new Promise((resolve, reject) => {
    const child = spawn('rclone', ['--config', CONFIG_PATH, ...args.map((arg) => String(arg))], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';

    if (job) {
      job.child = child;
      if (job.cancelRequested) {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch (_err) {
          child.kill('SIGTERM');
        }
      }
    }

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      if (job) job.child = null;
      if (job?.cancelRequested) {
        return reject(createCloudTransferError('CLOUD_TRANSFER_CANCELED', 'Cloud transfer was canceled.', 499));
      }
      if (error?.code === 'ENOENT') {
        return reject(createCloudTransferError('CLOUD_TRANSFER_RCLONE_NOT_FOUND', 'rclone binary not found. Please install rclone.', 500));
      }
      return reject(createCloudTransferError('CLOUD_TRANSFER_RCLONE_EXEC_FAILED', 'Failed to execute rclone command.', 500, {
        reason: summarizeOutput(error.message)
      }));
    });
    child.on('close', (code, signal) => {
      if (job) job.child = null;
      if (job?.cancelRequested) {
        return reject(createCloudTransferError('CLOUD_TRANSFER_CANCELED', 'Cloud transfer was canceled.', 499, { signal }));
      }
      if (code !== 0) {
        return reject(createCloudTransferError('CLOUD_TRANSFER_RCLONE_FAILED', 'rclone transfer command failed.', 502, {
          stdoutSummary: summarizeOutput(stdout),
          stderrSummary: summarizeOutput(stderr),
          exitCode: code,
          signal
        }));
      }
      return resolve({ stdout, stderr });
    });
  });
}

async function inspectTargetConflict(remote, remotePath) {
  const result = await runRclone(['lsjson', `${remote}:${remotePath}`]).catch((err) => {
    const summary = err?.details?.stderrSummary || err?.details?.stdoutSummary || err?.message || '';
    if (err?.code === 'CLOUD_TRANSFER_RCLONE_NOT_FOUND') throw err;
    if (/not found|directory not found|object not found|can't find|couldn't find|no such file/i.test(summary)) {
      return null;
    }
    throw createCloudTransferError('CLOUD_TRANSFER_TARGET_PREFLIGHT_FAILED', 'Could not verify remote target state.', 502, {
      remote,
      remotePath,
      stderrSummary: summarizeOutput(summary),
      causeCode: err?.code || null
    });
  });
  if (!result?.stdout) {
    return {
      exists: false,
      evidence: {
        exists: false,
        checkedAt: nowIso()
      }
    };
  }
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (_err) {
    parsed = null;
  }
  const item = Array.isArray(parsed) ? parsed[0] : parsed;
  const exists = Boolean(item && typeof item === 'object');
  return {
    exists,
    evidence: {
      exists,
      checkedAt: nowIso(),
      path: remotePath,
      size: item?.Size ?? null,
      modTime: item?.ModTime || null,
      isDirectory: item?.IsDir === true
    }
  };
}

class CloudTransferJobService {
  constructor() {
    this.jobs = new Map();
    this.queue = [];
    this.runningJobId = null;
    this.jobStoreFile = process.env.CLOUD_TRANSFER_JOBS_FILE || DEFAULT_JOB_STORE_FILE;
    this.#loadJobsFromStore();
  }

  async preflight(input = {}, context = {}) {
    const source = await validateSourcePath(input.sourcePath);
    const remote = sanitizeRemoteName(input.remote);
    if (!remote) {
      throw createCloudTransferError('CLOUD_TRANSFER_INVALID_REMOTE', 'Cloud remote is invalid.', 400);
    }
    await ensureRemoteExists(remote);
    const remotePath = normalizeTargetPath(input.remotePath, input.fileName, source.inputPath);
    if (!remotePath) {
      throw createCloudTransferError('CLOUD_TRANSFER_INVALID_TARGET', 'Remote target path is required.', 400);
    }
    const conflict = await inspectTargetConflict(remote, remotePath);
    if (conflict.evidence.isDirectory) {
      throw createCloudTransferError('CLOUD_TRANSFER_INVALID_TARGET', 'Remote target is a directory.', 409, {
        remote,
        remotePath
      });
    }

    const provider = inferProviderFromRemote(remote);
    const targetEvidence = {
      sourceRealPath: source.realPath,
      sourceSize: source.size,
      sourceMtimeMs: source.mtimeMs,
      remote,
      remotePath,
      conflict: stableConflictEvidence(conflict.evidence)
    };
    const targetHash = hashTargetEvidence(targetEvidence);
    let approval = null;
    if (conflict.exists) {
      const operation = operationApprovalService.createOperation({
        action: APPROVAL_ACTION,
        userId: context.userId,
        target: {
          type: 'cloud-transfer-target',
          id: `${remote}:${remotePath}`,
          label: `${remote}:${remotePath}`
        },
        targetHash,
        typedConfirmation: path.posix.basename(remotePath),
        metadata: {
          sourcePath: source.inputPath,
          remote,
          remotePath,
          provider
        }
      });
      approval = {
        required: true,
        action: APPROVAL_ACTION,
        operationId: operation.operationId,
        expiresAt: operation.expiresAt,
        targetHash,
        typedConfirmation: operation.typedConfirmation
      };
    }

    return {
      source: {
        path: source.inputPath,
        realPath: source.realPath,
        fileName: source.fileName,
        size: source.size,
        mtimeMs: source.mtimeMs
      },
      target: {
        remote,
        remotePath,
        provider,
        conflict: conflict.exists,
        conflictEvidence: conflict.evidence,
        targetHash
      },
      requiresApproval: conflict.exists,
      approval
    };
  }

  approve(input = {}, context = {}) {
    const result = operationApprovalService.approveOperation({
      operationId: input.operationId,
      userId: context.userId,
      action: APPROVAL_ACTION,
      typedConfirmation: input.typedConfirmation
    });
    return {
      success: true,
      approval: {
        action: APPROVAL_ACTION,
        operationId: result.operationId,
        nonce: result.nonce,
        expiresAt: result.expiresAt
      }
    };
  }

  async enqueue(input = {}, context = {}) {
    const preflight = await this.preflight(input, context);
    const overwrite = input.overwrite === true;
    const approval = input.approval && typeof input.approval === 'object' ? input.approval : null;
    if (preflight.requiresApproval) {
      if (!overwrite || !approval?.operationId || !approval?.nonce) {
        throw createCloudTransferError('CLOUD_TRANSFER_APPROVAL_REQUIRED', 'Overwrite requires backend approval evidence.', 409, {
          preflight
        });
      }
      try {
        operationApprovalService.consumeApproval({
          operationId: approval.operationId,
          userId: context.userId,
          action: APPROVAL_ACTION,
          targetId: `${preflight.target.remote}:${preflight.target.remotePath}`,
          targetHash: preflight.target.targetHash,
          nonce: approval.nonce
        });
      } catch (err) {
        throw createCloudTransferError('CLOUD_TRANSFER_APPROVAL_INVALID', err?.message || 'Approval evidence is invalid.', 409, {
          code: err?.code || 'OPERATION_APPROVAL_INVALID',
          preflight
        });
      }
    }

    const job = {
      id: createJobId(),
      status: 'queued',
      sourcePath: preflight.source.path,
      sourceRealPath: preflight.source.realPath,
      remote: preflight.target.remote,
      remotePath: preflight.target.remotePath,
      fileName: preflight.source.fileName,
      provider: preflight.target.provider,
      overwrite,
      approval: preflight.requiresApproval
        ? {
            action: APPROVAL_ACTION,
            operationId: approval.operationId,
            targetHash: preflight.target.targetHash,
            consumedAt: nowIso()
          }
        : null,
      conflict: preflight.target.conflict ? preflight.target.conflictEvidence : null,
      rclone: {
        command: 'copyto',
        flags: [...RCLONE_RETRY_FLAGS]
      },
      nextRetryAt: null,
      createdAt: nowIso(),
      startedAt: null,
      endedAt: null,
      progress: {
        transferredBytes: 0,
        totalBytes: preflight.source.size,
        percent: 0,
        updatedAt: nowIso()
      },
      error: null,
      child: null,
      cancelRequested: false,
      cancelRequestedAt: null
    };
    this.jobs.set(job.id, job);
    this.queue.push(job.id);
    this.#persistJobs();
    await auditService.log('FILE_TRANSFER', 'cloud_transfer_enqueued', {
      user: context.userId,
      jobId: job.id,
      sourcePath: job.sourcePath,
      remote: job.remote,
      remotePath: job.remotePath,
      overwrite: job.overwrite,
      approvalRequired: preflight.requiresApproval
    });
    this.#processQueue();
    return cloneJob(job);
  }

  listJobs() {
    return Array.from(this.jobs.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((job) => cloneJob(job));
  }

  getSummary() {
    const counts = {
      total: 0,
      queued: 0,
      running: 0,
      backoff: 0,
      paused_by_quota: 0,
      retryable_failed: 0,
      completed: 0,
      failed: 0,
      interrupted: 0,
      canceled: 0
    };
    for (const job of this.jobs.values()) {
      counts.total += 1;
      if (Object.prototype.hasOwnProperty.call(counts, job.status)) {
        counts[job.status] += 1;
      }
    }
    return counts;
  }

  getJob(jobId) {
    return cloneJob(this.jobs.get(text(jobId)));
  }

  cancelJob(jobId) {
    const job = this.jobs.get(text(jobId));
    if (!job) {
      throw createCloudTransferError('CLOUD_TRANSFER_JOB_NOT_FOUND', 'Cloud transfer job was not found.', 404);
    }
    if (FINISHED_STATUSES.has(job.status)) {
      throw createCloudTransferError('CLOUD_TRANSFER_CANCEL_UNAVAILABLE', `Cannot cancel job in '${job.status}' status.`, 409);
    }
    job.cancelRequested = true;
    job.cancelRequestedAt = nowIso();
    if (job.status === 'queued') {
      this.queue = this.queue.filter((id) => id !== job.id);
      job.status = 'canceled';
      job.endedAt = nowIso();
      job.error = {
        code: 'CLOUD_TRANSFER_CANCELED',
        message: 'Cloud transfer was canceled before execution.',
        details: null
      };
      this.#persistJobs();
      return cloneJob(job);
    }
    if (job.child) {
      try {
        process.kill(-job.child.pid, 'SIGTERM');
      } catch (_err) {
        job.child.kill('SIGTERM');
      }
      return cloneJob(job);
    }
    if (job.status === 'running') {
      return cloneJob(job);
    }
    throw createCloudTransferError('CLOUD_TRANSFER_CANCEL_UNAVAILABLE', 'Cloud transfer cancellation is unavailable.', 409, {
      status: job.status
    });
  }

  async retryJob(jobId, context = {}) {
    const existing = this.jobs.get(text(jobId));
    if (!existing) {
      throw createCloudTransferError('CLOUD_TRANSFER_JOB_NOT_FOUND', 'Cloud transfer job was not found.', 404);
    }
    if (!FINISHED_STATUSES.has(existing.status) && existing.status !== 'backoff' && existing.status !== 'paused_by_quota') {
      throw createCloudTransferError(
        'CLOUD_TRANSFER_RETRY_NOT_ALLOWED',
        `Retry is not allowed for '${existing.status}' jobs.`,
        409
      );
    }
    if (existing.conflict || existing.overwrite) {
      throw createCloudTransferError(
        'CLOUD_TRANSFER_APPROVAL_REQUIRED',
        'Retrying an overwrite transfer requires a fresh preflight and approval.',
        409
      );
    }
    return this.enqueue({
      sourcePath: existing.sourcePath,
      remote: existing.remote,
      remotePath: existing.remotePath,
      overwrite: false
    }, context);
  }

  clearJobs(options = {}) {
    const requested = Array.isArray(options.statuses) ? options.statuses : [];
    const normalized = new Set(requested.map((item) => text(item).toLowerCase()).filter(Boolean));
    const targetStatuses = normalized.size > 0
      ? normalized
      : new Set(['completed', 'failed', 'retryable_failed', 'interrupted', 'canceled']);
    for (const status of targetStatuses) {
      if (ACTIVE_STATUSES.has(status)) {
        throw createCloudTransferError('CLOUD_TRANSFER_PRUNE_ACTIVE_NOT_ALLOWED', 'Cannot prune active cloud transfer jobs.', 400);
      }
    }
    let removed = 0;
    for (const [id, job] of this.jobs.entries()) {
      if (!targetStatuses.has(job.status)) continue;
      this.jobs.delete(id);
      removed += 1;
    }
    this.queue = this.queue.filter((id) => this.jobs.has(id));
    this.#persistJobs();
    return {
      removed,
      remaining: this.jobs.size
    };
  }

  async #processQueue() {
    if (this.runningJobId || this.queue.length === 0) return;
    const nextJobId = this.queue.shift();
    const job = this.jobs.get(nextJobId);
    if (!job || job.status !== 'queued') {
      this.#processQueue();
      return;
    }
    this.runningJobId = job.id;
    job.status = 'running';
    job.startedAt = nowIso();
    job.error = null;
    this.#persistJobs();

    try {
      const source = await validateSourcePath(job.sourcePath);
      job.sourceRealPath = source.realPath;
      job.progress.totalBytes = source.size;
      job.progress.updatedAt = nowIso();
      await ensureRemoteExists(job.remote);
      await runRclone([
        ...RCLONE_RETRY_FLAGS,
        'copyto',
        source.realPath,
        `${job.remote}:${job.remotePath}`
      ], job);
      job.progress.transferredBytes = source.size;
      job.progress.percent = 100;
      job.progress.updatedAt = nowIso();
      job.status = 'completed';
      job.endedAt = nowIso();
      job.error = null;
      job.nextRetryAt = null;
    } catch (err) {
      const mapped = mapRuntimeError(err, job);
      job.status = mapped.status;
      job.endedAt = nowIso();
      job.nextRetryAt = mapped.nextRetryAt || null;
      job.error = mapped.error;
    } finally {
      job.child = null;
      this.runningJobId = null;
      this.#persistJobs();
      this.#processQueue();
    }
  }

  #loadJobsFromStore() {
    this.jobs.clear();
    this.queue = [];
    this.runningJobId = null;
    let payload = null;
    try {
      payload = fs.readJsonSync(this.jobStoreFile);
    } catch (err) {
      if (err?.code !== 'ENOENT') {
        console.warn(`[CLOUD_TRANSFER] Failed to load job store (${this.jobStoreFile}): ${err.message}`);
      }
      return;
    }
    const storedJobs = Array.isArray(payload?.jobs) ? payload.jobs : Array.isArray(payload) ? payload : [];
    let changed = false;
    for (const item of storedJobs) {
      const job = normalizeStoredJob(item);
      if (!job) {
        changed = true;
        continue;
      }
      if (job.status === 'running') {
        job.status = 'interrupted';
        job.endedAt = nowIso();
        job.error = {
          code: 'CLOUD_TRANSFER_INTERRUPTED',
          message: 'Cloud transfer was interrupted by backend restart.',
          details: { previousStatus: 'running' }
        };
        changed = true;
      }
      this.jobs.set(job.id, job);
      if (job.status === 'queued') {
        this.queue.push(job.id);
      }
    }
    if (changed) this.#persistJobs();
    if (this.queue.length > 0) setImmediate(() => this.#processQueue());
  }

  #persistJobs() {
    const payload = {
      version: 1,
      updatedAt: nowIso(),
      jobs: Array.from(this.jobs.values()).map((job) => serializeJob(job)).filter(Boolean)
    };
    try {
      fs.ensureDirSync(path.dirname(this.jobStoreFile));
      const tmpFile = `${this.jobStoreFile}.tmp`;
      fs.writeJsonSync(tmpFile, payload, { spaces: 2 });
      fs.renameSync(tmpFile, this.jobStoreFile);
    } catch (err) {
      console.warn(`[CLOUD_TRANSFER] Failed to persist job store (${this.jobStoreFile}): ${err.message}`);
    }
  }

  _reloadForTests(options = {}) {
    this.jobStoreFile = options.jobStoreFile || process.env.CLOUD_TRANSFER_JOBS_FILE || DEFAULT_JOB_STORE_FILE;
    this.#loadJobsFromStore();
  }

  _resetForTests(options = {}) {
    this.jobs.clear();
    this.queue = [];
    this.runningJobId = null;
    this.jobStoreFile = options.jobStoreFile || process.env.CLOUD_TRANSFER_JOBS_FILE || DEFAULT_JOB_STORE_FILE;
    if (options.removeStore !== false) {
      fs.removeSync(this.jobStoreFile);
    }
  }
}

module.exports = new CloudTransferJobService();
