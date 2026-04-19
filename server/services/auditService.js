const fs = require('fs-extra');
const path = require('path');

const AUDIT_FILE = path.join(__dirname, '../storage/audit.log');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB

const auditService = {
  async log(category, action, details = {}, level = 'INFO') {
    try {
      const entry = {
        timestamp: new Date().toISOString(),
        category, // SYSTEM, CONNECTION, FILE_TRANSFER
        level,    // INFO, WARNING, ERROR
        action,
        user: details.user || 'system',
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
      } catch (e) { /* File doesn't exist yet */ }

      await fs.appendFile(AUDIT_FILE, JSON.stringify(entry) + '\n', 'utf8');
    } catch (err) {
      console.error('[AUDIT] Failed to write log:', err.message);
    }
  },

  async getLogs(options = {}) {
    const { limit = 100, category, level, search } = options;
    try {
      if (await fs.pathExists(AUDIT_FILE)) {
        const content = await fs.readFile(AUDIT_FILE, 'utf8');
        let logs = content.trim().split('\n').map(line => {
          try { return JSON.parse(line); } catch (e) { return null; }
        }).filter(Boolean);

        // Server-side filtering
        if (category && category !== 'ALL') {
          logs = logs.filter(l => l.category === category);
        }
        if (level && level !== 'ALL') {
          logs = logs.filter(l => l.level === level);
        }
        if (search) {
          const q = search.toLowerCase();
          logs = logs.filter(l => 
            l.action.toLowerCase().includes(q) || 
            (l.user && l.user.toLowerCase().includes(q)) ||
            (l.path && l.path.toLowerCase().includes(q))
          );
        }

        return logs.slice(-limit).reverse();
      }
      return [];
    } catch (err) {
      console.error('[AUDIT] Error reading logs:', err);
      return [];
    }
  }
};

module.exports = auditService;

