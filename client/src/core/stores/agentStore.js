import { writable } from 'svelte/store';
import { apiFetch } from '../../utils/api.js';
import { openWindow } from './windowStore.js';

const AGENT_STATUSES = new Set(['idle', 'listening', 'thinking', 'executing', 'success', 'warning', 'error', 'terminal']);
const APPROVAL_STATUSES = new Set(['pending', 'approved', 'rejected']);

const DEFAULT_AGENT_STATE = {
  visible: true,
  status: 'idle',
  dialogue: '',
  dialogueTimeout: null,
  isOpen: false,
  messages: [],
  draft: '',
  wrappedMode: {
    enabled: false,
    intentDraft: '',
    plannedActions: []
  }
};

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeStatus(value, fallback = 'idle') {
  const status = String(value || '').trim().toLowerCase();
  return AGENT_STATUSES.has(status) ? status : fallback;
}

function normalizeApprovalStatus(value, fallback = 'pending') {
  const status = String(value || '').trim().toLowerCase();
  return APPROVAL_STATUSES.has(status) ? status : fallback;
}

function createMessage(role, content, options = {}) {
  return {
    id: makeId(),
    role,
    content: String(content ?? ''),
    createdAt: Date.now(),
    kind: String(options.kind || 'text'),
    approval: options.approval || null,
    meta: options.meta && typeof options.meta === 'object' ? options.meta : null
  };
}

