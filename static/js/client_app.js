/**
 * VideoAnalytics Pro - Client-Side Controller
 * High-performance edge AI running 100% in the browser (Desktop & Mobile App UX)
 */

let currentMode = 'object_detection';
let isWebcamRunning = false;
let videoStream = null;
let animationFrameId = null;
let currentFacingMode = 'user'; // 'user' (selfie) or 'environment' (back camera)

// Models
let cocoModel = null;
let isFaceApiLoaded = false;
let isOcrProcessing = false;

// Surveillance state
let lastFrameData = null;
let surveillanceIncidents = [];

const modeTitles = {
  object_detection: 'Object Detection (COCO-SSD)',
  emotion: 'Facial Emotion Recognition (Face-API)',
  ocr: 'Optical Character Recognition (Tesseract.js)',
  surveillance: 'Surveillance & Intrusion Detection'
};

const emotionEmojis = {
  angry: '😡', disgust: '🤢', fear: '😨',
  happy: '😊', neutral: '😐', sad: '😢', surprise: '😲'
};

const emotionColors = {
  angry: '#ef4444', disgust: '#22c55e', fear: '#a855f7',
  happy: '#10b981', neutral: '#94a3b8', sad: '#3b82f6', surprise: '#f59e0b'
};

// ─── Initialize ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initClock();
  preloadModels();
});

function initClock() {
  const clockEl = document.getElementById('liveClock');
  function update() {
    const d = new Date();
    clockEl.textContent = d.toLocaleTimeString('en-US', { hour12: false });
  }
  update();
  setInterval(update, 1000);
}

// ─── Preload AI Models ───────────────────────────────────────────────────────
async function preloadModels() {
  showLoader('Loading Object Detection AI...');
  try {
    if (typeof cocoSsd !== 'undefined') {
      cocoModel = await cocoSsd.load();
      setDot('pillYolo', true);
    }
  } catch (e) {
    console.warn('COCO-SSD load issue:', e);
  }

  showLoader('Loading Face & Emotion AI...');
  try {
    if (typeof faceapi !== 'undefined') {
      const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL)
      ]);
      isFaceApiLoaded = true;
      setDot('pillEmo', true);
    }
  } catch (e) {
    console.warn('FaceAPI load issue:', e);
  }

  setDot('pillOcr', true);
  hideLoader();
}

function showLoader(text) {
  const loader = document.getElementById('modelLoader');
  const txt = document.getElementById('modelLoaderText');
  if (loader && txt) {
    txt.textContent = text;
    loader.classList.remove('hidden');
  }
}

function hideLoader() {
  const loader = document.getElementById('modelLoader');
  if (loader) loader.classList.add('hidden');
}

function setDot(id, active) {
  const el = document.getElementById(id);
  if (!el) return;
  const dot = el.querySelector('.dot');
  if (dot) dot.className = active ? 'dot green' : 'dot';
}

// ─── Mode Switching (Syncs Desktop Sidebar & Mobile Bottom Nav) ──────────────
function setMode(newMode) {
  currentMode = newMode;

  // Sync Desktop Sidebar
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === newMode);
  });

  // Sync Mobile Bottom Tabs
  document.querySelectorAll('.mob-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.mode === newMode);
  });

  const badge = document.getElementById('activeModeBadge');
  if (badge) badge.textContent = modeTitles[newMode] || newMode;

  document.querySelectorAll('.telemetry-card').forEach(c => c.classList.add('hidden'));
  const card = document.getElementById(`card_${newMode}`);
  if (card) card.classList.remove('hidden');

  // Clear previous canvas drawing
  const canvas = document.getElementById('overlayCanvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// ─── Webcam Control ──────────────────────────────────────────────────────────
async function toggleWebcam() {
  const video = document.getElementById('webcamVideo');
  const canvas = document.getElementById('overlayCanvas');
  const placeholder = document.getElementById('placeholder');
  const liveBadge = document.getElementById('liveBadge');
  const btnDesktop = document.getElementById('btnToggleCamDesktop');
  const btnFloat = document.getElementById('btnFloatToggle');
  const camText = document.getElementById('camStatusText');

  if (!isWebcamRunning) {
    updateButtonStates('loading');

    try {
      videoStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: currentFacingMode,
          width: { ideal: 640 },
          height: { ideal: 480 }
        },
        audio: false
      });

      video.srcObject = videoStream;
      await video.play();

      // Mirror selfie camera for natural view, keep back camera unmirrored
      video.style.transform = (currentFacingMode === 'user') ? 'scaleX(-1)' : 'scaleX(1)';

      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;

      video.classList.remove('hidden');
      placeholder.classList.add('hidden');
      liveBadge.style.display = 'inline-flex';

      isWebcamRunning = true;
      updateButtonStates('running');
      setDot('pillCam', true);
      camText.textContent = (currentFacingMode === 'user') ? 'Front Cam' : 'Back Cam';

      // Start Real-Time Render Loop
      renderLoop();

    } catch (err) {
      alert('Camera access error: ' + err.message);
      updateButtonStates('stopped');
    }
  } else {
    // Stop Webcam
    if (animationFrameId) cancelAnimationFrame(animationFrameId);

    if (videoStream) {
      videoStream.getTracks().forEach(t => t.stop());
      videoStream = null;
    }

    video.srcObject = null;
    video.classList.add('hidden');
    placeholder.classList.remove('hidden');
    liveBadge.style.display = 'none';

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    isWebcamRunning = false;
    updateButtonStates('stopped');
    setDot('pillCam', false);
    camText.textContent = 'Cam Off';
  }
}

