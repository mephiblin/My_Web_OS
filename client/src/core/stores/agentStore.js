import { writable } from 'svelte/store';

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
        meta: item?.meta && typeof item.meta === 'object' ? item.meta : null
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
      status: 'pending'
    });
    if (!approval) return;
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
  }

  function resolveApproval(messageId, decision) {
    const targetId = String(messageId || '').trim();
    const nextStatus = decision === 'approve' ? 'approved' : 'rejected';
    const approved = decision === 'approve';
    if (!targetId) return;
    update((state) => ({
      ...state,
      status: approved ? 'executing' : 'warning',
      dialogue: approved ? 'Action approved.' : 'Action rejected.',
      messages: state.messages.map((item) => {
        if (item.id !== targetId || !item.approval) return item;
        return {
          ...item,
          approval: {
            ...item.approval,
            status: nextStatus,
            resolvedAt: Date.now()
          }
        };
      })
    }));

    addSystemMessage(
      approved ? 'Approval granted. Execution can proceed.' : 'Approval rejected. Action was canceled.',
      { kind: 'result', meta: { sourceMessageId: targetId, decision: nextStatus } }
    );

    if (approved) {
      setStatus('success', 'Execution completed.', 3000);
    }
  }

  function maybeCreateApprovalFromInput(message) {
    const text = String(message || '').toLowerCase();
    const risky = ['delete', 'remove', 'rollback', 'overwrite', 'terminal', 'rm ', 'format'].some((token) => text.includes(token));
    if (!risky) return false;

    requestApproval({
      title: 'Risky OS action',
      summary: 'Potentially destructive command detected. Please confirm before execution.',
      actionLabel: 'Approve execution',
      risk: 'high',
      content: 'I detected a risky action request. Review and approve to continue.'
    });
    return true;
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
        const actions = Array.isArray(s.wrappedMode?.plannedActions) ? s.wrappedMode.plannedActions : [];
        if (actions.length === 0) return s;
        return {
          ...s,
          isOpen: true,
          status: 'warning',
          dialogue: 'Wrapped mode: approvals required.',
          messages: [
            ...s.messages,
            createMessage('assistant', 'Wrapped Assistant plan queued. Approve actions one-by-one.', {
              kind: 'text'
            }),
            ...actions.map((action) =>
              createMessage('assistant', `Planned action: ${action.label}`, {
                kind: 'approval',
                approval: {
                  actionId: action.id,
                  title: 'Wrapped Assistant action',
                  summary: action.label,
                  actionLabel: 'Approve step',
                  risk: 'medium',
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
    handleUserMessageFlow: (message) => {
      setStatus('thinking', 'Analyzing request...', 0);
      if (maybeCreateApprovalFromInput(message)) return;
      addAssistantMessage('Request received. I will prepare the next action.', { kind: 'text' });
      setStatus('success', 'Ready.', 2500);
    },

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
