function clampText(value, maxLength = 4000) {
  return String(value || '').trim().slice(0, maxLength);
}

function toLowerText(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeAction(action, index) {
  if (!action || typeof action !== 'object') return null;
  const type = clampText(action.type, 64).toLowerCase();
  const label = clampText(action.label, 200);
  if (!type || !label) return null;
  return {
    id: clampText(action.id, 128) || `action-${index + 1}`,
    type,
    label,
    status: clampText(action.status, 24) || 'ready',
    payload: action.payload && typeof action.payload === 'object' ? action.payload : {}
  };
}

function detectDesktopAppIntent(messageLower, desktopApps = []) {
  for (const app of desktopApps) {
    const title = toLowerText(app?.title);
    const id = toLowerText(app?.id);
    if (!title && !id) continue;
    if ((title && messageLower.includes(title)) || (id && messageLower.includes(id))) {
      return app;
    }
  }
  return null;
}

function addOpenSystemAppAction(actions, appId, title) {
  const safeId = clampText(appId, 64);
  if (!safeId) return;
  const exists = actions.some((item) => String(item?.type || '').toLowerCase() === 'open_system_app' && item?.payload?.appId === safeId);
  if (exists) return;
  actions.push({
    id: `open-system-${safeId}`,
    type: 'open_system_app',
    label: `Open ${clampText(title || safeId, 80)}`,
    payload: {
      appId: safeId,
      title: clampText(title || safeId, 80)
    }
  });
}

function addOpenAuditAction(actions, search = '') {
  const exists = actions.some((item) => String(item?.type || '').toLowerCase() === 'open_audit');
  if (exists) return;
  const searchText = clampText(search, 120);
  actions.push({
    id: 'open-audit-trail',
    type: 'open_audit',
    label: 'Open Audit Trail',
    payload: {
      appId: 'logs',
      scope: 'audit',
      focus: 'audit',
      search: searchText || 'agent workflow'
    }
  });
}

function buildReply({ message, desktopApps = [], runtimeSummary = null, docker = null, recentErrors = [] }) {
  const messageText = clampText(message, 1000);
  const lower = toLowerText(messageText);

  const actions = [];
  const notes = [];
  let title = 'Assistant Result';
  let summary = 'Request analyzed.';
  let rawOutput = '';

  const appIntent = detectDesktopAppIntent(lower, desktopApps);
  if (lower.includes('open app') || lower.includes('앱 열') || appIntent) {
    const appId = appIntent?.id || 'files';
    title = 'Open App';
    summary = `Prepared open-app action for "${appIntent?.title || appId}".`;
    actions.push({
      id: `open-app-${appId}`,
      type: 'open_app',
      label: `Open ${appIntent?.title || appId}`,
      payload: {
        appId,
        title: appIntent?.title || appId
      }
    });
  }

  if (lower.includes('package') || lower.includes('패키지') || lower.includes('install') || lower.includes('update')) {
    addOpenSystemAppAction(actions, 'package-center', 'Package Center');
    addOpenAuditAction(actions, 'package');
  }

  if (lower.includes('open file') || lower.includes('파일 열')) {
    title = 'Open File Path';
    summary = 'Prepared file-station open-path action.';
    actions.push({
      id: 'open-file-path',
      type: 'open_file_path',
      label: 'Open Path In File Station',
      payload: {
        path: '/'
      }
    });
  }

  if (lower.includes('health check') || lower.includes('health') || lower.includes('헬스')) {
    const packageCandidate = desktopApps.find((app) => toLowerText(app?.appModel) === 'package');
    const appId = packageCandidate?.id || '';
    title = 'Package Health Check';
    summary = appId
      ? `Prepared package health-check action for "${appId}".`
      : 'No package app detected for health check. Install a package app first.';
    if (appId) {
      actions.push({
        id: `health-${appId}`,
        type: 'run_package_health_check',
        label: `Run Health Check (${appId})`,
        payload: { appId }
      });
    }
  }

  if (lower.includes('docker status') || lower.includes('docker') || lower.includes('도커')) {
    title = 'Docker Status';
    summary = docker?.ok
      ? `Docker containers: ${docker.count} detected.`
      : 'Docker status check failed. See raw output.';
    rawOutput = clampText(docker?.raw || docker?.error || '', 8000);
    actions.push({
      id: 'inspect-docker-status',
      type: 'inspect_docker_status',
      label: 'Inspect Docker Status',
      payload: {}
    });
    addOpenSystemAppAction(actions, 'docker', 'Docker Manager');
  }

  if (lower.includes('error log') || lower.includes('recent error') || lower.includes('에러 로그')) {
    title = 'Recent Error Summary';
    summary = `Recent errors: ${recentErrors.length}.`;
    rawOutput = clampText(
      recentErrors
        .slice(0, 20)
        .map((row) => `[${row?.timestamp || ''}] ${row?.action || ''}`)
        .join('\n'),
      8000
    );
    actions.push({
      id: 'summarize-recent-error-logs',
      type: 'summarize_recent_error_logs',
      label: 'Refresh Error Summary',
      payload: {}
    });
    addOpenSystemAppAction(actions, 'logs', 'Log Viewer');
    addOpenAuditAction(actions, 'error');
  }

  if (lower.includes('download') || lower.includes('transfer') || lower.includes('다운로드') || lower.includes('전송')) {
    title = 'Transfer Operations';
    summary = 'Prepared transfer/download workspace actions.';
    addOpenSystemAppAction(actions, 'download-station', 'Download Station');
    addOpenSystemAppAction(actions, 'transfer', 'Transfer');
    addOpenAuditAction(actions, 'transfer');
  }

  if (runtimeSummary && runtimeSummary.total > 0) {
    notes.push(`runtime:${runtimeSummary.running}/${runtimeSummary.total}`);
  }
  if (notes.length > 0) {
    summary = `${summary} (${notes.join(', ')})`;
  }

  if (actions.length === 0) {
    actions.push({
      id: 'inspect-docker-status',
      type: 'inspect_docker_status',
      label: 'Inspect Docker Status',
      payload: {}
    });
    actions.push({
      id: 'summarize-recent-error-logs',
      type: 'summarize_recent_error_logs',
      label: 'Summarize Recent Error Logs',
      payload: {}
    });
    addOpenSystemAppAction(actions, 'logs', 'Log Viewer');
    addOpenSystemAppAction(actions, 'package-center', 'Package Center');
    addOpenAuditAction(actions, 'agent workflow');
    title = 'Suggested Next Actions';
    summary = 'Prepared quick diagnostic actions.';
  }

  return {
    reply: summary,
    resultCard: {
      title,
      status: 'ok',
      summary,
      rawOutput: clampText(rawOutput, 8000),
      actions: actions.map(normalizeAction).filter(Boolean)
    }
  };
}

module.exports = {
  buildReply
};
