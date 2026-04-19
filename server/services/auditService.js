const fs = require('fs-extra');
const path = require('path');

const AUDIT_FILE = path.join(__dirname, '../storage/audit.log');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB

const auditService = {
  async log(type, action, details = {}) {
    try {
      const entry = {
        timestamp: new Date().toISOString(),
        type,
        action,
        ...details
      };

      await fs.ensureDir(path.dirname(AUDIT_FILE));
      
      // Log rotation: backup and reset if file exceeds MAX_LOG_SIZE
      try {
        const stats = await fs.stat(AUDIT_FILE);
        if (stats.size > MAX_LOG_SIZE) {
          const backupName = AUDIT_FILE.replace('.log', `_${Date.now()}.log`);
          await fs.rename(AUDIT_FILE, backupName);
          console.log(`[AUDIT] Rotated log to ${path.basename(backupName)}`);
        }
      } catch (e) { /* File doesn't exist yet, that's fine */ }

      await fs.appendFile(AUDIT_FILE, JSON.stringify(entry) + '\n', 'utf8');
    } catch (err) {
      console.error('[AUDIT] Failed to write log:', err.message);
    }
  },

  async getLogs(limit = 100) {
    try {
      if (await fs.pathExists(AUDIT_FILE)) {
        const content = await fs.readFile(AUDIT_FILE, 'utf8');
        return content.trim().split('\n').map(line => {
          try { return JSON.parse(line); } catch (e) { return null; }
        }).filter(Boolean).slice(-limit).reverse();
      }
      return [];
    } catch (err) {
      return [];
    }
  }
};

module.exports = auditService;

