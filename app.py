"""
Video Analytics Pro - All-in-One Multi-Task Video Analytics Platform
1. Real-time Object Detection (YOLOv8)
2. Facial Emotion Recognition (MTCNN + DeepFace)
3. Optical Character Recognition - OCR (EasyOCR)
4. Smart Surveillance & Intrusion Detection (MOG2 Motion + YOLO Person)
"""

import os
import sys
import cv2
import json
import time
import base64
import threading
from datetime import datetime
import numpy as np
from flask import Flask, render_template, Response, request, jsonify
from flask_cors import CORS
from PIL import Image

# Force UTF-8 on Windows
if sys.platform.startswith('win'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

app = Flask(__name__)
CORS(app)

# Storage paths
UPLOAD_FOLDER = 'uploads'
ALERT_FOLDER  = os.path.join('static', 'alerts')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(ALERT_FOLDER,  exist_ok=True)

# ─── Global State & Threading ────────────────────────────────────────────────
camera_lock = threading.Lock()
camera_active = False
camera_cap = None
active_camera_index = 1   # Index 1 is the physical webcam on this machine

latest_raw_frame = None
latest_processed_frame = None
processing_lock = threading.Lock()

current_mode = 'object_detection'   # 'object_detection', 'emotion', 'ocr', 'surveillance'
detection_results = {
    'object_detection': {'objects': [], 'count': 0},
    'emotion': {'faces': [], 'count': 0},
    'ocr': {'text': ''},
    'surveillance': {'alert': False, 'motions': 0}
}
surveillance_alerts = []

# ─── 1. Load YOLOv8 Model ────────────────────────────────────────────────────
print("[INFO] Loading YOLOv8 nano model...")
yolo_model = None
YOLO_READY = False
try:
    from ultralytics import YOLO
    yolo_model = YOLO('yolov8n.pt')
    YOLO_READY = True
    print("[INFO] YOLOv8 loaded successfully ✓")
except Exception as e:
    print(f"[ERROR] Failed to load YOLO: {e}")

# ─── 2. Load MTCNN & DeepFace for Facial Emotion Recognition ──────────────────
print("[INFO] Loading Face Detection (MTCNN) and Emotion (DeepFace)...")
mtcnn_detector = None
MTCNN_READY = False
try:
    from facenet_pytorch import MTCNN
    mtcnn_detector = MTCNN(keep_all=True, device='cpu', thresholds=[0.6, 0.7, 0.7])
    MTCNN_READY = True
    print("[INFO] MTCNN Face Detector loaded ✓")
except Exception as e:
    print(f"[WARN] MTCNN load error: {e}")

DEEPFACE_READY = False
try:
    from deepface import DeepFace
    # Warm up / verify emotion model with dummy image
    dummy_warmup = np.full((100, 100, 3), 128, dtype=np.uint8)
    _ = DeepFace.analyze(dummy_warmup, actions=['emotion'], detector_backend='skip', enforce_detection=False, silent=True)
    DEEPFACE_READY = True
    print("[INFO] DeepFace Emotion Model loaded and warmed up ✓")
except Exception as e:
    print(f"[WARN] DeepFace warm-up error: {e}")

EMOTION_COLORS = {
    'angry':    (30, 30, 230),
    'disgust':  (50, 180, 50),
    'fear':     (180, 30, 180),
    'happy':    (30, 210, 30),
    'neutral':  (180, 180, 180),
    'sad':      (220, 120, 30),
    'surprise': (30, 200, 240),
}

# ─── 3. Load EasyOCR ──────────────────────────────────────────────────────────
print("[INFO] Loading EasyOCR engine...")
ocr_reader = None
OCR_READY = False
try:
    import easyocr
    ocr_reader = easyocr.Reader(['en'], gpu=False, verbose=False)
    OCR_READY = True
    print("[INFO] EasyOCR loaded successfully ✓")
except Exception as e:
    print(f"[WARN] EasyOCR load error: {e}")

# ─── 4. Surveillance Setup (MOG2 Background Subtraction) ─────────────────────
class MotionDetector:
    def __init__(self):
        self.bg_sub = cv2.createBackgroundSubtractorMOG2(history=300, varThreshold=30, detectShadows=True)
        self.kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        self.min_area = 2500

    def get_motion_boxes(self, frame):
        fg_mask = self.bg_sub.apply(frame)
        fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_OPEN, self.kernel)
        fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_CLOSE, self.kernel)
        contours, _ = cv2.findContours(fg_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        boxes = []
        for c in contours:
            if cv2.contourArea(c) > self.min_area:
                boxes.append(cv2.boundingRect(c))
        return boxes

motion_detector = MotionDetector()

# ─── Camera Acquisition Thread ───────────────────────────────────────────────
def find_working_camera():
    """Probe for available cameras and return the first working index."""
    # Probe index 1 first (usually external or built-in webcam on laptop), then 0, then 2
    for idx in [1, 0, 2]:
        test_cap = cv2.VideoCapture(idx)
        if test_cap.isOpened():
            ret, frame = test_cap.read()
            test_cap.release()
            if ret and frame is not None and frame.size > 0:
                print(f"[INFO] Found working webcam at camera index {idx}")
                return idx
    return 1

def camera_grab_loop():
    """High-performance thread continuously grabbing camera frames."""
    global camera_cap, camera_active, latest_raw_frame
    while True:
        if camera_active:
            with camera_lock:
                if camera_cap is not None and camera_cap.isOpened():
                    ret, frame = camera_cap.read()
                    if ret and frame is not None:
                        with processing_lock:
                            latest_raw_frame = frame
        time.sleep(0.01)

cam_thread = threading.Thread(target=camera_grab_loop, daemon=True)
cam_thread.start()

# ─── Analytics Worker Thread ─────────────────────────────────────────────────
# Heavy tasks like OCR or DeepFace run in an async worker loop without stalling video
cached_ocr_text = ""
cached_emotion_data = []
cached_objects_data = []
cached_surveillance_data = {'alert': False, 'motions': 0}

last_ocr_time = 0
last_emotion_time = 0

def analytics_worker_loop():
    """Background worker for AI processing."""
    global cached_ocr_text, cached_emotion_data, cached_objects_data, cached_surveillance_data
    global last_ocr_time, last_emotion_time, surveillance_alerts

    while True:
        if not camera_active or latest_raw_frame is None:
            time.sleep(0.05)
            continue

        with processing_lock:
            frame_copy = latest_raw_frame.copy()
        now = time.time()

        try:
            # 1. OBJECT DETECTION
            if current_mode == 'object_detection':
                if YOLO_READY and yolo_model is not None:
                    res = yolo_model(frame_copy, conf=0.35, verbose=False)
                    objs = []
                    for r in res:
                        for box in r.boxes:
                            cls = int(box.cls[0])
                            conf = float(box.conf[0])
                            label = yolo_model.names[cls]
                            x1, y1, x2, y2 = map(int, box.xyxy[0])
                            objs.append({
                                'label': label,
                                'confidence': round(conf, 2),
                                'bbox': [x1, y1, x2, y2]
                            })
                    cached_objects_data = objs
                    detection_results['object_detection'] = {
                        'objects': objs,
                        'count': len(objs)
                    }
                time.sleep(0.02)

            # 2. EMOTION RECOGNITION (Throttle to every ~0.2s for silky smooth FPS)
            elif current_mode == 'emotion':
                if now - last_emotion_time >= 0.2:
                    last_emotion_time = now
                    faces = []
                    if MTCNN_READY and mtcnn_detector is not None:
                        rgb = cv2.cvtColor(frame_copy, cv2.COLOR_BGR2RGB)
                        pil_img = Image.fromarray(rgb)
                        boxes, _ = mtcnn_detector.detect(pil_img)

                        if boxes is not None:
                            h, w = frame_copy.shape[:2]
                            for box in boxes:
                                x1, y1, x2, y2 = [int(v) for v in box]
                                x1, y1 = max(0, x1), max(0, y1)
                                x2, y2 = min(w, x2), min(h, y2)
                                bw, bh = x2 - x1, y2 - y1

                                if bw > 20 and bh > 20:
                                    face_crop = frame_copy[y1:y2, x1:x2]
                                    dom_emotion = 'neutral'
                                    scores = {}
                                    if DEEPFACE_READY:
                                        try:
                                            df_res = DeepFace.analyze(
                                                face_crop,
                                                actions=['emotion'],
                                                detector_backend='skip',
                                                enforce_detection=False,
                                                silent=True
                                            )
                                            if isinstance(df_res, list) and len(df_res) > 0:
                                                df_res = df_res[0]
                                            dom_emotion = df_res.get('dominant_emotion', 'neutral')
                                            # Convert float32 scores to regular float rounded
                                            raw_scores = df_res.get('emotion', {})
                                            scores = {k: round(float(v), 1) for k, v in raw_scores.items()}
                                        except Exception:
                                            pass

                                    faces.append({
                                        'emotion': dom_emotion,
                                        'scores': scores,
                                        'bbox': [x1, y1, x2, y2]
                                    })
                        cached_emotion_data = faces
                        detection_results['emotion'] = {
                            'faces': faces,
                            'count': len(faces)
                        }
                time.sleep(0.03)

            # 3. OCR (Runs every ~1.2s to prevent frame drop)
            elif current_mode == 'ocr':
                if now - last_ocr_time >= 1.2:
                    last_ocr_time = now
                    if OCR_READY and ocr_reader is not None:
                        # Preprocess crop or center region for faster OCR
                        gray = cv2.cvtColor(frame_copy, cv2.COLOR_BGR2GRAY)
                        # Denoise & contrast stretch
                        gray = cv2.equalizeHist(gray)
                        lines = ocr_reader.readtext(gray, detail=0, paragraph=True)
                        extracted = '\n'.join([l.strip() for l in lines if l.strip()])
                        if extracted:
                            cached_ocr_text = extracted
                        detection_results['ocr'] = {'text': cached_ocr_text or "Scanning for text..."}
                time.sleep(0.05)

            # 4. SURVEILLANCE & INTRUSION DETECTION
            elif current_mode == 'surveillance':
                motion_boxes = motion_detector.get_motion_boxes(frame_copy)
                alert_active = False

                # Check if motion is present
                if len(motion_boxes) > 0:
                    alert_active = True

                # Check for persons using YOLO
                person_detected = False
                person_boxes = []
                if YOLO_READY and yolo_model is not None and len(motion_boxes) > 0:
                    res = yolo_model(frame_copy, classes=[0], conf=0.4, verbose=False)
                    for r in res:
                        for box in r.boxes:
                            x1, y1, x2, y2 = map(int, box.xyxy[0])
                            person_boxes.append((x1, y1, x2, y2))
                            person_detected = True
                            alert_active = True

                cached_surveillance_data = {
                    'alert': alert_active,
                    'motions': len(motion_boxes),
                    'motion_boxes': motion_boxes,
                    'person_boxes': person_boxes,
                    'person_detected': person_detected
                }
                detection_results['surveillance'] = {
                    'alert': alert_active,
                    'motions': len(motion_boxes),
                    'person_detected': person_detected
                }

                # Log alert event
                if alert_active:
                    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    # Rate limit duplicate alerts to 1 every 2 seconds
                    if len(surveillance_alerts) == 0 or (surveillance_alerts[0].get('timestamp', 0) < now - 2.0):
                        alert_item = {
                            'time': ts,
                            'timestamp': now,
                            'type': 'Person Intrusion' if person_detected else 'Motion Detected',
                            'zones': len(motion_boxes)
                        }
                        surveillance_alerts.insert(0, alert_item)
                        surveillance_alerts = surveillance_alerts[:30]

                time.sleep(0.03)

        except Exception as e:
            time.sleep(0.05)

analytics_thread = threading.Thread(target=analytics_worker_loop, daemon=True)
analytics_thread.start()

# ─── Frame Rendering Pipeline ────────────────────────────────────────────────
def render_hud_overlay(frame, title, status_text, color):
    """Draw a professional HUD status bar at the top."""
    h, w = frame.shape[:2]
    # Semi-transparent top bar
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (w, 52), (15, 20, 30), -1)
    cv2.addWeighted(overlay, 0.75, frame, 0.25, 0, frame)
    # Title
    cv2.putText(frame, title.upper(), (15, 25), cv2.FONT_HERSHEY_DUPLEX, 0.65, (255, 255, 255), 1)
    # Timestamp
    ts = datetime.now().strftime("%H:%M:%S")
    cv2.putText(frame, ts, (w - 110, 25), cv2.FONT_HERSHEY_DUPLEX, 0.6, (180, 180, 180), 1)
    # Status / Alert indicator
    cv2.circle(frame, (22, 42), 6, color, -1)
    cv2.putText(frame, status_text, (36, 46), cv2.FONT_HERSHEY_SIMPLEX, 0.52, color, 1)