function updateButtonStates(state) {
  const btnDesktop = document.getElementById('btnToggleCamDesktop');
  const btnFloat = document.getElementById('btnFloatToggle');

  if (state === 'loading') {
    if (btnDesktop) {
      btnDesktop.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Starting...';
      btnDesktop.disabled = true;
    }
    if (btnFloat) {
      btnFloat.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    }
  } else if (state === 'running') {
    if (btnDesktop) {
      btnDesktop.innerHTML = '<i class="fa-solid fa-stop"></i> Stop Camera';
      btnDesktop.className = 'cam-toggle stop';
      btnDesktop.disabled = false;
    }
    if (btnFloat) {
      btnFloat.innerHTML = '<i class="fa-solid fa-stop"></i>';
      btnFloat.className = 'floating-btn primary stop';
    }
  } else {
    if (btnDesktop) {
      btnDesktop.innerHTML = '<i class="fa-solid fa-play"></i> Start Camera';
      btnDesktop.className = 'cam-toggle start';
      btnDesktop.disabled = false;
    }
    if (btnFloat) {
      btnFloat.innerHTML = '<i class="fa-solid fa-play"></i>';
      btnFloat.className = 'floating-btn primary';
    }
  }
}

// ─── Flip Front / Back Camera (Crucial for Mobile) ───────────────────────────
async function flipCamera() {
  currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';
  if (isWebcamRunning) {
    // Stop current track and restart with new facing mode
    if (videoStream) {
      videoStream.getTracks().forEach(t => t.stop());
      videoStream = null;
    }
    isWebcamRunning = false;
    await toggleWebcam();
  }
}

// ─── Real-Time Processing Loop ───────────────────────────────────────────────
let ocrThrottleTimer = 0;

async function renderLoop() {
  if (!isWebcamRunning) return;

  const video = document.getElementById('webcamVideo');
  const canvas = document.getElementById('overlayCanvas');
  const ctx = canvas.getContext('2d');

  if (video.readyState === video.HAVE_ENOUGH_DATA) {
    if (canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. OBJECT DETECTION
    if (currentMode === 'object_detection' && cocoModel) {
      const predictions = await cocoModel.detect(video);
      renderObjects(predictions, ctx, canvas.width, canvas.height);
    }

    // 2. EMOTION RECOGNITION
    else if (currentMode === 'emotion' && isFaceApiLoaded) {
      const detections = await faceapi
        .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }))
        .withFaceExpressions();
      renderEmotions(detections, ctx);
    }

    // 3. OCR (Throttled every ~2 seconds)
    else if (currentMode === 'ocr') {
      ocrThrottleTimer++;
      if (ocrThrottleTimer % 60 === 0 && !isOcrProcessing) {
        runClientOcr(video);
      }
    }

    // 4. SURVEILLANCE
    else if (currentMode === 'surveillance') {
      renderSurveillance(video, ctx, canvas.width, canvas.height);
    }
  }

  animationFrameId = requestAnimationFrame(renderLoop);
}

