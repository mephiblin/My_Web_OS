const { exec } = require('child_process');

function sanitizeContainerId(id) {
  if (!id || typeof id !== 'string') return null;
  if (!/^[a-zA-Z0-9_.\-]+$/.test(id)) return null;
  return id;
}

function runDockerCommand(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        const wrapped = new Error(stderr?.trim() || err.message || 'Docker command failed.');
        wrapped.code = 'DOCKER_COMMAND_FAILED';
        return reject(wrapped);
      }
      resolve(stdout.trim());
    });
  });
}

function classifyDockerError(err, fallbackCode = 'DOCKER_OPERATION_FAILED') {
  const raw = String(err?.message || '').trim();
  const message = raw || 'Docker operation failed.';
  const normalized = message.toLowerCase();

  if (
    normalized.includes('command not found') ||
    normalized.includes('is not recognized as an internal or external command') ||
    normalized.includes('executable file not found')
  ) {
    return {
      status: 503,
      code: 'DOCKER_NOT_INSTALLED',
      message: 'Docker CLI is not installed or not available in PATH.'
    };
  }

  if (
    normalized.includes('cannot connect to the docker daemon') ||
    normalized.includes('error during connect') ||
    normalized.includes('docker daemon is not running')
  ) {
    return {
      status: 503,
      code: 'DOCKER_DAEMON_UNAVAILABLE',
      message: 'Docker daemon is unavailable. Check whether Docker is running.'
    };
  }

  if (normalized.includes('permission denied') || normalized.includes('got permission denied')) {
    return {
      status: 403,
      code: 'DOCKER_PERMISSION_DENIED',
      message: 'Permission denied while accessing Docker.'
    };
  }

  if (normalized.includes('no such container')) {
    return {
      status: 404,
      code: 'DOCKER_CONTAINER_NOT_FOUND',
      message: 'Container was not found.'
    };
  }

  return {
    status: 500,
    code: fallbackCode,
    message
  };
}

function parseDockerJsonLines(output) {
  if (!output) return [];
  const text = String(output).trim();
  if (!text) return [];

  function normalizeParsed(parsed) {
    if (!parsed) return [];
    if (Array.isArray(parsed)) {
      return parsed.filter((item) => item && typeof item === 'object');
    }
    if (typeof parsed === 'object') {
      return [parsed];
    }
    return [];
  }

  try {
    return normalizeParsed(JSON.parse(text));
  } catch (_err) {
    // Fallback: parse newline-delimited JSON output.
  }

  return text
    .split('\n')
    .flatMap((line) => {
      const candidate = String(line || '').trim();
      if (!candidate) return [];
      try {
        return normalizeParsed(JSON.parse(candidate));
      } catch (_err) {
        return [];
      }
    });
}

module.exports = {
  sanitizeContainerId,
  runDockerCommand,
  classifyDockerError,
  parseDockerJsonLines
};
