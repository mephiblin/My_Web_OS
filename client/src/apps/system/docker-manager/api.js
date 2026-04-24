import { apiFetch } from '../../../utils/api.js';

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

export async function fetchContainerLogs(id, tail = 200) {
  const params = new URLSearchParams({
    id: String(id || ''),
    tail: String(tail)
  });
  return apiFetch(`/api/docker/logs?${params.toString()}`);
}

export async function listVolumes() {
  return apiFetch('/api/docker/volumes');
}

export async function listImages() {
  return apiFetch('/api/docker/images');
}

export async function listComposeProjects() {
  return apiFetch('/api/docker/compose/projects');
}