// ─── 1. Object Detection Renderer ───────────────────────────────────────────
function renderObjects(predictions, ctx, w, h) {
  const countEl = document.getElementById('objCountVal');
  const tagList = document.getElementById('objTagList');

  countEl.textContent = predictions.length;

  if (predictions.length === 0) {
    tagList.innerHTML = '<div class="empty-state">No objects currently detected</div>';
    return;
  }

  const counts = {};

  predictions.forEach(p => {
    let [x, y, bw, bh] = p.bbox;

    // Flip X coordinates if selfie camera is mirrored
    if (currentFacingMode === 'user') {
      x = w - x - bw;
    }

    const label = `${p.class} ${Math.round(p.score * 100)}%`;
    counts[p.class] = (counts[p.class] || 0) + 1;

    ctx.strokeStyle = '#00e676';
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, bw, bh);

    ctx.font = 'bold 14px sans-serif';
    const textWidth = ctx.measureText(label).width;
    ctx.fillStyle = '#00e676';
    ctx.fillRect(x, Math.max(0, y - 24), textWidth + 10, 24);

    ctx.fillStyle = '#000000';
    ctx.fillText(label, x + 5, Math.max(16, y - 7));
  });

  tagList.innerHTML = Object.entries(counts).map(([name, count]) => `
    <div class="obj-pill">
      <span class="pill-name">${name}</span>
      <span class="pill-count">×${count}</span>
    </div>
  `).join('');
}

// ─── 2. Facial Emotion Renderer ─────────────────────────────────────────────
function renderEmotions(detections, ctx) {
  const countEl = document.getElementById('faceCountVal');
  const container = document.getElementById('facesContainer');
  const canvas = document.getElementById('overlayCanvas');
  const w = canvas.width;

  countEl.textContent = detections.length;

  if (detections.length === 0) {
    container.innerHTML = '<div class="empty-state">Looking for human faces...</div>';
    return;
  }

  const facesTelemetry = [];

  detections.forEach((d, idx) => {
    let box = d.detection.box;
    let x = box.x;
    if (currentFacingMode === 'user') {
      x = w - box.x - box.width;
    }

    const expressions = d.expressions;
    let maxEmotion = 'neutral';
    let maxScore = 0;
    for (const [em, val] of Object.entries(expressions)) {
      if (val > maxScore) {
        maxScore = val;
        maxEmotion = em;
      }
    }

    const color = emotionColors[maxEmotion] || '#94a3b8';
    const emoji = emotionEmojis[maxEmotion] || '😐';

    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(x, box.y, box.width, box.height);

    const label = `${emoji} ${maxEmotion.toUpperCase()}`;
    ctx.font = 'bold 15px sans-serif';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = color;
    ctx.fillRect(x, Math.max(0, box.y - 26), tw + 12, 26);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, x + 6, Math.max(18, box.y - 8));

    facesTelemetry.push({
      id: idx + 1,
      emotion: maxEmotion,
      emoji: emoji,
      color: color,
      scores: expressions
    });
  });

  container.innerHTML = facesTelemetry.map(f => {
    const bars = Object.entries(f.scores).map(([em, sc]) => {
      const pct = Math.round(sc * 100);
      const barColor = emotionColors[em] || '#94a3b8';
      return `
        <div class="emotion-bar-row">
          <span class="bar-label">${em}</span>
          <div class="bar-track">
            <div class="bar-fill" style="width: ${pct}%; background-color: ${barColor};"></div>
          </div>
          <span class="bar-val">${pct}%</span>
        </div>
      `;
    }).join('');

    return `
      <div class="face-card">
        <div class="face-card-header">
          <span class="face-id">Face #${f.id}</span>
          <span class="face-emotion-badge" style="background: ${f.color}22; color: ${f.color}; border: 1px solid ${f.color};">
            ${f.emoji} ${f.emotion.toUpperCase()}
          </span>
        </div>
        <div class="bars-container">${bars}</div>
      </div>
    `;
  }).join('');
}

// ─── 3. Client-Side OCR ─────────────────────────────────────────────────────
async function runClientOcr(videoEl) {
  if (isOcrProcessing || typeof Tesseract === 'undefined') return;
  isOcrProcessing = true;

  const box = document.getElementById('ocrOutputBox');
  box.textContent = 'Extracting text...';

  try {
    const offCanvas = document.createElement('canvas');
    offCanvas.width = videoEl.videoWidth || 640;
    offCanvas.height = videoEl.videoHeight || 480;
    const offCtx = offCanvas.getContext('2d');
    offCtx.drawImage(videoEl, 0, 0);

    const { data: { text } } = await Tesseract.recognize(offCanvas, 'eng');
    const clean = text.trim();
    box.textContent = clean || 'No text detected in scene. Point camera at printed text.';
  } catch (e) {
    box.textContent = 'OCR Scan complete. Point at clear text.';
  } finally {
    isOcrProcessing = false;
  }
}

