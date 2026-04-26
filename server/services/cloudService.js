const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');
const crypto = require('crypto');

// Use environment variables for paths, defaulting to standard Docker-friendly locations
const CONFIG_PATH = process.env.RCLONE_CONFIG || path.join(__dirname, '../../config/rclone.conf');
const DATA_PATH = process.env.RCLONE_DATA || path.join(__dirname, '../../storage/cloud');

// Create directories if they don't exist
const configDir = path.dirname(CONFIG_PATH);
if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
if (!fs.existsSync(DATA_PATH)) fs.mkdirSync(DATA_PATH, { recursive: true });

const MAX_WRITE_BYTES = 5 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;
const RCLONE_RETRY_FLAGS = [
  '--retries', process.env.RCLONE_RETRIES || '3',
  '--low-level-retries', process.env.RCLONE_LOW_LEVEL_RETRIES || '5',
  '--retries-sleep', process.env.RCLONE_RETRIES_SLEEP || '10s'
];
const RCLONE_VFS_CACHE_DIR = process.env.RCLONE_VFS_CACHE_DIR || path.join(DATA_PATH, '.vfs-cache');
const RCLONE_VFS_CACHE_MAX_SIZE = process.env.RCLONE_VFS_CACHE_MAX_SIZE || '2G';
const RCLONE_VFS_CACHE_MAX_AGE = process.env.RCLONE_VFS_CACHE_MAX_AGE || '24h';
const DEFAULT_PROVIDER_RETRY_MS = 15 * 60 * 1000;
const mountSessions = new Map();
const uploadJobs = new Map();

function createServiceError(code, message, status = 400, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  return error;
}

