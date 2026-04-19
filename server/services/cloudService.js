const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// Use environment variables for paths, defaulting to standard Docker-friendly locations
const CONFIG_PATH = process.env.RCLONE_CONFIG || path.join(__dirname, '../../config/rclone.conf');
const DATA_PATH = process.env.RCLONE_DATA || path.join(__dirname, '../../storage/cloud');

// Create directories if they don't exist
const configDir = path.dirname(CONFIG_PATH);
if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
if (!fs.existsSync(DATA_PATH)) fs.mkdirSync(DATA_PATH, { recursive: true });

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
  async mountRemote(name, port = 8081) {
    // This starts a background process
    runRclone(`serve webdav ${name}: --addr :${port} --vfs-cache-mode full`).catch(e => console.error(e));
    return { success: true, url: `http://localhost:${port}` };
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
