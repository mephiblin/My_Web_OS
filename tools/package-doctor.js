#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const builtinAppsSeed = require('../server/config/builtinAppsSeed');
const { CAPABILITY_CATALOG } = require('../server/services/capabilityCatalog');
const { isManagedRuntime, normalizeRuntimeProfile } = require('../server/services/runtimeProfiles');

const SUPPORTED_RUNTIME_TYPES = new Set(['sandbox-html', 'process-node', 'process-python', 'binary']);
const SUPPORTED_APP_TYPES = new Set(['app', 'widget', 'service', 'hybrid', 'developer']);
const SUPPORTED_APP_MODELS = new Set(['system', 'standard', 'package']);
function collectBuiltinSystemAppIds(seed = builtinAppsSeed) {
  return new Set((Array.isArray(seed) ? seed : [])
    .filter((app) => {
      const appModel = String(app?.appModel || '').trim().toLowerCase();
      const type = String(app?.type || app?.appType || app?.kind || '').trim().toLowerCase();
      return appModel === 'system' || type === 'system' || type === 'core' || type === 'host';
    })
    .map((app) => String(app?.id || '').trim())
    .filter(Boolean));
}

const BUILTIN_SYSTEM_APP_IDS = collectBuiltinSystemAppIds();
const KNOWN_PERMISSIONS = new Set(CAPABILITY_CATALOG.map((item) => item.id));
const FILE_ASSOC_ACTIONS = new Set(['preview', 'open', 'edit', 'import', 'export']);
const FILE_EXTENSION_RE = /^[a-z0-9][a-z0-9._+-]{0,31}$/i;
const MIME_TYPE_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;
const CONTRIBUTION_ID_RE = /^[a-z0-9][a-z0-9._:-]{0,63}$/i;
const CONTRIBUTION_LABEL_MAX = 80;
const FILE_TEMPLATE_NAME_MAX = 128;
const FILE_TEMPLATE_CONTENT_MAX = 64 * 1024;
const RELATIVE_ENTRY_MAX = 180;
const HOST_FILE_READ_PERMISSION = 'host.file.read';

function readArgs(argv) {
  const args = {
    manifest: '',
    builtinRegistry: '',
    json: false,
    help: false
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim();
    if (!token) continue;
    if (token === '--json') {
      args.json = true;
      continue;
    }
    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }
    if (token.startsWith('--manifest=')) {
      args.manifest = token.slice('--manifest='.length);
      continue;
    }
    if (token.startsWith('--builtin-registry=')) {
      args.builtinRegistry = token.slice('--builtin-registry='.length);
      continue;
    }
    if (!args.manifest) {
      args.manifest = token;
    }
  }

  return args;
}

function makeResult(status, id, message, detail = '') {
  return { status, id, message, detail };
}

