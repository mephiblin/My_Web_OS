#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeRuntimeProfile } = require('../server/services/runtimeProfiles');

const SUPPORTED_RUNTIME_TYPES = new Set(['sandbox-html', 'process-node', 'process-python', 'binary']);
const SUPPORTED_APP_TYPES = new Set(['app', 'widget', 'service', 'hybrid', 'developer']);
const SUPPORTED_APP_MODELS = new Set(['system', 'standard', 'package']);
const BUILTIN_SYSTEM_APP_IDS = new Set([
  'files',
  'terminal',
  'monitor',
  'docker',
  'control-panel',
  'settings',
  'logs',
  'package-center',
  'transfer'
]);
const KNOWN_PERMISSIONS = new Set([
  'app.data.list',
  'app.data.read',
  'app.data.write',
  'ui.notification',
  'window.open',
  'system.info'
]);
const FILE_ASSOC_ACTIONS = new Set(['preview', 'open', 'edit', 'import', 'export']);
const FILE_EXTENSION_RE = /^[a-z0-9][a-z0-9._+-]{0,31}$/i;
const MIME_TYPE_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;

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

function runChecks(manifest) {
  const checks = [];

  const id = String(manifest?.id || '').trim();
  const title = String(manifest?.title || '').trim();
  const appType = String(manifest?.type || '').trim();
  const runtimeProfile = normalizeRuntimeProfile(manifest);
  const runtimeType = String(runtimeProfile?.runtimeType || '').trim();
  const entry = String(runtimeProfile?.entry || manifest?.entry || '').trim();
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

  checks.push(
    SUPPORTED_RUNTIME_TYPES.has(runtimeType)
      ? makeResult('pass', 'manifest.runtime.type', 'Runtime type is supported.', runtimeType)
      : makeResult('fail', 'manifest.runtime.type', 'Runtime type is invalid.', runtimeType || '(empty)')
  );

  const runtimeDeclared = Boolean(
    (typeof manifest?.runtime === 'string' && String(manifest.runtime || '').trim()) ||
    (manifest?.runtime && typeof manifest.runtime === 'object' && String(manifest.runtime.type || '').trim())
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

  if (appType !== 'service') {
    checks.push(
      entry
        ? makeResult('pass', 'manifest.runtime.entry', 'Runtime entry exists.', entry)
        : makeResult('fail', 'manifest.runtime.entry', 'Runtime entry is required for non-service apps.')
    );
  } else {
    checks.push(makeResult('pass', 'manifest.runtime.entry', 'Service app entry rule is acceptable.', entry || '(empty)'));
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

main();
