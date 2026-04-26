const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const auditService = require('../services/auditService');
const operationApprovalService = require('../services/operationApprovalService');
const {
  sanitizeContainerId,
  buildDockerApprovalTargetHash,
  runDockerCommand,
  classifyDockerError,
  parseDockerJsonLines
} = require('../services/dockerService');

router.use(auth);

function sendDockerError(res, err, fallbackCode) {
  const mapped = classifyDockerError(err, fallbackCode);
  return res.status(mapped.status).json({
    error: true,
    code: mapped.code,
    message: mapped.message,
    details: mapped.details || null
  });
}

function createDockerHttpError(status, code, message, details = null) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.details = details;
  return err;
}

function dockerApprovalAction(action) {
  return `docker.${action}`;
}

function validateContainerIdOrThrow(rawId) {
  const id = sanitizeContainerId(rawId);
  if (!id) {
    throw createDockerHttpError(400, 'DOCKER_CONTAINER_ID_INVALID', 'Invalid container ID.');
  }
  return id;
}

function getDockerApprovalInput(body = {}) {
  return body.approval && typeof body.approval === 'object' && !Array.isArray(body.approval)
    ? body.approval
    : {};
}

function buildDockerApprovalPreflight(req, { id, action }) {
  const approvalAction = dockerApprovalAction(action);
  const targetHash = buildDockerApprovalTargetHash({ id, action });
  const operation = operationApprovalService.createOperation({
    action: approvalAction,
    userId: req.user?.username,
    target: {
      type: 'docker.container',
      id,
      label: id
    },
    targetHash,
    typedConfirmation: id,
    metadata: {
      impact: `Runs docker ${action} for container ${id}.`,
      recoverability: action === 'remove' ? 'unrecoverable without image/compose recreation' : 'reversible by another container lifecycle action',
      riskLevel: 'high',
      command: `docker ${action === 'remove' ? 'rm -f' : action} ${id}`
    }
  });

  return {
    action: approvalAction,
    operationId: operation.operationId,
    target: operation.target,
    targetHash,
    impact: operation.metadata.impact,
    recoverability: operation.metadata.recoverability,
    expiresAt: operation.expiresAt,
    approval: {
      required: true,
      typedConfirmation: id
    }
  };
}

async function createDockerPreflight(req, { id, action }) {
  const preflight = buildDockerApprovalPreflight(req, { id, action });
  await auditService.log('SYSTEM', `${preflight.action}.preflight`, {
    operationId: preflight.operationId,
    containerId: id,
    targetHash: preflight.targetHash,
    impact: preflight.impact,
    recoverability: preflight.recoverability,
    expiresAt: preflight.expiresAt,
    user: req.user?.username
  }, 'WARNING');
  return preflight;
}

async function approveDockerOperation(req, { id, action }) {
  const approvalAction = dockerApprovalAction(action);
  const approval = operationApprovalService.approveOperation({
    operationId: req.body?.operationId,
    userId: req.user?.username,
    action: approvalAction,
    targetId: id,
    typedConfirmation: req.body?.typedConfirmation
  });
  await auditService.log('SYSTEM', `${approvalAction}.approved`, {
    operationId: approval.operationId,
    containerId: id,
    expiresAt: approval.expiresAt,
    user: req.user?.username
  }, 'WARNING');
  return approval;
}

function consumeDockerApproval(req, { id, action }) {
  const approval = getDockerApprovalInput(req.body);
  if (!String(approval.operationId || '').trim() || !String(approval.nonce || '').trim()) {
    throw createDockerHttpError(428, 'DOCKER_OPERATION_APPROVAL_REQUIRED', 'Docker operation requires a scoped approval nonce.');
  }
  return operationApprovalService.consumeApproval({
    operationId: approval.operationId,
    nonce: approval.nonce,
    userId: req.user?.username,
    action: dockerApprovalAction(action),
    targetId: id,
    targetHash: buildDockerApprovalTargetHash({ id, action })
  });
}

async function handleDockerApprovalPreflight(req, res, action) {
  try {
    const id = validateContainerIdOrThrow(req.body?.id);
    const preflight = await createDockerPreflight(req, { id, action });
    return res.json({ success: true, preflight });
  } catch (err) {
    return sendDockerError(res, err, `DOCKER_CONTAINER_${action.toUpperCase()}_PREFLIGHT_FAILED`);
  }
}

async function handleDockerApprovalApprove(req, res, action) {
  try {
    const id = validateContainerIdOrThrow(req.body?.id);
    const approval = await approveDockerOperation(req, { id, action });
    return res.json({ success: true, approval });
  } catch (err) {
    await auditService.log('SYSTEM', `${dockerApprovalAction(action)}.approval_rejected`, {
      operationId: req.body?.operationId || null,
      approvalCode: err?.code || null,
      user: req.user?.username
    }, 'WARNING');
    return sendDockerError(res, createDockerHttpError(400, `DOCKER_CONTAINER_${action.toUpperCase()}_APPROVAL_INVALID`, err.message), `DOCKER_CONTAINER_${action.toUpperCase()}_APPROVAL_INVALID`);
  }
}