function validateFileContextMenuContributions(checks, manifest, fileAssociations) {
  const contributes = manifest?.contributes;
  if (contributes === undefined || contributes === null) return;
  if (!contributes || typeof contributes !== 'object' || Array.isArray(contributes)) {
    checks.push(makeResult('fail', 'manifest.contributes', 'contributes must be an object.'));
    return;
  }

  const rows = contributes.fileContextMenu;
  if (rows === undefined || rows === null) return;
  if (!Array.isArray(rows)) {
    checks.push(makeResult('fail', 'manifest.contributes.fileContextMenu', 'fileContextMenu must be an array.'));
    return;
  }

  const associationExtensionsByAction = new Map();
  for (const row of Array.isArray(fileAssociations) ? fileAssociations : []) {
    const actions = Array.isArray(row?.actions) && row.actions.length > 0
      ? row.actions
      : [row?.defaultAction || 'open'];
    for (const rawAction of actions) {
      const action = String(rawAction || '').trim().toLowerCase();
      if (!FILE_ASSOC_ACTIONS.has(action)) continue;
      if (!associationExtensionsByAction.has(action)) {
        associationExtensionsByAction.set(action, new Set());
      }
      for (const rawExt of Array.isArray(row?.extensions) ? row.extensions : []) {
        const ext = String(rawExt || '').trim().toLowerCase().replace(/^\./, '');
        if (ext) associationExtensionsByAction.get(action).add(ext);
      }
    }
  }

  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      checks.push(makeResult('fail', `manifest.contributes.fileContextMenu[${index}]`, 'Contribution entry must be an object.'));
      return;
    }

    const label = String(row.label || '').trim();
    if (!label) {
      checks.push(makeResult('fail', `manifest.contributes.fileContextMenu[${index}].label`, 'Contribution label is required.'));
    } else if (label.length > 80) {
      checks.push(makeResult('fail', `manifest.contributes.fileContextMenu[${index}].label`, 'Contribution label is too long.', label));
    }

    const action = String(row.action || row.defaultAction || 'open').trim().toLowerCase();
    if (!FILE_ASSOC_ACTIONS.has(action)) {
      checks.push(makeResult('fail', `manifest.contributes.fileContextMenu[${index}].action`, 'Unsupported contribution action.', action));
    }

    if (row.extensions !== undefined && row.extensions !== null && !Array.isArray(row.extensions)) {
      checks.push(makeResult('fail', `manifest.contributes.fileContextMenu[${index}].extensions`, 'Extensions must be an array when provided.'));
    }

    const extensions = Array.isArray(row.extensions) ? row.extensions : [];
    extensions.forEach((rawExt) => {
      const ext = String(rawExt || '').trim().replace(/^\./, '');
      if (!FILE_EXTENSION_RE.test(ext)) {
        checks.push(
          makeResult(
            'fail',
            `manifest.contributes.fileContextMenu[${index}].extensions`,
            'Invalid extension value.',
            String(rawExt || '')
          )
        );
      }
    });

    const hasExplicitExtensions = extensions.length > 0;
    const hasAssociationExtensions = (associationExtensionsByAction.get(action)?.size || 0) > 0;
    if (!hasExplicitExtensions && !hasAssociationExtensions) {
      checks.push(
        makeResult(
          'fail',
          `manifest.contributes.fileContextMenu[${index}].extensions`,
          'Contribution needs extensions or a matching fileAssociations action.',
          action
        )
      );
    }
  });
}

function validateContributionLabel(checks, id, label) {
  const normalized = String(label || '').trim();
  if (!normalized) {
    checks.push(makeResult('fail', `${id}.label`, 'Contribution label is required.'));
  } else if (normalized.length > CONTRIBUTION_LABEL_MAX) {
    checks.push(makeResult('fail', `${id}.label`, 'Contribution label is too long.', normalized));
  }
}

function validateContributionExtensions(checks, id, extensions) {
  if (extensions !== undefined && extensions !== null && !Array.isArray(extensions)) {
    checks.push(makeResult('fail', `${id}.extensions`, 'Extensions must be an array when provided.'));
    return false;
  }
  if (!Array.isArray(extensions)) return false;
  extensions.forEach((rawExt) => {
    const ext = String(rawExt || '').trim().replace(/^\./, '');
    if (!FILE_EXTENSION_RE.test(ext)) {
      checks.push(makeResult('fail', `${id}.extensions`, 'Invalid extension value.', String(rawExt || '')));
    }
  });
  return extensions.length > 0;
}

function associationHasExtensions(fileAssociations, actions = []) {
  const actionSet = new Set(actions.map((action) => String(action || '').trim().toLowerCase()).filter(Boolean));
  return (Array.isArray(fileAssociations) ? fileAssociations : []).some((row) => {
    const extensions = Array.isArray(row?.extensions) ? row.extensions : [];
    if (extensions.length === 0) return false;
    if (actionSet.size === 0) return true;
    const rowActions = Array.isArray(row?.actions) && row.actions.length > 0 ? row.actions : [row?.defaultAction || 'open'];
    return rowActions.some((action) => actionSet.has(String(action || '').trim().toLowerCase()));
  });
}

