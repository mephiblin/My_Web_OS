const express = require('express');

const auth = require('../middleware/auth');
const auditService = require('../services/auditService');
const packageRegistryService = require('../services/packageRegistryService');
const { runDockerCommand, classifyDockerError } = require('../services/dockerService');
const aiActionService = require('../services/aiActionService');

const router = express.Router();
router.use(auth);

function summarizeRuntime(runtimeManager) {
  const runtimeStatusMap = runtimeManager?.getRuntimeStatusMap ? runtimeManager.getRuntimeStatusMap() : {};
  const runtimeApps = Object.values(runtimeStatusMap || {});
  return {
    total: runtimeApps.length,
    running: runtimeApps.filter((item) => item?.status === 'running' || item?.status === 'starting' || item?.status === 'degraded').length,
    error: runtimeApps.filter((item) => item?.status === 'error').length
  };
}

async function getDockerSnapshot() {
  try {
    const output = await runDockerCommand('docker ps --format "{{.ID}}\t{{.Status}}\t{{.Names}}"');
    const lines = String(output || '').trim()
      ? String(output).trim().split('\n').slice(0, 40)
      : [];
    return {
      ok: true,
      count: lines.length,
      raw: lines.join('\n')
    };
  } catch (err) {
    const mapped = classifyDockerError(err, 'DOCKER_STATUS_FETCH_FAILED');
    return {
      ok: false,
      count: 0,
      error: `${mapped.code}: ${mapped.message}`,
      raw: ''
    };
  }
}

function shouldInspectDocker(message) {
  const lower = String(message || '').toLowerCase();
  return lower.includes('docker') || lower.includes('도커') || lower.includes('container') || lower.includes('컨테이너');
}

router.post('/assist', async (req, res) => {
  try {
    const message = String(req.body?.message || '').trim();
    if (!message) {
      return res.status(400).json({
        error: true,
        code: 'AI_MESSAGE_REQUIRED',
        message: 'message is required.'
      });
    }

    const runtimeManager = req.app.get('runtimeManager');
    const includeDocker = shouldInspectDocker(message);
    const [desktopApps, recentErrors, dockerSnapshot] = await Promise.all([
      packageRegistryService.listDesktopApps().catch(() => []),
      auditService.getLogs({ limit: 20, level: 'ERROR' }).catch(() => []),
      includeDocker ? getDockerSnapshot() : Promise.resolve(null)
    ]);

    if (includeDocker) {
      await auditService.log('AI', 'AI Docker status inspected', {
        user: req.user?.username,
        dockerOk: dockerSnapshot?.ok === true
      }, 'INFO').catch(() => {});
    }

    const payload = aiActionService.buildReply({
      message,
      desktopApps,
      runtimeSummary: summarizeRuntime(runtimeManager),
      docker: dockerSnapshot,
      recentErrors
    });

    return res.json({
      success: true,
      reply: payload.reply,
      resultCard: payload.resultCard,
      generatedAt: new Date().toISOString()
    });
  } catch (err) {
    return res.status(500).json({
      error: true,
      code: 'AI_ASSIST_FAILED',
      message: err.message
    });
  }
});

router.post('/audit', async (req, res) => {
  try {
    const action = String(req.body?.action || '').trim();
    if (!action) {
      return res.status(400).json({
        error: true,
        code: 'AI_AUDIT_ACTION_REQUIRED',
        message: 'action is required.'
      });
    }

    const runId = String(req.body?.runId || '').trim();
    const taskId = String(req.body?.taskId || '').trim();
    const detail = req.body?.detail && typeof req.body.detail === 'object'
      ? req.body.detail
      : {};

    await auditService.log(
      'AI',
      `Agent Workflow: ${action}`,
      {
        user: req.user?.username || 'unknown',
        runId: runId || undefined,
        taskId: taskId || undefined,
        detail
      },
      'INFO'
    );

    return res.json({
      success: true
    });
  } catch (err) {
    return res.status(500).json({
      error: true,
      code: 'AI_AUDIT_LOG_FAILED',
      message: err.message
    });
  }
});

module.exports = router;
