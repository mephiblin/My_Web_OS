import { writable } from 'svelte/store';

export const contextMenu = writable({
  x: 0,
  y: 0,
  visible: false,
  items: []
});

const DEFAULT_CONTEXT_MENU_SETTINGS = {
  showIcons: true,
  confirmDanger: true,
  density: 'cozy'
};

function normalizeContextMenuSettings(value = {}) {
  return {
    showIcons: value?.showIcons !== false,
    confirmDanger: value?.confirmDanger !== false,
    density: ['compact', 'cozy'].includes(value?.density) ? value.density : 'cozy'
  };
}

const createContextMenuSettingsStore = () => {
  const { subscribe, set, update } = writable(DEFAULT_CONTEXT_MENU_SETTINGS);
  let isInitialized = false;
  let saveTimeout;

  const init = async () => {
    try {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('web_os_token') : '';
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch('/api/system/state/contextMenu', { headers });
      if (res.ok) {
        const json = await res.json();
        set(normalizeContextMenuSettings(json?.data || {}));
      } else {
        set(DEFAULT_CONTEXT_MENU_SETTINGS);
      }
    } catch (error) {
      console.error('Error initializing context menu settings:', error);
      set(DEFAULT_CONTEXT_MENU_SETTINGS);
    } finally {
      isInitialized = true;
    }
  };

  subscribe((settings) => {
    if (!isInitialized) return;
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('web_os_token') : '';
      fetch('/api/system/state/contextMenu', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token || ''}`
        },
        body: JSON.stringify(settings)
      }).catch((error) => console.error('Error saving context menu settings:', error));
    }, 500);
  });

  return {
    subscribe,
    init,
    updateSettings: (nextSettings) =>
      update((current) => normalizeContextMenuSettings({ ...current, ...nextSettings })),
    reset: () => set(DEFAULT_CONTEXT_MENU_SETTINGS)
  };
};

export const contextMenuSettings = createContextMenuSettingsStore();

export function openContextMenu(x, y, items) {
  contextMenu.set({
    x,
    y,
    visible: true,
    items: Array.isArray(items) ? items : []
  });
}

export function closeContextMenu() {
  contextMenu.update((state) => ({ ...state, visible: false }));
}
