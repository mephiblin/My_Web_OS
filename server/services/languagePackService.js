const fs = require('fs-extra');
const path = require('path');

const inventoryPaths = require('../utils/inventoryPaths');

const BUILTIN_LANGUAGE_PACKS_DIR = path.resolve(__dirname, '../../client/src/core/i18n/packs');
const LANGUAGE_PACKS_DIR_NAME = 'language-packs';
const LANGUAGE_PACK_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;

function createLanguagePackError(status, code, message, details = null) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.details = details;
  return err;
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function asTrimmedString(value, maxLength = 120) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.slice(0, maxLength);
}

function normalizeLanguageCode(input) {
  const code = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

  if (!code) {
    throw createLanguagePackError(
      400,
      'LANGUAGE_PACK_INVALID_CODE',
      'Language pack code must contain letters, numbers, or hyphen.'
    );
  }

  return code;
}

function normalizeLanguagePackPayload(payload, options = {}) {
  if (!isObject(payload)) {
    throw createLanguagePackError(
      400,
      'LANGUAGE_PACK_INVALID_PAYLOAD',
      'Language pack payload must be a JSON object.'
    );
  }

  const meta = isObject(payload.meta) ? payload.meta : null;
  if (!meta) {
    throw createLanguagePackError(
      400,
      'LANGUAGE_PACK_META_REQUIRED',
      'Language pack meta object is required.'
    );
  }

  const codeSeed = asTrimmedString(meta.code) || asTrimmedString(options.fallbackCode);
  if (!codeSeed) {
    throw createLanguagePackError(
      400,
      'LANGUAGE_PACK_META_CODE_REQUIRED',
      'Language pack meta.code is required.'
    );
  }

  const code = normalizeLanguageCode(codeSeed);
  const name = asTrimmedString(meta.name, 120);
  const nativeName = asTrimmedString(meta.nativeName, 120);

  if (!name) {
    throw createLanguagePackError(
      400,
      'LANGUAGE_PACK_META_NAME_REQUIRED',
      'Language pack meta.name is required.'
    );
  }

  if (!nativeName) {
    throw createLanguagePackError(
      400,
      'LANGUAGE_PACK_META_NATIVE_NAME_REQUIRED',
      'Language pack meta.nativeName is required.'
    );
  }

  if (!isObject(payload.messages)) {
    throw createLanguagePackError(
      400,
      'LANGUAGE_PACK_MESSAGES_REQUIRED',
      'Language pack messages must be an object.'
    );
  }

  return {
    code,
    name,
    nativeName,
    source: options.source || 'uploaded',
    messages: payload.messages,
    raw: {
      meta: {
        code,
        name,
        nativeName
      },
      messages: payload.messages
    }
  };
}

function summarizeLanguagePack(pack) {
  return {
    code: pack.code,
    name: pack.name,
    nativeName: pack.nativeName,
    source: pack.source
  };
}

async function getUploadedLanguagePacksDir() {
  const roots = await inventoryPaths.getRoots();
  const dir = path.join(roots.systemDir, LANGUAGE_PACKS_DIR_NAME);
  await fs.ensureDir(dir);
  return dir;
}

async function listLanguagePacksFromDirectory(dirPath, source) {
  const packs = [];
  if (!(await fs.pathExists(dirPath))) return packs;

  const files = await fs.readdir(dirPath);
  for (const fileName of files) {
    if (!fileName.endsWith('.json')) continue;
    const fullPath = path.join(dirPath, fileName);
    try {
      const payload = await fs.readJson(fullPath);
      const fallbackCode = path.basename(fileName, '.json');
      const pack = normalizeLanguagePackPayload(payload, { source, fallbackCode });
      packs.push(pack);
    } catch (_err) {
      // Ignore malformed language packs to keep listing resilient.
    }
  }
  return packs;
}

async function listBuiltinLanguagePacks() {
  return listLanguagePacksFromDirectory(BUILTIN_LANGUAGE_PACKS_DIR, 'builtin');
}

async function listUploadedLanguagePacks() {
  const uploadedDir = await getUploadedLanguagePacksDir();
  return listLanguagePacksFromDirectory(uploadedDir, 'uploaded');
}

async function listLanguagePacks() {
  const [builtinPacks, uploadedPacks] = await Promise.all([
    listBuiltinLanguagePacks(),
    listUploadedLanguagePacks()
  ]);

  const mergedByCode = new Map();
  for (const pack of builtinPacks) {
    mergedByCode.set(pack.code, summarizeLanguagePack(pack));
  }
  for (const pack of uploadedPacks) {
    mergedByCode.set(pack.code, summarizeLanguagePack(pack));
  }

  return Array.from(mergedByCode.values()).sort((a, b) => a.code.localeCompare(b.code));
}

async function getLanguagePack(codeInput) {
  const targetCode = normalizeLanguageCode(codeInput);

  const uploadedPacks = await listUploadedLanguagePacks();
  const uploaded = uploadedPacks.find((pack) => pack.code === targetCode);
  if (uploaded) {
    return {
      ...summarizeLanguagePack(uploaded),
      messages: uploaded.messages
    };
  }

  const builtinPacks = await listBuiltinLanguagePacks();
  const builtin = builtinPacks.find((pack) => pack.code === targetCode);
  if (builtin) {
    return {
      ...summarizeLanguagePack(builtin),
      messages: builtin.messages
    };
  }

  throw createLanguagePackError(
    404,
    'LANGUAGE_PACK_NOT_FOUND',
    'Language pack was not found.',
    { code: targetCode }
  );
}

async function saveUploadedLanguagePackFromBuffer(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw createLanguagePackError(
      400,
      'LANGUAGE_PACK_UPLOAD_EMPTY',
      'Uploaded language pack file is empty.'
    );
  }

  let payload;
  try {
    payload = JSON.parse(buffer.toString('utf8'));
  } catch (err) {
    throw createLanguagePackError(
      400,
      'LANGUAGE_PACK_UPLOAD_INVALID_JSON',
      'Language pack file must be valid JSON.',
      { reason: err.message }
    );
  }

  const pack = normalizeLanguagePackPayload(payload, { source: 'uploaded' });
  const uploadedDir = await getUploadedLanguagePacksDir();
  const fileName = `${pack.code}.json`;
  const fullPath = path.join(uploadedDir, fileName);

  await fs.writeJson(fullPath, pack.raw, { spaces: 2 });

  return {
    ...summarizeLanguagePack(pack),
    fileName
  };
}

module.exports = {
  LANGUAGE_PACK_UPLOAD_MAX_BYTES,
  createLanguagePackError,
  normalizeLanguageCode,
  listLanguagePacks,
  getLanguagePack,
  saveUploadedLanguagePackFromBuffer
};
