import { derived, get, writable } from 'svelte/store';
import { systemSettings } from '../stores/systemStore.js';
import { apiFetch } from '../../utils/api.js';

const builtinPackModules = import.meta.glob('./packs/*.json', { eager: true });
const APP_TITLE_KEY_BY_ID = {
  files: 'app.title.files',
  terminal: 'app.title.terminal',
  monitor: 'app.title.monitor',
  docker: 'app.title.docker',
  settings: 'app.title.settings',
  'control-panel': 'app.title.control-panel',
  logs: 'app.title.logs',
  'package-center': 'app.title.package-center',
  transfer: 'app.title.transfer',
  'download-station': 'app.title.download-station',
  'photo-station': 'app.title.photo-station',
  'music-station': 'app.title.music-station',
  'document-station': 'app.title.document-station',
  'video-station': 'app.title.video-station',
  player: 'app.title.player',
  editor: 'app.title.editor',
  'doc-viewer': 'app.title.doc-viewer',
  'model-viewer': 'app.title.model-viewer',
  'widget-store': 'app.title.widget-store'
};

function toObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function toText(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function normalizePackMeta(rawPack, fallbackCode = '') {
  const source = toObject(rawPack);
  const code = toText(source.code || source.locale || source.id, fallbackCode).toLowerCase();
  if (!code) return null;
  const name = toText(source.name || source.label, code.toUpperCase());
  const nativeName = toText(source.nativeName || source.displayName, name);
  return { code, name, nativeName };
}

function loadBuiltinPacks() {
  const entries = Object.entries(builtinPackModules)
    .map(([path, moduleValue]) => {
      const payload = toObject(moduleValue?.default || moduleValue);
      const fileCode = String(path.split('/').pop() || '').replace(/\.json$/i, '').toLowerCase();
      const code = toText(payload?.meta?.code, fileCode) || 'en';
      const name = toText(payload?.meta?.name, code.toUpperCase());
      const nativeName = toText(payload?.meta?.nativeName, name);
      const messages = toObject(payload?.messages || payload);
      return { code, name, nativeName, messages };
    })
    .filter((entry) => entry.code);

  if (entries.length === 0) {
    return {
      en: { code: 'en', name: 'English', nativeName: 'English', messages: {} }
    };
  }

  const byCode = Object.fromEntries(entries.map((entry) => [entry.code, entry]));
  if (!byCode.en) {
    const first = entries[0];
    byCode.en = { ...first, code: 'en' };
  }
  return byCode;
}

const BUILTIN_PACKS = loadBuiltinPacks();
const FALLBACK_LOCALE = 'en';
const FALLBACK_MESSAGES = BUILTIN_PACKS[FALLBACK_LOCALE]?.messages || {};
const runtimePackMeta = writable([]);
const runtimePackMessages = writable({});
const activeMessages = writable({ ...FALLBACK_MESSAGES });
let activeMessageSyncToken = 0;
const pendingMessageLoads = new Map();

function lookupMessage(messages, key) {
  if (!key) return '';
  const direct = messages[key];
  if (typeof direct === 'string') return direct;
  const nested = String(key).split('.').reduce((acc, part) => (
    acc && typeof acc === 'object' ? acc[part] : undefined
  ), messages);
  return typeof nested === 'string' ? nested : '';
}

function interpolate(text, params = {}) {
  return String(text).replace(/\{([a-zA-Z0-9_]+)\}/g, (_full, token) => {
    const value = params[token];
    return value === undefined || value === null ? '' : String(value);
  });
}

export function normalizeLanguageCode(value) {
  const code = String(value || '').trim().toLowerCase();
  if (!code) return FALLBACK_LOCALE;
  if (BUILTIN_PACKS[code]) return code;
  const discoveredCodes = new Set(get(runtimePackMeta).map((pack) => pack.code));
  return discoveredCodes.has(code) ? code : FALLBACK_LOCALE;
}

function createTranslator(messages) {
  return (key, params = {}, fallback = key) => {
    const template = lookupMessage(messages || FALLBACK_MESSAGES, key) || fallback;
    return interpolate(template, params);
  };
}

export const supportedLanguages = derived(runtimePackMeta, ($runtimePackMeta) => {
  const byCode = new Map();
  Object.values(BUILTIN_PACKS).forEach((pack) => {
    byCode.set(pack.code, {
      code: pack.code,
      name: pack.name,
      nativeName: pack.nativeName
    });
  });
  $runtimePackMeta.forEach((pack) => {
    const normalized = normalizePackMeta(pack);
    if (!normalized) return;
    byCode.set(normalized.code, normalized);
  });

  const list = Array.from(byCode.values());
  list.sort((a, b) => {
    if (a.code === FALLBACK_LOCALE) return -1;
    if (b.code === FALLBACK_LOCALE) return 1;
    return a.code.localeCompare(b.code);
  });
  return list;
});

function pickLanguagePackArray(payload) {
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.data?.packs)) return payload.data.packs;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.packs)) return payload.packs;
  if (Array.isArray(payload)) return payload;
  return [];
}

