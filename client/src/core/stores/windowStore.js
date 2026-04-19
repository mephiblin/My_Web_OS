import { writable, get } from 'svelte/store';
import { currentDesktopId } from './desktopStore.js';

export const windows = writable([]);
export const activeWindowId = writable(null);

export function openWindow(app, data = null) {
  windows.update(items => {
    const existing = items.find(w => w.id === app.id);
    const maxZ = items.length > 0 ? Math.max(...items.map(w => w.zIndex)) : 50;

    if (existing) {
      activeWindowId.set(app.id);
      return items.map(w => 
        w.id === app.id 
          ? { ...w, data: data || w.data, minimized: false, zIndex: maxZ + 1 } 
          : w
      );
    }

    // Otherwise, create new window
    const newWindow = {
      ...app,
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
    
    activeWindowId.set(app.id);
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
