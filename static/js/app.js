/**
 * Video Analytics Pro - Frontend JavaScript Controller
 * High-performance, reactive UI for Real-time Computer Vision
 */

let currentMode = 'object_detection';
let isCameraRunning = false;
let telemetryTimer = null;

const modeLabels = {
  object_detection: 'Object Detection (YOLOv8)',
  emotion: 'Facial Emotion Recognition',
  ocr: 'Optical Character Recognition (OCR)',
  surveillance: 'Surveillance & Intrusion Detection'
};

const emotionEmojis = {
  angry: '😡',
  disgust: '🤢',
  fear: '😨',
  happy: '😊',
  neutral: '😐',
  sad: '😢',
  surprise: '😲'
};

const emotionColorCodes = {
  angry: '#ef4444',
  disgust: '#22c55e',
  fear: '#a855f7',
  happy: '#10b981',
  neutral: '#94a3b8',
  sad: '#3b82f6',
  surprise: '#f59e0b'
};

// ─── Initialize ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initClock();
  pollSystemHealth();
  setInterval(pollSystemHealth, 3000);
});

// ─── Clock ───────────────────────────────────────────────────────────────────
function initClock() {
  const clockEl = document.getElementById('liveClock');
  function update() {
    const d = new Date();
    clockEl.textContent = d.toLocaleTimeString('en-US', { hour12: false });
  }
  update();
  setInterval(update, 1000);
}

// ─── System Health & Status ──────────────────────────────────────────────────
async function pollSystemHealth() {
  try {
    const res = await fetch('/system_status');
    const data = await res.json();

    setDot('pillYolo', data.yolo);
    setDot('pillEmo', data.emotion);
    setDot('pillOcr', data.ocr);
    setDot('pillSurv', data.surveillance);
    setDot('pillCam', data.camera);

    const camText = document.getElementById('camStatusText');
    if (data.camera) {
      camText.textContent = `Camera Active (Dev #${data.camera_index})`;
    } else {
      camText.textContent = 'Camera Off';
    }
  } catch (err) {
    // console.warn('Health poll error:', err);
  }
}

function setDot(elementId, isActive) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const dot = el.querySelector('.dot');
  if (dot) {
    dot.className = isActive ? 'dot green' : 'dot';
  }
}

// ─── Mode Switching ──────────────────────────────────────────────────────────
async function switchMode(newMode) {
  if (currentMode === newMode) return;
  currentMode = newMode;

  // 1. Update Navigation Buttons
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === newMode);
  });

  // 2. Update Video Header Badge
  const badge = document.getElementById('activeModeBadge');
  if (badge) {
    badge.textContent = modeLabels[newMode] || newMode;
  }

  // 3. Update Right Telemetry Cards
  document.querySelectorAll('.telemetry-card').forEach(card => card.classList.add('hidden'));
  const activeCard = document.getElementById(`card_${newMode}`);
  if (activeCard) {
    activeCard.classList.remove('hidden');
  }

  // 4. Notify Backend
  try {
    await fetch('/set_mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: newMode })
    });
  } catch (err) {
    console.error('Mode switch failed:', err);
  }
}

// ─── Camera Control ──────────────────────────────────────────────────────────
async function toggleCamera() {
  const btn = document.getElementById('btnToggleCam');
  const video = document.getElementById('liveVideo');
  const placeholder = document.getElementById('placeholder');
  const liveBadge = document.getElementById('liveBadge');

  if (!isCameraRunning) {
    // START CAMERA
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Initializing...';
    btn.disabled = true;

    const selectEl = document.getElementById('cameraSelect');
    const chosenIndex = parseInt(selectEl.value, 10);

    try {
      const res = await fetch('/start_camera', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index: chosenIndex })
      });
      const data = await res.json();

      isCameraRunning = true;
      btn.innerHTML = '<i class="fa-solid fa-stop"></i> Stop Camera';
      btn.className = 'cam-toggle stop';
      btn.disabled = false;

      // Mount Video Stream
      video.src = `/video_feed?t=${Date.now()}`;
      video.classList.remove('hidden');
      placeholder.classList.add('hidden');
      liveBadge.style.display = 'inline-flex';

      // Start Telemetry Polling Loop
      startTelemetryPolling();
      pollSystemHealth();

    } catch (err) {
      btn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Error Starting';
      btn.disabled = false;
      setTimeout(() => {
        btn.innerHTML = '<i class="fa-solid fa-play"></i> Start Camera';
        btn.className = 'cam-toggle start';
      }, 2000);
    }

  } else {
    // STOP CAMERA
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Stopping...';
    btn.disabled = true;

    try {
      await fetch('/stop_camera', { method: 'POST' });
    } catch (_) {}

    isCameraRunning = false;
    btn.innerHTML = '<i class="fa-solid fa-play"></i> Start Camera';
    btn.className = 'cam-toggle start';
    btn.disabled = false;

    // Unmount Video Stream
    video.src = '';
    video.classList.add('hidden');
    placeholder.classList.remove('hidden');
    liveBadge.style.display = 'none';

    stopTelemetryPolling();
    pollSystemHealth();
  }
}

