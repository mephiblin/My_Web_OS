import { writable, get } from 'svelte/store';
import { addToast } from './toastStore.js';
import { currentDesktopId } from './desktopStore.js';

export const shortcuts = writable([]);
let isInitialized = false;
const DEFAULT_DESKTOP_ROWS = 8;

function normalizeGridIndex(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const safe = Math.floor(numeric);
  return safe < 0 ? null : safe;
}

function findNextGridSlot(items, desktopId) {
  const occupied = new Set(
    items
      .filter((item) => Number(item?.desktopId || 1) === Number(desktopId))
      .map((item) => `${normalizeGridIndex(item?.gridX)}:${normalizeGridIndex(item?.gridY)}`)
      .filter((key) => !key.startsWith('null:') && !key.endsWith(':null'))
  );

  for (let x = 0; x < 64; x += 1) {
    for (let y = 0; y < DEFAULT_DESKTOP_ROWS; y += 1) {
      const key = `${x}:${y}`;
      if (!occupied.has(key)) {
        return { gridX: x, gridY: y };
      }
    }
  }

  return { gridX: 0, gridY: 0 };
}

export const initShortcuts = async () => {
  try {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('web_os_token') : '';
    if (!token) return;

    const res = await fetch('/api/system/state/shortcuts', { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) {
      if (res.status === 404) {
        isInitialized = true; // No shortcuts yet, that's fine
      }
      return;
    }

    const json = await res.json();
    if (json.data && json.data.shortcuts) {
      shortcuts.set(json.data.shortcuts);
    }
    isInitialized = true;
  } catch (e) {
    console.error('Failed to load shortcuts state', e);
  }
};

let saveTimeout;
const saveState = (items) => {
  if (!isInitialized) return;
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('web_os_token') : '';
    fetch('/api/system/state/shortcuts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ shortcuts: items })
    }).catch(console.error);
  }, 1000);
};

shortcuts.subscribe(items => saveState(items));

export function addShortcut(item) {
  const current = get(shortcuts);
  const shortcutType = String(item?.shortcutType || '').trim().toLowerCase();
  const desktopId = Number.isFinite(Number(item?.desktopId))
    ? Number(item.desktopId)
    : Number.isFinite(Number(get(currentDesktopId)))
      ? Number(get(currentDesktopId))
      : 1;

  const initialSlot = findNextGridSlot(current, desktopId);

  if (shortcutType === 'app') {
    const appId = String(item?.appId || item?.id || '').trim();
    const appName = String(item?.name || item?.title || appId).trim();
    if (!appId || !appName) return;

    if (current.find((s) => s.kind === 'app' && Number(s.desktopId || 1) === desktopId && String(s.appId || '').trim() === appId)) {
      addToast('Shortcut already exists on desktop', 'info');
      return;
    }

    const newShortcut = {
      id: `shortcut-${Date.now()}`,
      kind: 'app',
      appId,
      name: appName,
      path: `app://${appId}`,
      isDirectory: false,
      ext: 'app',
      iconType: item?.iconType === 'image' && item?.iconUrl ? 'image' : 'lucide',
      iconUrl: item?.iconUrl || '',
      iconName: item?.iconName || item?.icon || '',
      appModel: item?.appModel || 'standard',
      desktopId,
      gridX: initialSlot.gridX,
      gridY: initialSlot.gridY
    };

    shortcuts.update((items) => [...items, newShortcut]);
    addToast('Shortcut added to desktop', 'success');
    return;
  }

  if (!item?.path || !item?.name) return;
  if (current.find((s) => Number(s.desktopId || 1) === desktopId && s.path === item.path)) {
    addToast('Shortcut already exists on desktop', 'info');
    return;
  }

  const newShortcut = {
    id: `shortcut-${Date.now()}`,
    kind: 'file',
    name: item.name,
    path: item.path,
    isDirectory: item.isDirectory,
    ext: item.name.split('.').pop().toLowerCase(),
    desktopId,
    gridX: initialSlot.gridX,
    gridY: initialSlot.gridY
  };

  shortcuts.update((items) => [...items, newShortcut]);
  addToast('Shortcut added to desktop', 'success');
}

export function removeShortcut(id) {
  shortcuts.update(items => items.filter(s => s.id !== id));
}

export function moveShortcut(sourceId, targetId) {
  const source = String(sourceId || '').trim();
  const target = String(targetId || '').trim();
  if (!source || !target || source === target) return;

  shortcuts.update((items) => {
    const sourceIndex = items.findIndex((item) => item.id === source);
    const targetIndex = items.findIndex((item) => item.id === target);
    if (sourceIndex < 0 || targetIndex < 0) return items;

    const next = [...items];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    return next;
  });
}

export function setShortcutGridPosition(id, gridX, gridY) {
  const targetId = String(id || '').trim();
  const nextGridX = normalizeGridIndex(gridX);
  const nextGridY = normalizeGridIndex(gridY);
  if (!targetId || nextGridX === null || nextGridY === null) return;

  shortcuts.update((items) => {
    const sourceIndex = items.findIndex((item) => item.id === targetId);
    if (sourceIndex < 0) return items;

    const source = items[sourceIndex];
    const desktopId = Number(source?.desktopId || 1);
    const sourceGridX = normalizeGridIndex(source?.gridX);
    const sourceGridY = normalizeGridIndex(source?.gridY);

    const targetIndex = items.findIndex(
      (item, index) =>
        index !== sourceIndex &&
        Number(item?.desktopId || 1) === desktopId &&
        normalizeGridIndex(item?.gridX) === nextGridX &&
        normalizeGridIndex(item?.gridY) === nextGridY
    );

    const next = [...items];
    next[sourceIndex] = {
      ...source,
      gridX: nextGridX,
      gridY: nextGridY
    };

    if (targetIndex >= 0) {
      const target = next[targetIndex];
      next[targetIndex] = {
        ...target,
        gridX: sourceGridX ?? 0,
        gridY: sourceGridY ?? 0
      };
    }

    return next;
  });
}
