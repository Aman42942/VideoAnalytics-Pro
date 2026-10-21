@echo off
title Video Analytics Pro
color 0B
cls
echo ======================================================================
echo          VIDEO ANALYTICS PRO - STARTING APPLICATION
echo       Object Detection  |  Emotion AI  |  OCR  |  Surveillance
echo ======================================================================
echo.

set PYTHON="C:\Users\amanh\AppData\Local\Programs\Python\Python311\python.exe"
set PYTHONIOENCODING=utf-8
set PORT=5000

echo [1/2] Launching AI & Computer Vision engines...
echo [2/2] Opening browser at: http://127.0.0.1:5000
echo.

start /B cmd /C "timeout /t 3 /nobreak >nul && start http://127.0.0.1:5000"

%PYTHON% app.py

pause
