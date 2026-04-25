const express = require('express');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const router = express.Router();
const auth = require('../middleware/auth');
const cloudService = require('../services/cloudService');

router.use(auth);
const CLOUD_UPLOAD_MAX_BYTES = 64 * 1024 * 1024;
const CLOUD_UPLOAD_TMP_DIR = path.join(__dirname, '../storage/tmp/cloud-uploads');
fs.ensureDirSync(CLOUD_UPLOAD_TMP_DIR);
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, CLOUD_UPLOAD_TMP_DIR),
    filename: (_req, file, cb) => {
      const safeName = String(file?.originalname || 'upload.bin').replace(/[^\w.\-]+/g, '_');
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`);
    }
  }),
  limits: {
    fileSize: CLOUD_UPLOAD_MAX_BYTES
  }
});

function sendError(res, fallbackCode, fallbackMessage, err, fallbackStatus = 500) {
  const status = Number.isInteger(err?.status) ? err.status : fallbackStatus;
  const code = err?.code || fallbackCode;
  const message = err?.message || fallbackMessage;
  const payload = {
    success: false,
    code,
    message,
    // Backward-compatible field for legacy clients that read `error` as string.
    error: message
  };
  if (err?.details !== undefined) {
    payload.details = err.details;
  }
  return res.status(status).json(payload);
}

function parseRemoteName(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function parseRemotePath(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function uploadSingle(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) {
      next();
      return;
    }

    if (err?.code === 'LIMIT_FILE_SIZE') {
      sendError(
        res,
        'CLOUD_UPLOAD_TOO_LARGE',
        `Upload exceeds ${CLOUD_UPLOAD_MAX_BYTES} bytes`,
        null,
        413
      );
      return;
    }

    sendError(res, 'CLOUD_UPLOAD_PARSE_FAILED', 'Failed to parse upload payload', err);
  });
}
// Get available cloud providers
router.get('/providers', async (req, res) => {
  const providers = await cloudService.listProviders();
  res.json(providers);
});

// Get currently configured remotes
router.get('/remotes', async (req, res) => {
  try {
    const remotes = await cloudService.listRemotes();
    const statuses = await cloudService.getMountStatus();
    const statusByName = new Map((Array.isArray(statuses) ? statuses : []).map((item) => [item.name, item]));
    res.json(remotes.map((remote) => {
      const status = statusByName.get(remote.name) || null;
      return {
        ...remote,
        mountStatus: status?.status || 'unmounted',
        mountUrl: status?.mountUrl || null,
        mounted: status?.status === 'mounted',
        mountDetails: status?.details || null
      };
    }));
  } catch (err) {
    sendError(res, 'CLOUD_REMOTES_FETCH_FAILED', 'Failed to list remotes', err);
  }
});

// Setup a new cloud remote
router.post('/setup', async (req, res) => {
  const { name, provider } = req.body;
  if (!name || !provider) {
    return res.status(400).json({ error: 'Name and provider are required' });
  }
  const result = await cloudService.setupRemote(name, provider);
  res.json(result);
});

// List entries in a remote
router.get('/list', async (req, res) => {
  const remote = parseRemoteName(req.query.remote);
  const remotePath = parseRemotePath(req.query.path);
  try {
    const items = await cloudService.listEntries(remote, remotePath || '');
    res.json(items);
  } catch (err) {
    sendError(res, 'CLOUD_LIST_FAILED', 'Failed to list remote entries', err);
  }
});

// Read file content from a remote
router.get('/read', async (req, res) => {
  const remote = parseRemoteName(req.query.remote);
  const remotePath = parseRemotePath(req.query.path);
  try {
    const content = await cloudService.getFileContent(remote, remotePath);
    res.json({ content });
  } catch (err) {
    sendError(res, 'CLOUD_READ_FAILED', 'Failed to read remote file', err);
  }
});

// Mount a configured remote and return mount URL + status
router.post('/mount', async (req, res) => {
  const name = parseRemoteName(req.body?.name);
  if (!name) {
    return sendError(
      res,
      'CLOUD_MOUNT_INVALID_NAME',
      'Remote name is required',
      null,
      400
    );
  }
  try {
    const mounted = await cloudService.mountRemote(name);
    const status = await cloudService.getMountStatus(name);
    return res.json({
      success: true,
      mountUrl: mounted.mountUrl,
      url: mounted.url,
      status: status.status,
      details: status.details
    });
  } catch (err) {
    return sendError(res, 'CLOUD_MOUNT_FAILED', 'Failed to mount remote', err);
  }
});

// Get mount status for all remotes or one remote
router.get('/mount-status', async (req, res) => {
  const name = parseRemoteName(req.query.name);
  try {
    if (name) {
      const status = await cloudService.getMountStatus(name);
      return res.json({ success: true, status });
    }
    const statuses = await cloudService.getMountStatus();
    return res.json({ success: true, statuses });
  } catch (err) {
    return sendError(res, 'CLOUD_MOUNT_STATUS_FAILED', 'Failed to fetch mount status', err);
  }
});

// List cloud upload jobs
router.get('/upload-jobs', async (_req, res) => {
  try {
    return res.json({
      success: true,
      jobs: cloudService.listUploadJobs()
    });
  } catch (err) {
    return sendError(res, 'CLOUD_UPLOAD_JOBS_LIST_FAILED', 'Failed to list cloud upload jobs', err);
  }
});

// Get one cloud upload job
router.get('/upload-jobs/:id', async (req, res) => {
  try {
    const job = cloudService.getUploadJob(req.params.id);
    if (!job) {
      return sendError(res, 'CLOUD_UPLOAD_JOB_NOT_FOUND', 'Cloud upload job was not found', null, 404);
    }
    return res.json({
      success: true,
      job
    });
  } catch (err) {
    return sendError(res, 'CLOUD_UPLOAD_JOB_FETCH_FAILED', 'Failed to fetch cloud upload job', err);
  }
});

// Cancel one cloud upload job
router.post('/upload-jobs/:id/cancel', async (req, res) => {
  try {
    const job = cloudService.cancelUploadJob(req.params.id);
    return res.json({
      success: true,
      accepted: true,
      job
    });
  } catch (err) {
    return sendError(res, 'CLOUD_UPLOAD_CANCEL_FAILED', 'Failed to cancel cloud upload job', err);
  }
});

// Write text file content to a remote path
router.post('/write', async (req, res) => {
  const remote = parseRemoteName(req.body?.remote);
  const path = parseRemotePath(req.body?.path);
  const { content } = req.body || {};

  if (!remote) {
    return sendError(res, 'CLOUD_WRITE_INVALID_REMOTE', 'Remote is required', null, 400);
  }
  if (!path) {
    return sendError(res, 'CLOUD_WRITE_INVALID_PATH', 'Path is required', null, 400);
  }
  if (typeof content !== 'string') {
    return sendError(res, 'CLOUD_WRITE_INVALID_CONTENT', 'Content must be a text string', null, 400);
  }

  try {
    const result = await cloudService.writeRemoteFile(remote, path, content);
    return res.json(result);
  } catch (err) {
    return sendError(res, 'CLOUD_WRITE_FAILED', 'Failed to write remote file', err);
  }
});

// Upload a binary file to a remote path
router.post('/upload', uploadSingle, async (req, res) => {
  const remote = parseRemoteName(req.body?.remote);
  const remotePath = parseRemotePath(req.body?.path || '');
  const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName.trim() : '';
  const file = req.file;
  const asyncUpload = parseBoolean(req.body?.async || req.query?.async);
  let cleanupTempFile = true;

  if (!remote) {
    return sendError(res, 'CLOUD_UPLOAD_INVALID_REMOTE', 'Remote is required', null, 400);
  }
  if (!file || typeof file.path !== 'string' || !file.path.trim()) {
    return sendError(res, 'CLOUD_UPLOAD_INVALID_FILE', 'A file upload is required', null, 400);
  }

  try {
    if (asyncUpload) {
      const job = await cloudService.startUploadRemoteFileFromPath(
        remote,
        remotePath,
        fileName || file.originalname || 'upload.bin',
        file.path,
        {
          cleanup: async () => fs.remove(file.path)
        }
      );
      cleanupTempFile = false;
      job.completion.catch(() => {});
      return res.status(202).json({
        success: true,
        accepted: true,
        jobId: job.id,
        status: 'running',
        job: cloudService.getUploadJob(job.id)
      });
    }

    const result = await cloudService.uploadRemoteFileFromPath(
      remote,
      remotePath,
      fileName || file.originalname || 'upload.bin',
      file.path
    );
    return res.json(result);
  } catch (err) {
    return sendError(res, 'CLOUD_UPLOAD_FAILED', 'Failed to upload remote file', err);
  } finally {
    if (cleanupTempFile) {
      await fs.remove(file?.path).catch(() => {});
    }
  }
});

// Setup a new WebDAV connection
router.post('/add-webdav', async (req, res) => {
  const { name, url, user, pass } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'Name and URL are required' });
  try {
    await cloudService.addWebDAV(name, url, user, pass);
    res.json({ success: true });
  } catch (err) {
    sendError(res, 'CLOUD_ADD_WEBDAV_FAILED', 'Failed to add WebDAV remote', err);
  }
});

module.exports = router;