function createUploadJobId() {
  if (typeof crypto.randomUUID === 'function') {
    return `cloud-upload-${crypto.randomUUID()}`;
  }
  return `cloud-upload-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function nowIso() {
  return new Date().toISOString();
}

function cloneUploadJob(job) {
  if (!job) return null;
  const error = job.error ? { ...job.error } : null;
  return {
    id: job.id,
    status: job.status,
    remote: job.remote,
    path: job.path,
    fileName: job.fileName,
    provider: job.provider || inferProviderFromRemote(job.remote),
    rclone: job.rclone ? { ...job.rclone } : null,
    nextRetryAt: job.nextRetryAt || null,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    cancelRequestedAt: job.cancelRequestedAt || null,
    progress: { ...job.progress },
    error,
    errors: error ? [error] : []
  };
}

function createUploadJob({ remote, targetPath, fileName, totalBytes }) {
  const job = {
    id: createUploadJobId(),
    status: 'queued',
    remote,
    path: targetPath,
    fileName,
    provider: inferProviderFromRemote(remote),
    rclone: {
      command: 'rcat',
      flags: [...RCLONE_RETRY_FLAGS]
    },
    nextRetryAt: null,
    createdAt: nowIso(),
    startedAt: null,
    endedAt: null,
    cancelRequestedAt: null,
    progress: {
      uploadedBytes: 0,
      totalBytes,
      percent: totalBytes > 0 ? 0 : 100
    },
    error: null,
    child: null,
    input: null,
    cancelRequested: false
  };
  uploadJobs.set(job.id, job);
  return job;
}

function updateUploadProgress(job, uploadedBytes) {
  job.progress.uploadedBytes = Math.min(uploadedBytes, job.progress.totalBytes);
  job.progress.percent = job.progress.totalBytes > 0
    ? Math.min(100, Math.round((job.progress.uploadedBytes / job.progress.totalBytes) * 100))
    : 100;
}

function redactSensitiveOutput(value) {
  return String(value || '')
    .replace(/\b(authorization)\s*[:=]\s*(bearer\s+)?[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/\b(token|grantId|ticket|code|secret|password|pass)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
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

function inferProviderPolicy(err, provider) {
  const details = err?.details && typeof err.details === 'object' ? err.details : {};
  const haystack = [
    err?.message,
    details.stderr,
    details.stderrSummary,
    details.stdout,
    details.stdoutSummary,
    details.reason,
    details.exitCode,
    provider
  ].map((item) => String(item || '').toLowerCase()).join(' ');

  if (provider === 'drive' || haystack.includes('google') || haystack.includes('drive')) {
    if (/\b403\b|\b429\b|quota|rate limit|ratelimit|user rate limit|daily limit|download quota|storage quota/.test(haystack)) {
      const quotaLike = /quota|daily limit|storage quota|download quota/.test(haystack);
      return {
        status: quotaLike ? 'paused_by_quota' : 'backoff',
        code: quotaLike ? 'CLOUD_PROVIDER_QUOTA' : 'CLOUD_PROVIDER_BACKOFF',
        message: quotaLike
          ? 'Google Drive quota paused this upload.'
          : 'Google Drive rate limit requires retry backoff.',
        retryable: true
      };
    }
  }

  if (provider === 'webdav' || haystack.includes('webdav') || haystack.includes('dav')) {
    if (/timeout|timed out|429|503|rate limit|too many requests|temporarily unavailable|connection reset|econnreset|etimedout/.test(haystack)) {
      return {
        status: 'backoff',
        code: 'CLOUD_PROVIDER_BACKOFF',
        message: 'WebDAV provider asked the upload to retry later.',
        retryable: true
      };
    }
  }

  return null;
}

function mapRcloneUploadError(err, job = null) {
  if (err?.code === 'CLOUD_UPLOAD_CANCELED') return err;
  const provider = job?.provider || inferProviderFromRemote(job?.remote);
  const providerPolicy = inferProviderPolicy(err, provider);
  if (providerPolicy) {
    const details = err?.details && typeof err.details === 'object' ? err.details : {};
    return createServiceError(providerPolicy.code, providerPolicy.message, 429, {
      provider,
      retryable: providerPolicy.retryable,
      suggestedStatus: providerPolicy.status,
      exitCode: details.exitCode ?? null,
      signal: details.signal ?? null,
      stderrSummary: summarizeOutput(details.stderrSummary || details.stderr || err?.message),
      stdoutSummary: summarizeOutput(details.stdoutSummary || details.stdout)
    });
  }
  if (err?.code) return err;
  return createServiceError(
    'CLOUD_UPLOAD_FAILED',
    err?.message || 'Failed to upload remote file',
    502,
    err?.details
  );
}

/**
 * Sanitize rclone remote name (alphanumeric, hyphens, underscores only)
 */
function sanitizeRemoteName(name) {
  if (!name || typeof name !== 'string') return null;
  if (!/^[a-zA-Z0-9_\-]+$/.test(name)) return null;
  return name;
}

function sanitizeProviderName(name) {
  if (!name || typeof name !== 'string') return null;
  const trimmed = name.trim().toLowerCase();
  if (!/^[a-z0-9_\-]+$/.test(trimmed)) return null;
  return trimmed;
}

function sanitizeWebDavUrl(value) {
  if (!value || typeof value !== 'string' || value.length > 2048) return null;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:', 'webdav:', 'webdavs:'].includes(parsed.protocol)) return null;
    if (!parsed.hostname) return null;
    return parsed.toString();
  } catch (_err) {
    return null;
  }
}

function sanitizeCredentialValue(value, maxLength = 1024) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return null;
  if (value.length > maxLength) return null;
  if (/[\0\r\n]/.test(value)) return null;
  return value;
}

/**
 * Sanitize remote path (reject shell metacharacters)
 */
function sanitizePath(p) {
  if (!p || typeof p !== 'string') return '';
  // Block dangerous shell characters
  if (/[;|&$`\\!><]/.test(p)) return null;
  return p;
}

function sanitizeFileName(name) {
  if (!name || typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..') return null;
  if (trimmed.includes('/') || trimmed.includes('\\')) return null;
  if (trimmed.includes('..')) return null;
  return sanitizePath(trimmed);
}

function normalizeLsJsonEntry(payload, remotePath = '') {
  const entries = Array.isArray(payload) ? payload : [payload];
  const item = entries.find((candidate) => candidate && typeof candidate === 'object') || null;
  if (!item) return null;
  const size = Number(item.Size);
  const modTime = item.ModTime || item.Modtime || item.ModTimeString || null;
  const mtimeMs = modTime ? Date.parse(modTime) : NaN;
  return {
    name: item.Name || path.posix.basename(remotePath) || '',
    path: item.Path || remotePath,
    isDirectory: item.IsDir === true,
    size: Number.isFinite(size) && size >= 0 ? size : 0,
    mtime: modTime,
    mtimeMs: Number.isFinite(mtimeMs) ? mtimeMs : Date.now(),
    mimeType: item.MimeType || null
  };
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (_) {
    return false;
  }
}

function checkPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function allocatePort(start = 18081, end = 18200) {
  for (let port = start; port <= end; port += 1) {
    // eslint-disable-next-line no-await-in-loop
    const available = await checkPortAvailable(port);
    if (available) return port;
  }
  return null;
}

function runRcloneWithInput(args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn('rclone', ['--config', CONFIG_PATH, ...args], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      if (error && error.code === 'ENOENT') {
        return reject(createServiceError('CLOUD_RCLONE_NOT_FOUND', 'rclone binary not found. Please install rclone.', 500));
      }
      return reject(createServiceError('CLOUD_RCLONE_EXEC_FAILED', 'Failed to execute rclone command', 500, { reason: summarizeOutput(error.message) }));
    });
    child.on('close', (code) => {
      if (code !== 0) {
        return reject(createServiceError('CLOUD_RCLONE_COMMAND_FAILED', 'rclone command failed', 502, {
          stdoutSummary: summarizeOutput(stdout),
          stderrSummary: summarizeOutput(stderr),
          exitCode: code
        }));
      }
      return resolve({ stdout, stderr });
    });
    child.stdin.end(input);
  });
}