function validateSafeRelativeEntry(checks, id, value) {
  const entry = String(value || '').trim().replace(/^[/\\]+/, '');
  const invalid =
    !entry ||
    entry.length > RELATIVE_ENTRY_MAX ||
    entry.includes('\0') ||
    entry.split(/[\\/]+/).includes('..') ||
    /^[a-z][a-z0-9+.-]*:/i.test(entry);
  if (invalid) {
    checks.push(makeResult('fail', id, 'Entry must be a safe relative path.', String(value || '')));
  }
}

function validateFileCreateTemplateContributions(checks, manifest) {
  const rows = manifest?.contributes?.fileCreateTemplates;
  if (rows === undefined || rows === null) return;
  if (!Array.isArray(rows)) {
    checks.push(makeResult('fail', 'manifest.contributes.fileCreateTemplates', 'fileCreateTemplates must be an array.'));
    return;
  }

  rows.forEach((row, index) => {
    const id = `manifest.contributes.fileCreateTemplates[${index}]`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      checks.push(makeResult('fail', id, 'Contribution entry must be an object.'));
      return;
    }
    validateContributionLabel(checks, id, row.label);

    const name = String(row.name || row.defaultName || '').trim();
    if (!name || name.length > FILE_TEMPLATE_NAME_MAX || name.includes('\0') || name.includes('/') || name.includes('\\')) {
      checks.push(makeResult('fail', `${id}.name`, 'Template name must be a safe file name.', name));
    }

    const extension = String(row.extension || (name.includes('.') ? name.split('.').pop() : '') || '').trim().replace(/^\./, '');
    if (!FILE_EXTENSION_RE.test(extension)) {
      checks.push(makeResult('fail', `${id}.extension`, 'Template needs a valid extension or file name extension.', extension));
    }

    const action = String(row.action || 'edit').trim().toLowerCase();
    if (!FILE_ASSOC_ACTIONS.has(action)) {
      checks.push(makeResult('fail', `${id}.action`, 'Unsupported template action.', action));
    }

    if (row.content !== undefined && typeof row.content !== 'string') {
      checks.push(makeResult('fail', `${id}.content`, 'Template content must be a string.'));
    } else if (typeof row.content === 'string' && row.content.length > FILE_TEMPLATE_CONTENT_MAX) {
      checks.push(makeResult('fail', `${id}.content`, 'Template content is too large.'));
    }

    if (row.openAfterCreate !== undefined && typeof row.openAfterCreate !== 'boolean') {
      checks.push(makeResult('fail', `${id}.openAfterCreate`, 'openAfterCreate must be a boolean when provided.'));
    }
  });
}

function validateFileProviderContributions(checks, manifest, fileAssociations, keyName) {
  const rows = manifest?.contributes?.[keyName];
  if (rows === undefined || rows === null) return;
  if (!Array.isArray(rows)) {
    checks.push(makeResult('fail', `manifest.contributes.${keyName}`, `${keyName} must be an array.`));
    return;
  }

  const permissions = new Set(Array.isArray(manifest?.permissions) ? manifest.permissions.map(String) : []);
  if ((keyName === 'previewProviders' || keyName === 'thumbnailProviders') && rows.length > 0 && !permissions.has(HOST_FILE_READ_PERMISSION)) {
    checks.push(
      makeResult(
        'fail',
        'manifest.permissions',
        `${keyName} requires ${HOST_FILE_READ_PERMISSION}.`,
        HOST_FILE_READ_PERMISSION
      )
    );
  }

  const hasInferableExtensions = associationHasExtensions(fileAssociations, ['preview', 'open']);
  rows.forEach((row, index) => {
    const id = `manifest.contributes.${keyName}[${index}]`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      checks.push(makeResult('fail', id, 'Contribution entry must be an object.'));
      return;
    }
    validateContributionLabel(checks, id, row.label);
    const hasExtensions = validateContributionExtensions(checks, id, row.extensions);
    if (!hasExtensions && !hasInferableExtensions) {
      checks.push(makeResult('fail', `${id}.extensions`, 'Provider needs extensions or matching fileAssociations.'));
    }
  });
}