def draw_tag(frame, text, pt, color=(0, 255, 0)):
    x, y = pt
    (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)
    cv2.rectangle(frame, (x, y - th - 8), (x + tw + 6, y + 2), color, -1)
    cv2.putText(frame, text, (x + 3, y - 3), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 1, cv2.LINE_AA)

def generate_video_stream():
    """Generates continuous MJPEG frames with real-time analytics overlay."""
    global latest_raw_frame

    while True:
        if not camera_active or latest_raw_frame is None:
            time.sleep(0.03)
            continue

        with processing_lock:
            frame = latest_raw_frame.copy()

        h, w = frame.shape[:2]

        try:
            # ─── MODE 1: OBJECT DETECTION ───
            if current_mode == 'object_detection':
                for obj in cached_objects_data:
                    x1, y1, x2, y2 = obj['bbox']
                    label = f"{obj['label']} {int(obj['confidence']*100)}%"
                    color = (0, 220, 100)
                    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                    draw_tag(frame, label, (x1, y1), color)
                status_msg = f"Objects Detected: {len(cached_objects_data)}"
                render_hud_overlay(frame, "Object Detection (YOLOv8)", status_msg, (0, 220, 100))

            # ─── MODE 2: EMOTION RECOGNITION ───
            elif current_mode == 'emotion':
                for f in cached_emotion_data:
                    x1, y1, x2, y2 = f['bbox']
                    emo = f['emotion']
                    color = EMOTION_COLORS.get(emo, (200, 200, 200))
                    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                    label = f"{emo.upper()}"
                    draw_tag(frame, label, (x1, y1), color)

                    # Draw mini score bars on the side of the box
                    scores = f.get('scores', {})
                    if scores:
                        bx = x2 + 6
                        by = y1
                        for idx, (em_name, sc) in enumerate(scores.items()):
                            if bx + 80 < w and by + (idx * 16) + 12 < h:
                                row_y = by + (idx * 16)
                                cv2.putText(frame, f"{em_name[:3]}: {int(sc)}%", (bx, row_y + 10),
                                            cv2.FONT_HERSHEY_SIMPLEX, 0.38, (255, 255, 255), 1)

                status_msg = f"Faces: {len(cached_emotion_data)}"
                render_hud_overlay(frame, "Facial Emotion Recognition", status_msg, (255, 200, 0))

            # ─── MODE 3: OCR TEXT ───
            elif current_mode == 'ocr':
                # Bottom semi-transparent overlay banner showing extracted text
                overlay = frame.copy()
                cv2.rectangle(overlay, (0, h - 140), (w, h), (10, 15, 25), -1)
                cv2.addWeighted(overlay, 0.8, frame, 0.2, 0, frame)

                cv2.putText(frame, "RECOGNIZED TEXT:", (15, h - 115),
                            cv2.FONT_HERSHEY_DUPLEX, 0.5, (0, 220, 255), 1)

                display_lines = (cached_ocr_text or "Point camera at printed text / paper...").split('\n')
                for i, ln in enumerate(display_lines[:4]):
                    cv2.putText(frame, ln[:80], (15, h - 90 + (i * 22)),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 120), 1)

                render_hud_overlay(frame, "Optical Character Recognition (OCR)", "Live Text Extractor", (0, 220, 255))

            # ─── MODE 4: SURVEILLANCE ───
            elif current_mode == 'surveillance':
                m_data = cached_surveillance_data
                is_alert = m_data.get('alert', False)

                # Draw motion boxes (Orange)
                for (mx, my, mw, mh) in m_data.get('motion_boxes', []):
                    cv2.rectangle(frame, (mx, my), (mx + mw, my + mh), (0, 140, 255), 2)
                    cv2.putText(frame, "MOTION", (mx, my - 6),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.48, (0, 140, 255), 1)

                # Draw person intrusion boxes (Red)
                for (px1, py1, px2, py2) in m_data.get('person_boxes', []):
                    cv2.rectangle(frame, (px1, py1), (px2, py2), (0, 0, 255), 3)
                    draw_tag(frame, "INTRUDER", (px1, py1), (0, 0, 255))

                if is_alert:
                    status_text = "WARNING: INTRUSION / MOTION DETECTED"
                    hud_color = (0, 0, 255)
                    # Flashing red border on alert
                    cv2.rectangle(frame, (0, 0), (w - 1, h - 1), (0, 0, 255), 4)
                else:
                    status_text = "SURVEILLANCE ACTIVE - ALL CLEAR"
                    hud_color = (0, 230, 0)

                render_hud_overlay(frame, "Security Surveillance System", status_text, hud_color)

        except Exception as e:
            cv2.putText(frame, f"Render error: {e}", (10, 80), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)

        # Encode frame as JPEG
        ret, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        if ret:
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')

        time.sleep(0.025)   # ~35 FPS smooth stream

