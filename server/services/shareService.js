const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

const DB_FILE = path.join(__dirname, '../storage/shares.json');
let shares = new Map();

const shareService = {
  async init() {
    await fs.ensureFile(DB_FILE);
    try {
      const data = await fs.readJson(DB_FILE);
      shares = new Map(Object.entries(data));
      this.cleanup();
      setInterval(() => this.cleanup(), 60 * 60 * 1000); // 1 hour
    } catch {
      await fs.writeJson(DB_FILE, {});
    }
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
  }
};

module.exports = shareService;
