import { writable, get } from 'svelte/store';
import { currentDesktopId } from './desktopStore.js';

export const windows = writable([]);
export const activeWindowId = writable(null);
let isInitialized = false;

export const initWindows = async () => {
  try {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('web_os_token') : '';
    if (!token) return;

    const res = await fetch('/api/system/state/windows', { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) return;

    const json = await res.json();
    if (json.data && json.data.windows) {
      windows.set(json.data.windows.map(w => ({ ...w, appId: w.appId || w.id })));
      activeWindowId.set(json.data.active || null);
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
  windows.update(items => {
    const maxZ = items.length > 0 ? Math.max(...items.map(w => w.zIndex)) : 50;
    const newId = `${app.id}-${Date.now()}`;

    const newWindow = {
      ...app,
      id: newId, // Use unique ID as the primary 'id'
      appId: app.id, // Keep original app ID for component lookup
      data,
      x: 100 + items.length * 30,
      y: 100 + items.length * 30,
      width: 800,
      height: 600,
      minimized: false,
      maximized: false,
      zIndex: maxZ + 1,
      desktopId: get(currentDesktopId)
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