function pickLanguagePackMessages(payload) {
  const candidates = [
    payload?.data?.messages,
    payload?.messages,
    payload?.data?.pack?.messages,
    payload?.pack?.messages
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      return candidate;
    }
  }
  return {};
}

export async function refreshLanguagePacks() {
  try {
    const payload = await apiFetch('/api/system/language-packs');
    const nextPacks = pickLanguagePackArray(payload)
      .map((rawPack) => normalizePackMeta(rawPack))
      .filter(Boolean);
    runtimePackMeta.set(nextPacks);
    return nextPacks;
  } catch (error) {
    runtimePackMeta.set([]);
    return [];
  }
}

async function ensureLanguageMessages(code) {
  const normalizedCode = normalizeLanguageCode(code);
  if (normalizedCode === FALLBACK_LOCALE) return FALLBACK_MESSAGES;
  const builtinMessages = BUILTIN_PACKS[normalizedCode]?.messages;
  if (builtinMessages) return builtinMessages;

  const cached = get(runtimePackMessages)[normalizedCode];
  if (cached) return cached;

  if (pendingMessageLoads.has(normalizedCode)) {
    return pendingMessageLoads.get(normalizedCode);
  }

  const loadingPromise = apiFetch(`/api/system/language-packs/${encodeURIComponent(normalizedCode)}`)
    .then((payload) => {
      const messages = toObject(pickLanguagePackMessages(payload));
      runtimePackMessages.update((current) => ({ ...current, [normalizedCode]: messages }));
      return messages;
    })
    .catch(() => ({}))
    .finally(() => {
      pendingMessageLoads.delete(normalizedCode);
    });

  pendingMessageLoads.set(normalizedCode, loadingPromise);
  return loadingPromise;
}

export const currentLanguage = derived(systemSettings, ($systemSettings) => normalizeLanguageCode($systemSettings.language));

async function syncActiveMessages(language) {
  const token = ++activeMessageSyncToken;
  const normalizedLanguage = normalizeLanguageCode(language);
  const selectedMessages = toObject(await ensureLanguageMessages(normalizedLanguage));
  if (token !== activeMessageSyncToken) return;
  activeMessages.set({ ...FALLBACK_MESSAGES, ...selectedMessages });
}

currentLanguage.subscribe((language) => {
  syncActiveMessages(language).catch(() => {
    activeMessages.set({ ...FALLBACK_MESSAGES });
  });
});

supportedLanguages.subscribe(() => {
  syncActiveMessages(get(currentLanguage)).catch(() => {
    activeMessages.set({ ...FALLBACK_MESSAGES });
  });
});

refreshLanguagePacks().catch(() => {});

export const i18n = derived([currentLanguage, activeMessages], ([$currentLanguage, $activeMessages]) => ({
  language: $currentLanguage,
  t: createTranslator($activeMessages)
}));

export function translateWith(i18nContext, key, params = {}, fallback = key) {
  if (i18nContext && typeof i18nContext.t === 'function') {
    return i18nContext.t(key, params, fallback);
  }
  const translator = createTranslator(FALLBACK_MESSAGES);
  return translator(key, params, fallback);
}

export function localizeAppTitle(app = {}, i18nContext) {
  const appId = String(app?.id || '').trim();
  const key = APP_TITLE_KEY_BY_ID[appId];
  if (!key) return app?.title || appId || '';
  return translateWith(i18nContext, key, {}, app?.title || appId);
}

export function translateNow(key, params = {}, fallback = key) {
  const translator = createTranslator(get(activeMessages));
  return translator(key, params, fallback);
}
