import { writable, get } from 'svelte/store';

const DEFAULT_DESKTOP_STATE = {
  desktops: [
    { id: 1, name: 'Desktop 1' },
    { id: 2, name: 'Desktop 2' },
    { id: 3, name: 'Desktop 3' }
  ],
  currentDesktopId: 1,
  layoutEditMode: false
};

export const desktops = writable(DEFAULT_DESKTOP_STATE.desktops);
export const currentDesktopId = writable(DEFAULT_DESKTOP_STATE.currentDesktopId);
export const layoutEditMode = writable(DEFAULT_DESKTOP_STATE.layoutEditMode);

let isInitialized = false;
let saveTimeout;

function normalizeDesktopState(value = {}) {
  const desktopItems = Array.isArray(value.desktops)
    ? value.desktops
      .filter((item) => item && typeof item === 'object')
      .map((item, index) => ({
        id: Number.isFinite(Number(item.id)) ? Number(item.id) : index + 1,
        name: String(item.name || `Desktop ${index + 1}`).trim() || `Desktop ${index + 1}`
      }))
    : [];

  const normalizedDesktops = desktopItems.length > 0
    ? desktopItems
    : DEFAULT_DESKTOP_STATE.desktops;

  const currentId = Number.isFinite(Number(value.currentDesktopId))
    ? Number(value.currentDesktopId)
    : DEFAULT_DESKTOP_STATE.currentDesktopId;

  const allowedIds = new Set(normalizedDesktops.map((item) => item.id));
  const safeCurrentId = allowedIds.has(currentId)
    ? currentId
    : normalizedDesktops[0].id;

  return {
    desktops: normalizedDesktops,
    currentDesktopId: safeCurrentId,
    layoutEditMode: value.layoutEditMode === true
  };
}

function scheduleSave() {
  if (!isInitialized) return;
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('web_os_token') : '';
    fetch('/api/system/state/desktops', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token || ''}`
      },
      body: JSON.stringify({
        desktops: get(desktops),
        currentDesktopId: get(currentDesktopId),
        layoutEditMode: get(layoutEditMode)
      })
    }).catch((error) => console.error('Error saving desktop state:', error));
  }, 500);
}

desktops.subscribe(() => scheduleSave());
currentDesktopId.subscribe(() => scheduleSave());
layoutEditMode.subscribe(() => scheduleSave());

export async function initDesktops() {
  try {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('web_os_token') : '';
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch('/api/system/state/desktops', { headers });
    if (res.ok) {
      const json = await res.json();
      const normalized = normalizeDesktopState(json?.data || {});
      desktops.set(normalized.desktops);
      currentDesktopId.set(normalized.currentDesktopId);
      layoutEditMode.set(normalized.layoutEditMode);
    } else {
      desktops.set(DEFAULT_DESKTOP_STATE.desktops);
      currentDesktopId.set(DEFAULT_DESKTOP_STATE.currentDesktopId);
      layoutEditMode.set(DEFAULT_DESKTOP_STATE.layoutEditMode);
    }
  } catch (error) {
    console.error('Error initializing desktops:', error);
    desktops.set(DEFAULT_DESKTOP_STATE.desktops);
    currentDesktopId.set(DEFAULT_DESKTOP_STATE.currentDesktopId);
    layoutEditMode.set(DEFAULT_DESKTOP_STATE.layoutEditMode);
  } finally {
    isInitialized = true;
  }
}

export function switchDesktop(id) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) return;
  const allowedIds = new Set(get(desktops).map((item) => item.id));
  if (!allowedIds.has(numericId)) return;
  currentDesktopId.set(numericId);
}

export function toggleLayoutEditMode() {
  layoutEditMode.update((value) => !value);
}