function validateSettingsPanelContributions(checks, manifest) {
  const rows = manifest?.contributes?.settingsPanels;
  if (rows === undefined || rows === null) return;
  if (!Array.isArray(rows)) {
    checks.push(makeResult('fail', 'manifest.contributes.settingsPanels', 'settingsPanels must be an array.'));
    return;
  }

  rows.forEach((row, index) => {
    const id = `manifest.contributes.settingsPanels[${index}]`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      checks.push(makeResult('fail', id, 'Contribution entry must be an object.'));
      return;
    }
    validateContributionLabel(checks, id, row.label);
    validateSafeRelativeEntry(checks, `${id}.entry`, row.entry || row.path || 'index.html');
  });
}

function validateBackgroundServiceContributions(checks, manifest) {
  const rows = manifest?.contributes?.backgroundServices;
  if (rows === undefined || rows === null) return;
  if (!Array.isArray(rows)) {
    checks.push(makeResult('fail', 'manifest.contributes.backgroundServices', 'backgroundServices must be an array.'));
    return;
  }

  rows.forEach((row, index) => {
    const id = `manifest.contributes.backgroundServices[${index}]`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      checks.push(makeResult('fail', id, 'Contribution entry must be an object.'));
      return;
    }
    const serviceId = String(row.id || '').trim();
    if (!CONTRIBUTION_ID_RE.test(serviceId)) {
      checks.push(makeResult('fail', `${id}.id`, 'Background service id is invalid.', serviceId));
    }
    validateContributionLabel(checks, id, row.label || serviceId);
    validateSafeRelativeEntry(checks, `${id}.entry`, row.entry);
    if (row.autoStart === true) {
      checks.push(
        makeResult(
          'warn',
          `${id}.autoStart`,
          'Background service autoStart is policy-gated and will not execute automatically yet.',
          serviceId
        )
      );
    } else if (row.autoStart !== undefined && typeof row.autoStart !== 'boolean') {
      checks.push(makeResult('fail', `${id}.autoStart`, 'autoStart must be a boolean when provided.'));
    }
  });
}

function validateWidgetContributions(checks, manifest) {
  const rows = manifest?.contributes?.widgets;
  if (rows === undefined || rows === null) return;
  if (!Array.isArray(rows)) {
    checks.push(makeResult('fail', 'manifest.contributes.widgets', 'widgets must be an array.'));
    return;
  }

  rows.forEach((row, index) => {
    const id = `manifest.contributes.widgets[${index}]`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      checks.push(makeResult('fail', id, 'Widget contribution must be an object.'));
      return;
    }
    const widgetId = String(row.id || '').trim();
    if (!CONTRIBUTION_ID_RE.test(widgetId)) {
      checks.push(makeResult('fail', `${id}.id`, 'Widget id is invalid.', widgetId));
    }
    validateContributionLabel(checks, id, row.label || row.title || widgetId);
    validateSafeRelativeEntry(checks, `${id}.entry`, row.entry || row.path);

    for (const field of ['defaultSize', 'minSize']) {
      if (row[field] === undefined || row[field] === null) continue;
      if (!row[field] || typeof row[field] !== 'object' || Array.isArray(row[field])) {
        checks.push(makeResult('fail', `${id}.${field}`, `${field} must be an object.`));
        continue;
      }
      const width = Number(row[field].w ?? row[field].width);
      const height = Number(row[field].h ?? row[field].height);
      if (!Number.isFinite(width) || width < 120) {
        checks.push(makeResult('fail', `${id}.${field}.w`, `${field} width must be at least 120.`));
      }
      if (!Number.isFinite(height) || height < 80) {
        checks.push(makeResult('fail', `${id}.${field}.h`, `${field} height must be at least 80.`));
      }
    }
  });
}

