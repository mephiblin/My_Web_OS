import { writable, get } from 'svelte/store';

export const desktops = writable([
  { id: 1, name: 'Desktop 1' },
  { id: 2, name: 'Desktop 2' },
  { id: 3, name: 'Desktop 3' }
]);

export const currentDesktopId = writable(1);

export function switchDesktop(id) {
  currentDesktopId.set(id);
}
