const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const TRASH_ROOT = path.join(__dirname, '../storage/.trash');
const TRASH_INFO_FILE = path.join(__dirname, '../storage/.trash_info.json');
let startedAt = null;
let lastError = null;

const trashService = {
  name: 'trash',

  async init() {
    await fs.ensureDir(TRASH_ROOT);
    if (!(await fs.pathExists(TRASH_INFO_FILE))) {
      await fs.writeJson(TRASH_INFO_FILE, {});
    }
    startedAt = Date.now();
    lastError = null;
  },

  async moveToTrash(sourcePath) {
    const id = uuidv4();
    const fileName = path.basename(sourcePath);
    const destPath = path.join(TRASH_ROOT, id);

    await fs.move(sourcePath, destPath);

    const info = await fs.readJson(TRASH_INFO_FILE);
    info[id] = {
      originalPath: sourcePath,
      fileName: fileName,
      deletedAt: new Date().toISOString()
    };
    await fs.writeJson(TRASH_INFO_FILE, info);
    return id;
  },

  async restore(id) {
    const info = await fs.readJson(TRASH_INFO_FILE);
    const item = info[id];
    if (!item) throw new Error('Item not found in trash');

    const sourcePath = path.join(TRASH_ROOT, id);
    await fs.ensureDir(path.dirname(item.originalPath));
    await fs.move(sourcePath, item.originalPath);

    delete info[id];
    await fs.writeJson(TRASH_INFO_FILE, info);
  },

  getTrashItemPath(id) {
    return path.join(TRASH_ROOT, String(id || ''));
  },

  async emptyTrash() {
    await fs.emptyDir(TRASH_ROOT);
    await fs.writeJson(TRASH_INFO_FILE, {});
  },

  async getTrashItems() {
    const info = await fs.readJson(TRASH_INFO_FILE);
    return Object.entries(info).map(([id, meta]) => ({
      id,
      ...meta
    }));
  },

  async close() {
    // No long-running resource yet, keep method for ServiceManager contract.
  },

  getStatus() {
    return {
      startedAt,
      lastError,
      trashRoot: TRASH_ROOT
    };
  }
};

module.exports = trashService;
