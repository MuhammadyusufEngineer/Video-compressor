import ffmpeg from 'fluent-ffmpeg';

// Quality presets
const QUALITY_PRESETS = {
  hq: { crf: 20, preset: 'slow' },
  balanced: { crf: 23, preset: 'medium' },
  small: { crf: 28, preset: 'fast' },
  mobile: { crf: 23, preset: 'slow' }
};

// Output format configuration
const FORMAT_CONFIG = {
  'mp4-h264': {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    audioOptions: ['-b:a 160k'],
    outputExt: '.mp4',
    compatOptions: [
      '-pix_fmt yuv420p',      // Mobile compatible pixel format
      '-profile:v main',        // Main profile for H.264
      '-level 4.0'              // Level 4.0 is widely supported
    ]
  }
  // You can extend to H.265 / WebM / MKV later if needed
};

/**
 * Convert a video file to best mobile-compatible format
 */
export function convertVideo(inputPath, outputPath, options, onProgress) {
  return new Promise((resolve, reject) => {
    const { format = 'mp4-h264', quality = 'mobile' } = options;

    if (!FORMAT_CONFIG[format]) return reject(new Error(`Unknown format: ${format}`));
    if (!QUALITY_PRESETS[quality]) return reject(new Error(`Unknown quality: ${quality}`));

    const formatCfg = FORMAT_CONFIG[format];
    const qualityCfg = QUALITY_PRESETS[quality];

    // Probe video for dynamic scaling / fps
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) return reject(new Error(`FFprobe error: ${err.message}`));

      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      const width = videoStream?.width || 0;
      const height = videoStream?.height || 0;
      const fps = eval(videoStream?.r_frame_rate || '30'); // Convert "30000/1001" to number

      // Downscale if width > 1080
      const scale = width > 1080 ? `-vf scale=1080:-2` : null;
      // Cap fps at 30 for mobile
      const frameRate = fps > 30 ? '-r 30' : null;

      const outputOptions = [
        `-crf ${qualityCfg.crf}`,
        `-preset ${qualityCfg.preset}`,
        ...formatCfg.compatOptions,
        scale,
        frameRate,
        '-movflags +faststart',
        ...formatCfg.audioOptions
      ].filter(Boolean);

      const cmd = ffmpeg(inputPath)
        .videoCodec(formatCfg.videoCodec)
        .audioCodec(formatCfg.audioCodec)
        .outputOptions(outputOptions);

      // Progress reporting
      cmd.on('progress', (progress) => {
        onProgress({
          percent: Math.min(Math.round(progress.percent ?? 0), 100),
          fps: progress.currentFps || 0,
          size: progress.targetSize || 0,
          timemark: progress.timemark || '00:00:00'
        });
      });

      cmd.on('end', () => {
        onProgress({ percent: 100 });
        resolve(outputPath);
      });

      cmd.on('error', (err) => reject(new Error(`FFmpeg error: ${err.message}`)));

      cmd.save(outputPath);
    });
  });
}