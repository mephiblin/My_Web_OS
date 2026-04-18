import { writable } from 'svelte/store';

export const windows = writable([]);
export const activeWindowId = writable(null);

export function openWindow(app, data = null) {
  windows.update(items => {
    // If window already open, focus and unminimize it
    const existing = items.find(w => w.id === app.id);
    if (existing && !data) {
      activeWindowId.set(app.id);
      return items.map(w => w.id === app.id ? { ...w, minimized: false } : w);
    }

    // Special case for editor: multiple windows or updating existing one
    if (app.id === 'editor' && existing) {
      activeWindowId.set('editor');
      return items.map(w => w.id === 'editor' ? { ...w, data, minimized: false } : w);
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
      zIndex: items.length + 50 // Start higher to be above everything
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
