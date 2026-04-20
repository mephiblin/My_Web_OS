const fs = require('fs-extra');
const path = require('path');

const packageRegistryService = require('./packageRegistryService');
const ProcessSupervisor = require('./processSupervisor');
const runtimeStateStore = require('./runtimeStateStore');
const serverConfig = require('../config/serverConfig');
const appPaths = require('../utils/appPaths');
const {
  normalizeRuntimeProfile,
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

class RuntimeManager {
  constructor() {
    this.name = 'runtimeManager';
    this.supervisor = new ProcessSupervisor();
    this.appStates = new Map();
    this.logBuffers = new Map();
    this.restartTimers = new Map();
    this.runtimeConfig = {
      allowedCommands: ['node', 'python', 'python3'],
      logBufferLines: 500,
      stopTimeoutMs: 5000
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
      current.updatedAt = nowIso();
      this.appendLog(event.appId, 'system', `Process started (pid=${event.pid || 'n/a'})`);
      this.persistState(event.appId).catch(() => {});
    });

    this.supervisor.on('error', (event) => {
      const current = this.ensureState(event.appId);
      current.status = 'error';
      current.lastError = event.message || 'Unknown runtime error';
      current.updatedAt = nowIso();
      this.appendLog(event.appId, 'system', current.lastError, event.timestamp);
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
      updatedAt: state.updatedAt,
      service: app.runtimeProfile?.service || null,
      healthcheck: app.runtimeProfile?.healthcheck || null
    };
  }

  appendLog(appId, stream, message, timestamp = nowIso()) {
    const maxLines = Math.max(50, Number(this.runtimeConfig.logBufferLines) || 500);
    const current = this.logBuffers.get(appId) || [];
    current.push({
      timestamp,
      stream,
      message: String(message || '')
    });
    if (current.length > maxLines) {
      current.splice(0, current.length - maxLines);
    }
    this.logBuffers.set(appId, current);
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
    return {
      appRoot,
      manifest,
      profile: normalizeRuntimeProfile(manifest)
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
        return {
          command: runtimeEntryPath,
          args,
          cwd,
          profile
        };
      }
      if (runtimeEntryPath) {
        args.push(runtimeEntryPath);
      }
      args.push(...profile.args);
      return {
        command,
        args,
        cwd,
        profile
      };
    }

    args.push(runtimeEntryPath, ...profile.args);
    return {
      command,
      args,
      cwd,
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

  async handleExit(event) {
    const { appId, code, signal, timestamp } = event;
    const state = this.ensureState(appId);
    state.pid = null;
    state.lastExitCode = code;
    state.lastExitSignal = signal;
    state.updatedAt = timestamp || nowIso();

    let profile;
    try {
      profile = (await this.loadManifest(appId)).profile;
    } catch (_err) {
      profile = null;
    }

    const wasStopping = state.status === 'stopping';
    if (wasStopping) {
      state.status = 'stopped';
      await this.persistState(appId);
      return;
    }

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
      await this.persistState(appId);
      return;
    }

    const delayMs = Number.isFinite(Number(profile.service?.restartDelayMs))
      ? Number(profile.service.restartDelayMs)
      : 1000;
    state.status = 'degraded';
    state.restartCount += 1;
    this.appendLog(appId, 'system', `Process exited. Scheduling restart #${state.restartCount} in ${delayMs}ms.`, timestamp);
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
        this.persistState(appId).catch(() => {});
      });
    }, delayMs);
    this.restartTimers.set(appId, timer);
  }

  async init() {
    const config = await serverConfig.getAll();
    const runtimeDefaults = config.defaults?.runtime || {};
    this.runtimeConfig.allowedCommands = normalizeCommandList(runtimeDefaults.allowedCommands, ['node', 'python', 'python3']);
    this.runtimeConfig.logBufferLines = Number.isFinite(Number(runtimeDefaults.logBufferLines))
      ? Number(runtimeDefaults.logBufferLines)
      : 500;
    this.runtimeConfig.stopTimeoutMs = Number.isFinite(Number(runtimeDefaults.stopTimeoutMs))
      ? Number(runtimeDefaults.stopTimeoutMs)
      : 5000;
    this.supervisor.stopTimeoutMs = this.runtimeConfig.stopTimeoutMs;

    const snapshot = await runtimeStateStore.readAll();
    for (const [appId, raw] of Object.entries(snapshot.apps || {})) {
      const next = this.ensureState(appId);
      Object.assign(next, raw || {});
      next.status = 'stopped';
      next.pid = null;
      next.updatedAt = nowIso();
    }
    await runtimeStateStore.writeAll({
      ...snapshot,
      apps: Object.fromEntries(this.appStates.entries())
    });
  }

  async close() {
    for (const appId of Array.from(this.restartTimers.keys())) {
      this.cancelRestart(appId);
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
    state.status = 'starting';
    state.runtimeType = plan.profile.runtimeType;
    state.appType = plan.profile.appType;
    state.updatedAt = nowIso();
    state.lastError = '';
    if (!options.isAutoRestart) {
      state.restartCount = 0;
    }
    this.appendLog(appId, 'system', `Starting process: ${plan.command} ${plan.args.join(' ')}`.trim());
    await this.persistState(appId);

    await this.supervisor.start(appId, {
      command: plan.command,
      args: plan.args,
      cwd: plan.cwd
    });
    return this.getApp(appId);
  }

  async stopApp(appId) {
    const state = this.ensureState(appId);
    this.cancelRestart(appId);
    if (!this.supervisor.isRunning(appId)) {
      state.status = 'stopped';
      state.pid = null;
      state.updatedAt = nowIso();
      await this.persistState(appId);
      return this.getApp(appId);
    }

    state.status = 'stopping';
    state.updatedAt = nowIso();
    await this.persistState(appId);
    await this.supervisor.stop(appId, { timeoutMs: this.runtimeConfig.stopTimeoutMs });
    state.status = 'stopped';
    state.pid = null;
    state.updatedAt = nowIso();
    await this.persistState(appId);
    return this.getApp(appId);
  }

  async restartApp(appId) {
    await this.stopApp(appId);
    return this.startApp(appId);
  }

  getLogs(appId, options = {}) {
    const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : 200;
    const logs = this.logBuffers.get(appId) || [];
    if (limit <= 0) return [];
    if (logs.length <= limit) return [...logs];
    return logs.slice(logs.length - limit);
  }

  getRuntimeStatusMap() {
    const result = {};
    for (const [appId, state] of this.appStates.entries()) {
      result[appId] = {
        status: state.status,
        pid: state.pid,
        lastError: state.lastError,
        updatedAt: state.updatedAt
      };
    }
    return result;
  }
}

module.exports = new RuntimeManager();
