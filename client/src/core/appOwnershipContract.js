function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

export function normalizeAppModel(app = {}) {
  const rawModel = normalizeText(app?.appModel || app?.model);
  if (rawModel === 'system') return 'system';
  if (rawModel === 'package') return 'package';
  if (rawModel === 'standard' || rawModel === 'app') return 'standard';

  const runtime = normalizeText(app?.runtime || app?.runtimeType);
  const source = normalizeText(app?.source);

  if (source === 'inventory-package' || runtime === 'sandbox') {
    return 'package';
  }
  if (source === 'system-registry' || runtime === 'builtin') {
    return 'system';
  }
  return 'standard';
}

export function deriveOwnerTier(appModelOrApp) {
  const appModel = typeof appModelOrApp === 'string'
    ? normalizeText(appModelOrApp)
    : normalizeAppModel(appModelOrApp);

  if (appModel === 'system') return 'core-system';
  if (appModel === 'package') return 'package-addon';
  return 'core-addon';
}

export function normalizeLaunchContract(app = {}) {
  const launch = app?.launch && typeof app.launch === 'object' ? app.launch : null;
  const mode = normalizeText(launch?.mode);
  const runtime = normalizeText(app?.runtime || app?.runtimeType);
  const source = normalizeText(app?.source);
  const singleton = launch?.singleton === true || app?.singleton === true;

  if (mode === 'component') {
    return {
      mode: 'component',
      componentId: String(launch?.componentId || app?.id || '').trim(),
      singleton
    };
  }

  if (mode === 'sandbox' || runtime === 'sandbox' || source === 'inventory-package') {
    return {
      mode: 'sandbox',
      componentId: null,
      singleton,
      entryUrl: String(launch?.entryUrl || app?.sandbox?.entryUrl || '').trim()
    };
  }

  return {
    mode: 'component',
    componentId: String(app?.id || '').trim(),
    singleton
  };
}

export function normalizeDataBoundary(app = {}, launchOrOwner = null, maybeOwner = null) {
  const launch = launchOrOwner && typeof launchOrOwner === 'object' && !Array.isArray(launchOrOwner)
    ? launchOrOwner
    : normalizeLaunchContract(app);
  const ownerTier = typeof launchOrOwner === 'string'
    ? deriveOwnerTier(launchOrOwner)
    : deriveOwnerTier(maybeOwner || app);
  const source = normalizeText(app?.source);

  if (launch.mode === 'sandbox' || ownerTier === 'package-addon' || source === 'inventory-package') {
    return 'inventory-app-data';
  }
  if (launch.mode === 'component') {
    return 'host-shared';
  }
  return 'none';
}
