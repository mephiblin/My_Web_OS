import { get, writable } from 'svelte/store';

const DEFAULT_START_MENU_STATE = {
  isOpen: false,
  query: '',
  pinnedAppIds: [],
  recentAppIds: [],
  layout: 'default'
};

const store = writable(DEFAULT_START_MENU_STATE);
const { subscribe, update, set } = store;

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

  update((state) => ({
    ...state,
    pinnedAppIds: nextPinned,
    recentAppIds: nextRecent,
    layout: nextLayout
  }));
}

export function getStartMenuPersistencePayload() {
  const state = get(store);
  return {
    pinnedAppIds: state.pinnedAppIds,
    recentAppIds: state.recentAppIds,
    layout: state.layout
  };
}

export function resetStartMenuState() {
  set(DEFAULT_START_MENU_STATE);
}
