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

router.get('/jobs', (req, res) => {
  try {
    const jobs = transferJobService.listJobs();
    return res.json({
      success: true,
      jobs
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

module.exports = router;
