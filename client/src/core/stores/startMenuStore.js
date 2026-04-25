import { get, writable } from 'svelte/store';

const DEFAULT_START_MENU_STATE = {
  isOpen: false,
  query: '',
  pinnedAppIds: [],
  recentAppIds: [],
  layout: 'default',
  keepOpenOnDesktopClick: false,
  presentation: 'drawer'
};

const store = writable(DEFAULT_START_MENU_STATE);
const { subscribe, update, set } = store;
let isInitialized = false;
let saveTimeout;

export const startMenuState = {
  subscribe
};

export function openStartMenu() {
  update((state) => ({ ...state, isOpen: true }));
}

export function closeStartMenu() {
  update((state) => ({ ...state, isOpen: false, query: '' }));
}

export function toggleStartMenu() {
  update((state) => ({ ...state, isOpen: !state.isOpen, query: state.isOpen ? '' : state.query }));
}

export function setStartMenuQuery(query) {
  update((state) => ({ ...state, query }));
}

export function clearStartMenuQuery() {
  update((state) => ({ ...state, query: '' }));
}

// Persistence hook shape for backend `/api/system/state/startMenu` integration.
export function hydrateStartMenuState(persisted = {}) {
  const nextPinned = Array.isArray(persisted?.pinnedAppIds) ? persisted.pinnedAppIds : [];
  const nextRecent = Array.isArray(persisted?.recentAppIds) ? persisted.recentAppIds : [];
  const nextLayout = ['default', 'compact', 'wide'].includes(persisted?.layout) ? persisted.layout : 'default';
  const keepOpenOnDesktopClick = persisted?.keepOpenOnDesktopClick === true;
  const presentation = ['drawer', 'windows'].includes(String(persisted?.presentation || ''))
    ? String(persisted.presentation)
    : 'drawer';

  update((state) => ({
    ...state,
    pinnedAppIds: nextPinned,
    recentAppIds: nextRecent,
    layout: nextLayout,
    keepOpenOnDesktopClick,
    presentation
  }));
}

export async function initStartMenuState() {
  try {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('web_os_token') : '';
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch('/api/system/state/startMenu', { headers });
    if (res.ok) {
      const json = await res.json();
      hydrateStartMenuState(json?.data || {});
    }
  } catch (error) {
    console.error('Error initializing start menu state:', error);
  } finally {
    isInitialized = true;
  }
}

function scheduleSave() {
  if (!isInitialized) return;
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('web_os_token') : '';
    fetch('/api/system/state/startMenu', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token || ''}`
      },
      body: JSON.stringify(getStartMenuPersistencePayload())
    }).catch((error) => console.error('Error saving start menu state:', error));
  }, 500);
}

subscribe(() => scheduleSave());

export function togglePinnedApp(appId) {
  const id = String(appId || '').trim();
  if (!id) return;
  update((state) => {
    const pinned = Array.isArray(state.pinnedAppIds) ? [...state.pinnedAppIds] : [];
    const exists = pinned.includes(id);
    return {
      ...state,
      pinnedAppIds: exists ? pinned.filter((item) => item !== id) : [id, ...pinned].slice(0, 24)
    };
  });
}

export function registerRecentApp(appId) {
  const id = String(appId || '').trim();
  if (!id) return;
  update((state) => {
    const recent = Array.isArray(state.recentAppIds) ? state.recentAppIds.filter((item) => item !== id) : [];
    return {
      ...state,
      recentAppIds: [id, ...recent].slice(0, 24)
    };
  });
}

export function setStartMenuLayout(layout) {
  const next = ['default', 'compact', 'wide'].includes(String(layout || '')) ? String(layout) : 'default';
  update((state) => ({
    ...state,
    layout: next
  }));
}

export function toggleStartMenuKeepOpenOnDesktopClick() {
  update((state) => ({
    ...state,
    keepOpenOnDesktopClick: !state.keepOpenOnDesktopClick
  }));
}

export function toggleStartMenuPresentation() {
  update((state) => ({
    ...state,
    presentation: state.presentation === 'windows' ? 'drawer' : 'windows'
  }));
}

export function getStartMenuPersistencePayload() {
  const state = get(store);
  return {
    pinnedAppIds: state.pinnedAppIds,
    recentAppIds: state.recentAppIds,
    layout: state.layout,
    keepOpenOnDesktopClick: state.keepOpenOnDesktopClick === true,
    presentation: ['drawer', 'windows'].includes(String(state.presentation || ''))
      ? String(state.presentation)
      : 'drawer'
  };
}

export function resetStartMenuState() {
  set(DEFAULT_START_MENU_STATE);
}
