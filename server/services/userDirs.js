/**
 * Cross-Platform User Directory Detection Service
 * 4-Layer Fallback: User Override → OS API (XDG) → Env Vars → Home Scan
 */
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// Layer 4: Known folder names across languages for brute-force scan
const KNOWN_NAMES = {
  documents: ['Documents', '문서', 'ドキュメント', 'Документы', 'Dokumente', 'Documentos', 'Documenti', 'Documenten'],
  downloads: ['Downloads', '다운로드', 'ダウンロード', 'Загрузки', 'Téléchargements', 'Descargas', 'Scaricati'],
  pictures:  ['Pictures', '사진', '画像', 'Изображения', 'Images', 'Bilder', 'Imágenes', 'Immagini'],
  videos:    ['Videos', '비디오', 'ビデオ', 'Видео', 'Vidéos', 'Vídeos'],
  desktop:   ['Desktop', '바탕화면', 'デスクトップ', 'Рабочий стол', 'Bureau', 'Escritorio', 'Schreibtisch'],
  music:     ['Music', '음악', 'ミュージック', 'Музыка', 'Musique', 'Música', 'Musik'],
};

const DIR_KEYS = Object.keys(KNOWN_NAMES);

/**
 * Layer 1: Check user-defined overrides from .env
 */
function getOverrides() {
  const overrides = {};
  for (const key of DIR_KEYS) {
    const envKey = `USER_DIR_${key.toUpperCase()}`;
    if (process.env[envKey]) {
      overrides[key] = process.env[envKey];
    }
  }
  return overrides;
}

/**
 * Layer 2: Parse XDG user-dirs.dirs (Linux)
 */
function parseXDG(homeDir) {
  const xdgPath = path.join(homeDir, '.config', 'user-dirs.dirs');
  const result = {};

  try {
    if (!fs.existsSync(xdgPath)) return result;

    const content = fs.readFileSync(xdgPath, 'utf8');
    const mappings = {
      XDG_DOCUMENTS_DIR: 'documents',
      XDG_DOWNLOAD_DIR:  'downloads',
      XDG_PICTURES_DIR:  'pictures',
      XDG_VIDEOS_DIR:    'videos',
      XDG_DESKTOP_DIR:   'desktop',
      XDG_MUSIC_DIR:     'music',
    };

    for (const [xdgKey, dirKey] of Object.entries(mappings)) {
      // Match lines like: XDG_DOCUMENTS_DIR="$HOME/문서"
      const regex = new RegExp(`^${xdgKey}="(.+)"`, 'm');
      const match = content.match(regex);
      if (match) {
        const resolved = match[1].replace('$HOME', homeDir);
        if (fs.existsSync(resolved)) {
          result[dirKey] = resolved;
        }
      }
    }
  } catch (err) {
    console.warn('XDG parse failed:', err.message);
  }

  return result;
}

/**
 * Layer 2 (Windows): Query Known Folders via PowerShell
 */
function getWindowsFolders() {
  const result = {};
  const mappings = {
    MyDocuments: 'documents',
    UserProfile: 'downloads', // Downloads needs special handling
    MyPictures:  'pictures',
    MyVideos:    'videos',
    Desktop:     'desktop',
    MyMusic:     'music',
  };

  try {
    for (const [folderName, dirKey] of Object.entries(mappings)) {
      const cmd = `powershell -NoProfile -Command "[Environment]::GetFolderPath('${folderName}')"`;
      let folderPath = execSync(cmd, { encoding: 'utf8', timeout: 5000 }).trim();

      // Special case: Downloads folder
      if (dirKey === 'downloads') {
        const profileDir = folderPath;
        folderPath = path.join(profileDir, 'Downloads');
      }

      if (folderPath && fs.existsSync(folderPath)) {
        result[dirKey] = folderPath;
      }
    }
  } catch (err) {
    console.warn('Windows folder detection failed:', err.message);
  }

  return result;
}

/**
 * Layer 3: Check environment variables
 */
function getEnvVars() {
  const result = {};
  const mappings = {
    XDG_DOCUMENTS_DIR: 'documents',
    XDG_DOWNLOAD_DIR:  'downloads',
    XDG_PICTURES_DIR:  'pictures',
    XDG_VIDEOS_DIR:    'videos',
    XDG_DESKTOP_DIR:   'desktop',
    XDG_MUSIC_DIR:     'music',
  };

  for (const [envKey, dirKey] of Object.entries(mappings)) {
    if (process.env[envKey] && fs.existsSync(process.env[envKey])) {
      result[dirKey] = process.env[envKey];
    }
  }

  return result;
}

