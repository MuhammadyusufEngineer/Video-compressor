import express from 'express';
import multer from 'multer';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { unlink, mkdir } from 'fs/promises';
import { statSync } from 'fs';
import { dirname, join, extname, basename } from 'path';
import { fileURLToPath } from 'url';
import { convertVideo } from './convert.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
let port = process.env.PORT || 3000;

// Ensure directories exist
const uploadDir = join(__dirname, 'uploads');
const outputDir = join(__dirname, 'outputs');

try {
  await mkdir(uploadDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
} catch (err) {
  console.error('Error creating directories:', err.message);
}

// Setup multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const ext = extname(file.originalname);
    cb(null, `${timestamp}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowed = [
    '.mp4', '.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm',
    '.m4v', '.3gp', '.ts', '.mts', '.mpg', '.mpeg', '.vob',
    '.ogv', '.ogg', '.divx', '.asf', '.rm', '.rmvb', '.dv',
    '.gxf', '.mxf', '.m2ts'
  ];
  const ext = extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`File type not supported: ${ext}`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 * 1024 } // 10GB limit
});

// Job management
const jobs = new Map();

// File operations (already promisified from fs/promises)

// Serve static files
app.use(express.static(join(__dirname, 'public')));

// POST /convert - Upload and start conversion
app.post('/convert', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { format = 'mp4-h265', quality = 'balanced' } = req.body;

    const jobId = uuidv4();
    const inputPath = req.file.path;
    const inputFileName = basename(inputPath, extname(inputPath));
    const outputExt = format === 'webm-vp9' ? '.webm' : (format === 'mkv-h265' ? '.mkv' : '.mp4');
    const outputPath = join(outputDir, `${inputFileName}_${jobId}${outputExt}`);

    // Get input file size
    const inputSize = req.file.size;

    // Create job context
    const emitter = new EventEmitter();
    jobs.set(jobId, {
      status: 'processing',
      inputPath,
      outputPath,
      inputSize,
      emitter,
      startTime: Date.now()
    });

    // Start conversion in background
    (async () => {
      try {
        await convertVideo(inputPath, outputPath, { format, quality }, (progress) => {
          emitter.emit('progress', progress);
        });

        emitter.emit('done');
        jobs.get(jobId).status = 'done';
      } catch (err) {
        console.error(`Conversion error for job ${jobId}:`, err.message);
        emitter.emit('error', err.message);
        jobs.get(jobId).status = 'error';
      } finally {
        // Clean up input file
        try {
          await unlink(inputPath);
        } catch (e) {
          console.error('Error deleting input file:', e.message);
        }
      }
    })();

    res.json({ jobId, format, quality });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /progress/:jobId - Server-Sent Events for progress
app.get('/progress/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  // Setup SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Send initial state if job is done
  if (job.status === 'done') {
    res.write(`data: ${JSON.stringify({ percent: 100, done: true })}\n\n`);
    res.end();
    return;
  }

  if (job.status === 'error') {
    res.write(`data: ${JSON.stringify({ error: 'Conversion failed' })}\n\n`);
    res.end();
    return;
  }

  // Forward progress events
  const progressHandler = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const doneHandler = () => {
    // Get output file size
    try {
      const outputSize = statSync(job.outputPath).size;
      res.write(`data: ${JSON.stringify({ percent: 100, done: true, outputSize })}\n\n`);
    } catch (e) {
      res.write(`data: ${JSON.stringify({ percent: 100, done: true })}\n\n`);
    }
    res.end();
  };

  const errorHandler = (msg) => {
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
    res.end();
  };

  job.emitter.on('progress', progressHandler);
  job.emitter.on('done', doneHandler);
  job.emitter.on('error', errorHandler);

  // Cleanup on disconnect
  req.on('close', () => {
    job.emitter.removeListener('progress', progressHandler);
    job.emitter.removeListener('done', doneHandler);
    job.emitter.removeListener('error', errorHandler);
  });
});

// GET /download/:jobId - Download converted file
app.get('/download/:jobId', async (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  if (job.status !== 'done') {
    return res.status(400).json({ error: 'Conversion not complete' });
  }

  try {
    const stat = statSync(job.outputPath);
    const originalName = basename(job.inputPath, extname(job.inputPath));
    const outputExt = extname(job.outputPath);

    res.setHeader('Content-Disposition', `attachment; filename="${originalName}_compressed${outputExt}"`);
    res.setHeader('Content-Length', stat.size);

    res.download(job.outputPath, `${originalName}_compressed${outputExt}`, async (err) => {
      if (!err) {
        // Clean up files after download
        try {
          await unlink(job.outputPath);
          jobs.delete(jobId);
        } catch (e) {
          console.error('Error cleaning up:', e.message);
        }
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to download file: ' + err.message });
  }
});

// Start server with auto-port detection
function startServer(tryPort) {
  const server = app.listen(tryPort, () => {
    console.log(`\n🎬 Video Compressor running at http://localhost:${tryPort}`);
    console.log(`📁 Upload dir: ${uploadDir}`);
    console.log(`📁 Output dir: ${outputDir}\n`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`⚠️  Port ${tryPort} busy, trying ${tryPort + 1}...`);
      server.close();
      startServer(tryPort + 1);
    } else {
      console.error('Server error:', err.message);
      process.exit(1);
    }
  });
}

startServer(port);
