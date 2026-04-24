import { apiFetch } from '../../../utils/api.js';

export async function fetchSettings() {
  return apiFetch('/api/settings');
}

export async function updateSettings(settings) {
  return apiFetch('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(settings)
  });
}

export async function fetchServices() {
  return apiFetch('/api/services');
}

export async function restartService(name) {
  return apiFetch(`/api/services/${encodeURIComponent(name)}/restart`, {
    method: 'POST'
  });
}

export async function fetchCloudProviders() {
  return apiFetch('/api/cloud/providers');
}

export async function fetchCloudRemotes() {
  return apiFetch('/api/cloud/remotes');
}

export async function setupCloudRemote(payload) {
  return apiFetch('/api/cloud/setup', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function mountCloudRemote(name) {
  return apiFetch('/api/cloud/mount', {
    method: 'POST',
    body: JSON.stringify({ name })
  });
}

export async function writeCloudFile({ remote, path, content }) {
  return apiFetch('/api/cloud/write', {
    method: 'POST',
    body: JSON.stringify({
      remote,
      path,
      remotePath: path,
      content,
      text: content
    })
  });
}

export async function fetchBackupJobs() {
  return apiFetch('/api/system/backup-jobs');
}

export async function createBackupJob(payload) {
  return apiFetch('/api/system/backup-jobs', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function deleteBackupJob(jobId) {
  return apiFetch(`/api/system/backup-jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE'
  });
}

export async function runBackupJob(jobId) {
  return apiFetch(`/api/system/backup-jobs/${encodeURIComponent(jobId)}/run`, {
    method: 'POST'
  });
}