/**
 * Layer 4: Scan home directory for known folder names
 */
function scanHomeDir(homeDir) {
  const result = {};
  try {
    const entries = fs.readdirSync(homeDir, { withFileTypes: true });
    const dirNames = entries.filter(e => e.isDirectory()).map(e => e.name);

    for (const [key, candidates] of Object.entries(KNOWN_NAMES)) {
      const match = dirNames.find(name => candidates.includes(name));
      if (match) {
        result[key] = path.join(homeDir, match);
      }
    }
  } catch (err) {
    console.warn('Home directory scan failed:', err.message);
  }
  return result;
}

/**
 * macOS defaults (always English internally)
 */
function getMacDefaults(homeDir) {
  const result = {};
  const defaults = {
    documents: 'Documents',
    downloads: 'Downloads',
    pictures:  'Pictures',
    videos:    'Movies', // macOS calls it "Movies"
    desktop:   'Desktop',
    music:     'Music',
  };

  for (const [key, name] of Object.entries(defaults)) {
    const dirPath = path.join(homeDir, name);
    if (fs.existsSync(dirPath)) {
      result[key] = dirPath;
    }
  }
  return result;
}

/**
 * Main: Detect user directories using 4-layer fallback
 */
function detectUserDirs() {
  const homeDir = os.homedir();
  const platform = os.platform(); // 'linux', 'win32', 'darwin'

  // Start with empty result
  const finalResult = {};
  const sources = {};

  // --- Layer 4: Home Scan (lowest priority, applied first) ---
  const scanned = scanHomeDir(homeDir);
  for (const [key, val] of Object.entries(scanned)) {
    finalResult[key] = val;
    sources[key] = 'scan';
  }

  // --- Layer 3: Environment Variables ---
  const envDirs = getEnvVars();
  for (const [key, val] of Object.entries(envDirs)) {
    finalResult[key] = val;
    sources[key] = 'env';
  }

  // --- Layer 2: OS-specific API ---
  let osDirs = {};
  if (platform === 'linux') {
    osDirs = parseXDG(homeDir);
  } else if (platform === 'win32') {
    osDirs = getWindowsFolders();
  } else if (platform === 'darwin') {
    osDirs = getMacDefaults(homeDir);
  }
  for (const [key, val] of Object.entries(osDirs)) {
    finalResult[key] = val;
    sources[key] = platform === 'linux' ? 'xdg' : platform === 'win32' ? 'known-folders' : 'macos-default';
  }

  // --- Layer 1: User Overrides (highest priority) ---
  const overrides = getOverrides();
  for (const [key, val] of Object.entries(overrides)) {
    if (fs.existsSync(val)) {
      finalResult[key] = val;
      sources[key] = 'user-override';
    }
  }

  // Build response
  const response = {
    home: homeDir,
    os: platform,
    _inventoryPath: path.join(__dirname, '..', 'storage', 'inventory'),
  };

  for (const key of DIR_KEYS) {
    response[key] = {
      path: finalResult[key] || null,
      source: sources[key] || 'not-found',
    };
  }

  return response;
}

/**
 * Build preferred file-station places from detected user dirs.
 * Intended for boot-time defaults when ALLOWED_ROOTS/INITIAL_PATH are not set.
 */
function detectPreferredPlaces() {
  const detected = detectUserDirs();
  const preferredOrder = ['documents', 'desktop', 'downloads', 'pictures', 'music', 'videos'];
  const allowedRoots = [];
  const seen = new Set();

  for (const key of preferredOrder) {
    const candidate = detected?.[key]?.path;
    if (!candidate) continue;
    const normalized = path.resolve(candidate);
    if (seen.has(normalized.toLowerCase())) continue;
    seen.add(normalized.toLowerCase());
    allowedRoots.push(normalized);
  }

  const homePath = detected?.home ? path.resolve(detected.home) : '';
  if (homePath && !seen.has(homePath.toLowerCase())) {
    allowedRoots.push(homePath);
  }

  const initialPath =
    detected?.documents?.path ||
    detected?.downloads?.path ||
    detected?.desktop?.path ||
    detected?.home ||
    '/';

  return {
    allowedRoots,
    initialPath: initialPath ? path.resolve(initialPath) : '/',
    homePath
  };
}

module.exports = { detectUserDirs, detectPreferredPlaces };
