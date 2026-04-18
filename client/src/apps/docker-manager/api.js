import { apiFetch } from '../../utils/api.js';

export async function listContainers() {
  return apiFetch('/api/docker/containers');
}

export async function startContainer(id) {
  return apiFetch('/api/docker/start', {
    method: 'POST',
    body: JSON.stringify({ id })
  });
}

export async function stopContainer(id) {
  return apiFetch('/api/docker/stop', {
    method: 'POST',
    body: JSON.stringify({ id })
  });
}

export async function restartContainer(id) {
  return apiFetch('/api/docker/restart', {
    method: 'POST',
    body: JSON.stringify({ id })
  });
}

export async function removeContainer(id) {
  return apiFetch('/api/docker/remove', {
    method: 'DELETE',
    body: JSON.stringify({ id })
  });
}
