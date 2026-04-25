function text(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function normalizeOpsStatus(value) {
  const raw = text(value);
  if (!raw) return 'unknown';

  if (['queued', 'pending'].includes(raw)) return 'queued';
  if (['active', 'working', 'running', 'up', 'started', 'starting'].includes(raw)) return 'running';
  if (['done', 'success', 'completed', 'healthy'].includes(raw)) return 'completed';
  if (['cancelled', 'canceled'].includes(raw)) return 'canceled';
  if (['error', 'failed', 'unhealthy'].includes(raw)) return 'failed';
  if (['stopped', 'exited', 'inactive'].includes(raw)) return 'stopped';
  if (['degraded', 'warning', 'warn'].includes(raw)) return 'degraded';

  return raw;
}

export function isRunningOpsStatus(value) {
  const status = normalizeOpsStatus(value);
  return status === 'running' || status === 'queued';
}
