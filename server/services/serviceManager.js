class ServiceManager {
  constructor() {
    this.services = new Map();
    this.state = new Map();
  }

  register(service) {
    if (!service || typeof service !== 'object') {
      throw new Error('Invalid service object');
    }

    const name = service.name;
    if (!name || typeof name !== 'string') {
      throw new Error('Service must provide a string "name" property');
    }

    if (this.services.has(name)) {
      throw new Error(`Service already registered: ${name}`);
    }

    this.services.set(name, service);
    this.state.set(name, {
      name,
      status: 'stopped',
      startedAt: null,
      uptimeMs: 0,
      lastError: null
    });
  }

  get(name) {
    return this.services.get(name) || null;
  }

  getAllNames() {
    return Array.from(this.services.keys());
  }

  async start(name) {
    const service = this.get(name);
    if (!service) {
      const err = new Error(`Unknown service: ${name}`);
      err.code = 'SERVICE_NOT_FOUND';
      throw err;
    }

    const meta = this.state.get(name);
    if (meta.status === 'running') return this.getStatus(name);

    meta.status = 'starting';
    meta.lastError = null;

    try {
      if (typeof service.init === 'function') {
        await service.init();
      }
      meta.status = 'running';
      meta.startedAt = Date.now();
      meta.uptimeMs = 0;
      return this.getStatus(name);
    } catch (error) {
      meta.status = 'error';
      meta.lastError = error.message || String(error);
      throw error;
    }
  }

  async stop(name) {
    const service = this.get(name);
    if (!service) {
      const err = new Error(`Unknown service: ${name}`);
      err.code = 'SERVICE_NOT_FOUND';
      throw err;
    }

    const meta = this.state.get(name);
    if (meta.status === 'stopped') return this.getStatus(name);

    meta.status = 'stopping';
    try {
      if (typeof service.close === 'function') {
        await service.close();
      }
      meta.status = 'stopped';
      meta.uptimeMs = meta.startedAt ? Date.now() - meta.startedAt : 0;
      meta.startedAt = null;
      return this.getStatus(name);
    } catch (error) {
      meta.status = 'error';
      meta.lastError = error.message || String(error);
      throw error;
    }
  }

  async restart(name) {
    await this.stop(name);
    await this.start(name);
    return this.getStatus(name);
  }

  async startAll() {
    const results = [];
    for (const name of this.getAllNames()) {
      const status = await this.start(name);
      results.push(status);
    }
    return results;
  }

  async stopAll() {
    const names = this.getAllNames().slice().reverse();
    const results = [];
    const errors = [];
    for (const name of names) {
      try {
        const status = await this.stop(name);
        results.push(status);
      } catch (error) {
        errors.push({
          name,
          message: error.message || String(error)
        });
        results.push(this.getStatus(name));
      }
    }

    if (errors.length > 0) {
      const error = new Error(`Failed to stop services: ${errors.map((item) => item.name).join(', ')}`);
      error.code = 'SERVICE_STOP_FAILED';
      error.details = errors;
      error.results = results;
      throw error;
    }

    return results;
  }

  getStatus(name) {
    const meta = this.state.get(name);
    if (!meta) return null;

    const service = this.get(name);
    const serviceStatus = service && typeof service.getStatus === 'function'
      ? service.getStatus()
      : {};

    const uptimeMs = meta.startedAt ? Date.now() - meta.startedAt : meta.uptimeMs;

    return {
      name: meta.name,
      status: meta.status,
      uptimeMs,
      startedAt: meta.startedAt,
      lastError: meta.lastError,
      ...serviceStatus
    };
  }

  getStatusSnapshot() {
    const snapshot = {};
    for (const name of this.getAllNames()) {
      snapshot[name] = this.getStatus(name);
    }
    return snapshot;
  }
}

module.exports = ServiceManager;
