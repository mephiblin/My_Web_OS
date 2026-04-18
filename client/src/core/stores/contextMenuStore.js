import { writable } from 'svelte/store';

export const contextMenu = writable({
  x: 0,
  y: 0,
  visible: false,
  items: []
});

export function openContextMenu(x, y, items) {
  contextMenu.set({
    x,
    y,
    visible: true,
    items
  });
}

export function closeContextMenu() {
  contextMenu.update(state => ({ ...state, visible: false }));
}
