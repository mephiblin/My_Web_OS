const DEFAULT_SENSITIVE_QUERY_KEYS = new Set([
  'authorization',
  'code',
  'grantid',
  'password',
  'secret',
  'ticket',
  'token'
]);

const REDACTED_VALUE = '[REDACTED]';

function isSensitiveQueryKey(key, sensitiveKeys = DEFAULT_SENSITIVE_QUERY_KEYS) {
  if (typeof key !== 'string') return false;
  return sensitiveKeys.has(key.toLowerCase());
}

function redactUrl(rawUrl, options = {}) {
  if (typeof rawUrl !== 'string' || rawUrl === '') return rawUrl;

  const sensitiveKeys = options.sensitiveKeys || DEFAULT_SENSITIVE_QUERY_KEYS;

  try {
    const parsed = new URL(rawUrl, 'http://webos.local');
    let changed = false;

    for (const key of [...parsed.searchParams.keys()]) {
      if (isSensitiveQueryKey(key, sensitiveKeys)) {
        parsed.searchParams.set(key, REDACTED_VALUE);
        changed = true;
      }
    }

    if (!changed) return rawUrl;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch (err) {
    return rawUrl.replace(/([?&])([^=&#]+)=([^&#]*)/g, (match, prefix, key) => {
      if (!isSensitiveQueryKey(key, sensitiveKeys)) return match;
      return `${prefix}${key}=${encodeURIComponent(REDACTED_VALUE)}`;
    });
  }
}

module.exports = {
  DEFAULT_SENSITIVE_QUERY_KEYS,
  REDACTED_VALUE,
  isSensitiveQueryKey,
  redactUrl
};
