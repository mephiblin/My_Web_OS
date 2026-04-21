import { writable } from 'svelte/store';

const DEFAULT_AGENT_STATE = {
  visible: true,
  emotion: 'idle', // 'idle', 'alert', 'error', 'happy', 'processing'
  dialogue: '',
  dialogueTimeout: null,
  isOpen: false,
  messages: [],
  draft: ''
};

function createMessage(role, content) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content: String(content ?? ''),
    createdAt: Date.now()
  };
}

function normalizeMessages(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      id: typeof item?.id === 'string' && item.id ? item.id : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: ['user', 'assistant', 'system'].includes(item?.role) ? item.role : 'system',
      content: typeof item?.content === 'string' ? item.content : '',
      createdAt: Number.isFinite(Number(item?.createdAt)) ? Number(item.createdAt) : Date.now()
    }))
    .filter((item) => item.content.length > 0);
}

function normalizePersistedState(value = {}) {
  return {
    isOpen: value?.isOpen === true,
    messages: normalizeMessages(value?.messages),
    draft: typeof value?.draft === 'string' ? value.draft : ''
  };
}

function toPersistedState(state) {
  return {
    isOpen: state.isOpen === true,
    messages: normalizeMessages(state.messages),
    draft: typeof state.draft === 'string' ? state.draft : ''
  };
}

// System Feedback Linkage + Agent Chat Base
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

  return {
    subscribe,
    init,
    setVisibility: (visible) => update(s => ({ ...s, visible })),
    togglePanel: () => update((s) => ({ ...s, isOpen: !s.isOpen })),
    openPanel: () => update((s) => ({ ...s, isOpen: true })),
    closePanel: () => update((s) => ({ ...s, isOpen: false })),
    setDraft: (draft) => update((s) => ({ ...s, draft: typeof draft === 'string' ? draft : '' })),
    sendUserMessage: (rawMessage) => update((s) => {
      const fromArg = typeof rawMessage === 'string' ? rawMessage : s.draft;
      const message = fromArg.trim();
      if (!message) return s;
      return {
        ...s,
        isOpen: true,
        draft: '',
        messages: [...s.messages, createMessage('user', message)]
      };
    }),
    
    // Trigger an emotion with optional dialogue
    triggerEmotion: (emotion, dialogue = '', duration = 5000) => {
      update(s => {
        if (s.dialogueTimeout) clearTimeout(s.dialogueTimeout);
        
        let timeout = null;
        if (duration > 0) {
          timeout = setTimeout(() => {
            update(inner => ({ ...inner, emotion: 'idle', dialogue: '' }));
          }, duration);
        }
        
        return { ...s, emotion, dialogue, dialogueTimeout: timeout };
      });
    },
    
    // Standard system reactions
    notifyUploadComplete: () => agentStore.triggerEmotion('happy', 'File upload complete!', 3000),
    notifyError: (msg) => agentStore.triggerEmotion('error', `Oops: ${msg}`, 5000),
    notifySystemAlert: () => agentStore.triggerEmotion('alert', 'High CPU Usage Detected!', 4000),
  };
};

export const agentStore = createAgentStore();
