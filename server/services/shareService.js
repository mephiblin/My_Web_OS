const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

const DB_FILE = path.join(__dirname, '../storage/shares.json');
let shares = new Map();
let cleanupInterval = null;
let startedAt = null;
let lastError = null;

const shareService = {
  name: 'share',

  async init() {
    await fs.ensureFile(DB_FILE);
    try {
      const data = await fs.readJson(DB_FILE);
      shares = new Map(Object.entries(data));
      await this.cleanup();
      if (cleanupInterval) clearInterval(cleanupInterval);
      cleanupInterval = setInterval(() => {
        this.cleanup().catch((err) => {
          lastError = err.message;
          console.error('[SHARE] Cleanup error:', err.message);
        });
      }, 60 * 60 * 1000); // 1 hour
      startedAt = Date.now();
      lastError = null;
    } catch (err) {
      lastError = err.message;
      await fs.writeJson(DB_FILE, {});
    }
    startedAt = Date.now();
    console.log('[SHARE] Initialized DB');
  },

  async save() {
    await fs.writeJson(DB_FILE, Object.fromEntries(shares));
  },

  async createShare(filePath, expiryHours) {
    const id = crypto.randomUUID();
    const expiryDate = expiryHours > 0 ? Date.now() + (expiryHours * 60 * 60 * 1000) : null;
    shares.set(id, {
      id,
      path: filePath,
      createdAt: Date.now(),
      expiryDate,
      name: path.basename(filePath)
    });
    await this.save();
    return id;
  },

  getShare(id) {
    const share = shares.get(id);
    if (!share) return null;
    if (share.expiryDate && Date.now() > share.expiryDate) {
      this.removeShare(id);
      return null;
    }
    return share;
  },

  async removeShare(id) {
    if (shares.has(id)) {
      shares.delete(id);
      await this.save();
    }
  },

  async cleanup() {
    let changed = false;
    const now = Date.now();
    for (const [id, share] of shares.entries()) {
      if (share.expiryDate && now > share.expiryDate) {
        shares.delete(id);
        changed = true;
      }
    }
    if (changed) {
      await this.save();
      console.log('[SHARE] Cleaned up expired links');
    }
  },

  async close() {
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = null;
    }
    await this.save();
  },

  getStatus() {
    return {
      startedAt,
      lastError,
      totalShares: shares.size,
      cleanupRunning: Boolean(cleanupInterval)
    };
  }
};

module.exports = shareService;