function changeCameraDevice() {
  if (isCameraRunning) {
    // Restart camera with new index
    toggleCamera().then(() => {
      setTimeout(toggleCamera, 300);
    });
  }
}

// ─── Real-Time Telemetry Polling ─────────────────────────────────────────────
function startTelemetryPolling() {
  if (telemetryTimer) clearInterval(telemetryTimer);
  telemetryTimer = setInterval(pollTelemetry, 600);
}

function stopTelemetryPolling() {
  if (telemetryTimer) {
    clearInterval(telemetryTimer);
    telemetryTimer = null;
  }
}

async function pollTelemetry() {
  try {
    const res = await fetch('/get_results');
    const data = await res.json();
    const mode = data.mode;
    const results = data.results || {};

    if (mode === 'object_detection') {
      renderObjectTelemetry(results);
    } else if (mode === 'emotion') {
      renderEmotionTelemetry(results);
    } else if (mode === 'ocr') {
      renderOcrTelemetry(results);
    } else if (mode === 'surveillance') {
      renderSurveillanceTelemetry(results);
    }
  } catch (_) {}
}

// ─── 1. Render Object Detection Telemetry ────────────────────────────────────
function renderObjectTelemetry(data) {
  const countEl = document.getElementById('objCountVal');
  const tagList = document.getElementById('objTagList');

  const objs = data.objects || [];
  countEl.textContent = objs.length;

  if (objs.length === 0) {
    tagList.innerHTML = '<div class="empty-state">No objects currently detected</div>';
    return;
  }

  // Count items by label
  const counts = {};
  objs.forEach(o => {
    counts[o.label] = (counts[o.label] || 0) + 1;
  });

  tagList.innerHTML = Object.entries(counts).map(([label, count]) => `
    <div class="obj-pill">
      <span class="pill-name">${label}</span>
      <span class="pill-count">×${count}</span>
    </div>
  `).join('');
}

// ─── 2. Render Emotion Recognition Telemetry ─────────────────────────────────
function renderEmotionTelemetry(data) {
  const countEl = document.getElementById('faceCountVal');
  const container = document.getElementById('facesContainer');

  const faces = data.faces || [];
  countEl.textContent = faces.length;

  if (faces.length === 0) {
    container.innerHTML = '<div class="empty-state">Looking for human faces...</div>';
    return;
  }

  container.innerHTML = faces.map((f, i) => {
    const emotion = f.emotion || 'neutral';
    const emoji = emotionEmojis[emotion] || '😐';
    const mainColor = emotionColorCodes[emotion] || '#94a3b8';
    const scores = f.scores || {};

    const bars = Object.entries(scores).map(([emName, score]) => {
      const barColor = emotionColorCodes[emName] || '#94a3b8';
      const pct = Math.min(Math.max(score, 0), 100);
      return `
        <div class="emotion-bar-row">
          <span class="bar-label">${emName}</span>
          <div class="bar-track">
            <div class="bar-fill" style="width: ${pct}%; background-color: ${barColor};"></div>
          </div>
          <span class="bar-val">${Math.round(pct)}%</span>
        </div>
      `;
    }).join('');

    return `
      <div class="face-card">
        <div class="face-card-header">
          <span class="face-id">Face #${i + 1}</span>
          <span class="face-emotion-badge" style="background: ${mainColor}22; color: ${mainColor}; border: 1px solid ${mainColor};">
            ${emoji} ${emotion.toUpperCase()}
          </span>
        </div>
        <div class="bars-container">${bars}</div>
      </div>
    `;
  }).join('');
}

// ─── 3. Render OCR Telemetry ─────────────────────────────────────────────────
function renderOcrTelemetry(data) {
  const box = document.getElementById('ocrOutputBox');
  const text = (data.text || '').trim();
  if (text) {
    box.textContent = text;
    box.classList.remove('text-muted');
  } else {
    box.textContent = 'Point camera at printed text / document to extract...';
    box.classList.add('text-muted');
  }
}

function copyExtractedText() {
  const box = document.getElementById('ocrOutputBox');
  const text = box.textContent;
  if (!text || text.includes('Point camera')) return;

  navigator.clipboard.writeText(text).then(() => {
    const orig = box.innerHTML;
    box.textContent = '✓ Copied to clipboard!';
    setTimeout(() => { box.textContent = text; }, 1200);
  });
}

function clearOcrText() {
  document.getElementById('ocrOutputBox').textContent = 'Cleared. Ready for next text...';
}

