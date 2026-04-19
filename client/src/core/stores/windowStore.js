import { writable, get } from 'svelte/store';
import { currentDesktopId } from './desktopStore.js';

// Load initial state from localStorage
const savedWindows = typeof localStorage !== 'undefined' ? localStorage.getItem('web_os_windows') : null;
const savedActive = typeof localStorage !== 'undefined' ? localStorage.getItem('web_os_active_window') : null;

export const windows = writable(savedWindows ? JSON.parse(savedWindows).map(w => ({
  ...w,
  appId: w.appId || w.id // Ensure appId exists for component lookup
})) : []);
export const activeWindowId = writable(savedActive || null);

// Persistence logic with debounce
let saveTimeout;
if (typeof localStorage !== 'undefined') {
  windows.subscribe(items => {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      localStorage.setItem('web_os_windows', JSON.stringify(items));
    }, 1000); // 1s debounce
  });
  activeWindowId.subscribe(id => {
    if (id) localStorage.setItem('web_os_active_window', id);
    else localStorage.removeItem('web_os_active_window');
  });
}

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

export function updateWindowTitle(id, title) {
  windows.update(items => items.map(w => w.id === id ? { ...w, title } : w));
}
