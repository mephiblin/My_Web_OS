const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mkv', '.mov', '.avi', '.wmv', '.m4v']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.avif', '.heic', '.heif']);
const PDF_EXTENSION = '.pdf';
const MAX_PDF_PAGE_SCAN_BYTES = 32 * 1024 * 1024;

function classifyMediaKind(ext) {
  const lower = ext.toLowerCase();
  if (AUDIO_EXTENSIONS.has(lower)) return 'audio';
  if (VIDEO_EXTENSIONS.has(lower)) return 'video';
  return null;
}

function classifyStationKind(ext) {
  const lower = String(ext || '').toLowerCase();
  if (AUDIO_EXTENSIONS.has(lower)) return 'audio';
  if (VIDEO_EXTENSIONS.has(lower)) return 'video';
  if (IMAGE_EXTENSIONS.has(lower)) return 'image';
  if (lower === PDF_EXTENSION) return 'document';
  return 'file';
}

function parsePdfPageCountFromText(rawText) {
  const text = typeof rawText === 'string' ? rawText : '';
  if (!text) return null;
  const matches = text.match(/\/Type\s*\/Page\b/g);
  if (!matches || matches.length === 0) return null;
  return matches.length;
}

async function readPdfPageCount(filePath) {
  let stats;
  try {
    stats = await fsp.stat(filePath);
  } catch (_err) {
    return null;
  }
  if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_PDF_PAGE_SCAN_BYTES) return null;
  const buffer = await fsp.readFile(filePath);
  return parsePdfPageCountFromText(buffer.toString('latin1'));
}

function getMetadata(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);

      const format = metadata.format;
      const videoStream = metadata.streams.find((s) => s.codec_type === 'video');
      const audioStream = metadata.streams.find((s) => s.codec_type === 'audio');

      resolve({
        filename: path.basename(filePath),
        duration: format.duration,
        size: format.size,
        format: format.format_name,
        video: videoStream ? {
          codec: videoStream.codec_name,
          width: videoStream.width,
          height: videoStream.height,
          fps: eval(videoStream.r_frame_rate)
        } : null,
        audio: audioStream ? {
          codec: audioStream.codec_name,
          channels: audioStream.channels,
          sampleRate: audioStream.sample_rate
        } : null
      });
    });
  });
}

/**
 * Service to handle media processing using FFmpeg.
 */
const mediaService = {
  /**
   * Get metadata for a media file.
   */
  getMetadata,

  async getStationMetadata(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const kind = classifyStationKind(ext);
    let stats;

    try {
      stats = await fsp.stat(filePath);
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        const notFound = new Error('Path not found.');
        notFound.status = 404;
        notFound.code = 'MEDIA_STATION_PATH_NOT_FOUND';
        throw notFound;
      }
      throw err;
    }

    if (!stats.isFile()) {
      const invalid = new Error('Path must be a file.');
      invalid.status = 400;
      invalid.code = 'MEDIA_STATION_INVALID_PATH';
      throw invalid;
    }

    const summary = {
      kind,
      durationSeconds: null,
      resolution: null,
      pages: null
    };

    if (kind === 'document' && ext === PDF_EXTENSION) {
      summary.pages = await readPdfPageCount(filePath);
      return summary;
    }

    if (kind !== 'audio' && kind !== 'video' && kind !== 'image') {
      return summary;
    }

    const metadata = await getMetadata(filePath);
    const duration = Number(metadata?.duration);
    if (Number.isFinite(duration) && duration > 0) {
      summary.durationSeconds = duration;
    }

    const width = Number(metadata?.video?.width);
    const height = Number(metadata?.video?.height);
    if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
      summary.resolution = { width, height };
    }

    return summary;
  },

  /**
   * Generate a thumbnail for a video file.
   */
  generateThumbnail(filePath, outputDir) {
    return new Promise((resolve, reject) => {
      const fileName = path.basename(filePath, path.extname(filePath)) + '.jpg';
      const outputPath = path.join(outputDir, fileName);

      // Check if already exists
      if (fs.existsSync(outputPath)) {
        return resolve(outputPath);
      }

      ffmpeg(filePath)
        .screenshots({
          timestamps: ['20%'],
          filename: fileName,
          folder: outputDir,
          size: '320x180'
        })
        .on('end', () => resolve(outputPath))
        .on('error', (err) => reject(err));
    });
  },

  /**
   * Build same-folder media playlist anchored at current file path.
   */
  async buildPlaylist(currentPath, kind = 'all') {
    const normalizedKind = typeof kind === 'string' ? kind.toLowerCase() : 'all';
    if (!['audio', 'video', 'all'].includes(normalizedKind)) {
      const err = new Error('Invalid kind. Use audio, video, or all.');
      err.status = 400;
      err.code = 'MEDIA_PLAYLIST_INVALID_KIND';
      throw err;
    }

    let stats;
    try {
      stats = await fsp.stat(currentPath);
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        const notFound = new Error('Path not found.');
        notFound.status = 404;
        notFound.code = 'MEDIA_PLAYLIST_PATH_NOT_FOUND';
        throw notFound;
      }
      throw err;
    }

    if (!stats.isFile()) {
      const err = new Error('Path must be an existing media file.');
      err.status = 400;
      err.code = 'MEDIA_PLAYLIST_INVALID_PATH';
      throw err;
    }

    const dir = path.dirname(currentPath);
    const files = await fsp.readdir(dir);

    const items = files
      .map((name) => {
        const ext = path.extname(name).toLowerCase();
        const mediaKind = classifyMediaKind(ext);
        if (!mediaKind) return null;
        if (normalizedKind !== 'all' && mediaKind !== normalizedKind) return null;
        return {
          path: path.join(dir, name),
          name,
          ext,
          kind: mediaKind,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));

    if (items.length === 0) {
      const err = new Error('No media files found in the same folder.');
      err.status = 404;
      err.code = 'MEDIA_PLAYLIST_NO_MEDIA';
      throw err;
    }

    const currentIndex = items.findIndex((item) => item.path === currentPath);

    return {
      currentPath,
      currentIndex,
      total: items.length,
      items,
    };
  },
};

mediaService.__internal = {
  parsePdfPageCountFromText
};

module.exports = mediaService;
