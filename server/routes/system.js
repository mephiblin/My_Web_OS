const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const si = require('systeminformation');

const auth = require('../middleware/auth');
const auditService = require('../services/auditService');
const packageRegistryService = require('../services/packageRegistryService');
const storageService = require('../services/storageService');
const stateStore = require('../services/stateStore');
const inventoryPaths = require('../utils/inventoryPaths');

const router = express.Router();
router.use(auth);

function handleStateKeyError(res, err) {
  if (err.code === 'STATE_KEY_UNSUPPORTED') {
    return res.status(400).json({
      error: true,
      code: err.code,
      message: err.message
    });
  }
  return res.status(500).json({ error: true, message: err.message });
}

const uploadWP = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      inventoryPaths.getWallpapersDir()
        .then((wallpapersDir) => fs.ensureDir(wallpapersDir).then(() => cb(null, wallpapersDir)))
        .catch((err) => cb(err));
    },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
  })
});

/**
 * GET /api/system/overview
 * Get quick overview of system status
 */
router.get('/overview', async (req, res) => {
  try {
    const [cpu, mem, fsSize, osInfo, gfx, net, cpuTemp] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.osInfo(),
      si.graphics(),
      si.networkStats(),
      si.cpuTemperature()
    ]);

    res.json({
      cpu: cpu.currentLoad.toFixed(2),
      cpuTemp: {
        main: cpuTemp.main,
        max: cpuTemp.max
      },
      memory: {
        total: mem.total,
        used: mem.used,
        percentage: ((mem.used / mem.total) * 100).toFixed(2)
      },
      storage: fsSize.map((drive) => ({
        fs: drive.fs,
        size: drive.size,
        used: drive.used,
        use: drive.use
      })),
      os: {
        distro: osInfo.distro,
        release: osInfo.release,
        platform: osInfo.platform
      },
      gpu: gfx.controllers.map((g) => ({
        model: g.model,
        vram: g.vram,
        bus: g.bus,
        temperatureGpu: g.temperatureGpu
      })),
      network: net.map((n) => ({
        iface: n.iface,
        rx_sec: n.rx_sec,
        tx_sec: n.tx_sec
      }))
    });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * GET /api/system/cpu
 * Detailed CPU stats
 */
router.get('/cpu', async (req, res) => {
  try {
    const [cpu, load, temp] = await Promise.all([
      si.cpu(),
      si.currentLoad(),
      si.cpuTemperature()
    ]);
    res.json({ cpu, load, temp });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * GET /api/system/network-ips
 * Get local and external IP addresses
 */
router.get('/network-ips', async (req, res) => {
  try {
    const netInterfaces = await si.networkInterfaces();
    const local = netInterfaces.find((i) => !i.internal && i.ip4 && i.operstate === 'up') || netInterfaces[0];

    let external = 'Unknown';
    try {
      const response = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(3000) });
      const data = await response.json();
      external = data.ip;
    } catch (_e) {
      external = 'Unavailable';
    }

    res.json({
      local: local ? local.ip4 : 'Unknown',
      external
    });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * GET /api/system/apps
 * Get dynamic app registry
 */
router.get('/apps', async (req, res) => {
  try {
    const apps = await packageRegistryService.listDesktopApps();
    res.json(apps);
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * GET /api/system/storage/diagnostics
 * Get S.M.A.R.T health data
 */
router.get('/storage/diagnostics', async (req, res) => {
  try {
    const data = await storageService.getDiagnostics();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * GET /api/system/processes
 * Get running processes list
 */
router.get('/processes', async (req, res) => {
  try {
    const data = await si.processes();
    const list = (data.list || []).sort((a, b) => (b.cpu || 0) - (a.cpu || 0));
    res.json(list.slice(0, 50));
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * GET /api/system/network/connections
 * Get active ports and sessions
 */
router.get('/network/connections', async (req, res) => {
  try {
    const data = await si.networkConnections();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * GET /api/system/wallpapers/list
 * List all files in the wallpapers inventory
 */
router.get('/wallpapers/list', async (req, res) => {
  try {
    await inventoryPaths.ensureInventoryStructure();
    const wallpapersDir = await inventoryPaths.getWallpapersDir();
    const files = await fs.readdir(wallpapersDir);
    const wallpapers = files.filter((f) => /\.(jpg|jpeg|png|webp|mp4|webm|gif)$/i.test(f));
    res.json({ success: true, data: wallpapers });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * POST /api/system/wallpapers/upload
 * Upload a new wallpaper
 */
router.post('/wallpapers/upload', uploadWP.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: true, message: 'Upload failed' });
  }

  await auditService.log('SYSTEM', 'Upload Wallpaper', { fileName: req.file.filename, user: req.user?.username }, 'INFO');
  return res.json({ success: true, filename: req.file.filename });
});

/**
 * GET /api/system/state/:key
 * Read OS state from protected inventory state store
 */
router.get('/state/:key', async (req, res) => {
  try {
    const data = await stateStore.readState(req.params.key);
    res.json({ success: true, data });
  } catch (err) {
    handleStateKeyError(res, err);
  }
});

/**
 * POST /api/system/state/:key
 * Write OS state to protected inventory state store
 */
router.post('/state/:key', async (req, res) => {
  try {
    const savedState = await stateStore.writeState(req.params.key, req.body);
    await auditService.log('SYSTEM', `Save State: ${req.params.key}`, { user: req.user?.username }, 'INFO');
    res.json({ success: true, data: savedState });
  } catch (err) {
    handleStateKeyError(res, err);
  }
});

/**
 * GET /api/system/widget-library
 * List all widget templates from inventory
 */
router.get('/widget-library', async (req, res) => {
  try {
    await inventoryPaths.ensureInventoryStructure();
    const widgetsDir = await inventoryPaths.getWidgetLibraryDir();
    const files = await fs.readdir(widgetsDir);
    const library = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const item = await fs.readJson(path.join(widgetsDir, file));
      library.push(item);
    }

    res.json({ success: true, data: library });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * POST /api/system/widget-library/:id
 * Save or update a widget template
 */
router.post('/widget-library/:id', async (req, res) => {
  try {
    await inventoryPaths.ensureInventoryStructure();
    const widgetsDir = await inventoryPaths.getWidgetLibraryDir();
    const widgetFile = path.join(widgetsDir, `${req.params.id}.json`);
    await fs.writeJson(widgetFile, req.body, { spaces: 2 });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * DELETE /api/system/widget-library/:id
 * Remove a widget template
 */
router.delete('/widget-library/:id', async (req, res) => {
  try {
    await inventoryPaths.ensureInventoryStructure();
    const widgetsDir = await inventoryPaths.getWidgetLibraryDir();
    const widgetFile = path.join(widgetsDir, `${req.params.id}.json`);

    if (!(await fs.pathExists(widgetFile))) {
      return res.status(404).json({ error: true, message: 'Widget template not found' });
    }

    await fs.remove(widgetFile);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: true, message: err.message });
  }
});

module.exports = router;
