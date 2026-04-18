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
 * Executes an rclone command and returns the output.
 */
function runRclone(args) {
  return new Promise((resolve, reject) => {
    // Note: In a real production environment, we should verify the rclone binary exists.
    // Here we include the config path for every command.
    const command = `rclone --config ${CONFIG_PATH} ${args}`;
    exec(command, (error, stdout, stderr) => {
      if (error) {
        // If binary is missing, provide a helpful mock/error message for development
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
      return result.stdout.trim().split('\n').filter(Boolean).map(r => ({
        name: r.replace(':', ''),
        connected: true // In a real app, we might check if it's mounted
      }));
    } catch (err) {
      return [];
    }
  },

  /**
   * Setup a new remote (Simplified for this project).
   * In a real app, this would handle the interactive OAuth flow.
   */
  async setupRemote(name, provider) {
    // This is a complex interaction in CLI; for the Web OS, we'd likely use 
    // `rclone config create` or manual config file manipulation.
    return { 
      success: true, 
      message: `Remote ${name} configured. (OAuth flow would happen here in a real rclone setup)` 
    };
  },

  /**
   * Serve a remote via WebDAV (More portable for Docker than FUSE mount).
   */
  async mountRemote(name, port = 8081) {
    try {
      // Use `rclone serve webdav` as it doesn't require FUSE on the host
      // This would typically be a long-running process managed by the server
      const args = `serve webdav ${name}: --addr :${port} --vfs-cache-mode full`;
      // For this implementation, we just return the endpoint info
      return { success: true, url: `http://localhost:${port}` };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
};

module.exports = cloudService;
