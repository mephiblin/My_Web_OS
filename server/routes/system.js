const express = require('express');
const router = express.Router();
const si = require('systeminformation');

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

module.exports = router;
