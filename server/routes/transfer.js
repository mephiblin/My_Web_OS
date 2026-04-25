const express = require('express');
const auth = require('../middleware/auth');
const transferJobService = require('../services/transferJobService');

const router = express.Router();
router.use(auth);

function mapTransferError(err, fallbackCode, fallbackMessage) {
  if (err?.status && err?.code) {
    return {
      status: err.status,
      code: err.code,
      message: err.message || fallbackMessage,
      details: err.details || null
    };
  }

  return {
    status: 500,
    code: fallbackCode,
    message: err?.message || fallbackMessage,
    details: err?.details || null
  };
}

function sendTransferError(res, err, fallbackCode, fallbackMessage) {
  const mapped = mapTransferError(err, fallbackCode, fallbackMessage);
  return res.status(mapped.status).json({
    error: true,
    code: mapped.code,
    message: mapped.message,
    details: mapped.details
  });
}

const TRANSFER_STATUS_ALIASES = new Map([
  ['error', 'failed'],
  ['cancelled', 'canceled'],
  ['success', 'completed'],
  ['done', 'completed'],
  ['active', 'running'],
  ['working', 'running']
]);

router.get('/jobs', (req, res) => {
  try {
    const jobs = transferJobService.listJobs();
    const summary = transferJobService.getSummary();
    return res.json({
      success: true,
      jobs,
      summary
    });
  } catch (err) {
    return sendTransferError(res, err, 'TRANSFER_LIST_FAILED', 'Failed to list transfer jobs.');
  }
});

router.post('/jobs/download', async (req, res) => {
  try {
    const job = await transferJobService.enqueueDownload({
      url: req.body?.url,
      destinationDir: req.body?.destinationDir,
      fileName: req.body?.fileName
    });

    return res.status(202).json({
      success: true,
      job
    });
  } catch (err) {
    return sendTransferError(res, err, 'TRANSFER_CREATE_DOWNLOAD_FAILED', 'Failed to create download job.');
  }
});

router.post('/jobs/copy', async (req, res) => {
  try {
    const job = await transferJobService.enqueueCopy({
      sourcePath: req.body?.sourcePath,
      destinationDir: req.body?.destinationDir,
      fileName: req.body?.fileName
    });

    return res.status(202).json({
      success: true,
      job
    });
  } catch (err) {
    return sendTransferError(res, err, 'TRANSFER_CREATE_COPY_FAILED', 'Failed to create copy job.');
  }
});

router.post('/jobs/:id/cancel', (req, res) => {
  try {
    const job = transferJobService.cancelJob(req.params.id);
    return res.json({
      success: true,
      job
    });
  } catch (err) {
    return sendTransferError(res, err, 'TRANSFER_CANCEL_FAILED', 'Failed to cancel transfer job.');
  }
});

router.post('/jobs/:id/retry', async (req, res) => {
  try {
    const job = await transferJobService.retryJob(req.params.id);
    return res.status(202).json({
      success: true,
      job
    });
  } catch (err) {
    return sendTransferError(res, err, 'TRANSFER_RETRY_FAILED', 'Failed to retry transfer job.');
  }
});

router.delete('/jobs', (req, res) => {
  try {
    const statuses = String(req.query?.statuses || '')
      .split(',')
      .map((item) => String(item || '').trim().toLowerCase())
      .map((status) => TRANSFER_STATUS_ALIASES.get(status) || status)
      .filter(Boolean);
    const result = transferJobService.clearJobs({ statuses });
    return res.json({
      success: true,
      ...result
    });
  } catch (err) {
    return sendTransferError(res, err, 'TRANSFER_CLEAR_FAILED', 'Failed to clear transfer jobs.');
  }
});

module.exports = router;
