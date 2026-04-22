const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs-extra');
const serverConfig = require('../config/serverConfig');

const INDEX_FILE = path.join(__dirname, '../storage/index.json');

let index = new Map();
let watcher = null;
let updateQueue = new Map(); // key: filePath, value: type — deduplicates same-file events
let updateTimer = null;
let saveInterval = null;
let startedAt = null;
let lastError = null;
let currentDataRoot = null;
let currentIndexDepth = 5;

async function resolveRuntimeConfig() {
  const config = await serverConfig.getAll();
  return {
    dataRoot: config.env.INITIAL_PATH || path.join(__dirname, '../../data'),
    indexDepth: config.paths.indexDepth
  };
}

const indexService = {
  name: 'index',

  async init() {
    try {
      const previousDataRoot = currentDataRoot;
      const runtime = await resolveRuntimeConfig();

      currentDataRoot = runtime.dataRoot;
      currentIndexDepth = runtime.indexDepth;

      await fs.ensureDir(currentDataRoot);
      
      if (previousDataRoot && previousDataRoot !== currentDataRoot) {
        index = new Map();
      } else if (await fs.pathExists(INDEX_FILE)) {
        console.log('[INDEX] Loading existing index...');
        const data = await fs.readJson(INDEX_FILE);
        index = new Map(Object.entries(data));
        console.log(`[INDEX] Loaded ${index.size} entries`);
      }

      console.log(`[INDEX] Starting watcher (Depth: ${currentIndexDepth}) on: ${currentDataRoot}`);
      
      watcher = chokidar.watch(currentDataRoot, {
        ignored: [
          /(^|[\/\\])\../,
          '**/node_modules/**',
          '**/dist/**',
          '**/.git/**',
          '**/storage/**'
        ],
        persistent: true,
        ignoreInitial: false,
        depth: currentIndexDepth,
        // Windows junctions (e.g. "My Music") can throw EPERM.
        // Keep the indexer alive instead of crashing the whole server.
        ignorePermissionErrors: true
      });

      watcher
        .on('add', (filePath) => this.queueUpdate(filePath, 'file'))
        .on('addDir', (filePath) => this.queueUpdate(filePath, 'dir'))
        .on('unlink', (filePath) => this.remove(filePath))
        .on('unlinkDir', (filePath) => this.remove(filePath))
        .on('change', (filePath) => this.queueUpdate(filePath, 'file'))
        .on('error', (err) => {
          lastError = err?.message || 'Unknown watcher error';
          console.warn('[INDEX] Watcher warning:', lastError);
        });

      saveInterval = setInterval(() => this.save(), 60000);
      startedAt = Date.now();
      lastError = null;

    } catch (err) {
      lastError = err.message;
      console.error('[INDEX] Initialization failed:', err.message);
      throw err;
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
        const relPath = path.relative(currentDataRoot, filePath);
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
    const relPath = path.relative(currentDataRoot, filePath);
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
    updateTimer = null;
    saveInterval = null;
    if (watcher) {
      await watcher.close();
      console.log('[INDEX] Watcher closed');
      watcher = null;
    }
  },

  getStatus() {
    return {
      startedAt,
      lastError,
      entries: index.size,
      queueSize: updateQueue.size,
      watching: Boolean(watcher),
      dataRoot: currentDataRoot,
      indexDepth: currentIndexDepth
    };
  }
};

module.exports = indexService;