// ─── 4. Render Surveillance Telemetry ────────────────────────────────────────
async function renderSurveillanceTelemetry(data) {
  const banner = document.getElementById('surveillanceBanner');
  const title = document.getElementById('survStatusTitle');
  const sub = document.getElementById('survStatusSub');

  if (data.alert) {
    banner.className = 'alert-banner danger pulse-danger';
    title.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> INTRUSION ALERT';
    sub.textContent = data.person_detected
      ? 'Unauthorized Person Detected in Monitored Area!'
      : 'Significant Motion Detected in Monitored Zone';
  } else {
    banner.className = 'alert-banner';
    title.innerHTML = '<i class="fa-solid fa-shield-check"></i> Monitoring Active - All Clear';
    sub.textContent = 'Zero intrusions detected. Area secured.';
  }

  // Fetch incident log
  try {
    const res = await fetch('/get_alerts');
    const json = await res.json();
    const alerts = json.alerts || [];
    const listEl = document.getElementById('alertsList');

    if (alerts.length === 0) {
      listEl.innerHTML = '<div class="empty-state">No security incidents recorded</div>';
      return;
    }

    listEl.innerHTML = alerts.slice(0, 15).map(a => `
      <div class="incident-item">
        <div class="incident-header">
          <span class="incident-type"><i class="fa-solid fa-circle-exclamation text-danger"></i> ${a.type}</span>
          <span class="incident-time">${a.time}</span>
        </div>
        <div class="incident-details">Triggered in ${a.zones || 1} motion zone(s)</div>
      </div>
    `).join('');
  } catch (_) {}
}

function clearAlertHistory() {
  document.getElementById('alertsList').innerHTML =
    '<div class="empty-state">Incident log cleared</div>';
}

// ─── Single Image Upload Handler ─────────────────────────────────────────────
async function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const modal = document.getElementById('uploadModal');
  const imgEl = document.getElementById('modalResultImg');
  const jsonEl = document.getElementById('modalJsonResult');

  jsonEl.textContent = 'Processing with ' + modeLabels[currentMode] + '...';
  imgEl.src = URL.createObjectURL(file);
  modal.classList.remove('hidden');

  const formData = new FormData();
  formData.append('image', file);
  formData.append('mode', currentMode);

  try {
    const res = await fetch('/upload_image', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();

    if (data.error) {
      jsonEl.textContent = 'Error: ' + data.error;
      return;
    }

    // Set processed annotated image
    imgEl.src = 'data:image/jpeg;base64,' + data.image;

    // Format human-friendly result summary
    const r = data.result || {};
    let textSummary = '';

    if (currentMode === 'object_detection') {
      textSummary = `Objects Found: ${r.count || 0}\n\n` +
        (r.objects || []).map(o => `• ${o.label} (${Math.round(o.confidence * 100)}% confidence)`).join('\n');
    } else if (currentMode === 'emotion') {
      textSummary = `Faces Detected: ${r.count || 0}\n\n` +
        (r.faces || []).map((f, i) =>
          `Face #${i + 1}: ${f.emotion.toUpperCase()}\n` +
          Object.entries(f.scores || {}).map(([em, sc]) => `  - ${em}: ${sc}%`).join('\n')
        ).join('\n\n');
    } else if (currentMode === 'ocr') {
      textSummary = "EXTRACTED TEXT:\n" + "─".repeat(30) + "\n" + (r.text || 'None');
    } else if (currentMode === 'surveillance') {
      textSummary = r.alert ? '⚠ INTRUDER / MOTION DETECTED!' : '✓ Scene is clear - no intruders';
    }

    jsonEl.textContent = textSummary || JSON.stringify(r, null, 2);

  } catch (err) {
    jsonEl.textContent = 'Network or processing error: ' + err.message;
  }

  // Reset file input
  e.target.value = '';
}

function closeUploadModal() {
  document.getElementById('uploadModal').classList.add('hidden');
}

function closeModalOnBackdrop(e) {
  if (e.target.id === 'uploadModal') {
    closeUploadModal();
  }
}

// ─── Fullscreen Toggle ───────────────────────────────────────────────────────
function toggleFullscreen() {
  const vp = document.getElementById('videoViewport');
  if (!document.fullscreenElement) {
    vp.requestFullscreen().catch(err => alert(`Fullscreen error: ${err.message}`));
  } else {
    document.exitFullscreen();
  }
}

// ─── Keyboard Hotkeys ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

  if (e.key === '1') switchMode('object_detection');
  if (e.key === '2') switchMode('emotion');
  if (e.key === '3') switchMode('ocr');
  if (e.key === '4') switchMode('surveillance');
  if (e.key === ' ' || e.code === 'Space') {
    e.preventDefault();
    toggleCamera();
  }
  if (e.key === 'Escape') {
    closeUploadModal();
  }
});
