const fs = require('fs-extra');
const path = require('path');

const AUDIT_FILE = path.join(__dirname, '../storage/audit.log'); // Use .log for JSONL

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
      // Append as single line JSON
      await fs.appendFile(AUDIT_FILE, JSON.stringify(entry) + '\n', 'utf8');
      console.log(`[AUDIT] ${type} | ${action} | ${JSON.stringify(details)}`);
    } catch (err) {
      console.error('[AUDIT] Failed to write log:', err.message);
    }
  },

  async getLogs() {
    try {
      if (await fs.pathExists(AUDIT_FILE)) {
        const content = await fs.readFile(AUDIT_FILE, 'utf8');
        return content.trim().split('\n').map(line => {
          try { return JSON.parse(line); } catch (e) { return null; }
        }).filter(Boolean).slice(-1000);
      }
      return [];
    } catch (err) {
      return [];
    }
  }
};

module.exports = auditService;