function runRcloneWithStream(args, stream, job = null) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      if (job) {
        job.child = null;
        job.input = null;
      }
      handler(value);
    };
    const child = spawn('rclone', ['--config', CONFIG_PATH, ...RCLONE_RETRY_FLAGS, ...args], {
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    if (job) {
      job.child = child;
      job.input = stream;
    }
    let stdout = '';
    let stderr = '';
    let uploadedBytes = 0;
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    stream.on('data', (chunk) => {
      if (!job) return;
      uploadedBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
      updateUploadProgress(job, uploadedBytes);
    });
    child.on('error', (error) => {
      if (job?.cancelRequested) {
        return finish(reject, createServiceError('CLOUD_UPLOAD_CANCELED', 'Cloud upload was canceled.', 499));
      }
      if (error && error.code === 'ENOENT') {
        return finish(reject, createServiceError('CLOUD_RCLONE_NOT_FOUND', 'rclone binary not found. Please install rclone.', 500));
      }
      return finish(reject, createServiceError('CLOUD_RCLONE_EXEC_FAILED', 'Failed to execute rclone command', 500, { reason: summarizeOutput(error.message) }));
    });
    child.on('close', (code, signal) => {
      if (job?.cancelRequested) {
        return finish(reject, createServiceError('CLOUD_UPLOAD_CANCELED', 'Cloud upload was canceled.', 499, { signal }));
      }
      if (code !== 0) {
        return finish(reject, createServiceError('CLOUD_RCLONE_COMMAND_FAILED', 'rclone command failed', 502, {
          stdoutSummary: summarizeOutput(stdout),
          stderrSummary: summarizeOutput(stderr),
          exitCode: code,
          signal,
          provider: job?.provider || inferProviderFromRemote(job?.remote)
        }));
      }
      return finish(resolve, { stdout, stderr });
    });

    stream.on('error', (err) => {
      if (job?.cancelRequested) return;
      child.stdin.destroy(err);
    });
    stream.pipe(child.stdin);
  });
}

async function ensureRemoteExists(name) {
  const remotes = await cloudService.listRemotes();
  return remotes.some((remote) => remote.name === name);
}

async function validateUploadFileFromPath(remote, remotePath, fileName, filePath) {
  const safeRemote = sanitizeRemoteName(remote);
  if (!safeRemote) {
    throw createServiceError('CLOUD_UPLOAD_INVALID_REMOTE', 'Invalid remote name', 400);
  }

  const safeDirPath = sanitizePath(remotePath || '');
  if (safeDirPath === null) {
    throw createServiceError('CLOUD_UPLOAD_INVALID_PATH', 'Invalid remote path', 400);
  }

  const safeFileName = sanitizeFileName(fileName || '');
  if (safeFileName === null || !safeFileName.trim()) {
    throw createServiceError('CLOUD_UPLOAD_INVALID_FILENAME', 'Invalid file name', 400);
  }

  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw createServiceError('CLOUD_UPLOAD_INVALID_FILE', 'Invalid temporary upload file path', 400);
  }

  let stats = null;
  try {
    stats = await fs.promises.stat(filePath);
  } catch (_err) {
    throw createServiceError('CLOUD_UPLOAD_INVALID_FILE', 'Uploaded file does not exist', 400);
  }

  if (!stats.isFile()) {
    throw createServiceError('CLOUD_UPLOAD_INVALID_FILE', 'Uploaded path is not a file', 400);
  }

  if (stats.size > MAX_UPLOAD_BYTES) {
    throw createServiceError('CLOUD_UPLOAD_TOO_LARGE', `File exceeds ${MAX_UPLOAD_BYTES} bytes`, 413);
  }

  const remoteExists = await ensureRemoteExists(safeRemote);
  if (!remoteExists) {
    throw createServiceError('CLOUD_UPLOAD_REMOTE_NOT_FOUND', 'Remote not found', 404, { remote: safeRemote });
  }

  const targetPath = safeDirPath
    ? `${safeDirPath.replace(/\/+$/, '')}/${safeFileName}`
    : safeFileName;

  return {
    safeRemote,
    safeFileName,
    targetPath,
    size: stats.size
  };
}

