@echo off
title Share Video Analytics Live
color 0A
cls
echo ======================================================================
echo          CREATING INSTANT PUBLIC LIVE URL FOR VIDEO ANALYTICS
echo ======================================================================
echo.

curl -s https://loca.lt/mytunnelpassword > "%temp%\localtunnel_ip.txt"
set /p TUNNEL_PASS=<"%temp%\localtunnel_ip.txt"

echo  -------------------------------------------------------------
echo   YOUR LIVE TUNNEL PASSWORD / IP IS:  %TUNNEL_PASS%
echo  -------------------------------------------------------------
echo   Share this password along with the live URL generated below!
echo.

npx.cmd localtunnel --port 5000

pause