function getDeclaredRuntimeType(manifest) {
  if (typeof manifest?.runtime === 'string') {
    return String(manifest.runtime || '').trim().toLowerCase();
  }
  if (manifest?.runtime && typeof manifest.runtime === 'object') {
    return String(manifest.runtime.type || manifest.runtime.runtimeType || '').trim().toLowerCase();
  }
  return '';
}

function runChecks(manifest) {
  const checks = [];

  const id = String(manifest?.id || '').trim();
  const title = String(manifest?.title || '').trim();
  const appType = String(manifest?.type || '').trim();
  const runtimeProfile = normalizeRuntimeProfile(manifest);
  const runtimeType = String(runtimeProfile?.runtimeType || '').trim();
  const declaredRuntimeType = getDeclaredRuntimeType(manifest);
  const entry = String(runtimeProfile?.entry || manifest?.entry || '').trim();
  const uiEntry = String(runtimeProfile?.ui?.entry || manifest?.ui?.entry || '').trim();
  const runtimeCommand = String(runtimeProfile?.command || manifest?.runtime?.command || '').trim();
  const permissions = Array.isArray(manifest?.permissions) ? manifest.permissions.map(String) : [];
  const fileAssociations = manifest?.fileAssociations;

  checks.push(
    id
      ? makeResult('pass', 'manifest.id', 'Package id exists.', id)
      : makeResult('fail', 'manifest.id', 'Package id is required.')
  );

  checks.push(
    title
      ? makeResult('pass', 'manifest.title', 'Package title exists.', title)
      : makeResult('fail', 'manifest.title', 'Package title is required.')
  );

  checks.push(
    SUPPORTED_APP_TYPES.has(appType)
      ? makeResult('pass', 'manifest.type', 'App type is supported.', appType)
      : makeResult('fail', 'manifest.type', 'App type is invalid.', appType || '(empty)')
  );

  const runtimeDeclared = Boolean(
    (typeof manifest?.runtime === 'string' && String(manifest.runtime || '').trim()) ||
    (manifest?.runtime && typeof manifest.runtime === 'object' && String(manifest.runtime.type || manifest.runtime.runtimeType || '').trim())
  );
  const runtimeTypeForValidation = declaredRuntimeType || runtimeType;
  checks.push(
    SUPPORTED_RUNTIME_TYPES.has(runtimeTypeForValidation)
      ? makeResult('pass', 'manifest.runtime.type', 'Runtime type is supported.', runtimeTypeForValidation)
      : makeResult('fail', 'manifest.runtime.type', 'Runtime type is invalid.', runtimeTypeForValidation || '(empty)')
  );
  if (!runtimeDeclared) {
    checks.push(
      makeResult(
        'warn',
        'manifest.runtime.type',
        'Runtime type is omitted and defaults to sandbox-html. Consider declaring it explicitly.',
        runtimeType || 'sandbox-html'
      )
    );
  }

  if (appType === 'hybrid') {
    if (!isManagedRuntime(runtimeProfile)) {
      checks.push(
        makeResult(
          'fail',
          'manifest.runtime.type',
          'Hybrid package runtime must be process-node, process-python, or binary.',
          runtimeTypeForValidation || '(empty)'
        )
      );
    }
    checks.push(
      entry || runtimeCommand
        ? makeResult('pass', 'manifest.runtime.entry', 'Hybrid service runtime entry or command exists.', entry || runtimeCommand)
        : makeResult('fail', 'manifest.runtime.entry', 'Hybrid package requires a service runtime entry or command.')
    );
    checks.push(
      uiEntry
        ? makeResult('pass', 'manifest.ui.entry', 'Hybrid sandbox UI entry exists.', uiEntry)
        : makeResult('fail', 'manifest.ui.entry', 'Hybrid package requires ui.entry.')
    );
    if (runtimeProfile?.ui?.runtimeType !== 'sandbox-html') {
      checks.push(makeResult('fail', 'manifest.ui.type', 'Hybrid UI must use sandbox-html.', runtimeProfile?.ui?.runtimeType || '(empty)'));
    }
  } else if (appType === 'service') {
    if (!isManagedRuntime(runtimeProfile)) {
      checks.push(
        makeResult(
          'fail',
          'manifest.runtime.type',
          'Service package runtime must be process-node, process-python, or binary.',
          runtimeTypeForValidation || '(empty)'
        )
      );
    }
    checks.push(
      entry || runtimeCommand
        ? makeResult('pass', 'manifest.runtime.entry', 'Service runtime entry or command exists.', entry || runtimeCommand)
        : makeResult('fail', 'manifest.runtime.entry', 'Service package requires a runtime entry or command.')
    );
  } else {
    checks.push(
      entry
        ? makeResult('pass', 'manifest.runtime.entry', 'Runtime entry exists.', entry)
        : makeResult('fail', 'manifest.runtime.entry', 'Runtime entry is required for non-service apps.')
    );
  }

  for (const permission of permissions) {
    if (!KNOWN_PERMISSIONS.has(permission)) {
      checks.push(
        makeResult('warn', `permissions.${permission}`, 'Permission is not in known capability catalog.', permission)
      );
    }
  }

  if (permissions.length === 0) {
    checks.push(makeResult('warn', 'permissions', 'No permissions declared. Confirm this is intentional.'));
  }
  if ((appType === 'service' || appType === 'hybrid') && !permissions.includes('runtime.process')) {
    checks.push(makeResult('fail', 'permissions.runtime.process', 'Managed tool packages must declare runtime.process.'));
  }
  if (appType === 'hybrid' && !permissions.includes('service.bridge')) {
    checks.push(makeResult('fail', 'permissions.service.bridge', 'Hybrid UI must declare service.bridge to call its paired service.'));
  }

  if (fileAssociations === undefined || fileAssociations === null) {
    checks.push(makeResult('warn', 'manifest.fileAssociations', 'No file associations declared.'));
  } else if (!Array.isArray(fileAssociations)) {
    checks.push(makeResult('fail', 'manifest.fileAssociations', 'fileAssociations must be an array.'));
  } else {
    fileAssociations.forEach((row, index) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        checks.push(makeResult('fail', `manifest.fileAssociations[${index}]`, 'Association entry must be an object.'));
        return;
      }

      const extensions = Array.isArray(row.extensions) ? row.extensions : [];
      const mimeTypes = Array.isArray(row.mimeTypes) ? row.mimeTypes : [];
      if (extensions.length === 0 && mimeTypes.length === 0) {
        checks.push(
          makeResult(
            'fail',
            `manifest.fileAssociations[${index}]`,
            'Association must include at least one extension or mime type.'
          )
        );
      }

      extensions.forEach((rawExt) => {
        const ext = String(rawExt || '').trim().replace(/^\./, '');
        if (!FILE_EXTENSION_RE.test(ext)) {
          checks.push(
            makeResult(
              'fail',
              `manifest.fileAssociations[${index}].extensions`,
              'Invalid extension value.',
              String(rawExt || '')
            )
          );
        }
      });

      mimeTypes.forEach((rawMime) => {
        const mime = String(rawMime || '').trim().toLowerCase();
        if (!MIME_TYPE_RE.test(mime)) {
          checks.push(
            makeResult(
              'fail',
              `manifest.fileAssociations[${index}].mimeTypes`,
              'Invalid mime type value.',
              String(rawMime || '')
            )
          );
        }
      });

      const actions = Array.isArray(row.actions) ? row.actions.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean) : [];
      if (actions.length === 0) {
        checks.push(makeResult('warn', `manifest.fileAssociations[${index}].actions`, 'Actions are empty. defaultAction will be used.'));
      }
      actions.forEach((action) => {
        if (!FILE_ASSOC_ACTIONS.has(action)) {
          checks.push(
            makeResult('fail', `manifest.fileAssociations[${index}].actions`, 'Unsupported action.', action)
          );
        }
      });

      if (row.defaultAction) {
        const defaultAction = String(row.defaultAction || '').trim().toLowerCase();
        if (!FILE_ASSOC_ACTIONS.has(defaultAction)) {
          checks.push(
            makeResult('fail', `manifest.fileAssociations[${index}].defaultAction`, 'Invalid defaultAction.', defaultAction)
          );
        } else if (actions.length > 0 && !actions.includes(defaultAction)) {
          checks.push(
            makeResult(
              'fail',
              `manifest.fileAssociations[${index}].defaultAction`,
              'defaultAction must exist in actions.',
              defaultAction
            )
          );
        }
      }
    });
  }

  validateFileContextMenuContributions(checks, manifest, fileAssociations);
  validateFileCreateTemplateContributions(checks, manifest);
  validateFileProviderContributions(checks, manifest, fileAssociations, 'previewProviders');
  validateFileProviderContributions(checks, manifest, fileAssociations, 'thumbnailProviders');
  validateSettingsPanelContributions(checks, manifest);
  validateBackgroundServiceContributions(checks, manifest);
  validateWidgetContributions(checks, manifest);

  const failCount = checks.filter((item) => item.status === 'fail').length;
  const warnCount = checks.filter((item) => item.status === 'warn').length;
  const status = failCount > 0 ? 'fail' : (warnCount > 0 ? 'warn' : 'pass');

  return { status, failCount, warnCount, checks };
}