function getSessionStatus(name, session = null) {
  const current = session || mountSessions.get(name);
  if (!current) {
    return {
      name,
      status: 'unmounted',
      mountUrl: null,
      details: {}
    };
  }
  const alive = isPidAlive(current.pid);
  if (alive) {
    return {
      name,
      status: 'mounted',
      mountUrl: current.mountUrl,
      details: {
        pid: current.pid,
        port: current.port,
        startedAt: current.startedAt
      }
    };
  }
  return {
    name,
    status: current.lastError ? 'error' : 'unmounted',
    mountUrl: current.mountUrl || null,
    details: {
      pid: current.pid,
      port: current.port,
      startedAt: current.startedAt,
      lastError: current.lastError || null
    }
  };
}

/**
 * Executes an rclone command without a shell and returns the output.
 */
function runRclone(args = []) {
  return new Promise((resolve, reject) => {
    const childArgs = Array.isArray(args) ? args.map((arg) => String(arg)) : [String(args)];
    const child = spawn('rclone', ['--config', CONFIG_PATH, ...childArgs], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      if (error && error.code === 'ENOENT') {
        return resolve({ success: false, error: 'rclone binary not found. Please install rclone.' });
      }
      return reject(createServiceError('CLOUD_RCLONE_EXEC_FAILED', 'Failed to execute rclone command', 500, {
        reason: summarizeOutput(error.message)
      }));
    });
    child.on('close', (code) => {
      if (code !== 0) {
        return resolve({
          success: false,
          stdout,
          stderr,
          error: summarizeOutput(stderr || stdout) || `rclone exited with code ${code}`,
          exitCode: code
        });
      }
      return resolve({ success: true, stdout, stderr });
    });
  });
}

