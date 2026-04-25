const fs = require('fs-extra');
const path = require('path');
const { createWriteStream } = require('fs');
const { pipeline } = require('stream/promises');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const serverConfig = require('../config/serverConfig');
const { resolveSafePath, isWithinAllowedRoots, isProtectedSystemPath, isSafeLeafName } = require('../utils/pathPolicy');

const MAX_REDIRECTS = 5;

function createTransferError(status, code, message, details = null) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.details = details;
  return err;
}

function createJobId() {
  if (typeof crypto.randomUUID === 'function') {
    return `transfer-${crypto.randomUUID()}`;
  }
  return `transfer-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function nowIso() {
  return new Date().toISOString();
}

function cloneJob(job) {
  const error = job.error ? { ...job.error } : null;
  return {
    id: job.id,
    type: job.type,
    fileName: job.fileName,
    status: job.status,
    source: job.source,
    destinationDir: job.destinationDir,
    destinationPath: job.destinationPath,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    progress: { ...job.progress },
    error,
    errors: error ? [error] : []
  };
}

async function validateManagedPath(inputPath, label) {
  let absolutePath;
  try {
    absolutePath = resolveSafePath(inputPath);
  } catch (_err) {
    throw createTransferError(400, 'TRANSFER_INVALID_PATH', `${label} path is invalid.`);
  }
  const { paths } = await serverConfig.getAll();

  if (isProtectedSystemPath(absolutePath, [paths.inventoryRoot])) {
    throw createTransferError(
      403,
      'TRANSFER_PROTECTED_PATH',
      `${label} path is protected by system boundary.`,
      { path: absolutePath, label }
    );
  }

  if (!isWithinAllowedRoots(absolutePath, paths.allowedRoots)) {
    throw createTransferError(
      403,
      'TRANSFER_PATH_NOT_ALLOWED',
      `${label} path is outside allowed roots.`,
      { path: absolutePath, label }
    );
  }

  return absolutePath;
}

function setProgress(job, transferredBytes, totalBytes = null) {
  const percent = totalBytes > 0 ? Math.min(100, Math.round((transferredBytes / totalBytes) * 100)) : null;
  job.progress = {
    transferredBytes,
    totalBytes: Number.isFinite(totalBytes) ? totalBytes : null,
    percent,
    updatedAt: nowIso()
  };
}

function mapJobRuntimeError(err) {
  if (err?.code === 'TRANSFER_JOB_CANCELED' || err?.name === 'AbortError') {
    return {
      status: 409,
      code: 'TRANSFER_JOB_CANCELED',
      message: 'Transfer job was canceled.',
      details: null
    };
  }

  if (err?.code === 'ENOENT') {
    return {
      status: 404,
      code: 'TRANSFER_PATH_NOT_FOUND',
      message: 'A source or destination path was not found.',
      details: null
    };
  }

  if (err?.code === 'EACCES' || err?.code === 'EPERM') {
    return {
      status: 403,
      code: 'TRANSFER_ACCESS_DENIED',
      message: 'Transfer cannot access source or destination path.',
      details: null
    };
  }

  if (err?.code === 'EEXIST') {
    return {
      status: 409,
      code: 'TRANSFER_TARGET_EXISTS',
      message: 'Destination file already exists.',
      details: null
    };
  }

  return {
    status: err?.status || 500,
    code: err?.code || 'TRANSFER_JOB_FAILED',
    message: err?.message || 'Transfer job failed.',
    details: err?.details || null
  };
}

function abortError() {
  const err = new Error('Transfer job was canceled.');
  err.code = 'TRANSFER_JOB_CANCELED';
  return err;
}

function downloadToFile(urlString, filePath, signal, onProgress, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(urlString);
    } catch (_err) {
      reject(createTransferError(400, 'TRANSFER_INVALID_URL', 'A valid HTTP/HTTPS URL is required.'));
      return;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      reject(createTransferError(400, 'TRANSFER_INVALID_URL', 'Only HTTP/HTTPS URLs are supported.'));
      return;
    }

    const client = parsed.protocol === 'https:' ? https : http;
    const request = client.get(parsed, (response) => {
      const statusCode = response.statusCode || 0;
      const location = response.headers.location;

      if (statusCode >= 300 && statusCode < 400 && location) {
        response.resume();
        if (redirectCount >= MAX_REDIRECTS) {
          reject(createTransferError(400, 'TRANSFER_DOWNLOAD_REDIRECT_LIMIT', 'Too many redirects while downloading.'));
          return;
        }
        const nextUrl = new URL(location, parsed).toString();
        resolve(downloadToFile(nextUrl, filePath, signal, onProgress, redirectCount + 1));
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(
          createTransferError(
            400,
            'TRANSFER_DOWNLOAD_FAILED',
            `Failed to download file (HTTP ${statusCode}).`,
            { statusCode }
          )
        );
        return;
      }

      const total = Number.parseInt(response.headers['content-length'], 10);
      let transferred = 0;
      const writable = createWriteStream(filePath, { flags: 'wx' });

      const onData = (chunk) => {
        transferred += chunk.length;
        onProgress(transferred, Number.isFinite(total) ? total : null);
      };

      response.on('data', onData);
      pipeline(response, writable)
        .then(() => resolve())
        .catch((err) => reject(err));
    });

    request.on('error', reject);

    const onAbort = () => {
      request.destroy(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function copyFileWithProgress(sourcePath, destinationPath, signal, onProgress) {
  return new Promise(async (resolve, reject) => {
    let totalBytes = null;
    try {
      const stats = await fs.stat(sourcePath);
      if (!stats.isFile()) {
        reject(createTransferError(400, 'TRANSFER_SOURCE_NOT_FILE', 'Source path must be a file.'));
        return;
      }
      totalBytes = stats.size;
    } catch (err) {
      reject(err);
      return;
    }

    const readStream = fs.createReadStream(sourcePath);
    const writeStream = fs.createWriteStream(destinationPath, { flags: 'wx' });
    let transferred = 0;

    const cleanup = () => {
      readStream.removeAllListeners();
      writeStream.removeAllListeners();
    };

    readStream.on('data', (chunk) => {
      transferred += chunk.length;
      onProgress(transferred, totalBytes);
    });

    readStream.on('error', (err) => {
      cleanup();
      reject(err);
    });

    writeStream.on('error', (err) => {
      cleanup();
      reject(err);
    });

    writeStream.on('finish', () => {
      cleanup();
      resolve();
    });

    const onAbort = () => {
      readStream.destroy(abortError());
      writeStream.destroy(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });

    readStream.pipe(writeStream);
  });
}

class TransferJobService {
  constructor() {
    this.jobs = new Map();
    this.queue = [];
    this.runningJobId = null;
  }

  async enqueueDownload(input) {
    const sourceUrl = String(input?.url || '').trim();
    const destinationDir = await validateManagedPath(input?.destinationDir, 'destination');
    const requestedName = String(input?.fileName || '').trim();

    if (!sourceUrl) {
      throw createTransferError(400, 'TRANSFER_URL_REQUIRED', 'A download URL is required.');
    }

    let derivedName = requestedName;
    if (!derivedName) {
      try {
        const urlObj = new URL(sourceUrl);
        const pathName = decodeURIComponent(urlObj.pathname || '');
        derivedName = path.basename(pathName) || 'download.bin';
      } catch (_err) {
        throw createTransferError(400, 'TRANSFER_INVALID_URL', 'A valid HTTP/HTTPS URL is required.');
      }
    }

    if (!isSafeLeafName(derivedName)) {
      throw createTransferError(400, 'TRANSFER_INVALID_FILENAME', 'Destination file name is invalid.');
    }

    await fs.ensureDir(destinationDir);

    const destinationPath = path.resolve(destinationDir, derivedName);
    await validateManagedPath(destinationPath, 'destination');

    const job = this.#createBaseJob({
      type: 'download',
      fileName: derivedName,
      source: { url: sourceUrl },
      destinationDir,
      destinationPath
    });

    this.#enqueue(job);
    return cloneJob(job);
  }

  async enqueueCopy(input) {
    const sourcePath = await validateManagedPath(input?.sourcePath, 'source');
    const destinationDir = await validateManagedPath(input?.destinationDir, 'destination');
    const requestedName = String(input?.fileName || '').trim();

    await fs.ensureDir(destinationDir);

    const sourceStats = await fs.stat(sourcePath).catch(() => null);
    if (!sourceStats) {
      throw createTransferError(404, 'TRANSFER_SOURCE_NOT_FOUND', 'Source path was not found.');
    }
    if (!sourceStats.isFile()) {
      throw createTransferError(400, 'TRANSFER_SOURCE_NOT_FILE', 'Source path must be a file.');
    }

    const leafName = requestedName || path.basename(sourcePath);
    if (!isSafeLeafName(leafName)) {
      throw createTransferError(400, 'TRANSFER_INVALID_FILENAME', 'Destination file name is invalid.');
    }

    const destinationPath = path.resolve(destinationDir, leafName);
    await validateManagedPath(destinationPath, 'destination');

    const job = this.#createBaseJob({
      type: 'copy',
      fileName: leafName,
      source: { path: sourcePath },
      destinationDir,
      destinationPath
    });

    this.#enqueue(job);
    return cloneJob(job);
  }

  listJobs() {
    return Array.from(this.jobs.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((job) => cloneJob(job));
  }

  getJob(jobId) {
    const job = this.jobs.get(jobId);
    return job ? cloneJob(job) : null;
  }

  cancelJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw createTransferError(404, 'TRANSFER_JOB_NOT_FOUND', 'Transfer job was not found.');
    }

    if (job.status === 'completed' || job.status === 'failed' || job.status === 'canceled') {
      throw createTransferError(409, 'TRANSFER_JOB_NOT_CANCELABLE', `Cannot cancel job in '${job.status}' status.`);
    }

    if (job.status === 'queued') {
      this.queue = this.queue.filter((id) => id !== jobId);
      job.status = 'canceled';
      job.endedAt = nowIso();
      job.error = {
        code: 'TRANSFER_JOB_CANCELED',
        message: 'Transfer job was canceled before execution.'
      };
      return cloneJob(job);
    }

    if (job.status === 'running' && job.abortController) {
      job.abortController.abort();
      return cloneJob(job);
    }

    throw createTransferError(409, 'TRANSFER_JOB_NOT_CANCELABLE', `Cannot cancel job in '${job.status}' status.`);
  }

  async retryJob(jobId) {
    const safeId = String(jobId || '').trim();
    const job = this.jobs.get(safeId);
    if (!job) {
      throw createTransferError(404, 'TRANSFER_JOB_NOT_FOUND', 'Transfer job was not found.');
    }

    if (!(job.status === 'failed' || job.status === 'canceled')) {
      throw createTransferError(
        409,
        'TRANSFER_JOB_RETRY_NOT_ALLOWED',
        `Retry is only allowed for failed/canceled jobs (current: '${job.status}').`
      );
    }

    if (job.type === 'download') {
      return this.enqueueDownload({
        url: job.source?.url,
        destinationDir: job.destinationDir,
        fileName: job.fileName
      });
    }

    if (job.type === 'copy') {
      return this.enqueueCopy({
        sourcePath: job.source?.path,
        destinationDir: job.destinationDir,
        fileName: job.fileName
      });
    }

    throw createTransferError(400, 'TRANSFER_JOB_TYPE_UNSUPPORTED', `Unsupported transfer type '${job.type}'.`);
  }

  clearJobs(options = {}) {
    const requested = Array.isArray(options.statuses) ? options.statuses : [];
    const normalized = new Set(
      requested
        .map((item) => String(item || '').trim().toLowerCase())
        .filter(Boolean)
    );

    const defaultStatuses = new Set(['completed', 'failed', 'canceled']);
    const targetStatuses = normalized.size > 0 ? normalized : defaultStatuses;

    if (targetStatuses.has('queued') || targetStatuses.has('running')) {
      throw createTransferError(400, 'TRANSFER_CLEAR_ACTIVE_NOT_ALLOWED', 'Cannot clear queued/running jobs.');
    }

    let removed = 0;
    for (const [id, job] of this.jobs.entries()) {
      const status = String(job.status || '').toLowerCase();
      if (!targetStatuses.has(status)) continue;
      this.jobs.delete(id);
      removed += 1;
    }

    this.queue = this.queue.filter((id) => this.jobs.has(id));
    return {
      removed,
      remaining: this.jobs.size
    };
  }

  getSummary() {
    const counts = {
      total: 0,
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      canceled: 0
    };

    for (const job of this.jobs.values()) {
      counts.total += 1;
      const status = String(job.status || '').toLowerCase();
      if (Object.prototype.hasOwnProperty.call(counts, status)) {
        counts[status] += 1;
      }
    }

    return counts;
  }

  #createBaseJob({ type, fileName, source, destinationDir, destinationPath }) {
    return {
      id: createJobId(),
      type,
      fileName: String(fileName || '').trim() || path.basename(destinationPath || ''),
      source,
      destinationDir,
      destinationPath,
      status: 'queued',
      createdAt: nowIso(),
      startedAt: null,
      endedAt: null,
      progress: {
        transferredBytes: 0,
        totalBytes: null,
        percent: 0,
        updatedAt: nowIso()
      },
      error: null,
      abortController: null
    };
  }

  #enqueue(job) {
    this.jobs.set(job.id, job);
    this.queue.push(job.id);
    this.#processQueue();
  }

  async #processQueue() {
    if (this.runningJobId || this.queue.length === 0) {
      return;
    }

    const nextJobId = this.queue.shift();
    const job = this.jobs.get(nextJobId);
    if (!job || job.status !== 'queued') {
      this.#processQueue();
      return;
    }

    this.runningJobId = job.id;
    job.status = 'running';
    job.startedAt = nowIso();
    job.abortController = new AbortController();

    try {
      await fs.pathExists(job.destinationPath).then((exists) => {
        if (exists) {
          throw createTransferError(409, 'TRANSFER_TARGET_EXISTS', 'Destination file already exists.');
        }
      });

      if (job.type === 'download') {
        await downloadToFile(
          job.source.url,
          job.destinationPath,
          job.abortController.signal,
          (transferredBytes, totalBytes) => setProgress(job, transferredBytes, totalBytes)
        );
      } else if (job.type === 'copy') {
        await copyFileWithProgress(
          job.source.path,
          job.destinationPath,
          job.abortController.signal,
          (transferredBytes, totalBytes) => setProgress(job, transferredBytes, totalBytes)
        );
      } else {
        throw createTransferError(400, 'TRANSFER_JOB_TYPE_UNSUPPORTED', `Unsupported transfer type '${job.type}'.`);
      }

      setProgress(job, job.progress.transferredBytes, job.progress.totalBytes);
      job.status = 'completed';
      job.endedAt = nowIso();
      job.error = null;
    } catch (err) {
      const mapped = mapJobRuntimeError(err);
      job.status = mapped.code === 'TRANSFER_JOB_CANCELED' ? 'canceled' : 'failed';
      job.endedAt = nowIso();
      job.error = {
        code: mapped.code,
        message: mapped.message,
        details: mapped.details
      };
      await fs.remove(job.destinationPath).catch(() => {});
    } finally {
      job.abortController = null;
      this.runningJobId = null;
      this.#processQueue();
    }
  }
}

module.exports = new TransferJobService();
