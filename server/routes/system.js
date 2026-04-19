const router = express.Router();
const auditService = require('../services/auditService');
const si = require('systeminformation');
const fs = require('fs-extra');
const path = require('path');
const auth = require('../middleware/auth');
const storageService = require('../services/storageService');

router.use(auth);
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
      storage: fsSize.map(drive => ({
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
      gpu: gfx.controllers.map(g => ({
        model: g.model,
        vram: g.vram,
        bus: g.bus,
        temperatureGpu: g.temperatureGpu
      })),
      network: net.map(n => ({
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
    // Filter for common ipv4 addresses, excluding internal loopback
    const local = netInterfaces.find(i => !i.internal && i.ip4 && i.operstate === 'up') || netInterfaces[0];
    
    let external = 'Unknown';
    try {
      const response = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(3000) });
      const data = await response.json();
      external = data.ip;
    } catch (e) {
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
    const appsPath = path.join(__dirname, '../storage/apps.json');
    if (await fs.pathExists(appsPath)) {
      const apps = await fs.readJson(appsPath);
      res.json(apps);
    } else {
      res.json([]);
    }
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
    let list = data.list || [];
    // Sort by CPU usage descending
    list.sort((a, b) => (b.cpu || 0) - (a.cpu || 0));
    // Provide top 50
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
 * GET /api/system/state/:key
 * Read OS state from Inventory
 */
/**
 * GET /api/system/wallpapers/list
 * List all files in the wallpapers inventory
 */
router.get('/wallpapers/list', async (req, res) => {
  try {
    const wpDir = path.join(__dirname, '../storage/inventory/wallpapers');
    await fs.ensureDir(wpDir);
    const files = await fs.readdir(wpDir);
    // Filter for common image/video extensions
    const wallpapers = files.filter(f => /\.(jpg|jpeg|png|webp|mp4|webm|gif)$/i.test(f));
    res.json({ success: true, data: wallpapers });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

const multer = require('multer');
const uploadWP = multer({ 
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, '../storage/inventory/wallpapers')),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
  })
});

/**
 * POST /api/system/wallpapers/upload
 * Upload a new wallpaper
 */
router.post('/wallpapers/upload', uploadWP.single('file'), async (req, res) => {
  if (req.file) {
    await auditService.log('SYSTEM', 'Upload Wallpaper', { fileName: req.file.filename, user: req.user?.username }, 'INFO');
    res.json({ success: true, filename: req.file.filename });
  } else {
    res.status(400).json({ error: true, message: 'Upload failed' });
  }
});

router.get('/state/:key', async (req, res) => {
  try {
    const stateFile = path.join(__dirname, `../storage/inventory/state_${req.params.key}.json`);
    if (await fs.pathExists(stateFile)) {
      const data = await fs.readJson(stateFile);
      res.json({ success: true, data });
    } else {
      res.json({ success: true, data: null });
    }
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * GET /api/system/widget-library
 * List all widget templates from Inventory
 */
router.get('/widget-library', async (req, res) => {
  try {
    const widgetsDir = path.join(__dirname, '../storage/inventory/widgets');
    await fs.ensureDir(widgetsDir);
    const files = await fs.readdir(widgetsDir);
    const library = [];
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        const data = await fs.readJson(path.join(widgetsDir, file));
        library.push(data);
      }
    }
    res.json({ success: true, data: library });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * POST /api/system/widget-library/:id
 * Save/Update a widget template
 */
router.post('/widget-library/:id', async (req, res) => {
  try {
    const widgetsDir = path.join(__dirname, '../storage/inventory/widgets');
    await fs.ensureDir(widgetsDir);
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
    const widgetFile = path.join(__dirname, `../storage/inventory/widgets/${req.params.id}.json`);
    if (await fs.pathExists(widgetFile)) {
      await fs.remove(widgetFile);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: true, message: 'Widget template not found' });
    }
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

/**
 * POST /api/system/state/:key
 * Write OS state to Inventory
 */
router.post('/state/:key', async (req, res) => {
  try {
    const inventoryDir = path.join(__dirname, '../storage/inventory');
    await fs.ensureDir(inventoryDir);
    const stateFile = path.join(inventoryDir, `state_${req.params.key}.json`);
    await fs.writeJson(stateFile, req.body, { spaces: 2 });
    await auditService.log('SYSTEM', `Save State: ${req.params.key}`, { user: req.user?.username }, 'INFO');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: true, message: err.message });
  }
});

module.exports = router;
