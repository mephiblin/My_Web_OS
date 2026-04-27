const fs = require('fs-extra');
const path = require('path');
const net = require('net');

const packageRegistryService = require('./packageRegistryService');
const ProcessSupervisor = require('./processSupervisor');
const runtimeStateStore = require('./runtimeStateStore');
const serverConfig = require('../config/serverConfig');
const appPaths = require('../utils/appPaths');
const inventoryPaths = require('../utils/inventoryPaths');
const {
  normalizeRuntimeProfile,
  assertValidRuntimeProfile,
  getRuntimeCommand,
  isManagedRuntime,
  sanitizeProfileForClient
} = require('./runtimeProfiles');

function normalizeCommandList(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function nowIso() {
  return new Date().toISOString();
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function createRuntimeError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

class RuntimeManager {
  constructor() {
    this.name = 'runtimeManager';
    this.supervisor = new ProcessSupervisor();
    this.appStates = new Map();
    this.logBuffers = new Map();
    this.eventBuffers = new Map();
    this.logWriteQueues = new Map();
    this.restartTimers = new Map();
    this.healthcheckTimers = new Map();
    this.healthFailures = new Map();
    this.runtimeLogsDir = '';
    this.runtimeConfig = {
      allowedCommands: ['node', 'python', 'python3'],
      logBufferLines: 500,
      eventBufferSize: 300,
      stopTimeoutMs: 5000,
      logFileMaxBytes: 10 * 1024 * 1024,
      logFileMaxFiles: 5,
      healthcheckFailureThreshold: 3,
      servicePortStart: 38000,
      servicePortEnd: 38999,
      serviceProxyTimeoutMs: 15000
    };

    this.supervisor.on('log', (event) => {
      this.appendLog(event.appId, event.stream, event.message, event.timestamp);
    });

    this.supervisor.on('start', (event) => {
      const current = this.ensureState(event.appId);
      current.status = 'running';
      current.pid = event.pid || null;
      current.lastStartedAt = event.timestamp || nowIso();
      current.lastError = '';
      current.healthStatus = 'unknown';
      current.updatedAt = nowIso();

      this.appendLog(event.appId, 'system', `Process started (pid=${event.pid || 'n/a'})`);
      this.appendEvent(event.appId, 'runtime.start', 'info', 'Runtime process started.', {
        pid: event.pid || null,
        command: event.command,
        args: event.args,
        cwd: event.cwd
      });

      this.scheduleHealthcheck(event.appId).catch(() => {});
      this.persistState(event.appId).catch(() => {});
    });

    this.supervisor.on('error', (event) => {
      const current = this.ensureState(event.appId);
      current.status = 'error';
      current.lastError = event.message || 'Unknown runtime error';
      current.updatedAt = nowIso();
      this.appendLog(event.appId, 'system', current.lastError, event.timestamp);
      this.appendEvent(event.appId, 'runtime.error', 'error', current.lastError);
      this.persistState(event.appId).catch(() => {});
    });

    this.supervisor.on('exit', (event) => {
      this.handleExit(event).catch(() => {});
    });
  }

  ensureState(appId) {
    if (this.appStates.has(appId)) {
      return this.appStates.get(appId);
    }

    const initial = {
      appId,
      status: 'stopped',
      pid: null,
      runtimeType: 'sandbox-html',
      appType: 'app',
      restartCount: 0,
      lastExitCode: null,
      lastExitSignal: null,
      lastStartedAt: null,
      lastError: '',
      healthStatus: 'unknown',
      lastHealthAt: null,
      servicePort: null,
      updatedAt: nowIso()
    };
    this.appStates.set(appId, initial);
    return initial;
  }

  toRuntimeSnapshot(app, state) {
    return {
      appId: app.id,
      title: app.title,
      description: app.description || '',
      runtimeType: app.runtimeProfile?.runtimeType || state.runtimeType,
      appType: app.appType || app.runtimeProfile?.appType || state.appType,
      status: state.status,
      pid: state.pid,
      restartCount: state.restartCount,
      lastStartedAt: state.lastStartedAt,
      lastExitCode: state.lastExitCode,
      lastExitSignal: state.lastExitSignal,
      lastError: state.lastError || '',
      healthStatus: state.healthStatus || 'unknown',
      lastHealthAt: state.lastHealthAt || null,
      servicePort: state.servicePort || null,
      updatedAt: state.updatedAt,
      service: app.runtimeProfile?.service || null,
      healthcheck: app.runtimeProfile?.healthcheck || null
    };
  }

  async ensureRuntimeLogsDir() {
    if (this.runtimeLogsDir) return this.runtimeLogsDir;
    const roots = await inventoryPaths.ensureInventoryStructure();
    this.runtimeLogsDir = path.join(roots.systemDir, 'runtime-logs');
    await fs.ensureDir(this.runtimeLogsDir);
    return this.runtimeLogsDir;
  }

  getLogFilePath(appId) {
    return path.join(this.runtimeLogsDir, `${appId}.log`);
  }

  appendEvent(appId, type, level, message, payload = {}, timestamp = nowIso()) {
    const maxEvents = Math.max(50, toNumber(this.runtimeConfig.eventBufferSize, 300));
    const current = this.eventBuffers.get(appId) || [];
    current.push({
      timestamp,
      type,
      level,
      message: String(message || ''),
      payload: payload && typeof payload === 'object' ? payload : {}
    });
    if (current.length > maxEvents) {
      current.splice(0, current.length - maxEvents);
    }
    this.eventBuffers.set(appId, current);
  }

  enqueueLogWrite(appId, line) {
    const previous = this.logWriteQueues.get(appId) || Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(() => this.appendLogToFile(appId, line));
    this.logWriteQueues.set(appId, next);
    next.finally(() => {
      if (this.logWriteQueues.get(appId) === next) {
        this.logWriteQueues.delete(appId);
      }
    });
  }

  async rotateLogFileIfNeeded(logFilePath, incomingBytes) {
    const maxBytes = Math.max(1024, toNumber(this.runtimeConfig.logFileMaxBytes, 10 * 1024 * 1024));
    const maxFiles = Math.max(1, toNumber(this.runtimeConfig.logFileMaxFiles, 5));

    const exists = await fs.pathExists(logFilePath);
    if (!exists) return;

    const stats = await fs.stat(logFilePath).catch(() => null);
    if (!stats) return;
    if (stats.size + incomingBytes < maxBytes) return;

    if (maxFiles <= 1) {
      await fs.remove(logFilePath).catch(() => {});
      return;
    }

    for (let index = maxFiles - 1; index >= 1; index -= 1) {
      const source = `${logFilePath}.${index}`;
      const target = `${logFilePath}.${index + 1}`;
      if (await fs.pathExists(source)) {
        await fs.remove(target).catch(() => {});
        await fs.move(source, target, { overwrite: true }).catch(() => {});
      }
    }

    await fs.move(logFilePath, `${logFilePath}.1`, { overwrite: true }).catch(() => {});
  }

  async appendLogToFile(appId, line) {
    await this.ensureRuntimeLogsDir();
    const logFilePath = this.getLogFilePath(appId);
    const bytes = Buffer.byteLength(line, 'utf8');
    await this.rotateLogFileIfNeeded(logFilePath, bytes);
    await fs.appendFile(logFilePath, line, 'utf8');
  }

  appendLog(appId, stream, message, timestamp = nowIso()) {
    const maxLines = Math.max(50, Number(this.runtimeConfig.logBufferLines) || 500);
    const normalizedMessage = String(message || '');
    const current = this.logBuffers.get(appId) || [];
    current.push({
      timestamp,
      stream,
      message: normalizedMessage
    });
    if (current.length > maxLines) {
      current.splice(0, current.length - maxLines);
    }
    this.logBuffers.set(appId, current);

    const line = `[${timestamp}] [${stream}] ${normalizedMessage}\n`;
    this.enqueueLogWrite(appId, line);
  }

  buildCursorResult(items, options = {}) {
    const limit = Math.max(1, toNumber(options.limit, 200));
    const total = items.length;

    let start;
    if (options.cursor !== undefined && options.cursor !== null && String(options.cursor).trim() !== '') {
      start = Math.max(0, toNumber(options.cursor, 0));
    } else {
      start = Math.max(0, total - limit);
    }

    const end = Math.min(total, start + limit);
    const slice = items.slice(start, end);

    return {
      items: slice,
      cursor: {
        next: end < total ? end : null,
        hasMore: end < total,
        total
      }
    };
  }

  getLogs(appId, options = {}) {
    const logs = this.logBuffers.get(appId) || [];
    return this.buildCursorResult(logs, options);
  }

  getEvents(appId, options = {}) {
    const events = this.eventBuffers.get(appId) || [];
    return this.buildCursorResult(events, options);
  }

  async persistState(appId) {
    const snapshot = await runtimeStateStore.readAll();
    snapshot.apps[appId] = { ...this.ensureState(appId) };
    await runtimeStateStore.writeAll(snapshot);
  }

  async loadManifest(appId) {
    const appRoot = await appPaths.getAppRoot(appId);
    const manifestFile = path.join(appRoot, 'manifest.json');
    if (!(await fs.pathExists(manifestFile))) {
      const err = new Error('Package manifest not found.');
      err.code = 'RUNTIME_APP_NOT_FOUND';
      throw err;
    }

    const manifest = await fs.readJson(manifestFile);
    const profile = normalizeRuntimeProfile(manifest);
    assertValidRuntimeProfile(manifest, profile);

    return {
      appRoot,
      manifest,
      profile
    };
  }

  ensureCommandAllowed(command) {
    const allowed = new Set(normalizeCommandList(this.runtimeConfig.allowedCommands, ['node', 'python', 'python3']));
    const commandBase = path.basename(command || '');
    if (allowed.has(command) || allowed.has(commandBase)) {
      return;
    }
    const err = new Error(`Command is not allowed: ${command}`);
    err.code = 'RUNTIME_COMMAND_NOT_ALLOWED';
    throw err;
  }

  async isPortAvailable(port) {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.unref();
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => {
        server.close(() => resolve(true));
      });
    });
  }

  isServicePortInRange(port) {
    const normalizedPort = Number(port);
    return Number.isInteger(normalizedPort) &&
      normalizedPort >= this.runtimeConfig.servicePortStart &&
      normalizedPort <= this.runtimeConfig.servicePortEnd;
  }

  async allocateServicePort(appId) {
    const state = this.ensureState(appId);
    const currentPort = Number(state.servicePort);
    if (this.isServicePortInRange(currentPort) && await this.isPortAvailable(currentPort)) {
      return currentPort;
    }
    state.servicePort = null;

    const start = Math.max(1, toNumber(this.runtimeConfig.servicePortStart, 38000));
    const end = Math.max(start, toNumber(this.runtimeConfig.servicePortEnd, 38999));
    const reserved = new Set();
    for (const [otherAppId, otherState] of this.appStates.entries()) {
      if (otherAppId === appId) continue;
      const port = Number(otherState?.servicePort);
      if (Number.isInteger(port) && port > 0) reserved.add(port);
    }

    for (let port = start; port <= end; port += 1) {
      if (reserved.has(port)) continue;
      if (!(await this.isPortAvailable(port))) continue;
      state.servicePort = port;
      return port;
    }

    const err = new Error(`No available service port in range ${start}-${end}.`);
    err.code = 'RUNTIME_SERVICE_PORT_UNAVAILABLE';
    throw err;
  }

  async buildRuntimeEnv(appId, appRoot, servicePort) {
    const configPaths = await serverConfig.getPaths();
    const appDataDir = await appPaths.ensureAppDataRoot(appId);
    return {
      WEBOS_APP_ID: appId,
      WEBOS_PACKAGE_DIR: appRoot,
      WEBOS_APP_DATA_DIR: appDataDir,
      WEBOS_ALLOWED_ROOTS_JSON: JSON.stringify(configPaths.allowedRoots || []),
      WEBOS_SERVICE_PORT: String(servicePort || ''),
      WEBOS_RUNTIME_MODE: 'managed-process'
    };
  }

  async resolveExecutionPlan(appId) {
    const { appRoot, profile } = await this.loadManifest(appId);
    if (!isManagedRuntime(profile)) {
      const err = new Error('This app runtime is not process-managed.');
      err.code = 'RUNTIME_NOT_MANAGED';
      throw err;
    }

    const command = getRuntimeCommand(profile);
    if (!command) {
      const err = new Error('Runtime command could not be resolved.');
      err.code = 'RUNTIME_COMMAND_REQUIRED';
      throw err;
    }

    this.ensureCommandAllowed(command);

    const cwd = appPaths.ensureWithinRoot(appRoot, path.join(appRoot, profile.cwd || '.'));
    const runtimeEntryPath = profile.entry
      ? appPaths.ensureWithinRoot(appRoot, path.join(appRoot, profile.entry))
      : '';

    if (profile.runtimeType !== 'binary') {
      if (!runtimeEntryPath || !(await fs.pathExists(runtimeEntryPath))) {
        const err = new Error(`Runtime entry file not found: ${profile.entry}`);
        err.code = 'RUNTIME_ENTRY_NOT_FOUND';
        throw err;
      }
    }

    const args = [];
    if (profile.runtimeType === 'binary') {
      if (!profile.command && runtimeEntryPath) {
        args.push(...profile.args);
        const servicePort = await this.allocateServicePort(appId);
        return {
          command: runtimeEntryPath,
          args,
          cwd,
          env: await this.buildRuntimeEnv(appId, appRoot, servicePort),
          servicePort,
          profile
        };
      }
      if (runtimeEntryPath) {
        args.push(runtimeEntryPath);
      }
      args.push(...profile.args);
      const servicePort = await this.allocateServicePort(appId);
      return {
        command,
        args,
        cwd,
        env: await this.buildRuntimeEnv(appId, appRoot, servicePort),
        servicePort,
        profile
      };
    }

    args.push(runtimeEntryPath, ...profile.args);
    const servicePort = await this.allocateServicePort(appId);
    return {
      command,
      args,
      cwd,
      env: await this.buildRuntimeEnv(appId, appRoot, servicePort),
      servicePort,
      profile
    };
  }

  cancelRestart(appId) {
    const timer = this.restartTimers.get(appId);
    if (timer) {
      clearTimeout(timer);
      this.restartTimers.delete(appId);
    }
  }

  clearHealthcheck(appId) {
    const timer = this.healthcheckTimers.get(appId);
    if (timer) {
      clearInterval(timer);
      this.healthcheckTimers.delete(appId);
    }
    this.healthFailures.delete(appId);
  }

  async performHealthcheck(appId, profile) {
    const state = this.ensureState(appId);
    if (!this.supervisor.isRunning(appId)) {
      return;
    }

    const healthType = profile.healthcheck?.type || 'none';
    if (healthType === 'none') {
      return;
    }

    let healthy = false;
    let reason = '';

    if (healthType === 'process') {
      healthy = this.supervisor.isRunning(appId);
      reason = healthy ? '' : 'Process is not running.';
    } else if (healthType === 'http') {
      const rawPath = String(profile.healthcheck?.path || '').trim();
      const statePort = Number(state.servicePort);
      if (!this.isServicePortInRange(statePort) || !rawPath.startsWith('/')) {
        healthy = false;
        reason = 'HTTP healthcheck target is invalid.';
      } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rawPath) || rawPath.startsWith('//') || rawPath.includes('\\')) {
        healthy = false;
        reason = 'HTTP healthcheck path must be relative to the package service.';
      } else {
        const target = new URL(rawPath, `http://127.0.0.1:${statePort}`).toString();

        try {
          const response = await fetch(target, {
            method: 'GET',
            signal: AbortSignal.timeout(Math.max(100, toNumber(profile.healthcheck?.timeoutMs, 2000)))
          });
          healthy = response.ok;
          if (!healthy) {
            reason = `Health endpoint returned ${response.status}.`;
          }
        } catch (error) {
          healthy = false;
          reason = error.message || 'HTTP healthcheck failed.';
        }
      }
    }

    const failureThreshold = Math.max(1, toNumber(this.runtimeConfig.healthcheckFailureThreshold, 3));
    const now = nowIso();
    state.lastHealthAt = now;

    if (healthy) {
      const previousFailures = this.healthFailures.get(appId) || 0;
      if (previousFailures >= failureThreshold || state.healthStatus === 'unhealthy') {
        this.appendEvent(appId, 'runtime.health.recovered', 'info', 'Healthcheck recovered.');
      }
      this.healthFailures.set(appId, 0);
      state.healthStatus = 'healthy';
      if (state.status === 'degraded') {
        state.status = 'running';
      }
      state.updatedAt = now;
      await this.persistState(appId);
      return;
    }

    const failures = (this.healthFailures.get(appId) || 0) + 1;
    this.healthFailures.set(appId, failures);

    if (failures >= failureThreshold) {
      state.healthStatus = 'unhealthy';
      if (state.status === 'running') {
        state.status = 'degraded';
      }
      state.lastError = reason || 'Healthcheck failed.';
      state.updatedAt = now;
      this.appendEvent(appId, 'runtime.health.failed', 'warn', state.lastError, {
        failures,
        threshold: failureThreshold
      });
      this.appendLog(appId, 'system', `Healthcheck failed (${failures}/${failureThreshold}): ${state.lastError}`);
      await this.persistState(appId);
    }
  }

  async scheduleHealthcheck(appId, profileInput = null) {
    this.clearHealthcheck(appId);

    let profile = profileInput;
    if (!profile) {
      try {
        profile = (await this.loadManifest(appId)).profile;
      } catch (_err) {
        return;
      }
    }

    const healthType = profile.healthcheck?.type || 'none';
    if (healthType === 'none') {
      return;
    }

    const intervalMs = Math.max(250, toNumber(profile.healthcheck?.intervalMs, 10000));
    const run = () => {
      this.performHealthcheck(appId, profile).catch(() => {});
    };

    run();
    const timer = setInterval(run, intervalMs);
    this.healthcheckTimers.set(appId, timer);
  }

  async handleExit(event) {
    const { appId, code, signal, timestamp } = event;
    const state = this.ensureState(appId);
    state.pid = null;
    state.lastExitCode = code;
    state.lastExitSignal = signal;
    state.updatedAt = timestamp || nowIso();

    this.clearHealthcheck(appId);

    let profile;
    try {
      profile = (await this.loadManifest(appId)).profile;
    } catch (_err) {
      profile = null;
    }

    const wasStopping = state.status === 'stopping';
    if (wasStopping) {
      state.status = 'stopped';
      this.appendEvent(appId, 'runtime.stop', 'info', 'Runtime process stopped.');
      await this.persistState(appId);
      return;
    }

    this.appendEvent(appId, 'runtime.exit', Number(code) === 0 ? 'info' : 'warn', 'Runtime process exited.', {
      code: Number.isFinite(Number(code)) ? Number(code) : null,
      signal: signal || null
    });

    const shouldRestart = Boolean(
      profile &&
      profile.service?.restartPolicy !== 'never' &&
      (profile.service.restartPolicy === 'always' || (profile.service.restartPolicy === 'on-failure' && Number(code) !== 0))
    );

    if (!shouldRestart) {
      state.status = Number(code) === 0 ? 'stopped' : 'error';
      if (Number(code) !== 0) {
        state.lastError = `Process exited with code ${code}${signal ? ` (${signal})` : ''}`;
      }
      await this.persistState(appId);
      return;
    }

    const maxRetries = Number.isFinite(Number(profile.service?.maxRetries)) ? Number(profile.service.maxRetries) : 3;
    if (state.restartCount >= maxRetries) {
      state.status = 'error';
      state.lastError = `Restart limit exceeded (${maxRetries}).`;
      this.appendEvent(appId, 'runtime.restart.limit', 'error', state.lastError, {
        maxRetries
      });
      await this.persistState(appId);
      return;
    }

    const delayMs = Number.isFinite(Number(profile.service?.restartDelayMs))
      ? Number(profile.service.restartDelayMs)
      : 1000;
    state.status = 'degraded';
    state.restartCount += 1;
    this.appendLog(appId, 'system', `Process exited. Scheduling restart #${state.restartCount} in ${delayMs}ms.`, timestamp);
    this.appendEvent(appId, 'runtime.restart.scheduled', 'warn', 'Automatic restart scheduled.', {
      restartCount: state.restartCount,
      delayMs
    });
    await this.persistState(appId);

    this.cancelRestart(appId);
    const timer = setTimeout(() => {
      this.restartTimers.delete(appId);
      this.startApp(appId, { isAutoRestart: true }).catch((err) => {
        const current = this.ensureState(appId);
        current.status = 'error';
        current.lastError = err.message || 'Auto-restart failed.';
        current.updatedAt = nowIso();
        this.appendLog(appId, 'system', current.lastError);
        this.appendEvent(appId, 'runtime.restart.failed', 'error', current.lastError);
        this.persistState(appId).catch(() => {});
      });
    }, delayMs);
    this.restartTimers.set(appId, timer);
  }

  async init() {
    const config = await serverConfig.getAll();
    const runtimeDefaults = config.defaults?.runtime || {};
    this.runtimeConfig.allowedCommands = normalizeCommandList(runtimeDefaults.allowedCommands, ['node', 'python', 'python3']);
    this.runtimeConfig.logBufferLines = Math.max(50, toNumber(runtimeDefaults.logBufferLines, 500));
    this.runtimeConfig.eventBufferSize = Math.max(50, toNumber(runtimeDefaults.eventBufferSize, 300));
    this.runtimeConfig.stopTimeoutMs = Math.max(100, toNumber(runtimeDefaults.stopTimeoutMs, 5000));
    this.runtimeConfig.logFileMaxBytes = Math.max(1024, toNumber(runtimeDefaults.logFileMaxBytes, 10 * 1024 * 1024));
    this.runtimeConfig.logFileMaxFiles = Math.max(1, toNumber(runtimeDefaults.logFileMaxFiles, 5));
    this.runtimeConfig.healthcheckFailureThreshold = Math.max(1, toNumber(runtimeDefaults.healthcheckFailureThreshold, 3));
    this.runtimeConfig.servicePortStart = Math.max(1, toNumber(runtimeDefaults.servicePortStart, 38000));
    this.runtimeConfig.servicePortEnd = Math.max(this.runtimeConfig.servicePortStart, toNumber(runtimeDefaults.servicePortEnd, 38999));
    this.runtimeConfig.serviceProxyTimeoutMs = Math.max(500, toNumber(runtimeDefaults.serviceProxyTimeoutMs, 15000));

    this.supervisor.stopTimeoutMs = this.runtimeConfig.stopTimeoutMs;
    await this.ensureRuntimeLogsDir();

    const snapshot = await runtimeStateStore.readAll();
    for (const [appId, raw] of Object.entries(snapshot.apps || {})) {
      const next = this.ensureState(appId);
      Object.assign(next, raw || {});
      next.status = 'stopped';
      next.pid = null;
      next.healthStatus = 'unknown';
      next.lastHealthAt = null;
      next.updatedAt = nowIso();
    }

    await runtimeStateStore.writeAll({
      ...snapshot,
      apps: Object.fromEntries(this.appStates.entries())
    });

    const apps = await packageRegistryService.listSandboxApps();
    for (const app of apps) {
      const profile = app.runtimeProfile;
      if (!profile || !isManagedRuntime(profile)) continue;
      if (!profile.service?.autoStart) continue;

      this.appendEvent(app.id, 'runtime.autostart', 'info', 'Auto-start requested by runtime policy.');
      this.startApp(app.id, { isAutoStart: true }).catch((err) => {
        const state = this.ensureState(app.id);
        state.status = 'error';
        state.lastError = err.message || 'Auto-start failed.';
        state.updatedAt = nowIso();
        this.appendEvent(app.id, 'runtime.autostart.failed', 'error', state.lastError);
        this.persistState(app.id).catch(() => {});
      });
    }
  }

  async close() {
    for (const appId of Array.from(this.restartTimers.keys())) {
      this.cancelRestart(appId);
    }
    for (const appId of Array.from(this.healthcheckTimers.keys())) {
      this.clearHealthcheck(appId);
    }

    for (const appId of Array.from(this.appStates.keys())) {
      const state = this.ensureState(appId);
      if (state.status === 'running' || state.status === 'starting' || state.status === 'degraded') {
        state.status = 'stopping';
      }
    }

    await this.supervisor.stopAll();

    for (const appId of Array.from(this.appStates.keys())) {
      const state = this.ensureState(appId);
      state.status = 'stopped';
      state.pid = null;
      state.healthStatus = 'unknown';
      state.lastHealthAt = null;
      state.updatedAt = nowIso();
    }

    await runtimeStateStore.writeAll({
      version: 1,
      updatedAt: nowIso(),
      apps: Object.fromEntries(this.appStates.entries())
    });
  }

  getStatus() {
    const running = Array.from(this.appStates.values()).filter((item) => item.status === 'running').length;
    const total = this.appStates.size;
    return {
      runningApps: running,
      trackedApps: total
    };
  }

  async listApps() {
    const apps = await packageRegistryService.listSandboxApps();
    return apps.map((app) => {
      const state = this.ensureState(app.id);
      state.runtimeType = app.runtimeProfile?.runtimeType || state.runtimeType;
      state.appType = app.appType || state.appType;
      return {
        ...this.toRuntimeSnapshot(app, state),
        runtimeProfile: app.runtimeProfile ? sanitizeProfileForClient(app.runtimeProfile) : null
      };
    });
  }

  async getApp(appId) {
    const app = await packageRegistryService.getSandboxApp(appId);
    if (!app) {
      const err = new Error('App not found.');
      err.code = 'RUNTIME_APP_NOT_FOUND';
      throw err;
    }

    const state = this.ensureState(app.id);
    state.runtimeType = app.runtimeProfile?.runtimeType || state.runtimeType;
    state.appType = app.appType || state.appType;
    return {
      ...this.toRuntimeSnapshot(app, state),
      runtimeProfile: app.runtimeProfile ? sanitizeProfileForClient(app.runtimeProfile) : null
    };
  }

  async startApp(appId, options = {}) {
    const app = await packageRegistryService.getSandboxApp(appId);
    if (!app) {
      const err = new Error('App not found.');
      err.code = 'RUNTIME_APP_NOT_FOUND';
      throw err;
    }
    if (!isManagedRuntime(app.runtimeProfile)) {
      const err = new Error('This app runtime cannot be started via runtime manager.');
      err.code = 'RUNTIME_NOT_MANAGED';
      throw err;
    }

    const plan = await this.resolveExecutionPlan(appId);
    const state = this.ensureState(appId);
    if (state.status === 'running' || state.status === 'starting') {
      return this.getApp(appId);
    }

    this.cancelRestart(appId);
    this.clearHealthcheck(appId);

    state.status = 'starting';
    state.runtimeType = plan.profile.runtimeType;
    state.appType = plan.profile.appType;
    state.updatedAt = nowIso();
    state.lastError = '';
    state.healthStatus = 'unknown';
    state.lastHealthAt = null;
    if (!options.isAutoRestart) {
      state.restartCount = 0;
    }

    this.appendLog(appId, 'system', `Starting process: ${plan.command} ${plan.args.join(' ')}`.trim());
    this.appendEvent(appId, 'runtime.start.requested', 'info', 'Runtime start requested.', {
      command: plan.command,
      args: plan.args,
      cwd: plan.cwd,
      autoRestart: Boolean(options.isAutoRestart),
      autoStart: Boolean(options.isAutoStart)
    });

    await this.persistState(appId);

    await this.supervisor.start(appId, {
      command: plan.command,
      args: plan.args,
      cwd: plan.cwd,
      env: plan.env
    });

    return this.getApp(appId);
  }

  async stopApp(appId) {
    const app = await packageRegistryService.getSandboxApp(appId);
    if (!app) {
      const err = new Error('App not found.');
      err.code = 'RUNTIME_APP_NOT_FOUND';
      throw err;
    }

    const state = this.ensureState(appId);
    this.cancelRestart(appId);
    this.clearHealthcheck(appId);

    if (!this.supervisor.isRunning(appId)) {
      state.status = 'stopped';
      state.pid = null;
      state.updatedAt = nowIso();
      this.appendEvent(appId, 'runtime.stop', 'info', 'Runtime already stopped.');
      await this.persistState(appId);
      return this.getApp(appId);
    }

    state.status = 'stopping';
    state.updatedAt = nowIso();
    this.appendEvent(appId, 'runtime.stop.requested', 'info', 'Runtime stop requested.');
    await this.persistState(appId);

    await this.supervisor.stop(appId, { timeoutMs: this.runtimeConfig.stopTimeoutMs });

    state.status = 'stopped';
    state.pid = null;
    state.healthStatus = 'unknown';
    state.lastHealthAt = null;
    state.updatedAt = nowIso();
    await this.persistState(appId);
    return this.getApp(appId);
  }

  async restartApp(appId) {
    const app = await packageRegistryService.getSandboxApp(appId);
    if (!app) {
      const err = new Error('App not found.');
      err.code = 'RUNTIME_APP_NOT_FOUND';
      throw err;
    }

    this.appendEvent(appId, 'runtime.restart.requested', 'info', 'Runtime restart requested.');
    await this.stopApp(appId);
    return this.startApp(appId);
  }

  async validateApp(appId) {
    const app = await packageRegistryService.getSandboxApp(appId);
    if (!app) {
      const err = new Error('App not found.');
      err.code = 'RUNTIME_APP_NOT_FOUND';
      throw err;
    }

    const checks = [];
    let profile = null;
    let plan = null;

    try {
      const loaded = await this.loadManifest(appId);
      profile = loaded.profile;
      checks.push({
        id: 'manifest.runtime-profile',
        level: 'pass',
        message: 'Runtime profile is valid.'
      });
    } catch (err) {
      checks.push({
        id: 'manifest.runtime-profile',
        level: 'fail',
        code: err.code || 'RUNTIME_PROFILE_INVALID',
        message: err.message
      });
      return {
        appId,
        valid: false,
        checks,
        plan: null
      };
    }

    if (isManagedRuntime(profile)) {
      try {
        plan = await this.resolveExecutionPlan(appId);
        checks.push({
          id: 'runtime.execution-plan',
          level: 'pass',
          message: 'Runtime execution plan is resolvable.',
          command: plan.command,
          args: plan.args,
          cwd: plan.cwd,
          servicePort: plan.servicePort
        });
      } catch (err) {
        checks.push({
          id: 'runtime.execution-plan',
          level: 'fail',
          code: err.code || 'RUNTIME_EXECUTION_PLAN_INVALID',
          message: err.message
        });
      }
    } else {
      checks.push({
        id: 'runtime.execution-plan',
        level: 'pass',
        message: 'Sandbox runtime does not require process execution plan.'
      });
    }

    const valid = checks.every((check) => check.level !== 'fail');
    return {
      appId,
      valid,
      checks,
      plan: plan
        ? {
          command: plan.command,
          args: plan.args,
          cwd: plan.cwd,
          servicePort: plan.servicePort
        }
        : null
    };
  }

  async recoverApp(appId) {
    const app = await packageRegistryService.getSandboxApp(appId);
    if (!app) {
      const err = new Error('App not found.');
      err.code = 'RUNTIME_APP_NOT_FOUND';
      throw err;
    }
    if (!isManagedRuntime(app.runtimeProfile)) {
      const err = new Error('This app runtime cannot be recovered via runtime manager.');
      err.code = 'RUNTIME_NOT_MANAGED';
      throw err;
    }

    const state = this.ensureState(appId);
    const running = this.supervisor.isRunning(appId);
    let action = 'none';

    if (!running) {
      await this.startApp(appId, { isAutoRestart: true });
      action = 'start';
      this.appendEvent(appId, 'runtime.recovery.start', 'info', 'Recovery started a stopped runtime.');
    } else if (
      state.status === 'degraded' ||
      state.status === 'error' ||
      state.healthStatus === 'unhealthy'
    ) {
      await this.restartApp(appId);
      action = 'restart';
      this.appendEvent(appId, 'runtime.recovery.restart', 'warn', 'Recovery restarted degraded runtime.');
    } else {
      action = 'none';
      this.appendEvent(appId, 'runtime.recovery.noop', 'info', 'Recovery skipped because runtime is healthy.');
    }

    return {
      action,
      app: await this.getApp(appId)
    };
  }

  getRuntimeStatusMap() {
    const result = {};
    for (const [appId, state] of this.appStates.entries()) {
      result[appId] = {
        status: state.status,
        pid: state.pid,
        lastError: state.lastError,
        healthStatus: state.healthStatus || 'unknown',
        lastHealthAt: state.lastHealthAt || null,
        servicePort: state.servicePort || null,
        updatedAt: state.updatedAt
      };
    }
    return result;
  }

  getServiceProxyTimeoutMs() {
    return Math.max(500, toNumber(this.runtimeConfig.serviceProxyTimeoutMs, 15000));
  }

  async getServiceConnectionInfo(appId) {
    const app = await packageRegistryService.getSandboxApp(appId);
    if (!app) {
      const err = new Error('App not found.');
      err.code = 'RUNTIME_APP_NOT_FOUND';
      throw err;
    }
    if (!isManagedRuntime(app.runtimeProfile)) {
      const err = new Error('This app does not expose a managed service runtime.');
      err.code = 'RUNTIME_NOT_MANAGED';
      throw err;
    }
    const state = this.ensureState(appId);
    if (!this.supervisor.isRunning(appId) || !['running', 'degraded'].includes(String(state.status || '').toLowerCase())) {
      const err = new Error('Package service is not running.');
      err.code = 'RUNTIME_SERVICE_UNAVAILABLE';
      err.status = state.status || 'stopped';
      throw err;
    }
    if (!state.servicePort) {
      throw createRuntimeError('Package service port is not assigned.', 'RUNTIME_SERVICE_PORT_MISSING');
    }
    if (!this.isServicePortInRange(state.servicePort)) {
      throw createRuntimeError('Package service port is outside the allowed runtime range.', 'RUNTIME_SERVICE_PORT_INVALID');
    }
    return {
      appId,
      port: Number(state.servicePort),
      status: state.status,
      healthStatus: state.healthStatus || 'unknown'
    };
  }
}

module.exports = new RuntimeManager();