function runManualOcr() {
  const video = document.getElementById('webcamVideo');
  if (isWebcamRunning) {
    runClientOcr(video);
  } else {
    alert('Please start the camera first or upload an image.');
  }
}

function copyOcrText() {
  const box = document.getElementById('ocrOutputBox');
  const txt = box.textContent;
  if (!txt || txt.includes('Scanning')) return;
  navigator.clipboard.writeText(txt).then(() => {
    alert('Copied to clipboard!');
  });
}

// ─── 4. Client-Side Surveillance System ─────────────────────────────────────
function renderSurveillance(video, ctx, w, h) {
  const offCanvas = document.createElement('canvas');
  offCanvas.width = 64;
  offCanvas.height = 48;
  const offCtx = offCanvas.getContext('2d');
  offCtx.drawImage(video, 0, 0, 64, 48);

  const curData = offCtx.getImageData(0, 0, 64, 48).data;
  let motionPixels = 0;

  if (lastFrameData) {
    for (let i = 0; i < curData.length; i += 4) {
      const diff = Math.abs(curData[i] - lastFrameData[i]) +
                   Math.abs(curData[i+1] - lastFrameData[i+1]) +
                   Math.abs(curData[i+2] - lastFrameData[i+2]);
      if (diff > 80) motionPixels++;
    }
  }
  lastFrameData = curData;

  const isIntruder = motionPixels > 120;
  const banner = document.getElementById('surveillanceBanner');
  const title = document.getElementById('survStatusTitle');
  const sub = document.getElementById('survStatusSub');

  if (isIntruder) {
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 8;
    ctx.strokeRect(0, 0, w, h);

    banner.className = 'alert-banner danger pulse-danger';
    title.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> MOTION / INTRUSION ALERT';
    sub.textContent = 'Significant motion detected in monitored zone!';

    const now = Date.now();
    if (surveillanceIncidents.length === 0 || now - surveillanceIncidents[0].timeMs > 3000) {
      surveillanceIncidents.unshift({
        time: new Date().toLocaleTimeString(),
        timeMs: now,
        type: 'Motion Intrusion'
      });
      renderIncidents();
    }
  } else {
    banner.className = 'alert-banner';
    title.innerHTML = '<i class="fa-solid fa-shield-check"></i> Monitoring Active - All Clear';
    sub.textContent = 'Zero intrusions detected. Area secured.';
  }
}

function renderIncidents() {
  const listEl = document.getElementById('alertsList');
  if (surveillanceIncidents.length === 0) {
    listEl.innerHTML = '<div class="empty-state">No security incidents recorded</div>';
    return;
  }
  listEl.innerHTML = surveillanceIncidents.slice(0, 10).map(inc => `
    <div class="incident-item">
      <div class="incident-header">
        <span class="incident-type"><i class="fa-solid fa-circle-exclamation text-danger"></i> ${inc.type}</span>
        <span class="incident-time">${inc.time}</span>
      </div>
      <div class="incident-details">Triggered in live camera feed</div>
    </div>
  `).join('');
}

function clearIncidents() {
  surveillanceIncidents = [];
  renderIncidents();
}

// ─── Test Image Upload ───────────────────────────────────────────────────────
async function handleImageFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  const img = new Image();
  img.src = URL.createObjectURL(file);
  img.onload = async () => {
    const canvas = document.getElementById('overlayCanvas');
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;

    ctx.drawImage(img, 0, 0);

    if (currentMode === 'object_detection' && cocoModel) {
      const preds = await cocoModel.detect(img);
      renderObjects(preds, ctx, img.width, img.height);
    } else if (currentMode === 'emotion' && isFaceApiLoaded) {
      const dets = await faceapi
        .detectAllFaces(img, new faceapi.TinyFaceDetectorOptions())
        .withFaceExpressions();
      renderEmotions(dets, ctx);
    } else if (currentMode === 'ocr') {
      const { data: { text } } = await Tesseract.recognize(img, 'eng');
      document.getElementById('ocrOutputBox').textContent = text.trim() || 'No text recognized.';
    }
  };
}

// ─── Fullscreen & Keyboard Hotkeys ───────────────────────────────────────────
function toggleFullscreen() {
  const vp = document.getElementById('videoViewport');
  if (!document.fullscreenElement) vp.requestFullscreen();
  else document.exitFullscreen();
}

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === '1') setMode('object_detection');
  if (e.key === '2') setMode('emotion');
  if (e.key === '3') setMode('ocr');
  if (e.key === '4') setMode('surveillance');
  if (e.key === ' ' || e.code === 'Space') {
    e.preventDefault();
    toggleWebcam();
  }
});
