---
title: VideoAnalytics Pro
emoji: 🎥
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# 🎥 VideoAnalytics Pro

An end-to-end multi-task Video Analytics platform powered by Computer Vision and Deep Learning. Features real-time **Object Detection**, **Facial Emotion Recognition**, **Optical Character Recognition (OCR)**, and an intelligent **Security Surveillance System** in a single web dashboard.

---

## 🌟 Key Features

### 1. 🔍 Real-Time Object Detection
- Powered by **Ultralytics YOLOv8** (Nano model for real-time edge performance).
- Detects and classifies **80 MS-COCO object categories** (people, vehicles, electronics, animals, etc.).
- Bounding box rendering with real-time confidence scores and group counts.

### 2. 😊 Facial Emotion Recognition
- Powered by **MTCNN** for deep face localization and **DeepFace** for facial emotion classification.
- Classifies 7 core human emotional states in real-time:
  - 😡 Angry
  - 🤢 Disgust
  - 😨 Fear
  - 😊 Happy
  - 😐 Neutral
  - 😢 Sad
  - 😲 Surprise
- Live percentage breakdown bars for every detected face.

### 3. 📝 Optical Character Recognition (OCR)
- Powered by **EasyOCR** with deep learning text detection and recognition.
- Asynchronous processing pipeline prevents video stream freezing.
- Real-time text extraction with one-click **Copy to Clipboard** feature.

### 4. 🛡️ Intelligent Surveillance & Intrusion Detection
- Powered by **MOG2 Background Subtraction** and **YOLOv8 Human Intrusion Detection**.
- Real-time motion contour bounding boxes and person intrusion alerts.
- Visual flashing alarm HUD with a live timestamped incident logging system.

---

## 🛠️ System Architecture

- **Backend**: Python 3.11, Flask, Flask-CORS
- **Computer Vision**: OpenCV (cv2), PIL (Pillow)
- **Deep Learning**: PyTorch, TorchVision, Ultralytics YOLOv8, MTCNN (FaceNet-PyTorch), DeepFace, EasyOCR
- **Frontend**: HTML5, Modern Dark Theme CSS3, JavaScript (ES6+), FontAwesome 6
- **Streaming**: High-performance multi-threaded MJPEG stream at ~35 FPS

---

## 🚀 Getting Started

### Prerequisites
- Python 3.10 or 3.11 installed
- A working webcam

### 1. Clone the Repository
```bash
git clone https://github.com/Aman42942/VideoAnalytics-Pro.git
cd VideoAnalytics-Pro
```

### 2. Install Dependencies
```bash
pip install -r requirements.txt
```

### 3. Run the Application
**On Windows:**
Double-click `run.bat` or run:
```bash
python app.py
```

**Access the Web Dashboard:**
Open your web browser and navigate to:
```
http://127.0.0.1:5000
```

---

## ⌨️ Keyboard Shortcuts

| Key | Action |
|---|---|
| `1` | Switch to Object Detection |
| `2` | Switch to Facial Emotion Recognition |
| `3` | Switch to Optical Character Recognition (OCR) |
| `4` | Switch to Surveillance & Intrusion System |
| `Space` | Toggle Camera On / Off |
| `Esc` | Close Upload Modal |

---

## 📁 Project Structure

```
├── app.py                # Main Flask backend with 4 AI analytics pipelines
├── requirements.txt      # Project dependencies
├── run.bat               # Windows one-click launcher
├── yolov8n.pt            # YOLOv8 nano model weights
├── static/
│   ├── css/
│   │   └── style.css     # Modern responsive dark theme styling
│   ├── js/
│   │   └── app.js        # Dynamic frontend controller & telemetry polling
│   └── alerts/           # Incident snapshots and logs
└── templates/
    └── index.html        # Unified single-page web dashboard
```

---

## 👨‍💻 Author
- **Aman** - [GitHub Profile](https://github.com/Aman42942)
