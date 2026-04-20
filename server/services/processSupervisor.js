const { EventEmitter } = require('events');
const { spawn } = require('child_process');

function splitLines(bufferText) {
  const lines = bufferText.split(/\r?\n/);
  const remainder = lines.pop() || '';
  return { lines, remainder };
}

class ProcessSupervisor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.processes = new Map();
    this.stopTimeoutMs = Number.isFinite(Number(options.stopTimeoutMs)) ? Number(options.stopTimeoutMs) : 5000;
  }

  isRunning(appId) {
    const runtime = this.processes.get(appId);
    return Boolean(runtime && runtime.child && !runtime.child.killed);
  }

  getProcessMeta(appId) {
    const runtime = this.processes.get(appId);
    if (!runtime) return null;
    return {
      appId,
      pid: runtime.child?.pid || null,
      command: runtime.command,
      args: runtime.args,
      cwd: runtime.cwd,
      startedAt: runtime.startedAt
    };
  }

  async start(appId, options = {}) {
    if (this.isRunning(appId)) {
      return this.getProcessMeta(appId);
    }

    const command = String(options.command || '').trim();
    if (!command) {
      const err = new Error('Runtime command is required.');
      err.code = 'RUNTIME_COMMAND_REQUIRED';
      throw err;
    }

    const args = Array.isArray(options.args) ? options.args.map((item) => String(item)) : [];
    const cwd = options.cwd || process.cwd();
    const env = options.env && typeof options.env === 'object'
      ? { ...process.env, ...options.env }
      : { ...process.env };

    const child = spawn(command, args, {
      cwd,
      env,
      detached: false,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const runtime = {
      child,
      command,
      args,
      cwd,
      startedAt: new Date().toISOString(),
      stopSignal: options.stopSignal || 'SIGTERM',
      stdoutRemainder: '',
      stderrRemainder: ''
    };
    this.processes.set(appId, runtime);

    child.stdout?.on('data', (chunk) => {
      runtime.stdoutRemainder += chunk.toString('utf8');
      const { lines, remainder } = splitLines(runtime.stdoutRemainder);
      runtime.stdoutRemainder = remainder;
      for (const line of lines) {
        this.emit('log', {
          appId,
          stream: 'stdout',
          timestamp: new Date().toISOString(),
          message: line
        });
      }
    });

    child.stderr?.on('data', (chunk) => {
      runtime.stderrRemainder += chunk.toString('utf8');
      const { lines, remainder } = splitLines(runtime.stderrRemainder);
      runtime.stderrRemainder = remainder;
      for (const line of lines) {
        this.emit('log', {
          appId,
          stream: 'stderr',
          timestamp: new Date().toISOString(),
          message: line
        });
      }
    });

    child.on('error', (error) => {
      this.emit('error', {
        appId,
        timestamp: new Date().toISOString(),
        message: error.message || String(error)
      });
    });

    child.on('exit', (code, signal) => {
      const active = this.processes.get(appId);
      if (active?.stdoutRemainder) {
        this.emit('log', {
          appId,
          stream: 'stdout',
          timestamp: new Date().toISOString(),
          message: active.stdoutRemainder
        });
      }
      if (active?.stderrRemainder) {
        this.emit('log', {
          appId,
          stream: 'stderr',
          timestamp: new Date().toISOString(),
          message: active.stderrRemainder
        });
      }
      this.processes.delete(appId);

      this.emit('exit', {
        appId,
        code: Number.isFinite(Number(code)) ? Number(code) : null,
        signal: signal || null,
        timestamp: new Date().toISOString()
      });
    });

    this.emit('start', {
      appId,
      pid: child.pid,
      command,
      args,
      cwd,
      timestamp: runtime.startedAt
    });

    return this.getProcessMeta(appId);
  }

  async stop(appId, options = {}) {
    const runtime = this.processes.get(appId);
    if (!runtime || !runtime.child) return;

    const stopSignal = options.signal || runtime.stopSignal || 'SIGTERM';
    const timeoutMs = Number.isFinite(Number(options.timeoutMs))
      ? Number(options.timeoutMs)
      : this.stopTimeoutMs;

    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };

      runtime.child.once('exit', finish);
      try {
        runtime.child.kill(stopSignal);
      } catch (_err) {
        finish();
        return;
      }

      setTimeout(() => {
        if (done) return;
        try {
          runtime.child.kill('SIGKILL');
        } catch (_err) {
          // no-op
        }
      }, timeoutMs);
    });
  }

  async stopAll() {
    const targets = Array.from(this.processes.keys());
    for (const appId of targets) {
      await this.stop(appId);
    }
  }
}

module.exports = ProcessSupervisor;
