@echo off
cd /d "%~dp0"
echo Starting Finesse...
start "" http://localhost:5173
npm run dev
