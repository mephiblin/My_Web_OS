const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs-extra');
const si = require('systeminformation');

const auth = require('../middleware/auth');
const auditService = require('../services/auditService');
const packageRegistryService = require('../services/packageRegistryService');
const storageService = require('../services/storageService');
const stateStore = require('../services/stateStore');
const serverConfig = require('../config/serverConfig');
const { resolveSafePath, isWithinAllowedRoots, isProtectedSystemPath } = require('../utils/pathPolicy');
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

function createBackupError(status, code, message, details = null) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.details = details;
  return err;
}

function sendBackupError(res, err) {
  return res.status(err.status || 500).json({
    error: true,
    code: err.code || 'BACKUP_JOB_INTERNAL_ERROR',
    message: err.message || 'Backup job operation failed.',
    details: err.details || null
  });
}

function toSafeTrimmedString(value, maxLength = 4096) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.slice(0, maxLength);
}

function toBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  return fallback;
}

function formatTimestamp(value) {
  const date = new Date(value);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function withTimestampName(baseName, timestamp) {
  const parsed = path.parse(baseName);
  if (!parsed.ext) return `${baseName}-${timestamp}`;
  return `${parsed.name}-${timestamp}${parsed.ext}`;
}

async function resolveAndValidateBackupPath(rawPath, fieldName) {
  const pathValue = toSafeTrimmedString(rawPath);
  if (!pathValue) {
    throw createBackupError(
      400,
      `BACKUP_JOB_INVALID_${fieldName.toUpperCase()}`,
      `${fieldName} is required.`
    );
  }

  let absolutePath;
  try {
    absolutePath = resolveSafePath(pathValue);
  } catch (err) {
    throw createBackupError(
      400,
      `BACKUP_JOB_INVALID_${fieldName.toUpperCase()}`,
      err.message || `${fieldName} is invalid.`,
      { path: pathValue }
    );
  }

  const { allowedRoots, inventoryRoot } = await serverConfig.getPaths();
  if (!isWithinAllowedRoots(absolutePath, allowedRoots)) {
    throw createBackupError(
      403,
      `BACKUP_JOB_${fieldName.toUpperCase()}_FORBIDDEN`,
      `${fieldName} must be inside allowed roots.`,
      { path: absolutePath }
    );
  }

  if (isProtectedSystemPath(absolutePath, [inventoryRoot])) {
    throw createBackupError(
      403,
      `BACKUP_JOB_${fieldName.toUpperCase()}_SYSTEM_PROTECTED`,
      `${fieldName} cannot target protected system inventory paths.`,
      { path: absolutePath }
    );
  }

  return absolutePath;
}

async function loadBackupJobsState() {
  return stateStore.readState('backupJobs');
}

async function saveBackupJobsState(nextState) {
  return stateStore.writeState('backupJobs', nextState);
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
 * GET /api/system/backup-jobs
 * Read backup job manager state
 */
router.get('/backup-jobs', async (_req, res) => {
  try {
    const data = await loadBackupJobsState();
    res.json({ success: true, data });
  } catch (err) {
    sendBackupError(res, createBackupError(500, 'BACKUP_JOB_READ_FAILED', err.message));
  }
});

/**
 * POST /api/system/backup-jobs
 * Create backup job
 */
router.post('/backup-jobs', async (req, res) => {
  try {
    const name = toSafeTrimmedString(req.body?.name, 200);
    const sourcePath = await resolveAndValidateBackupPath(req.body?.sourcePath, 'sourcePath');
    const destinationRoot = await resolveAndValidateBackupPath(req.body?.destinationRoot, 'destinationRoot');

    const id = crypto.randomUUID();
    const now = Date.now();
    const fallbackName = `Backup ${path.basename(sourcePath) || id.slice(0, 8)}`;
    const nextJob = {
      id,
      name: name || fallbackName,
      sourcePath,
      destinationRoot,
      includeTimestamp: toBool(req.body?.includeTimestamp, true),
      createdAt: now,
      lastRunAt: null,
      lastStatus: null,
      lastOutputPath: null,
      lastError: null
    };

    const state = await loadBackupJobsState();
    const nextState = {
      ...state,
      jobs: [...state.jobs, nextJob]
    };
    const saved = await saveBackupJobsState(nextState);
    const created = saved.jobs.find((job) => job.id === id) || nextJob;

    await auditService.log('SYSTEM', 'Create Backup Job', { user: req.user?.username, id, name: created.name }, 'INFO');
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    sendBackupError(res, err);
  }
});

/**
 * DELETE /api/system/backup-jobs/:id
 * Remove backup job
 */
router.delete('/backup-jobs/:id', async (req, res) => {
  try {
    const id = toSafeTrimmedString(req.params.id, 128);
    if (!id) {
      throw createBackupError(400, 'BACKUP_JOB_INVALID_ID', 'Backup job id is required.');
    }

    const state = await loadBackupJobsState();
    const exists = state.jobs.some((job) => job.id === id);
    if (!exists) {
      throw createBackupError(404, 'BACKUP_JOB_NOT_FOUND', 'Backup job not found.', { id });
    }

    const nextState = {
      ...state,
      jobs: state.jobs.filter((job) => job.id !== id),
      history: state.history.filter((entry) => entry.jobId !== id)
    };
    await saveBackupJobsState(nextState);

    await auditService.log('SYSTEM', 'Delete Backup Job', { user: req.user?.username, id }, 'INFO');
    res.json({ success: true, data: { removedId: id } });
  } catch (err) {
    sendBackupError(res, err);
  }
});

/**
 * POST /api/system/backup-jobs/:id/run
 * Execute backup job immediately
 */
router.post('/backup-jobs/:id/run', async (req, res) => {
  const id = toSafeTrimmedString(req.params.id, 128);
  const startedAt = Date.now();

  try {
    if (!id) {
      throw createBackupError(400, 'BACKUP_JOB_INVALID_ID', 'Backup job id is required.');
    }

    const state = await loadBackupJobsState();
    const targetJob = state.jobs.find((job) => job.id === id);
    if (!targetJob) {
      throw createBackupError(404, 'BACKUP_JOB_NOT_FOUND', 'Backup job not found.', { id });
    }

    const sourcePath = await resolveAndValidateBackupPath(targetJob.sourcePath, 'sourcePath');
    const destinationRoot = await resolveAndValidateBackupPath(targetJob.destinationRoot, 'destinationRoot');

    const sourceExists = await fs.pathExists(sourcePath);
    if (!sourceExists) {
      throw createBackupError(
        400,
        'BACKUP_JOB_SOURCE_NOT_FOUND',
        'Backup source path does not exist.',
        { sourcePath }
      );
    }

    const sourceStats = await fs.stat(sourcePath);
    if (!(await fs.pathExists(destinationRoot))) {
      throw createBackupError(
        400,
        'BACKUP_JOB_DESTINATION_NOT_FOUND',
        'Backup destination root does not exist.',
        { destinationRoot }
      );
    }
    const destinationStats = await fs.stat(destinationRoot);
    if (!destinationStats.isDirectory()) {
      throw createBackupError(
        400,
        'BACKUP_JOB_DESTINATION_NOT_DIRECTORY',
        'Backup destination root must be a directory.',
        { destinationRoot }
      );
    }

    const now = Date.now();
    const timeSuffix = formatTimestamp(now);
    const sourceName = path.basename(sourcePath);
    const outputName = targetJob.includeTimestamp
      ? withTimestampName(sourceName, timeSuffix)
      : sourceName;
    const outputPath = path.join(destinationRoot, outputName);

    if (await fs.pathExists(outputPath)) {
      throw createBackupError(
        409,
        'BACKUP_JOB_OUTPUT_ALREADY_EXISTS',
        'Backup output path already exists.',
        { outputPath }
      );
    }

    if (!sourceStats.isFile() && !sourceStats.isDirectory()) {
      throw createBackupError(
        400,
        'BACKUP_JOB_SOURCE_UNSUPPORTED_TYPE',
        'Only file and directory sources are supported for backup.',
        { sourcePath }
      );
    }

    await fs.copy(sourcePath, outputPath, {
      overwrite: false,
      errorOnExist: true,
      dereference: false,
      preserveTimestamps: true
    });

    const finishedAt = Date.now();
    const historyEntry = {
      id: crypto.randomUUID(),
      jobId: id,
      startedAt,
      finishedAt,
      status: 'success',
      outputPath,
      error: null
    };

    const nextJobs = state.jobs.map((job) => (job.id === id
      ? {
          ...job,
          lastRunAt: finishedAt,
          lastStatus: 'success',
          lastOutputPath: outputPath,
          lastError: null
        }
      : job));
    const nextHistory = [...state.history, historyEntry].slice(-500);
    const saved = await saveBackupJobsState({ ...state, jobs: nextJobs, history: nextHistory });
    const updatedJob = saved.jobs.find((job) => job.id === id);

    await auditService.log('SYSTEM', 'Run Backup Job', { user: req.user?.username, id, outputPath }, 'INFO');
    res.json({
      success: true,
      data: {
        job: updatedJob,
        run: historyEntry
      }
    });
  } catch (err) {
    if (!id) {
      return sendBackupError(res, err);
    }

    let latestState;
    try {
      latestState = await loadBackupJobsState();
      const targetJob = latestState.jobs.find((job) => job.id === id);
      if (targetJob) {
        const finishedAt = Date.now();
        const failEntry = {
          id: crypto.randomUUID(),
          jobId: id,
          startedAt,
          finishedAt,
          status: 'error',
          outputPath: null,
          error: err.message || 'Backup job run failed.'
        };

        const nextJobs = latestState.jobs.map((job) => (job.id === id
          ? {
              ...job,
              lastRunAt: finishedAt,
              lastStatus: 'error',
              lastOutputPath: null,
              lastError: failEntry.error
            }
          : job));
        const nextHistory = [...latestState.history, failEntry].slice(-500);
        await saveBackupJobsState({ ...latestState, jobs: nextJobs, history: nextHistory });
      }
    } catch (_persistErr) {
      // Ignore persistence failure in error path and return original run error.
    }

    return sendBackupError(res, err);
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
