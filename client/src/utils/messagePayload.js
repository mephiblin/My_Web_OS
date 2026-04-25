function cloneViaJson(value, fallback) {
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== 'string') return fallback;
    return JSON.parse(serialized);
  } catch (_err) {
    return fallback;
  }
}

export function cloneMessagePayload(value, fallback = null) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch (_err) {
      // Fall through to JSON clone for non-cloneable payloads.
    }
  }

  return cloneViaJson(value, fallback);
}
