function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeTransferJobStatus(value) {
  const raw = text(value).toLowerCase();
  if (!raw) return 'unknown';
  if (raw === 'pending') return 'queued';
  if (raw === 'done' || raw === 'success' || raw === 'completed') return 'completed';
  if (raw === 'active' || raw === 'working' || raw === 'uploading') return 'running';
  if (raw === 'cancelled' || raw === 'canceled') return 'canceled';
  if (raw === 'error') return 'failed';
  return raw;
}
