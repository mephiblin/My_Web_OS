const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs-extra');

const DATA_ROOT = path.join(__dirname, '../../data'); // Watch the user data directory
const INDEX_FILE = path.join(__dirname, '../storage/index.json');

let index = new Map();
let watcher = null;

const indexService = {
  async init() {
    try {
      await fs.ensureDir(DATA_ROOT);
      
      // Load existing index if any
      if (await fs.pathExists(INDEX_FILE)) {
        const data = await fs.readJson(INDEX_FILE);
        index = new Map(Object.entries(data));
      }

      console.log(`[INDEX] Starting watcher on ${DATA_ROOT}`);
      
      watcher = chokidar.watch(DATA_ROOT, {
        ignored: /(^|[\/\\])\../, // ignore dotfiles
        persistent: true,
        ignoreInitial: false
      });

      watcher
        .on('add', (filePath) => this.update(filePath, 'file'))
        .on('addDir', (filePath) => this.update(filePath, 'dir'))
        .on('unlink', (filePath) => this.remove(filePath))
        .on('unlinkDir', (filePath) => this.remove(filePath))
        .on('change', (filePath) => this.update(filePath, 'file'));

      // Periodic save
      setInterval(() => this.save(), 60000); // every minute

    } catch (err) {
      console.error('[INDEX] Initialization failed:', err.message);
    }
  },

  update(filePath, type) {
    const relativePath = path.relative(DATA_ROOT, filePath);
    const fileName = path.basename(filePath);
    
    index.set(relativePath, {
      name: fileName,
      path: relativePath,
      type: type,
      mtime: new Date()
    });
  },

  remove(filePath) {
    const relativePath = path.relative(DATA_ROOT, filePath);
    index.delete(relativePath);
  },

  search(query) {
    if (!query) return [];
    const q = query.toLowerCase();
    const results = [];
    
    for (const item of index.values()) {
      if (item.name.toLowerCase().includes(q)) {
        results.push(item);
      }
      if (results.length > 50) break; // Limit results
    }
    
    return results;
  },

  async save() {
    try {
      const data = Object.fromEntries(index);
      await fs.writeJson(INDEX_FILE, data);
      console.log('[INDEX] Saved successfully');
    } catch (err) {
      console.error('[INDEX] Save failed:', err.message);
    }
  },

  async close() {
    if (watcher) {
      await watcher.close();
      console.log('[INDEX] Watcher closed');
    }
  }
};

module.exports = indexService;
