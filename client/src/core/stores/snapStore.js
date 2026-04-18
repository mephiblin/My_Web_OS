import { writable } from 'svelte/store';

export const snapGhost = writable({
  visible: false,
  x: 0,
  y: 0,
  width: 0,
  height: 0
});

export function setSnapGhost(data) {
  snapGhost.set(data);
}

export function hideSnapGhost() {
  snapGhost.set({ visible: false, x: 0, y: 0, width: 0, height: 0 });
}
