const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

// Use environment variables for paths, defaulting to standard Docker-friendly locations
const CONFIG_PATH = process.env.RCLONE_CONFIG || path.join(__dirname, '../../config/rclone.conf');
const DATA_PATH = process.env.RCLONE_DATA || path.join(__dirname, '../../storage/cloud');

// Create directories if they don't exist
const configDir = path.dirname(CONFIG_PATH);
if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
if (!fs.existsSync(DATA_PATH)) fs.mkdirSync(DATA_PATH, { recursive: true });

const MAX_WRITE_BYTES = 5 * 1024 * 1024;
const mountSessions = new Map();

function createServiceError(code, message, status = 400, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  return error;
}

/**
 * Sanitize rclone remote name (alphanumeric, hyphens, underscores only)
 */
function sanitizeRemoteName(name) {
  if (!name || typeof name !== 'string') return null;
  if (!/^[a-zA-Z0-9_\-]+$/.test(name)) return null;
  return name;
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
      return reject(createServiceError('CLOUD_RCLONE_EXEC_FAILED', 'Failed to execute rclone command', 500, { reason: error.message }));
    });
    child.on('close', (code) => {
      if (code !== 0) {
        return reject(createServiceError('CLOUD_RCLONE_COMMAND_FAILED', 'rclone command failed', 502, { stdout, stderr, exitCode: code }));
      }
      return resolve({ stdout, stderr });
    });
    child.stdin.end(input);
  });
}

async function ensureRemoteExists(name) {
  const remotes = await cloudService.listRemotes();
  return remotes.some((remote) => remote.name === name);
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
 * Executes an rclone command and returns the output.
 */
function runRclone(args) {
  return new Promise((resolve, reject) => {
    const command = `rclone --config ${CONFIG_PATH} ${args}`;
    exec(command, (error, stdout, stderr) => {
      if (error) {
        if (error.code === 127) {
          return resolve({ success: false, error: 'rclone binary not found. Please install rclone.' });
        }
        return reject(stderr || stdout || error.message);
      }
      resolve({ success: true, stdout, stderr });
    });
  });
}

const cloudService = {
  /**
   * List all providers supported by rclone.
   */
  async listProviders() {
    try {
      const result = await runRclone('backend features');
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
      const result = await runRclone('listremotes');
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
      const result = await runRclone(`lsjson "${safeRemote}:${safePath}"`);
      if (!result.success) throw new Error(result.stderr);
      
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
      console.error(`[CLOUD] List entries failed for ${safeRemote}:`, err);
      throw err;
    }
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
      const result = await runRclone(`cat "${safeRemote}:${safePath}"`);
      if (!result.success) throw new Error(result.stderr);
      return result.stdout;
    } catch (err) {
      console.error(`[CLOUD] Cat failed for ${safeRemote}:${safePath}:`, err);
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
      '--vfs-cache-mode', 'full'
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
        finish({ ok: false, code: 'CLOUD_MOUNT_FAILED', message: `Failed to start mount: ${error.message}` });
      });
      child.once('exit', (code) => {
        finish({
          ok: false,
          code: 'CLOUD_MOUNT_FAILED',
          message: `Mount process exited early (code ${code})`,
          details: { stderr: startupError.trim() || null }
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

  /**
   * Add a new WebDAV remote using rclone config create
   */
  async addWebDAV(name, url, user, pass) {
    const safeName = sanitizeRemoteName(name);
    if (!safeName) throw new Error('Invalid remote name');
    
    // Obscure password
    let obscuredPass = pass;
    if (pass) {
      const obsResult = await runRclone(`obscure "${pass.replace(/"/g, '\\"')}"`);
      if (obsResult.success) {
        obscuredPass = obsResult.stdout.trim();
      }
    }
    
    const args = `config create ${safeName} webdav url="${url.replace(/"/g, '\\"')}" vendor=other user="${(user||'').replace(/"/g, '\\"')}" pass="${obscuredPass}"`;
    const result = await runRclone(args);
    if (!result.success) throw new Error(result.stderr);
    return { success: true };
  }
};

module.exports = cloudService;
