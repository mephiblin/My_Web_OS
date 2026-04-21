const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mkv', '.mov', '.avi', '.wmv', '.m4v']);

function classifyMediaKind(ext) {
  const lower = ext.toLowerCase();
  if (AUDIO_EXTENSIONS.has(lower)) return 'audio';
  if (VIDEO_EXTENSIONS.has(lower)) return 'video';
  return null;
}

/**
 * Service to handle media processing using FFmpeg.
 */
const mediaService = {
  /**
   * Get metadata for a media file.
   */
  getMetadata(filePath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) return reject(err);
        
        const format = metadata.format;
        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
        const audioStream = metadata.streams.find(s => s.codec_type === 'audio');

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

module.exports = mediaService;
