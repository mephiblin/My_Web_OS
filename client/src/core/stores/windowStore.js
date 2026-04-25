import { writable, get } from 'svelte/store';
import { currentDesktopId } from './desktopStore.js';
import { windowDefaultsSettings } from './windowDefaultsStore.js';

export const windows = writable([]);
export const activeWindowId = writable(null);
let isInitialized = false;
const MAX_RESTORED_WINDOWS = 12;
const TASKBAR_SAFE_HEIGHT = 56;

function getViewportBounds() {
  const width = typeof globalThis !== 'undefined' && Number.isFinite(globalThis.innerWidth)
    ? globalThis.innerWidth
    : 1280;
  const height = typeof globalThis !== 'undefined' && Number.isFinite(globalThis.innerHeight)
    ? globalThis.innerHeight
    : 720;
  return {
    width,
    height: Math.max(320, height - TASKBAR_SAFE_HEIGHT)
  };
}

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(numeric, min), max);
}

function normalizeWindowPlacement(win, index = 0) {
  const bounds = getViewportBounds();
  const defaults = get(windowDefaultsSettings);
  const width = clampNumber(win.width, defaults.defaultWidth, 280, Math.max(320, bounds.width));
  const height = clampNumber(win.height, defaults.defaultHeight, 220, Math.max(260, bounds.height));
  const maxX = Math.max(0, bounds.width - Math.min(width, bounds.width) - 16);
  const maxY = Math.max(0, bounds.height - Math.min(height, bounds.height) - 16);
  const fallbackX = 80 + (index % 8) * 32;
  const fallbackY = 70 + (index % 8) * 32;

  return {
    ...win,
    appId: win.appId || win.id,
    x: clampNumber(win.x, fallbackX, 0, maxX),
    y: clampNumber(win.y, fallbackY, 0, maxY),
    width,
    height
  };
}

function normalizeRestoredWindows(restoredWindows = []) {
  return restoredWindows
    .slice(-MAX_RESTORED_WINDOWS)
    .map((win, index) => normalizeWindowPlacement(win, index));
}

function nextWindowPosition(items, width, height) {
  const bounds = getViewportBounds();
  const maxX = Math.max(0, bounds.width - Math.min(width, bounds.width) - 16);
  const maxY = Math.max(0, bounds.height - Math.min(height, bounds.height) - 16);
  const slot = items.filter((item) => item.desktopId === get(currentDesktopId)).length % 8;
  return {
    x: Math.min(100 + slot * 30, maxX),
    y: Math.min(90 + slot * 30, maxY)
  };
}

export const initWindows = async () => {
  try {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('web_os_token') : '';
    if (!token) return;

    const res = await fetch('/api/system/state/windows', { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) return;

    const json = await res.json();
    if (json.data && json.data.windows) {
      const restoredWindows = normalizeRestoredWindows(json.data.windows);
      const restoredActive = restoredWindows.some((w) => w.id === json.data.active)
        ? json.data.active
        : restoredWindows.at(-1)?.id || null;
      windows.set(restoredWindows);
      activeWindowId.set(restoredActive);
      isInitialized = true;
    }
  } catch (e) {
    console.error('Failed to load window state', e);
  }
};

// Persistence logic with debounce
let saveTimeout;
const saveState = (items, activeId) => {
  if (!isInitialized) return;
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('web_os_token') : '';
    fetch('/api/system/state/windows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ windows: items, active: activeId })
    }).catch(console.error);
  }, 1000);
};

windows.subscribe(items => saveState(items, get(activeWindowId)));
activeWindowId.subscribe(id => saveState(get(windows), id));

export function openWindow(app, data = null) {
  const currentWindows = get(windows);
  const windowConfig = app.window || {};
  const defaults = get(windowDefaultsSettings);
  const mergedWindowConfig = {
    width: defaults.defaultWidth,
    height: defaults.defaultHeight,
    minWidth: defaults.minWidth,
    minHeight: defaults.minHeight,
    titleBarHeight: defaults.titleBarHeight,
    ...windowConfig
  };
  
  // Singleton check
  if (app.singleton) {
    const existing = currentWindows.find(w => w.appId === app.id);
    if (existing) {
      focusWindow(existing.id);
      return;
    }
  }

  windows.update(items => {
    const maxZ = items.length > 0 ? Math.max(...items.map(w => w.zIndex)) : 50;
    const newId = `${app.id}-${Date.now()}`;
    const width = Number.isFinite(Number(mergedWindowConfig.width)) ? Number(mergedWindowConfig.width) : defaults.defaultWidth;
    const height = Number.isFinite(Number(mergedWindowConfig.height)) ? Number(mergedWindowConfig.height) : defaults.defaultHeight;
    const position = nextWindowPosition(items, width, height);

    const newWindow = {
      ...app,
      id: newId, // Use unique ID as the primary 'id'
      appId: app.id, // Keep original app ID for component lookup
      data,
      x: position.x,
      y: position.y,
      width,
      height,
      minimized: false,
      maximized: false,
      zIndex: maxZ + 1,
      desktopId: get(currentDesktopId),
      window: mergedWindowConfig
    };
    
    activeWindowId.set(newId);
    return [...items, newWindow];
  });
}

export function closeWindow(id) {
  windows.update(items => items.filter(w => w.id !== id));
}

export function focusWindow(id) {
  activeWindowId.set(id);
  windows.update(items => {
    const maxZ = Math.max(0, ...items.map(w => w.zIndex));
    return items.map(w => w.id === id ? { ...w, zIndex: maxZ + 1, minimized: false } : w);
  });
}

export function toggleMinimize(id) {
  windows.update(items => items.map(w => w.id === id ? { ...w, minimized: !w.minimized } : w));
}

export function toggleMaximize(id) {
  windows.update(items => items.map(w => w.id === id ? { ...w, maximized: !w.maximized } : w));
}

export function moveWindowToDesktop(windowId, desktopId) {
  windows.update(items => items.map(w => w.id === windowId ? { ...w, desktopId } : w));
}

export function updateWindowData(id, newData) {
  windows.update(items => items.map(w => w.id === id ? { ...w, data: { ...w.data, ...newData } } : w));
}

export function updateWindowTitle(id, title) {
  windows.update(items => items.map(w => w.id === id ? { ...w, title } : w));
}