function runBuiltinRegistryChecks(registry) {
  const checks = [];
  const apps = Array.isArray(registry) ? registry : [];
  const seenIds = new Set();

  checks.push(
    Array.isArray(registry)
      ? makeResult('pass', 'builtin.registry.shape', 'Built-in registry is an array.', String(apps.length))
      : makeResult('fail', 'builtin.registry.shape', 'Built-in registry must be a JSON array.')
  );

  for (const app of apps) {
    const appId = String(app?.id || '').trim();
    const appLabel = appId || '(missing-id)';
    const title = String(app?.title || '').trim();
    const appModel = String(app?.appModel || '').trim().toLowerCase();
    const entry = String(app?.entry || '').trim();
    const runtime = String(app?.runtime || '').trim().toLowerCase();
    const version = String(app?.version || '').trim();
    const fileAssociations = app?.fileAssociations;

    if (!appId) {
      checks.push(makeResult('fail', `builtin.${appLabel}.id`, 'App id is required.'));
      continue;
    }
    if (seenIds.has(appId)) {
      checks.push(makeResult('fail', `builtin.${appId}.id`, 'Duplicate app id found.', appId));
    } else {
      seenIds.add(appId);
      checks.push(makeResult('pass', `builtin.${appId}.id`, 'App id is unique.', appId));
    }

    checks.push(
      title
        ? makeResult('pass', `builtin.${appId}.title`, 'App title exists.', title)
        : makeResult('fail', `builtin.${appId}.title`, 'App title is required.')
    );

    checks.push(
      SUPPORTED_APP_MODELS.has(appModel)
        ? makeResult('pass', `builtin.${appId}.appModel`, 'App model is valid.', appModel)
        : makeResult('fail', `builtin.${appId}.appModel`, 'App model must be one of system|standard|package.', appModel || '(empty)')
    );

    checks.push(
      runtime === 'builtin'
        ? makeResult('pass', `builtin.${appId}.runtime`, 'Runtime is builtin for built-in registry.', runtime)
        : makeResult('warn', `builtin.${appId}.runtime`, 'Built-in app runtime should be "builtin".', runtime || '(empty)')
    );

    if (appModel === 'standard') {
      checks.push(
        version
          ? makeResult('pass', `builtin.${appId}.version`, 'Standard app version exists.', version)
          : makeResult('fail', `builtin.${appId}.version`, 'Standard app version is required.')
      );
      checks.push(
        entry
          ? makeResult('pass', `builtin.${appId}.entry`, 'Standard app entry exists.', entry)
          : makeResult('fail', `builtin.${appId}.entry`, 'Standard app entry is required.')
      );
    } else {
      if (!version) {
        checks.push(makeResult('warn', `builtin.${appId}.version`, 'Version is recommended.', '(empty)'));
      }
      if (!entry) {
        checks.push(makeResult('warn', `builtin.${appId}.entry`, 'Entry is recommended.', '(empty)'));
      }
    }

    if (fileAssociations !== undefined && fileAssociations !== null && !Array.isArray(fileAssociations)) {
      checks.push(
        makeResult('fail', `builtin.${appId}.fileAssociations`, 'fileAssociations must be an array when provided.')
      );
    } else if (Array.isArray(fileAssociations)) {
      checks.push(
        makeResult(
          'pass',
          `builtin.${appId}.fileAssociations`,
          'fileAssociations shape is array.',
          String(fileAssociations.length)
        )
      );
    } else if (appModel === 'system') {
      checks.push(
        makeResult('pass', `builtin.${appId}.fileAssociations`, 'System app does not declare file associations.', 'none')
      );
    } else {
      checks.push(
        makeResult('warn', `builtin.${appId}.fileAssociations`, 'No file associations declared.')
      );
    }

    if (appModel === 'system' && !BUILTIN_SYSTEM_APP_IDS.has(appId)) {
      checks.push(
        makeResult('warn', `builtin.${appId}.system-allowlist`, 'System model app is not in builtin system allowlist.', appId)
      );
    }
    if (appModel === 'standard' && BUILTIN_SYSTEM_APP_IDS.has(appId)) {
      checks.push(
        makeResult('fail', `builtin.${appId}.system-allowlist`, 'System allowlist app cannot be marked as standard.', appId)
      );
    }
  }

  const failCount = checks.filter((item) => item.status === 'fail').length;
  const warnCount = checks.filter((item) => item.status === 'warn').length;
  const status = failCount > 0 ? 'fail' : (warnCount > 0 ? 'warn' : 'pass');

  return { status, failCount, warnCount, checks };
}