const cloudService = {
  /**
   * List all providers supported by rclone.
   */
  async listProviders() {
    try {
      await runRclone(['backend', 'features']);
      // For now, return a static list if rclone fails or for quicker UX
      // In reality, we'd parse `rclone config providers`
      return [
        { id: 'drive', name: 'Google Drive' },
        { id: 'dropbox', name: 'Dropbox' },
        { id: 'onedrive', name: 'OneDrive' },
        { id: 's3', name: 'Amazon S3' }
      ];
    } catch (err) {
      return [];
    }
  },

  /**
   * List currently configured remotes.
   */
  async listRemotes() {
    try {
      const result = await runRclone(['listremotes']);
      if (!result.success) return [];
      
      const remotes = result.stdout.trim().split('\n').filter(Boolean).map(r => ({
        name: r.replace(':', ''),
        type: 'cloud'
      }));
      return remotes;
    } catch (err) {
      console.error('[CLOUD] List remotes failed:', err);
      return [];
    }
  },

  /**
   * List entries in a remote path.
   */
  async listEntries(remote, remotePath = '') {
    const safeRemote = sanitizeRemoteName(remote);
    if (!safeRemote) throw new Error('Invalid remote name');
    const safePath = sanitizePath(remotePath);
    if (safePath === null) throw new Error('Invalid path characters');
    try {
      const result = await runRclone(['lsjson', `${safeRemote}:${safePath}`]);
      if (!result.success) {
        throw createServiceError('CLOUD_LIST_RCLONE_FAILED', 'Failed to list remote entries', 502, {
          stderrSummary: summarizeOutput(result.stderr || result.error),
          exitCode: result.exitCode ?? null
        });
      }
      
      const entries = JSON.parse(result.stdout);
      return entries.map(item => ({
        name: item.Name,
        path: item.Path,
        isDirectory: item.IsDir,
        size: item.Size,
        mtime: item.ModTime,
        mimeType: item.MimeType
      }));
    } catch (err) {
      console.error(`[CLOUD] List entries failed for ${safeRemote}: ${summarizeOutput(err?.message || err)}`);
      throw err;
    }
  },

  async getEntryMetadata(remote, remotePath = '') {
    const safeRemote = sanitizeRemoteName(remote);
    if (!safeRemote) {
      throw createServiceError('CLOUD_INVALID_REMOTE', 'Invalid remote name', 400);
    }
    const safePath = sanitizePath(remotePath);
    if (safePath === null || !safePath.trim()) {
      throw createServiceError('CLOUD_INVALID_PATH', 'Invalid remote path', 400);
    }

    const result = await runRclone(['lsjson', `${safeRemote}:${safePath}`]);
    if (!result.success) {
      throw createServiceError('CLOUD_ENTRY_STAT_FAILED', 'Failed to inspect remote entry', 502, {
        stderrSummary: summarizeOutput(result.stderr || result.error),
        exitCode: result.exitCode ?? null
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(result.stdout);
    } catch (_err) {
      throw createServiceError('CLOUD_ENTRY_STAT_INVALID', 'Remote entry metadata was invalid', 502);
    }

    const entry = normalizeLsJsonEntry(parsed, safePath);
    if (!entry) {
      throw createServiceError('CLOUD_ENTRY_NOT_FOUND', 'Remote entry was not found', 404, {
        remote: safeRemote,
        path: safePath
      });
    }
    return {
      ...entry,
      remote: safeRemote
    };
  },

  createReadStream(remote, remotePath = '', options = {}) {
    const safeRemote = sanitizeRemoteName(remote);
    if (!safeRemote) {
      throw createServiceError('CLOUD_INVALID_REMOTE', 'Invalid remote name', 400);
    }
    const safePath = sanitizePath(remotePath);
    if (safePath === null || !safePath.trim()) {
      throw createServiceError('CLOUD_INVALID_PATH', 'Invalid remote path', 400);
    }

    const args = ['cat', `${safeRemote}:${safePath}`];
    const offset = Number(options.offset);
    const count = Number(options.count);
    if (Number.isFinite(offset) && offset >= 0) {
      args.push('--offset', String(Math.trunc(offset)));
    }
    if (Number.isFinite(count) && count >= 0) {
      args.push('--count', String(Math.trunc(count)));
    }

    return spawn('rclone', ['--config', CONFIG_PATH, ...args], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
  },

  /**
   * Get file content from a remote.
   */
  async getFileContent(remote, remotePath) {
    const safeRemote = sanitizeRemoteName(remote);
    if (!safeRemote) throw new Error('Invalid remote name');
    const safePath = sanitizePath(remotePath);
    if (safePath === null) throw new Error('Invalid path characters');
    try {
      const result = await runRclone(['cat', `${safeRemote}:${safePath}`]);
      if (!result.success) {
        throw createServiceError('CLOUD_READ_RCLONE_FAILED', 'Failed to read remote file', 502, {
          stderrSummary: summarizeOutput(result.stderr || result.error),
          exitCode: result.exitCode ?? null
        });
      }
      return result.stdout;
    } catch (err) {
      console.error(`[CLOUD] Cat failed for ${safeRemote}: ${summarizeOutput(err?.message || err)}`);
      throw err;
    }
  },

  /**
   * Serve a remote via WebDAV (fallback for complex mounts).
   */
  async mountRemote(name, port = null) {
    const safeName = sanitizeRemoteName(name);
    if (!safeName) {
      throw createServiceError('CLOUD_MOUNT_INVALID_NAME', 'Invalid remote name', 400);
    }
    const remoteExists = await ensureRemoteExists(safeName);
    if (!remoteExists) {
      throw createServiceError('CLOUD_MOUNT_REMOTE_NOT_FOUND', 'Remote not found', 404, { name: safeName });
    }

    const existing = mountSessions.get(safeName);
    if (existing && isPidAlive(existing.pid)) {
      return {
        success: true,
        mountUrl: existing.mountUrl,
        url: existing.mountUrl,
        status: 'mounted',
        details: {
          pid: existing.pid,
          port: existing.port,
          alreadyMounted: true
        }
      };
    }

    let assignedPort = null;
    if (Number.isInteger(port) && port > 0) {
      const available = await checkPortAvailable(port);
      if (!available) {
        throw createServiceError('CLOUD_MOUNT_PORT_IN_USE', `Requested port ${port} is already in use`, 409);
      }
      assignedPort = port;
    } else {
      assignedPort = await allocatePort();
    }
    if (!assignedPort) {
      throw createServiceError('CLOUD_MOUNT_NO_PORT', 'No available local port for mount', 503);
    }

    const args = [
      '--config', CONFIG_PATH,
      'serve', 'webdav', `${safeName}:`,
      '--addr', `127.0.0.1:${assignedPort}`,
      '--vfs-cache-mode', 'full',
      '--cache-dir', RCLONE_VFS_CACHE_DIR,
      '--vfs-cache-max-size', RCLONE_VFS_CACHE_MAX_SIZE,
      '--vfs-cache-max-age', RCLONE_VFS_CACHE_MAX_AGE
    ];

    const child = spawn('rclone', args, {
      detached: true,
      stdio: ['ignore', 'ignore', 'pipe']
    });

    let startupError = '';
    child.stderr.on('data', (chunk) => {
      startupError += String(chunk);
    });

    const startupResult = await new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (!settled) {
          settled = true;
          resolve(result);
        }
      };
      child.once('error', (error) => {
        if (error && error.code === 'ENOENT') {
          finish({ ok: false, code: 'CLOUD_RCLONE_NOT_FOUND', message: 'rclone binary not found. Please install rclone.' });
          return;
        }
        finish({ ok: false, code: 'CLOUD_MOUNT_FAILED', message: `Failed to start mount: ${summarizeOutput(error.message)}` });
      });
      child.once('exit', (code) => {
        finish({
          ok: false,
          code: 'CLOUD_MOUNT_FAILED',
          message: `Mount process exited early (code ${code})`,
          details: { stderrSummary: summarizeOutput(startupError) }
        });
      });
      setTimeout(() => finish({ ok: true }), 500);
    });

    if (!startupResult.ok) {
      throw createServiceError(startupResult.code, startupResult.message, 502, startupResult.details);
    }

    child.unref();
    const session = {
      name: safeName,
      pid: child.pid,
      port: assignedPort,
      mountUrl: `http://127.0.0.1:${assignedPort}`,
      startedAt: new Date().toISOString(),
      lastError: null
    };
    mountSessions.set(safeName, session);

    return {
      success: true,
      mountUrl: session.mountUrl,
      url: session.mountUrl,
      status: 'mounted',
      details: {
        pid: session.pid,
        port: session.port
      },
      vfsCache: {
        dir: RCLONE_VFS_CACHE_DIR,
        maxSize: RCLONE_VFS_CACHE_MAX_SIZE,
        maxAge: RCLONE_VFS_CACHE_MAX_AGE
      }
    };
  },

  async getMountStatus(name = null) {
    if (name) {
      const safeName = sanitizeRemoteName(name);
      if (!safeName) {
        throw createServiceError('CLOUD_MOUNT_STATUS_INVALID_NAME', 'Invalid remote name', 400);
      }
      const remoteExists = await ensureRemoteExists(safeName);
      if (!remoteExists) {
        throw createServiceError('CLOUD_MOUNT_STATUS_REMOTE_NOT_FOUND', 'Remote not found', 404, { name: safeName });
      }
      return getSessionStatus(safeName);
    }

    const remotes = await cloudService.listRemotes();
    return remotes.map((remote) => getSessionStatus(remote.name));
  },

  async writeRemoteFile(remote, remotePath, content) {
    const safeRemote = sanitizeRemoteName(remote);
    if (!safeRemote) {
      throw createServiceError('CLOUD_WRITE_INVALID_REMOTE', 'Invalid remote name', 400);
    }
    const safePath = sanitizePath(remotePath);
    if (safePath === null || !safePath.trim()) {
      throw createServiceError('CLOUD_WRITE_INVALID_PATH', 'Invalid remote file path', 400);
    }
    if (typeof content !== 'string') {
      throw createServiceError('CLOUD_WRITE_INVALID_CONTENT', 'Content must be a text string', 400);
    }
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > MAX_WRITE_BYTES) {
      throw createServiceError('CLOUD_WRITE_CONTENT_TOO_LARGE', `Content exceeds ${MAX_WRITE_BYTES} bytes`, 413);
    }

    const remoteExists = await ensureRemoteExists(safeRemote);
    if (!remoteExists) {
      throw createServiceError('CLOUD_WRITE_REMOTE_NOT_FOUND', 'Remote not found', 404, { remote: safeRemote });
    }

    await runRcloneWithInput(['rcat', `${safeRemote}:${safePath}`], content);
    return {
      success: true,
      remote: safeRemote,
      path: safePath,
      writtenBytes: bytes
    };
  },

  async uploadRemoteFile(remote, remotePath, fileName, buffer) {
    const safeRemote = sanitizeRemoteName(remote);
    if (!safeRemote) {
      throw createServiceError('CLOUD_UPLOAD_INVALID_REMOTE', 'Invalid remote name', 400);
    }

    const safeDirPath = sanitizePath(remotePath || '');
    if (safeDirPath === null) {
      throw createServiceError('CLOUD_UPLOAD_INVALID_PATH', 'Invalid remote path', 400);
    }

    const safeFileName = sanitizePath(fileName || '');
    if (safeFileName === null || !safeFileName.trim()) {
      throw createServiceError('CLOUD_UPLOAD_INVALID_FILENAME', 'Invalid file name', 400);
    }

    if (!Buffer.isBuffer(buffer)) {
      throw createServiceError('CLOUD_UPLOAD_INVALID_CONTENT', 'Uploaded file content is invalid', 400);
    }

    if (buffer.length > MAX_UPLOAD_BYTES) {
      throw createServiceError('CLOUD_UPLOAD_TOO_LARGE', `File exceeds ${MAX_UPLOAD_BYTES} bytes`, 413);
    }

    const remoteExists = await ensureRemoteExists(safeRemote);
    if (!remoteExists) {
      throw createServiceError('CLOUD_UPLOAD_REMOTE_NOT_FOUND', 'Remote not found', 404, { remote: safeRemote });
    }

    const targetPath = safeDirPath
      ? `${safeDirPath.replace(/\/+$/, '')}/${safeFileName}`
      : safeFileName;

    await runRcloneWithInput(['rcat', `${safeRemote}:${targetPath}`], buffer);
    return {
      success: true,
      remote: safeRemote,
      path: targetPath,
      uploadedBytes: buffer.length
    };
  },

  async uploadRemoteFileFromPath(remote, remotePath, fileName, filePath) {
    const job = await cloudService.startUploadRemoteFileFromPath(remote, remotePath, fileName, filePath);

    const completed = await job.completion;
    return {
      success: true,
      remote: completed.remote,
      path: completed.path,
      uploadedBytes: completed.progress.uploadedBytes,
      job: completed,
      jobId: completed.id,
      status: completed.status
    };
  },

  async startUploadRemoteFileFromPath(remote, remotePath, fileName, filePath, options = {}) {
    const upload = await validateUploadFileFromPath(remote, remotePath, fileName, filePath);
    const job = createUploadJob({
      remote: upload.safeRemote,
      targetPath: upload.targetPath,
      fileName: upload.safeFileName,
      totalBytes: upload.size
    });

    const cleanup = typeof options.cleanup === 'function' ? options.cleanup : null;
    job.status = 'running';
    job.startedAt = nowIso();
    const input = fs.createReadStream(filePath);
    job.completion = runRcloneWithStream(['rcat', `${upload.safeRemote}:${upload.targetPath}`], input, job)
      .then(() => {
        updateUploadProgress(job, upload.size);
        job.status = 'completed';
        job.endedAt = nowIso();
        return cloneUploadJob(job);
      })
      .catch((err) => {
        const mapped = mapRcloneUploadError(err, job);
        const suggestedStatus = mapped.details?.suggestedStatus;
        job.status = mapped.code === 'CLOUD_UPLOAD_CANCELED'
          ? 'canceled'
          : (suggestedStatus || 'failed');
        job.endedAt = nowIso();
        job.nextRetryAt = mapped.details?.retryable
          ? new Date(Date.now() + DEFAULT_PROVIDER_RETRY_MS).toISOString()
          : null;
        job.error = {
          code: mapped.code || 'CLOUD_UPLOAD_FAILED',
          message: mapped.message || 'Failed to upload remote file',
          details: mapped.details || null
        };
        throw mapped;
      })
      .finally(async () => {
        job.child = null;
        job.input = null;
        if (cleanup) await cleanup().catch(() => {});
      });

    return job;
  },

  listUploadJobs() {
    return Array.from(uploadJobs.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((job) => cloneUploadJob(job));
  },

  getUploadJob(jobId) {
    const safeId = String(jobId || '').trim();
    return cloneUploadJob(uploadJobs.get(safeId));
  },

  cancelUploadJob(jobId) {
    const safeId = String(jobId || '').trim();
    const job = uploadJobs.get(safeId);
    if (!job) {
      throw createServiceError('CLOUD_UPLOAD_JOB_NOT_FOUND', 'Cloud upload job was not found.', 404);
    }

    if (job.status === 'completed' || job.status === 'failed' || job.status === 'canceled') {
      throw createServiceError(
        'CLOUD_UPLOAD_JOB_NOT_CANCELABLE',
        `Cloud upload job cannot be canceled in "${job.status}" status.`,
        409
      );
    }

    job.cancelRequested = true;
    job.cancelRequestedAt = nowIso();

    if (job.status === 'queued') {
      job.status = 'canceled';
      job.endedAt = nowIso();
      job.error = {
        code: 'CLOUD_UPLOAD_CANCELED',
        message: 'Cloud upload was canceled before execution.'
      };
      return cloneUploadJob(job);
    }

    if (job.status === 'running' && job.child) {
      job.status = 'canceled';
      job.endedAt = nowIso();
      job.error = {
        code: 'CLOUD_UPLOAD_CANCELED',
        message: 'Cloud upload cancellation was requested.'
      };
      if (job.input) {
        job.input.destroy(createServiceError('CLOUD_UPLOAD_CANCELED', 'Cloud upload was canceled.', 499));
      }
      try {
        process.kill(-job.child.pid, 'SIGTERM');
      } catch (_err) {
        job.child.kill('SIGTERM');
      }
      return cloneUploadJob(job);
    }

    throw createServiceError(
      'CLOUD_UPLOAD_CANCEL_UNAVAILABLE',
      'Cloud upload cancellation is unavailable for this job.',
      409,
      { status: job.status }
    );
  },

  async setupRemote(name, provider) {
    const safeName = sanitizeRemoteName(name);
    const safeProvider = sanitizeProviderName(provider);
    if (!safeName) {
      throw createServiceError('CLOUD_SETUP_INVALID_NAME', 'Invalid remote name', 400);
    }
    if (!safeProvider) {
      throw createServiceError('CLOUD_SETUP_INVALID_PROVIDER', 'Invalid provider name', 400);
    }

    const result = await runRclone(['config', 'create', safeName, safeProvider]);
    if (!result.success) {
      throw createServiceError('CLOUD_SETUP_FAILED', 'Failed to create rclone remote', 502, {
        stderrSummary: summarizeOutput(result.stderr || result.error),
        stdoutSummary: summarizeOutput(result.stdout),
        exitCode: result.exitCode ?? null
      });
    }

    return {
      success: true,
      name: safeName,
      provider: safeProvider
    };
  },

  /**
   * Add a new WebDAV remote using rclone config create
   */
  async addWebDAV(name, url, user, pass) {
    const safeName = sanitizeRemoteName(name);
    const safeUrl = sanitizeWebDavUrl(url);
    const safeUser = sanitizeCredentialValue(user || '');
    const safePass = sanitizeCredentialValue(pass || '');
    if (!safeName) throw createServiceError('CLOUD_ADD_WEBDAV_INVALID_NAME', 'Invalid remote name', 400);
    if (!safeUrl) throw createServiceError('CLOUD_ADD_WEBDAV_INVALID_URL', 'Invalid WebDAV URL', 400);
    if (safeUser === null || safePass === null) {
      throw createServiceError('CLOUD_ADD_WEBDAV_INVALID_CREDENTIALS', 'Invalid WebDAV credentials', 400);
    }
    
    let obscuredPass = safePass;
    if (safePass) {
      const obsResult = await runRclone(['obscure', safePass]);
      if (obsResult.success) {
        obscuredPass = obsResult.stdout.trim();
      }
    }
    
    const result = await runRclone([
      'config',
      'create',
      safeName,
      'webdav',
      `url=${safeUrl}`,
      'vendor=other',
      `user=${safeUser}`,
      `pass=${String(obscuredPass || '')}`
    ]);
    if (!result.success) {
      throw createServiceError('CLOUD_ADD_WEBDAV_RCLONE_FAILED', 'Failed to add WebDAV remote', 502, {
        stderrSummary: summarizeOutput(result.stderr || result.error),
        stdoutSummary: summarizeOutput(result.stdout),
        exitCode: result.exitCode ?? null
      });
    }
    return { success: true };
  }
};

module.exports = cloudService;
