const fs = require('fs-extra');
const path = require('path');

const inventoryPaths = require('../utils/inventoryPaths');

const CATALOG_FILE = 'ecosystem-template-catalog.json';
const BUILTIN_CATALOG_FILE = path.join(__dirname, '../presets', CATALOG_FILE);
const DEFAULT_NAMESPACE = 'official';
const CATALOG_LOAD_ERROR_CODE = 'ECOSYSTEM_TEMPLATE_CATALOG_LOAD_FAILED';

function createCatalogLoadError(message, cause) {
  const err = new Error(message);
  err.code = CATALOG_LOAD_ERROR_CODE;
  if (cause) {
    err.cause = cause;
  }
  return err;
}

function normalizePermissions(value, index, templateId) {
  if (!Array.isArray(value)) {
    throw createCatalogLoadError(
      `Template "${templateId || `index ${index}`}" defaults.permissions must be an array.`
    );
  }

  const permissions = [];
  const seen = new Set();
  for (const permissionValue of value) {
    const permission = String(permissionValue || '').trim();
    if (!permission) {
      throw createCatalogLoadError(
        `Template "${templateId || `index ${index}`}" defaults.permissions contains an empty value.`
      );
    }
    if (seen.has(permission)) continue;
    seen.add(permission);
    permissions.push(permission);
  }
  return permissions;
}

function normalizeTemplate(input, index, namespace) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw createCatalogLoadError(`Template at index ${index} must be an object.`);
  }

  const id = String(input.id || '').trim();
  if (!id) {
    throw createCatalogLoadError(`Template at index ${index} is missing a valid id.`);
  }

  const title = String(input.title || '').trim();
  if (!title) {
    throw createCatalogLoadError(`Template "${id}" is missing a valid title.`);
  }

  const category = String(input.category || '').trim();
  if (!category) {
    throw createCatalogLoadError(`Template "${id}" is missing a valid category.`);
  }

  const description = String(input.description || '').trim();
  if (!description) {
    throw createCatalogLoadError(`Template "${id}" is missing a valid description.`);
  }

  if (!input.defaults || typeof input.defaults !== 'object' || Array.isArray(input.defaults)) {
    throw createCatalogLoadError(`Template "${id}" is missing defaults object.`);
  }

  const runtimeType = String(input.defaults.runtimeType || '').trim();
  const appType = String(input.defaults.appType || '').trim();
  const entry = String(input.defaults.entry || '').trim();
  const uiEntry = String(input.defaults.uiEntry || '').trim();

  if (!runtimeType) {
    throw createCatalogLoadError(`Template "${id}" defaults.runtimeType is required.`);
  }
  if (!appType) {
    throw createCatalogLoadError(`Template "${id}" defaults.appType is required.`);
  }
  if (!entry) {
    throw createCatalogLoadError(`Template "${id}" defaults.entry is required.`);
  }
  if (appType === 'hybrid' && !uiEntry) {
    throw createCatalogLoadError(`Template "${id}" defaults.uiEntry is required for hybrid templates.`);
  }

  return {
    id,
    namespace,
    title,
    category,
    description,
    defaults: {
      runtimeType,
      appType,
      entry,
      ...(uiEntry ? { uiEntry } : {}),
      permissions: normalizePermissions(input.defaults.permissions, index, id)
    }
  };
}

function parseCatalog(payload) {
  if (payload == null) {
    throw createCatalogLoadError('Template catalog payload is required.');
  }

  let version = 1;
  let namespace = DEFAULT_NAMESPACE;
  let templatesInput = payload;

  if (!Array.isArray(payload)) {
    if (!payload || typeof payload !== 'object') {
      throw createCatalogLoadError('Template catalog must be an object or array.');
    }

    const parsedVersion = Number(payload.version ?? 1);
    if (!Number.isInteger(parsedVersion) || parsedVersion <= 0) {
      throw createCatalogLoadError('Template catalog version must be a positive integer.');
    }
    version = parsedVersion;
    namespace = String(payload.namespace || DEFAULT_NAMESPACE).trim() || DEFAULT_NAMESPACE;
    templatesInput = payload.templates;
  }

  if (!Array.isArray(templatesInput)) {
    throw createCatalogLoadError('Template catalog templates must be an array.');
  }

  const templates = [];
  const seen = new Set();

  for (let index = 0; index < templatesInput.length; index += 1) {
    const template = normalizeTemplate(templatesInput[index], index, namespace);
    if (seen.has(template.id)) {
      throw createCatalogLoadError(`Template id "${template.id}" is duplicated in catalog.`);
    }
    seen.add(template.id);
    templates.push(template);
  }

  return {
    version,
    namespace,
    templates
  };
}

async function getRuntimeCatalogPath() {
  const roots = await inventoryPaths.getRoots();
  return path.join(roots.systemDir, CATALOG_FILE);
}

async function resolveCatalogSource() {
  const runtimePath = await getRuntimeCatalogPath();
  if (await fs.pathExists(runtimePath)) {
    return {
      source: 'inventory-override',
      path: runtimePath
    };
  }
  return {
    source: 'builtin-preset',
    path: BUILTIN_CATALOG_FILE
  };
}

async function loadCatalogFromFile(catalogPath) {
  let payload;

  try {
    payload = await fs.readJson(catalogPath);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      throw createCatalogLoadError(`Ecosystem template catalog file not found: ${catalogPath}`);
    }

    throw createCatalogLoadError(`Failed to read ecosystem template catalog: ${catalogPath}`, err);
  }

  const catalog = parseCatalog(payload);
  return {
    ...catalog,
    path: catalogPath
  };
}

async function getCatalog() {
  const sourceMeta = await resolveCatalogSource();
  const catalog = await loadCatalogFromFile(sourceMeta.path);
  return {
    ...catalog,
    source: sourceMeta.source
  };
}

async function listTemplates() {
  const catalog = await getCatalog();
  return catalog.templates;
}

async function getTemplate(templateId) {
  const key = String(templateId || '').trim();
  if (!key) {
    return null;
  }

  const catalog = await getCatalog();
  return catalog.templates.find((template) => template.id === key) || null;
}

module.exports = {
  DEFAULT_NAMESPACE,
  CATALOG_LOAD_ERROR_CODE,
  CATALOG_FILE,
  BUILTIN_CATALOG_FILE,
  loadCatalogFromFile,
  getCatalog,
  listTemplates,
  getTemplate
};
