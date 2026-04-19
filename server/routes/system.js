const express = require('express');
const router = express.Router();
const si = require('systeminformation');
const fs = require('fs-extra');
const path = require('path');
const storageService = require('../services/storageService');

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
 * GET /api/system/audit
 * Get recent audit logs
 */
router.get('/audit', async (req, res) => {
  try {
    const auditService = require('../services/auditService');
    const logs = await auditService.getLogs();
    res.json(logs);
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

module.exports = router;