function printTextReport(report, manifestPath) {
  const icon = report.status === 'pass' ? 'PASS' : report.status === 'warn' ? 'WARN' : 'FAIL';
  console.log(`[package-doctor] ${icon} ${manifestPath}`);
  for (const check of report.checks) {
    const head = `[${String(check.status || 'info').toUpperCase()}] ${check.id}: ${check.message}`;
    if (check.detail) {
      console.log(`${head} (${check.detail})`);
    } else {
      console.log(head);
    }
  }
  console.log(`[summary] fails=${report.failCount} warns=${report.warnCount}`);
}

function main() {
  const args = readArgs(process.argv);
  if (args.help) {
    console.log('Usage: node tools/package-doctor.js [--json] [--manifest=<path>] [--builtin-registry=<path>] <manifest-path>');
    console.log('Example: npm run package:doctor -- server/storage/inventory/apps/hello-sandbox/manifest.json');
    console.log('Example: npm run package:doctor -- --builtin-registry=server/storage/inventory/system/apps.json');
    return;
  }

  const hasBuiltinMode = Boolean(String(args.builtinRegistry || '').trim());
  const targetPath = hasBuiltinMode
    ? path.resolve(process.cwd(), args.builtinRegistry)
    : (args.manifest
      ? path.resolve(process.cwd(), args.manifest)
      : path.resolve(process.cwd(), 'server/storage/inventory/apps/example/manifest.json'));

  if (!fs.existsSync(targetPath)) {
    console.error(`[package-doctor] FAIL File not found: ${targetPath}`);
    process.exitCode = 1;
    return;
  }

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  } catch (err) {
    console.error(`[package-doctor] FAIL Invalid JSON: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const report = hasBuiltinMode ? runBuiltinRegistryChecks(payload) : runChecks(payload);
  if (args.json) {
    console.log(JSON.stringify({ targetPath, mode: hasBuiltinMode ? 'builtin-registry' : 'manifest', ...report }, null, 2));
  } else {
    printTextReport(report, targetPath);
  }

  if (report.status === 'fail') {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  collectBuiltinSystemAppIds,
  runChecks,
  runBuiltinRegistryChecks
};