/**
 * GET /api/docker/containers
 */
router.get('/containers', async (req, res) => {
  try {
    const output = await runDockerCommand('docker ps -a --format "{{json .}}"');
    if (!output) return res.json({ containers: [] });
    const containers = parseDockerJsonLines(output);
    res.json({ containers });
  } catch (err) {
    const mapped = classifyDockerError(err, 'DOCKER_CONTAINERS_FETCH_FAILED');
    res.json({
      containers: [],
      error: true,
      code: mapped.code,
      message: mapped.message
    });
  }
});

/**
 * GET /api/docker/logs?id=<container>&tail=200
 */
router.get('/logs', async (req, res) => {
  try {
    const id = sanitizeContainerId(String(req.query.id || '').trim());
    if (!id) {
      return res.status(400).json({ error: true, code: 'DOCKER_CONTAINER_ID_INVALID', message: 'Invalid container ID.' });
    }
    const tail = Number.isFinite(Number(req.query.tail)) ? Math.max(20, Math.min(1000, Number(req.query.tail))) : 200;
    const output = await runDockerCommand(`docker logs --tail ${tail} ${id} 2>&1`);
    const lines = output ? output.split('\n').filter(Boolean) : [];
    return res.json({ success: true, id, lines });
  } catch (err) {
    return sendDockerError(res, err, 'DOCKER_LOGS_FETCH_FAILED');
  }
});

/**
 * GET /api/docker/volumes
 */
router.get('/volumes', async (_req, res) => {
  try {
    const output = await runDockerCommand('docker volume ls --format "{{json .}}"');
    const volumes = parseDockerJsonLines(output);
    return res.json({ success: true, volumes });
  } catch (err) {
    return sendDockerError(res, err, 'DOCKER_VOLUMES_FETCH_FAILED');
  }
});

/**
 * GET /api/docker/images
 */
router.get('/images', async (_req, res) => {
  try {
    const output = await runDockerCommand('docker image ls --format "{{json .}}"');
    const images = parseDockerJsonLines(output);
    return res.json({ success: true, images });
  } catch (err) {
    return sendDockerError(res, err, 'DOCKER_IMAGES_FETCH_FAILED');
  }
});

/**
 * GET /api/docker/compose/projects
 */
router.get('/compose/projects', async (_req, res) => {
  try {
    const output = await runDockerCommand('docker compose ls --format json');
    const projects = parseDockerJsonLines(output);
    return res.json({ success: true, projects });
  } catch (err) {
    return sendDockerError(res, err, 'DOCKER_COMPOSE_FETCH_FAILED');
  }
});

/**
 * POST /api/docker/start
 */
router.post('/start', async (req, res) => {
  try {
    const id = sanitizeContainerId(req.body.id);
    if (!id) {
      return res.status(400).json({
        error: true,
        code: 'DOCKER_CONTAINER_ID_INVALID',
        message: 'Invalid container ID.'
      });
    }
    await runDockerCommand(`docker start ${id}`);
    await auditService.log('SYSTEM', 'Docker: Start Container', { containerId: id, user: req.user?.username }, 'INFO');
    res.json({ success: true, message: `Container ${id} started.` });
  } catch (err) {
    return sendDockerError(res, err, 'DOCKER_CONTAINER_START_FAILED');
  }
});

/**
 * POST /api/docker/stop
 */
router.post('/stop/preflight', (req, res) => handleDockerApprovalPreflight(req, res, 'stop'));
router.post('/stop/approve', (req, res) => handleDockerApprovalApprove(req, res, 'stop'));

router.post('/stop', async (req, res) => {
  let approvalContext = null;
  try {
    const id = validateContainerIdOrThrow(req.body.id);
    try {
      approvalContext = consumeDockerApproval(req, { id, action: 'stop' });
    } catch (approvalErr) {
      const preflight = await createDockerPreflight(req, { id, action: 'stop' });
      await auditService.log('SYSTEM', 'docker.stop.approval_rejected', {
        operationId: req.body?.approval?.operationId || null,
        approvalCode: approvalErr?.code || null,
        containerId: id,
        user: req.user?.username
      }, 'WARNING');
      return res.status(428).json({
        error: true,
        code: 'DOCKER_CONTAINER_STOP_APPROVAL_REQUIRED',
        message: approvalErr.message,
        preflight
      });
    }
    await runDockerCommand(`docker stop ${id}`);
    await auditService.log('SYSTEM', 'docker.stop', {
      operationId: approvalContext.operationId,
      containerId: id,
      targetHash: approvalContext.targetHash,
      approval: { nonceConsumed: true },
      result: { status: 'success' },
      user: req.user?.username
    }, 'WARNING');
    res.json({ success: true, message: `Container ${id} stopped.` });
  } catch (err) {
    if (approvalContext) {
      await auditService.log('SYSTEM', 'docker.stop', {
        operationId: approvalContext.operationId,
        containerId: approvalContext.target?.id,
        targetHash: approvalContext.targetHash,
        approval: { nonceConsumed: true },
        result: { status: 'failure', code: err?.code || 'DOCKER_CONTAINER_STOP_FAILED' },
        user: req.user?.username
      }, 'ERROR');
    }
    return sendDockerError(res, err, 'DOCKER_CONTAINER_STOP_FAILED');
  }
});

