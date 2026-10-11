@echo off
title NoPayStation Modern Frontend & Manager
echo Starting NoPayStation Server...
cd /d "%~dp0"
start http://localhost:3000
node server.js
pause
