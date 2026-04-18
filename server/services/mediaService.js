const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

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
  }
};

module.exports = mediaService;