/**
 * POST /api/docker/restart
 */
router.post('/restart/preflight', (req, res) => handleDockerApprovalPreflight(req, res, 'restart'));
router.post('/restart/approve', (req, res) => handleDockerApprovalApprove(req, res, 'restart'));

router.post('/restart', async (req, res) => {
  let approvalContext = null;
  try {
    const id = validateContainerIdOrThrow(req.body.id);
    try {
      approvalContext = consumeDockerApproval(req, { id, action: 'restart' });
    } catch (approvalErr) {
      const preflight = await createDockerPreflight(req, { id, action: 'restart' });
      await auditService.log('SYSTEM', 'docker.restart.approval_rejected', {
        operationId: req.body?.approval?.operationId || null,
        approvalCode: approvalErr?.code || null,
        containerId: id,
        user: req.user?.username
      }, 'WARNING');
      return res.status(428).json({
        error: true,
        code: 'DOCKER_CONTAINER_RESTART_APPROVAL_REQUIRED',
        message: approvalErr.message,
        preflight
      });
    }
    await runDockerCommand(`docker restart ${id}`);
    await auditService.log('SYSTEM', 'docker.restart', {
      operationId: approvalContext.operationId,
      containerId: id,
      targetHash: approvalContext.targetHash,
      approval: { nonceConsumed: true },
      result: { status: 'success' },
      user: req.user?.username
    }, 'WARNING');
    res.json({ success: true, message: `Container ${id} restarted.` });
  } catch (err) {
    if (approvalContext) {
      await auditService.log('SYSTEM', 'docker.restart', {
        operationId: approvalContext.operationId,
        containerId: approvalContext.target?.id,
        targetHash: approvalContext.targetHash,
        approval: { nonceConsumed: true },
        result: { status: 'failure', code: err?.code || 'DOCKER_CONTAINER_RESTART_FAILED' },
        user: req.user?.username
      }, 'ERROR');
    }
    return sendDockerError(res, err, 'DOCKER_CONTAINER_RESTART_FAILED');
  }
});

/**
 * DELETE /api/docker/remove
 */
router.post('/remove/preflight', (req, res) => handleDockerApprovalPreflight(req, res, 'remove'));
router.post('/remove/approve', (req, res) => handleDockerApprovalApprove(req, res, 'remove'));

router.delete('/remove', async (req, res) => {
  let approvalContext = null;
  try {
    const id = validateContainerIdOrThrow(req.body.id);
    try {
      approvalContext = consumeDockerApproval(req, { id, action: 'remove' });
    } catch (approvalErr) {
      const preflight = await createDockerPreflight(req, { id, action: 'remove' });
      await auditService.log('SYSTEM', 'docker.remove.approval_rejected', {
        operationId: req.body?.approval?.operationId || null,
        approvalCode: approvalErr?.code || null,
        containerId: id,
        user: req.user?.username
      }, 'WARNING');
      return res.status(428).json({
        error: true,
        code: 'DOCKER_CONTAINER_REMOVE_APPROVAL_REQUIRED',
        message: approvalErr.message,
        preflight
      });
    }
    await runDockerCommand(`docker rm -f ${id}`);
    await auditService.log('SYSTEM', 'docker.remove', {
      operationId: approvalContext.operationId,
      containerId: id,
      targetHash: approvalContext.targetHash,
      approval: { nonceConsumed: true },
      result: { status: 'success' },
      user: req.user?.username
    }, 'WARNING');
    res.json({ success: true, message: `Container ${id} removed.` });
  } catch (err) {
    if (approvalContext) {
      await auditService.log('SYSTEM', 'docker.remove', {
        operationId: approvalContext.operationId,
        containerId: approvalContext.target?.id,
        targetHash: approvalContext.targetHash,
        approval: { nonceConsumed: true },
        result: { status: 'failure', code: err?.code || 'DOCKER_CONTAINER_REMOVE_FAILED' },
        user: req.user?.username
      }, 'ERROR');
    }
    return sendDockerError(res, err, 'DOCKER_CONTAINER_REMOVE_FAILED');
  }
});

module.exports = router;
