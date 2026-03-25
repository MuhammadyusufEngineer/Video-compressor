import ffmpeg from 'fluent-ffmpeg';

// CRF values: lower = better quality
const QUALITY_PRESETS = {
  hq: { crf: 20, preset: 'slow' },
  balanced: { crf: 26, preset: 'medium' },
  small: { crf: 32, preset: 'fast' }
};

// Output format configuration
const FORMAT_CONFIG = {
  'mp4-h264': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    audioOptions: ['-b:a 128k'],
    outputExt: '.mp4'
  },
  'mp4-h265': {
    videoCodec: 'libx265',
    audioCodec: 'aac',
    audioOptions: ['-b:a 128k'],
    outputExt: '.mp4'
  },
  'webm-vp9': {
    videoCodec: 'libvpx-vp9',
    audioCodec: 'libopus',
    audioOptions: ['-b:a 128k'],
    outputExt: '.webm'
  },
  'mkv-h265': {
    videoCodec: 'libx265',
    audioCodec: 'aac',
    audioOptions: ['-b:a 128k'],
    outputExt: '.mkv'
  }
};

/**
 * Convert a video file to a different format with specified quality
 * @param {string} inputPath - Path to input video file
 * @param {string} outputPath - Path to output video file
 * @param {object} options - { format: 'mp4-h264'|'mp4-h265'|'webm-vp9'|'mkv-h265', quality: 'hq'|'balanced'|'small' }
 * @param {function} onProgress - Callback for progress updates: (data) => {}
 * @returns {Promise}
 */
export function convertVideo(inputPath, outputPath, options, onProgress) {
  return new Promise((resolve, reject) => {
    const { format = 'mp4-h265', quality = 'balanced' } = options;

    if (!FORMAT_CONFIG[format]) {
      return reject(new Error(`Unknown format: ${format}`));
    }
    if (!QUALITY_PRESETS[quality]) {
      return reject(new Error(`Unknown quality: ${quality}`));
    }

    const formatCfg = FORMAT_CONFIG[format];
    const qualityCfg = QUALITY_PRESETS[quality];

    // Build the ffmpeg command
    let cmd = ffmpeg(inputPath)
      .videoCodec(formatCfg.videoCodec)
      .audioCodec(formatCfg.audioCodec);

    // Add CRF and preset as output options
    const outputOptions = [
      `-crf ${qualityCfg.crf}`,
      `-preset ${qualityCfg.preset}`,
      '-movflags +faststart', // Enable web streaming for MP4
      ...formatCfg.audioOptions
    ];

    cmd.outputOptions(outputOptions);

    // Setup progress reporting
    cmd.on('progress', (progress) => {
      const percent = Math.min(Math.round(progress.percent ?? 0), 100);
      onProgress({
        percent,
        fps: progress.currentFps || 0,
        size: progress.targetSize || 0,
        timemark: progress.timemark || '00:00:00'
      });
    });

    // Success handler
    cmd.on('end', () => {
      onProgress({ percent: 100 });
      resolve(outputPath);
    });

    // Error handler
    cmd.on('error', (err) => {
      reject(new Error(`FFmpeg error: ${err.message}`));
    });

    // Start the conversion
    cmd.save(outputPath);
  });
}