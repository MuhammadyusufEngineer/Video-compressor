// DOM Elements
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const fileInfo = document.getElementById('fileInfo');
const fileName = document.getElementById('fileName');
const fileSize = document.getElementById('fileSize');

const optionsSection = document.getElementById('optionsSection');
const formatSelect = document.getElementById('formatSelect');
const qualityRadios = document.querySelectorAll('input[name="quality"]');
const convertBtn = document.getElementById('convertBtn');

const progressSection = document.getElementById('progressSection');
const progressFill = document.getElementById('progressFill');
const progressPercent = document.getElementById('progressPercent');
const statFps = document.getElementById('statFps');
const statSize = document.getElementById('statSize');
const statTime = document.getElementById('statTime');

const completeSection = document.getElementById('completeSection');
const originalSize = document.getElementById('originalSize');
const compressedSize = document.getElementById('compressedSize');
const savedSize = document.getElementById('savedSize');
const downloadBtn = document.getElementById('downloadBtn');
const convertAgainBtn = document.getElementById('convertAgainBtn');

const errorSection = document.getElementById('errorSection');
const errorText = document.getElementById('errorText');
const retryBtn = document.getElementById('retryBtn');

// State
let selectedFile = null;
let currentJobId = null;
let originalFileSize = 0;

// Utility: Format bytes to human-readable
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

// Drop zone event listeners
dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');

  const files = e.dataTransfer.files;
  if (files.length > 0) {
    handleFileSelect(files[0]);
  }
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    handleFileSelect(e.target.files[0]);
  }
});

// Handle file selection
function handleFileSelect(file) {
  selectedFile = file;
  originalFileSize = file.size;

  fileName.textContent = file.name;
  fileSize.textContent = formatBytes(file.size);
  fileInfo.style.display = 'flex';

  optionsSection.style.display = 'block';
  progressSection.style.display = 'none';
  completeSection.style.display = 'none';
  errorSection.style.display = 'none';
}

// Quality button selection
qualityRadios.forEach((radio) => {
  radio.addEventListener('change', (e) => {
    document.querySelectorAll('.quality-label').forEach(label => {
      label.classList.remove('active');
    });
    document.querySelector(`label[for="${e.target.id}"]`).classList.add('active');
  });
});

// Set initial active quality
document.querySelector('label[for="qualityBalanced"]').classList.add('active');

// Convert button
convertBtn.addEventListener('click', startConversion);

// Download button
downloadBtn.addEventListener('click', downloadFile);

// Convert again button
convertAgainBtn.addEventListener('click', resetUI);

// Retry button
retryBtn.addEventListener('click', resetUI);

async function startConversion() {
  if (!selectedFile) {
    alert('Please select a file');
    return;
  }

  const format = formatSelect.value;
  const quality = document.querySelector('input[name="quality"]:checked').value;

  // Prepare form data
  const formData = new FormData();
  formData.append('video', selectedFile);
  formData.append('format', format);
  formData.append('quality', quality);

  convertBtn.disabled = true;
  optionsSection.style.display = 'none';
  progressSection.style.display = 'block';
  errorSection.style.display = 'none';

  try {
    // Upload and start conversion
    const response = await fetch('/convert', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Upload failed');
    }

    const result = await response.json();
    currentJobId = result.jobId;

    // Start listening for progress
    listenToProgress(currentJobId);
  } catch (err) {
    showError(err.message);
    convertBtn.disabled = false;
  }
}

function listenToProgress(jobId) {
  const eventSource = new EventSource(`/progress/${jobId}`);

  eventSource.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.error) {
        eventSource.close();
        showError(data.error);
        convertBtn.disabled = false;
        return;
      }

      if (data.done) {
        eventSource.close();
        showComplete(data.outputSize);
        return;
      }

      // Update progress
      updateProgress(data);
    } catch (err) {
      console.error('Error parsing progress:', err);
    }
  });

  eventSource.addEventListener('error', () => {
    eventSource.close();
    showError('Connection lost');
    convertBtn.disabled = false;
  });
}

function updateProgress(data) {
  const percent = data.percent || 0;
  progressFill.style.width = percent + '%';
  progressPercent.textContent = Math.round(percent) + '%';

  if (data.fps) {
    statFps.textContent = Math.round(data.fps) + ' fps';
  }

  if (data.size) {
    statSize.textContent = formatBytes(data.size);
  }

  if (data.timemark) {
    statTime.textContent = data.timemark;
  }
}

function showComplete(outputSizeBytes) {
  progressSection.style.display = 'none';
  completeSection.style.display = 'block';

  originalSize.textContent = formatBytes(originalFileSize);

  const compSize = outputSizeBytes || 0;
  compressedSize.textContent = formatBytes(compSize);

  const saved = Math.max(0, originalFileSize - compSize);
  savedSize.textContent = formatBytes(saved);

  const reduction = originalFileSize > 0 ? Math.round((saved / originalFileSize) * 100) : 0;
  savedSize.textContent += ` (${reduction}% reduction)`;
}

function showError(message) {
  progressSection.style.display = 'none';
  completeSection.style.display = 'none';
  errorSection.style.display = 'block';

  errorText.textContent = message;
}

function downloadFile() {
  if (!currentJobId) {
    alert('No job to download');
    return;
  }

  // Create a download link
  const link = document.createElement('a');
  link.href = `/download/${currentJobId}`;
  link.click();
}

function resetUI() {
  selectedFile = null;
  currentJobId = null;
  originalFileSize = 0;

  // Reset form
  fileInput.value = '';
  fileInfo.style.display = 'none';
  optionsSection.style.display = 'none';
  progressSection.style.display = 'none';
  completeSection.style.display = 'none';
  errorSection.style.display = 'none';

  // Reset progress
  progressFill.style.width = '0%';
  progressPercent.textContent = '0%';
  statFps.textContent = '0 fps';
  statSize.textContent = '0 MB';
  statTime.textContent = '00:00:00';

  convertBtn.disabled = false;
}
