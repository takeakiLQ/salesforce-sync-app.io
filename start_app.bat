@echo off
cd /d %~dp0
start "" http://localhost:3000
npx serve -s build -l 3000
pause