function makeResultAction(type, label, payload = {}, idPrefix = 'action') {
  return {
    id: `${idPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: String(type || '').trim().toLowerCase(),
    label: String(label || '').trim(),
    status: 'ready',
    payload: payload && typeof payload === 'object' ? payload : {}
  };
}

function makeOpenSystemAction(appId, title) {
  const safeId = String(appId || '').trim();
  const safeTitle = String(title || safeId).trim();
  if (!safeId || !safeTitle) return null;
  return makeResultAction(
    'open_system_app',
    `Open ${safeTitle}`,
    { appId: safeId, title: safeTitle },
    `open-${safeId}`
  );
}

function makeOpenAuditAction(search = '') {
  return makeResultAction(
    'open_audit',
    'Open Audit Trail',
    {
      appId: 'logs',
      focus: 'audit',
      search: String(search || '').trim()
    },
    'open-audit'
  );
}

function normalizeResultActions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 8)
    .map((item, index) => {
      const type = String(item?.type || '').trim().toLowerCase();
      const label = String(item?.label || '').trim();
      if (!type || !label) return null;
      const payloadRaw = item?.payload;
      let payload = {};
      if (typeof payloadRaw === 'string') {
        try {
          payload = JSON.parse(payloadRaw);
        } catch (_err) {
          payload = {};
        }
      } else if (payloadRaw && typeof payloadRaw === 'object') {
        payload = payloadRaw;
      }
      return {
        id: String(item?.id || `action-${index + 1}`),
        type,
        label,
        status: String(item?.status || 'ready').trim().toLowerCase() || 'ready',
        payload
      };
    })
    .filter(Boolean);
}

function normalizeApproval(value) {
  if (!value || typeof value !== 'object') return null;
  const actionId = String(value.actionId || '').trim();
  const title = String(value.title || '').trim();
  if (!actionId || !title) return null;
  return {
    actionId,
    title,
    summary: String(value.summary || '').trim(),
    actionLabel: String(value.actionLabel || 'Approve').trim() || 'Approve',
    risk: String(value.risk || 'medium').trim() || 'medium',
    impact: String(value.impact || '').trim(),
    target: String(value.target || '').trim(),
    reversibility: String(value.reversibility || '').trim(),
    recovery: String(value.recovery || '').trim(),
    runId: String(value.runId || '').trim(),
    status: normalizeApprovalStatus(value.status, 'pending'),
    resolvedAt: Number.isFinite(Number(value.resolvedAt)) ? Number(value.resolvedAt) : null
  };
}

function normalizeMessages(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const role = ['user', 'assistant', 'system'].includes(item?.role) ? item.role : 'system';
      const content = typeof item?.content === 'string' ? item.content : '';
      const kind = String(item?.kind || 'text').trim() || 'text';
      const approval = normalizeApproval(item?.approval);
      if (!content && !approval) return null;
      return {
        id: typeof item?.id === 'string' && item.id ? item.id : makeId(),
        role,
        content,
        createdAt: Number.isFinite(Number(item?.createdAt)) ? Number(item.createdAt) : Date.now(),
        kind,
        approval,
        meta: item?.meta && typeof item.meta === 'object'
          ? {
              ...item.meta,
              resultActions: normalizeResultActions(item.meta?.resultActions)
            }
          : null
      };
    })
    .filter(Boolean);
}

function normalizePersistedState(value = {}) {
  const wrapped = value?.wrappedMode && typeof value.wrappedMode === 'object'
    ? value.wrappedMode
    : {};
  const plannedActions = Array.isArray(wrapped.plannedActions)
    ? wrapped.plannedActions
      .map((item) => ({
        id: String(item?.id || makeId()),
        label: String(item?.label || '').trim(),
        status: String(item?.status || 'pending').trim() || 'pending'
      }))
      .filter((item) => item.label)
      .slice(0, 20)
    : [];
  return {
    isOpen: value?.isOpen === true,
    messages: normalizeMessages(value?.messages),
    draft: typeof value?.draft === 'string' ? value.draft : '',
    wrappedMode: {
      enabled: wrapped.enabled === true,
      intentDraft: typeof wrapped.intentDraft === 'string' ? wrapped.intentDraft : '',
      plannedActions
    }
  };
}

function toPersistedState(state) {
  const wrapped = state?.wrappedMode && typeof state.wrappedMode === 'object'
    ? state.wrappedMode
    : {};
  return {
    isOpen: state.isOpen === true,
    messages: normalizeMessages(state.messages),
    draft: typeof state.draft === 'string' ? state.draft : '',
    wrappedMode: {
      enabled: wrapped.enabled === true,
      intentDraft: typeof wrapped.intentDraft === 'string' ? wrapped.intentDraft : '',
      plannedActions: Array.isArray(wrapped.plannedActions)
        ? wrapped.plannedActions
          .map((item) => ({
            id: String(item?.id || makeId()),
            label: String(item?.label || '').trim(),
            status: String(item?.status || 'pending').trim() || 'pending'
          }))
          .filter((item) => item.label)
          .slice(0, 20)
        : []
    }
  };
}

const createAgentStore = () => {
  const { subscribe, set, update } = writable(DEFAULT_AGENT_STATE);
  let isInitialized = false;
  let saveTimeout;

  async function emitAgentAudit(action, payload = {}) {
    const safeAction = String(action || '').trim();
    if (!safeAction) return;
    try {
      await apiFetch('/api/ai/audit', {
        method: 'POST',
        body: JSON.stringify({
          action: safeAction,
          runId: String(payload?.runId || '').trim() || undefined,
          taskId: String(payload?.taskId || '').trim() || undefined,
          detail: payload?.detail && typeof payload.detail === 'object' ? payload.detail : {}
        })
      });
    } catch (_err) {
      // non-blocking audit path
    }
  }

  const init = async () => {
    try {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('web_os_token') : '';
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch('/api/system/state/agentChat', { headers });
      if (res.ok) {
        const json = await res.json();
        const persisted = normalizePersistedState(json?.data || {});
        set({ ...DEFAULT_AGENT_STATE, ...persisted });
      } else {
        set(DEFAULT_AGENT_STATE);
      }
    } catch (error) {
      console.error('Error initializing agent chat state:', error);
      set(DEFAULT_AGENT_STATE);
    } finally {
      isInitialized = true;
    }
  };

  subscribe((state) => {
    if (!isInitialized) return;
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('web_os_token') : '';
      fetch('/api/system/state/agentChat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token || ''}`
        },
        body: JSON.stringify(toPersistedState(state))
      }).catch((error) => console.error('Error saving agent chat state:', error));
    }, 500);
  });

  function setStatus(status, dialogue = '', duration = 0) {
    update((state) => {
      if (state.dialogueTimeout) clearTimeout(state.dialogueTimeout);
      const next = {
        ...state,
        status: normalizeStatus(status, state.status),
        dialogue: String(dialogue || '')
      };
      if (duration > 0) {
        next.dialogueTimeout = setTimeout(() => {
          update((inner) => ({ ...inner, status: 'idle', dialogue: '', dialogueTimeout: null }));
        }, duration);
      } else {
        next.dialogueTimeout = null;
      }
      return next;
    });
  }

  function addAssistantMessage(content, options = {}) {
    update((state) => ({
      ...state,
      isOpen: true,
      messages: [...state.messages, createMessage('assistant', content, options)]
    }));
  }

  function addSystemMessage(content, options = {}) {
    update((state) => ({
      ...state,
      isOpen: true,
      messages: [...state.messages, createMessage('system', content, options)]
    }));
  }

  function requestApproval(payload = {}) {
    const approval = normalizeApproval({
      actionId: payload.actionId || makeId(),
      title: payload.title || 'Approval required',
      summary: payload.summary || '',
      actionLabel: payload.actionLabel || 'Approve',
      risk: payload.risk || 'medium',
      impact: payload.impact || '',
      target: payload.target || '',
      reversibility: payload.reversibility || '',
      recovery: payload.recovery || '',
      runId: payload.runId || '',
      status: 'pending'
    });
    if (!approval) return;
    let hasPendingSameAction = false;
    update((state) => {
      hasPendingSameAction = state.messages.some((item) => (
        item?.kind === 'approval' &&
        item?.approval?.actionId === approval.actionId &&
        item?.approval?.status === 'pending'
      ));
      return state;
    });
    if (hasPendingSameAction) return;

    const cardMessage = createMessage(
      'assistant',
      payload.content || 'This action requires your approval.',
      { kind: 'approval', approval }
    );
    update((state) => ({
      ...state,
      isOpen: true,
      status: 'warning',
      dialogue: 'Approval required.',
      messages: [...state.messages, cardMessage]
    }));
    emitAgentAudit('approval_requested', {
      runId: approval.runId,
      taskId: approval.actionId,
      detail: {
        title: approval.title,
        risk: approval.risk,
        target: approval.target,
        impact: approval.impact,
        reversibility: approval.reversibility
      }
    });
  }

  function buildApprovalResultActions(approval, decision) {
    const safeDecision = String(decision || '').trim().toLowerCase();
    const links = [];
    links.push(makeOpenAuditAction(approval?.actionId || ''));
    links.push(makeOpenSystemAction('logs', 'Log Viewer'));

    const targetText = [
      String(approval?.target || ''),
      String(approval?.title || ''),
      String(approval?.summary || '')
    ].join(' ').toLowerCase();

    if (targetText.includes('package') || targetText.includes('runtime')) {
      links.push(makeOpenSystemAction('package-center', 'Package Center'));
    }
    if (targetText.includes('docker') || targetText.includes('container')) {
      links.push(makeOpenSystemAction('docker', 'Docker Manager'));
    }
    if (targetText.includes('terminal') || targetText.includes('command')) {
      links.push(makeOpenSystemAction('terminal', 'Terminal'));
    }
    if (targetText.includes('file') || targetText.includes('host')) {
      links.push(makeOpenSystemAction('files', 'File Station'));
    }

    // Deduplicate while preserving order.
    const seen = new Set();
    const deduped = [];
    for (const item of links) {
      if (!item?.type || !item?.label) continue;
      const key = `${item.type}:${item.payload?.appId || ''}:${item.payload?.search || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(item);
    }

    if (safeDecision !== 'approve' && safeDecision !== 'approved') {
      return deduped.filter((item) => item.type === 'open_audit' || item.payload?.appId === 'logs');
    }
    return deduped;
  }

  function resolveApproval(messageId, decision) {
    const targetId = String(messageId || '').trim();
    const nextStatus = decision === 'approve' ? 'approved' : 'rejected';
    const approved = decision === 'approve';
    if (!targetId) return;
    let resolvedApproval = null;
    update((state) => ({
      ...state,
      status: approved ? 'executing' : 'warning',
      dialogue: approved ? 'Action approved.' : 'Action rejected.',
      messages: state.messages.map((item) => {
        if (item.id !== targetId || !item.approval) return item;
        resolvedApproval = item.approval;
        return {
          ...item,
          approval: {
            ...item.approval,
            status: nextStatus,
            resolvedAt: Date.now()
          }
        };
      }),
      wrappedMode: {
        ...state.wrappedMode,
        plannedActions: Array.isArray(state.wrappedMode?.plannedActions)
          ? state.wrappedMode.plannedActions.map((action) => {
            const targetActionId = String(action?.id || '').trim();
            const resolvedActionId = state.messages.find((item) => item.id === targetId)?.approval?.actionId || '';
            if (!targetActionId || targetActionId !== resolvedActionId) return action;
            return {
              ...action,
              status: approved ? 'approved' : 'rejected'
            };
          })
          : []
      }
    }));

    const resultActions = buildApprovalResultActions(resolvedApproval, nextStatus);
    addSystemMessage(
      approved ? 'Approval accepted. Continue with linked recovery and audit checks.' : 'Approval rejected. Action execution was blocked.',
      {
        kind: 'result',
        meta: {
          sourceMessageId: targetId,
          decision: nextStatus,
          resultTitle: approved ? 'Approval Accepted' : 'Approval Rejected',
          resultStatus: approved ? 'ok' : 'warning',
          note: resolvedApproval?.summary || (approved ? 'Execution can proceed under approval scope.' : 'No host action executed.'),
          resultActions,
          auditTrace: resolvedApproval
            ? {
                actionId: resolvedApproval.actionId,
                runId: resolvedApproval.runId || '',
                title: resolvedApproval.title,
                risk: resolvedApproval.risk,
                target: resolvedApproval.target,
                impact: resolvedApproval.impact,
                reversibility: resolvedApproval.reversibility,
                decidedAt: Date.now()
              }
            : null
        }
      }
    );
    emitAgentAudit('approval_resolved', {
      runId: resolvedApproval?.runId,
      taskId: resolvedApproval?.actionId || '',
      detail: {
        decision: nextStatus,
        title: resolvedApproval?.title || '',
        risk: resolvedApproval?.risk || ''
      }
    });

    setStatus(approved ? 'success' : 'warning', approved ? 'Approval recorded.' : 'Approval rejected.', 1800);
  }

  function buildRiskProfile(message) {
    const text = String(message || '').toLowerCase();
    if (text.includes('delete') || text.includes('remove') || text.includes('rm ')) {
      return {
        title: 'Risk Check: Delete/Remove',
        summary: 'Delete/remove request detected. Target data may be permanently removed.',
        risk: 'high',
        impact: 'Data loss and workflow breakage are possible.',
        target: 'File or package data',
        reversibility: 'Low unless backup or rollback points exist.',
        recovery: 'Confirm backup availability and restore path before execution.'
      };
    }
    if (text.includes('overwrite')) {
      return {
        title: 'Risk Check: Overwrite',
        summary: 'Overwrite request detected. Existing content can be replaced.',
        risk: 'high',
        impact: 'Previous data versions can be lost.',
        target: 'File content',
        reversibility: 'Medium with prior backup/version history.',
        recovery: 'Create backup copy first, then proceed with overwrite.'
      };
    }
    if (text.includes('rollback')) {
      return {
        title: 'Risk Check: Rollback',
        summary: 'Rollback request detected. Runtime/package state will move to a previous point.',
        risk: 'medium',
        impact: 'Current runtime behavior and state may change.',
        target: 'Package/runtime lifecycle',
        reversibility: 'Medium when another rollback point is retained.',
        recovery: 'Validate rollback point and run health checks afterward.'
      };
    }
    return {
      title: 'Risk Check: Host Action',
      summary: 'Potentially destructive host action detected. Explicit approval is required.',
      risk: 'high',
      impact: 'System or data state can change unexpectedly.',
      target: 'Host operation',
      reversibility: 'Depends on backup/rollback coverage.',
      recovery: 'Review logs, backup status, and scope before continuing.'
    };
  }

  function maybeCreateApprovalFromInput(message) {
    const text = String(message || '').toLowerCase();
    const risky = ['delete', 'remove', 'rollback', 'overwrite', 'terminal', 'rm ', 'format'].some((token) => text.includes(token));
    if (!risky) return false;
    const profile = buildRiskProfile(message);

    requestApproval({
      title: profile.title,
      summary: profile.summary,
      actionLabel: 'Approve Action',
      risk: profile.risk,
      impact: profile.impact,
      target: profile.target,
      reversibility: profile.reversibility,
      recovery: profile.recovery,
      content: 'Risk check required. Review target, impact, reversibility, and recovery before approval.'
    });
    return true;
  }

  function updateResultActionStatus(messageId, actionId, status, note = '') {
    const targetMessageId = String(messageId || '').trim();
    const targetActionId = String(actionId || '').trim();
    if (!targetMessageId || !targetActionId) return;

    update((state) => ({
      ...state,
      messages: state.messages.map((item) => {
        if (item.id !== targetMessageId) return item;
        const meta = item.meta && typeof item.meta === 'object' ? item.meta : {};
        const actions = normalizeResultActions(meta.resultActions).map((action) => (
          action.id === targetActionId
            ? {
                ...action,
                status
              }
            : action
        ));
        return {
          ...item,
          meta: {
            ...meta,
            note: note || meta.note || '',
            resultActions: actions
          }
        };
      })
    }));
  }

  async function executeActionFromResult(messageId, actionId) {
    const targetMessageId = String(messageId || '').trim();
    const targetActionId = String(actionId || '').trim();
    if (!targetMessageId || !targetActionId) return;

    let action = null;
    update((state) => {
      const message = state.messages.find((item) => item.id === targetMessageId);
      const actions = normalizeResultActions(message?.meta?.resultActions);
      action = actions.find((item) => item.id === targetActionId) || null;
      return state;
    });
    if (!action) return;

    updateResultActionStatus(targetMessageId, targetActionId, 'running');
    emitAgentAudit('result_action_started', {
      taskId: action.id,
      detail: {
        type: action.type,
        label: action.label
      }
    });

    try {
      const openSystemApp = (appId, title = '') => {
        const id = String(appId || '').trim();
        if (!id) throw new Error('appId is required.');
        openWindow({
          id,
          title: String(title || id).trim() || id
        });
      };

      const openAuditTrail = (payload = {}) => {
        openWindow(
          {
            id: 'logs',
            title: 'Log Viewer'
          },
          {
            focus: String(payload?.focus || 'audit').trim() || 'audit',
            search: String(payload?.search || '').trim(),
            level: String(payload?.level || '').trim()
          }
        );
      };

      if (action.type === 'open_app') {
        const appId = String(action.payload?.appId || '').trim();
        if (!appId) throw new Error('appId is required.');
        openSystemApp(appId, String(action.payload?.title || appId));
        addSystemMessage(`Opened app: ${appId}`, { kind: 'result' });
      } else if (action.type === 'open_system_app') {
        const appId = String(action.payload?.appId || '').trim();
        const title = String(action.payload?.title || appId).trim();
        openSystemApp(appId, title);
        addSystemMessage(`Opened system app: ${appId}`, { kind: 'result' });
      } else if (action.type === 'open_logs') {
        openSystemApp('logs', 'Log Viewer');
        addSystemMessage('Opened Log Viewer.', { kind: 'result' });
      } else if (action.type === 'open_package_center') {
        openSystemApp('package-center', 'Package Center');
        addSystemMessage('Opened Package Center.', { kind: 'result' });
      } else if (action.type === 'open_transfer') {
        openSystemApp('transfer', 'Transfer');
        addSystemMessage('Opened Transfer.', { kind: 'result' });
      } else if (action.type === 'open_docker') {
        openSystemApp('docker', 'Docker Manager');
        addSystemMessage('Opened Docker Manager.', { kind: 'result' });
      } else if (action.type === 'open_audit') {
        openAuditTrail(action.payload || {});
        addSystemMessage('Opened audit trail in Log Viewer.', { kind: 'result' });
      } else if (action.type === 'open_file_path') {
        const path = String(action.payload?.path || '/').trim() || '/';
        openWindow(
          {
            id: 'files',
            title: 'File Station'
          },
          {
            path
          }
        );
        addSystemMessage(`Opened path in File Station: ${path}`, { kind: 'result' });
      } else if (action.type === 'run_package_health_check') {
        const appId = String(action.payload?.appId || '').trim();
        if (!appId) throw new Error('appId is required.');
        const result = await apiFetch(`/api/packages/${encodeURIComponent(appId)}/health`);
        const statusText = String(result?.report?.status || result?.status || 'unknown').toLowerCase();
        addSystemMessage(`Package health check (${appId}) finished with status: ${statusText}.`, {
          kind: 'result',
          meta: {
            resultTitle: `Health Check: ${appId}`,
            resultStatus: statusText,
            note: String(result?.report?.summary || ''),
            resultActions: [
              makeOpenSystemAction('package-center', 'Package Center'),
              makeOpenSystemAction('logs', 'Log Viewer'),
              makeOpenAuditAction(`health-${appId}`)
            ].filter(Boolean)
          }
        });
      } else if (action.type === 'inspect_docker_status') {
        const result = await apiFetch('/api/docker/containers');
        const rows = Array.isArray(result?.containers) ? result.containers : [];
        const rawOutput = rows.slice(0, 20).map((row) => `${row?.ID || '-'}\t${row?.Status || '-'}\t${row?.Names || '-'}`).join('\n');
        addSystemMessage(`Docker containers: ${rows.length}`, {
          kind: 'result',
          meta: {
            resultTitle: 'Docker Status',
            resultStatus: 'ok',
            rawOutput,
            resultActions: [
              makeOpenSystemAction('docker', 'Docker Manager'),
              makeOpenSystemAction('logs', 'Log Viewer'),
              makeOpenAuditAction('docker')
            ].filter(Boolean)
          }
        });
      } else if (action.type === 'summarize_recent_error_logs') {
        const rows = await apiFetch('/api/logs?level=ERROR&limit=20');
        const logs = Array.isArray(rows) ? rows : [];
        const rawOutput = logs.map((row) => `[${row?.timestamp || ''}] ${row?.action || ''}`).join('\n');
        addSystemMessage(`Recent errors: ${logs.length}`, {
          kind: 'result',
          meta: {
            resultTitle: 'Recent Error Logs',
            resultStatus: logs.length > 0 ? 'warning' : 'ok',
            rawOutput,
            resultActions: [
              makeOpenSystemAction('logs', 'Log Viewer'),
              makeOpenAuditAction('errors')
            ].filter(Boolean)
          }
        });
      } else {
        throw new Error(`Unsupported action type: ${action.type}`);
      }

      updateResultActionStatus(targetMessageId, targetActionId, 'completed');
      emitAgentAudit('result_action_completed', {
        taskId: action.id,
        detail: {
          type: action.type,
          label: action.label
        }
      });
      setStatus('success', 'Action completed.', 1800);
    } catch (err) {
      updateResultActionStatus(targetMessageId, targetActionId, 'failed', String(err?.message || 'Action failed.'));
      emitAgentAudit('result_action_failed', {
        taskId: action.id,
        detail: {
          type: action.type,
          label: action.label,
          error: String(err?.message || 'Action failed')
        }
      });
      addSystemMessage(`Action failed: ${err?.message || 'Unknown error'}`, {
        kind: 'result',
        meta: {
          resultTitle: 'Action Failure',
          resultStatus: 'error',
          note: String(err?.message || ''),
          resultActions: [
            {
              id: `fallback-open-logs-${Date.now()}`,
              type: 'open_system_app',
              label: 'Open Log Viewer',
              status: 'ready',
              payload: { appId: 'logs', title: 'Log Viewer' }
            },
            {
              id: `fallback-open-package-center-${Date.now()}`,
              type: 'open_system_app',
              label: 'Open Package Center',
              status: 'ready',
              payload: { appId: 'package-center', title: 'Package Center' }
            },
            {
              id: `fallback-open-audit-${Date.now()}`,
              type: 'open_audit',
              label: 'Open Audit Trail',
              status: 'ready',
              payload: { appId: 'logs', scope: 'audit' }
            }
          ]
        }
      });
      setStatus('error', 'Action failed.', 2200);
    }
  }

  return {
    subscribe,
    init,
    setVisibility: (visible) => update((s) => ({ ...s, visible })),
    togglePanel: () => update((s) => ({ ...s, isOpen: !s.isOpen })),
    openPanel: () => update((s) => ({ ...s, isOpen: true })),
    closePanel: () => update((s) => ({ ...s, isOpen: false })),
    setDraft: (draft) => update((s) => ({ ...s, draft: typeof draft === 'string' ? draft : '' })),
    toggleWrappedMode: () =>
      update((s) => ({
        ...s,
        wrappedMode: {
          ...s.wrappedMode,
          enabled: !s.wrappedMode.enabled
        }
      })),
    setWrappedIntentDraft: (value) =>
      update((s) => ({
        ...s,
        wrappedMode: {
          ...s.wrappedMode,
          intentDraft: typeof value === 'string' ? value : ''
        }
      })),
    addWrappedPlannedAction: (label) =>
      update((s) => {
        const text = String(label || '').trim();
        if (!text) return s;
        const next = Array.isArray(s.wrappedMode?.plannedActions) ? [...s.wrappedMode.plannedActions] : [];
        if (next.length >= 20) return s;
        next.push({
          id: makeId(),
          label: text,
          status: 'pending'
        });
        return {
          ...s,
          wrappedMode: {
            ...s.wrappedMode,
            plannedActions: next,
            intentDraft: ''
          }
        };
      }),
    clearWrappedPlan: () =>
      update((s) => ({
        ...s,
        wrappedMode: {
          ...s.wrappedMode,
          plannedActions: []
        }
      })),
    runWrappedPlanWithApprovals: () =>
      update((s) => {
        if (s.wrappedMode?.enabled !== true) {
          return {
            ...s,
            status: 'warning',
            dialogue: 'Enable Wrapped Assistant Mode first.'
          };
        }
        const actions = Array.isArray(s.wrappedMode?.plannedActions) ? s.wrappedMode.plannedActions : [];
        if (actions.length === 0) return s;
        const normalizedPlan = actions
          .map((action) => ({
            id: String(action?.id || makeId()),
            label: String(action?.label || '').trim().slice(0, 200),
            status: 'pending'
          }))
          .filter((action) => action.label)
          .slice(0, 20);
        if (normalizedPlan.length === 0) return s;
        const runId = `wrapped-${Date.now()}`;
        setTimeout(() => {
          emitAgentAudit('wrapped_task_queued', {
            runId,
            detail: {
              stepCount: normalizedPlan.length,
              steps: normalizedPlan.map((item) => ({ id: item.id, label: item.label }))
            }
          });
        }, 0);

        return {
          ...s,
          isOpen: true,
          status: 'warning',
          dialogue: 'Wrapped mode: approvals required.',
          wrappedMode: {
            ...s.wrappedMode,
            plannedActions: normalizedPlan
          },
          messages: [
            ...s.messages,
            createMessage('assistant', `Wrapped Assistant plan queued (${runId}). Approve actions one-by-one.`, {
              kind: 'result',
              meta: {
                resultTitle: 'Repeatable Task Queued',
                resultStatus: 'pending',
                note: `Task ${runId} prepared with ${normalizedPlan.length} steps.`,
                resultActions: [
                  makeOpenAuditAction(runId),
                  makeOpenSystemAction('logs', 'Log Viewer')
                ].filter(Boolean),
                repeatableTask: {
                  id: runId,
                  steps: normalizedPlan.map((item) => ({
                    id: item.id,
                    label: item.label
                  }))
                }
              }
            }),
            ...normalizedPlan.map((action) =>
              createMessage('assistant', `Planned action: ${action.label}`, {
                kind: 'approval',
                approval: {
                  actionId: action.id,
                  title: 'Wrapped Assistant action',
                  summary: action.label,
                  actionLabel: 'Approve step',
                  risk: 'medium',
                  runId,
                  status: 'pending'
                }
              })
            )
          ]
        };
      }),
    setStatus,
    addAssistantMessage,
    addSystemMessage,
    requestApproval,
    resolveApproval,
    sendUserMessage: (rawMessage) =>
      update((state) => {
        const fromArg = typeof rawMessage === 'string' ? rawMessage : state.draft;
        const message = fromArg.trim();
        if (!message) return state;
        const next = {
          ...state,
          isOpen: true,
          draft: '',
          status: 'listening',
          messages: [...state.messages, createMessage('user', message)]
        };
        return next;
      }),
    handleUserMessageFlow: async (message) => {
      setStatus('thinking', 'Analyzing request...', 0);
      if (maybeCreateApprovalFromInput(message)) return;
      try {
        const payload = await apiFetch('/api/ai/assist', {
          method: 'POST',
          body: JSON.stringify({ message })
        });
        const card = payload?.resultCard && typeof payload.resultCard === 'object' ? payload.resultCard : {};
        const resultActions = normalizeResultActions(card.actions || []);
        addAssistantMessage(
          String(payload?.reply || card.summary || 'Request analyzed.'),
          {
            kind: 'result',
            meta: {
              resultTitle: String(card.title || 'Assistant Result'),
              resultStatus: String(card.status || 'ok'),
              rawOutput: String(card.rawOutput || ''),
              resultActions,
              note: String(card.summary || '')
            }
          }
        );
        setStatus('success', 'Ready.', 1800);
      } catch (err) {
        addSystemMessage(`Assistant request failed: ${err?.message || 'unknown error'}`, {
          kind: 'result',
          meta: {
            resultTitle: 'Assistant Proxy Error',
            resultStatus: 'error',
            note: String(err?.message || '')
          }
        });
        setStatus('error', 'Assistant failed.', 2200);
      }
    },
    executeResultAction: executeActionFromResult,

    // Compatibility methods used by existing apps
    triggerEmotion: (emotion, dialogue = '', duration = 5000) => {
      const map = {
        idle: 'idle',
        alert: 'warning',
        error: 'error',
        happy: 'success',
        processing: 'thinking'
      };
      setStatus(map[String(emotion || 'idle')] || 'idle', dialogue, duration);
    },
    notifyUploadComplete: () => setStatus('success', 'File upload complete!', 3000),
    notifyError: (msg) => setStatus('error', `Oops: ${msg}`, 5000),
    notifySystemAlert: () => setStatus('warning', 'High CPU usage detected!', 4000)
  };
};

export const agentStore = createAgentStore();
