const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs-extra');

const DATA_ROOT = process.env.INITIAL_PATH || path.join(__dirname, '../../data'); 
const INDEX_FILE = path.join(__dirname, '../storage/index.json');
const INDEX_DEPTH = parseInt(process.env.INDEX_DEPTH || '5');

let index = new Map();
let watcher = null;
let updateQueue = new Map(); // key: filePath, value: type — deduplicates same-file events
let updateTimer = null;
let saveInterval = null;

const indexService = {
  async init() {
    try {
      await fs.ensureDir(DATA_ROOT);
      
      if (await fs.pathExists(INDEX_FILE)) {
        console.log('[INDEX] Loading existing index...');
        const data = await fs.readJson(INDEX_FILE);
        index = new Map(Object.entries(data));
        console.log(`[INDEX] Loaded ${index.size} entries`);
      }

      console.log(`[INDEX] Starting watcher (Depth: ${INDEX_DEPTH}) on: ${DATA_ROOT}`);
      
      watcher = chokidar.watch(DATA_ROOT, {
        ignored: [
          /(^|[\/\\])\../,
          '**/node_modules/**',
          '**/dist/**',
          '**/.git/**',
          '**/storage/**'
        ],
        persistent: true,
        ignoreInitial: false,
        depth: INDEX_DEPTH
      });

      watcher
        .on('add', (filePath) => this.queueUpdate(filePath, 'file'))
        .on('addDir', (filePath) => this.queueUpdate(filePath, 'dir'))
        .on('unlink', (filePath) => this.remove(filePath))
        .on('unlinkDir', (filePath) => this.remove(filePath))
        .on('change', (filePath) => this.queueUpdate(filePath, 'file'));

      saveInterval = setInterval(() => this.save(), 60000);

    } catch (err) {
      console.error('[INDEX] Initialization failed:', err.message);
    }
  },

  queueUpdate(filePath, type) {
    updateQueue.set(filePath, type); // Map: last event wins, naturally deduplicates
    if (!updateTimer) {
      updateTimer = setTimeout(async () => {
        updateTimer = null; // reset before processing so new events queue correctly
        await this.processQueue();
      }, 500);
    }
  },

  async processQueue() {
    const batch = Array.from(updateQueue.entries()); // [filePath, type][]
    updateQueue.clear();

    for (const [filePath, type] of batch) {
      try {
        const relPath = path.relative(DATA_ROOT, filePath);
        const fileName = path.basename(filePath);
        const stats = await fs.stat(filePath);

        index.set(relPath, {
          name: fileName,
          path: filePath,
          relPath: relPath,
          isDirectory: type === 'dir',
          size: stats.size,
          mtime: stats.mtime
        });
      } catch (err) {
        // File may have vanished between queue and processing
      }
    }
  },

  remove(filePath) {
    const relPath = path.relative(DATA_ROOT, filePath);
    index.delete(relPath);
  },

  search(query, targetPath = null) {
    if (!query) return [];
    const q = query.toLowerCase();
    const results = [];
    
    for (const item of index.values()) {
      if (targetPath && !item.path.startsWith(targetPath)) continue;

      if (item.name.toLowerCase().includes(q)) {
        results.push(item);
      }
      if (results.length > 500) break;
    }
    
    return results;
  },

  async save() {
    try {
      if (index.size === 0) return;
      const data = Object.fromEntries(index);
      await fs.writeJson(INDEX_FILE, data);
      console.log(`[INDEX] Saved successfully (${index.size} entries)`);
    } catch (err) {
      console.error('[INDEX] Save failed:', err.message);
    }
  },

  async close() {
    if (updateTimer) clearTimeout(updateTimer);
    if (saveInterval) clearInterval(saveInterval);
    if (watcher) {
      await watcher.close();
      console.log('[INDEX] Watcher closed');
    }
  }
};

module.exports = indexService;