# ─── API Routes ───────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/video_feed')
def video_feed():
    return Response(generate_video_stream(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/start_camera', methods=['POST'])
def start_camera():
    global camera_cap, camera_active, active_camera_index
    req_index = request.json.get('index', active_camera_index) if request.json else active_camera_index

    with camera_lock:
        if camera_cap is not None:
            camera_cap.release()
            camera_cap = None

        # Try requested index first, then auto-discover
        indices_to_try = [req_index] + [i for i in [1, 0, 2] if i != req_index]
        opened = False
        for idx in indices_to_try:
            cap = cv2.VideoCapture(idx)
            if cap.isOpened():
                ret, test_frame = cap.read()
                if ret and test_frame is not None:
                    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
                    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
                    camera_cap = cap
                    active_camera_index = idx
                    camera_active = True
                    opened = True
                    print(f"[INFO] Camera started successfully on index {idx}")
                    break
                else:
                    cap.release()

        if not opened:
            # Fallback to index 0 even if read returns False initially
            camera_cap = cv2.VideoCapture(0)
            camera_active = True
            active_camera_index = 0

    return jsonify({'status': 'started', 'camera_index': active_camera_index})

@app.route('/stop_camera', methods=['POST'])
def stop_camera():
    global camera_cap, camera_active, latest_raw_frame
    camera_active = False
    with camera_lock:
        if camera_cap:
            camera_cap.release()
            camera_cap = None
    with processing_lock:
        latest_raw_frame = None
    return jsonify({'status': 'stopped'})

@app.route('/set_mode', methods=['POST'])
def set_mode():
    global current_mode, cached_objects_data, cached_emotion_data, cached_surveillance_data
    data = request.get_json() or {}
    mode = data.get('mode')
    if mode in ['object_detection', 'emotion', 'ocr', 'surveillance']:
        current_mode = mode
        # Clear transient data of previous mode
        cached_objects_data = []
        cached_emotion_data = []
        cached_surveillance_data = {'alert': False, 'motions': 0}
        return jsonify({'status': 'ok', 'mode': current_mode})
    return jsonify({'status': 'error', 'message': 'Invalid mode'}), 400

@app.route('/get_results')
def get_results():
    return jsonify({
        'mode': current_mode,
        'results': detection_results.get(current_mode, {}),
        'camera_active': camera_active
    })

@app.route('/get_alerts')
def get_alerts():
    return jsonify({'alerts': surveillance_alerts})

@app.route('/system_status')
def system_status():
    return jsonify({
        'yolo': YOLO_READY,
        'emotion': DEEPFACE_READY and MTCNN_READY,
        'ocr': OCR_READY,
        'surveillance': True,
        'camera': camera_active,
        'camera_index': active_camera_index,
        'mode': current_mode
    })

# ─── Single Image & File Upload Endpoint ──────────────────────────────────────
@app.route('/upload_image', methods=['POST'])
def upload_image():
    if 'image' not in request.files:
        return jsonify({'error': 'No image provided'}), 400

    file = request.files['image']
    img_bytes = np.frombuffer(file.read(), np.uint8)
    frame = cv2.imdecode(img_bytes, cv2.IMREAD_COLOR)

    if frame is None:
        return jsonify({'error': 'Failed to decode image'}), 400

    mode = request.form.get('mode', current_mode)
    res_data = {}

    try:
        # 1. Object Detection
        if mode == 'object_detection':
            if YOLO_READY and yolo_model:
                r = yolo_model(frame, conf=0.35, verbose=False)[0]
                objs = []
                for box in r.boxes:
                    cls = int(box.cls[0])
                    conf = float(box.conf[0])
                    label = yolo_model.names[cls]
                    x1, y1, x2, y2 = map(int, box.xyxy[0])
                    cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 220, 100), 2)
                    draw_tag(frame, f"{label} {int(conf*100)}%", (x1, y1), (0, 220, 100))
                    objs.append({'label': label, 'confidence': round(conf, 2)})
                res_data = {'objects': objs, 'count': len(objs)}

        # 2. Emotion Recognition
        elif mode == 'emotion':
            faces = []
            if MTCNN_READY and mtcnn_detector:
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                boxes, _ = mtcnn_detector.detect(Image.fromarray(rgb))
                if boxes is not None:
                    h, w = frame.shape[:2]
                    for box in boxes:
                        x1, y1, x2, y2 = [int(v) for v in box]
                        x1, y1 = max(0, x1), max(0, y1)
                        x2, y2 = min(w, x2), min(h, y2)
                        crop = frame[y1:y2, x1:x2]
                        if crop.shape[0] > 15 and crop.shape[1] > 15:
                            df_res = DeepFace.analyze(crop, actions=['emotion'], detector_backend='skip', enforce_detection=False, silent=True)
                            if isinstance(df_res, list): df_res = df_res[0]
                            dom = df_res.get('dominant_emotion', 'neutral')
                            scores = {k: round(float(v), 1) for k, v in df_res.get('emotion', {}).items()}
                            color = EMOTION_COLORS.get(dom, (255, 255, 255))
                            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                            draw_tag(frame, dom.upper(), (x1, y1), color)
                            faces.append({'emotion': dom, 'scores': scores})
            res_data = {'faces': faces, 'count': len(faces)}

        # 3. OCR Text
        elif mode == 'ocr':
            text = ""
            if OCR_READY and ocr_reader:
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                lines = ocr_reader.readtext(gray, detail=0, paragraph=True)
                text = '\n'.join(lines)
            res_data = {'text': text or "No text recognized."}

        # 4. Surveillance
        elif mode == 'surveillance':
            # Run person detection
            persons = []
            if YOLO_READY and yolo_model:
                r = yolo_model(frame, classes=[0], conf=0.35, verbose=False)[0]
                for box in r.boxes:
                    x1, y1, x2, y2 = map(int, box.xyxy[0])
                    cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 0, 255), 3)
                    draw_tag(frame, "PERSON INTRUDER", (x1, y1), (0, 0, 255))
                    persons.append([x1, y1, x2, y2])
            res_data = {'alert': len(persons) > 0, 'persons_found': len(persons)}

        # Encode processed image
        _, buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
        img_b64 = base64.b64encode(buf).decode('utf-8')
        return jsonify({'result': res_data, 'image': img_b64})

    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ─── Main Entry Point ────────────────────────────────────────────────────────
if __name__ == '__main__':
    print("\n" + "="*65)
    print("      🚀 VIDEO ANALYTICS PRO - ALL-IN-ONE SYSTEM 🚀")
    print("      Object Detection | Emotion | OCR | Surveillance")
    print(f"      • YOLOv8 Nano:      {'✓ READY' if YOLO_READY else '✗'}")
    print(f"      • Emotion (DeepFace):{'✓ READY' if DEEPFACE_READY else '✗'}")
    print(f"      • EasyOCR:          {'✓ READY' if OCR_READY else '✗'}")
    print(f"      • Surveillance:     {'✓ READY'}")
    print("="*65)
    print("      🌐 Web UI: http://127.0.0.1:5000")
    print("="*65 + "\n")
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)
