@echo off
setlocal
cd /d "%~dp0frontend"

if not exist "node_modules" (
  echo Frontend dependencies are missing. Run setup.cmd first.
  pause
  exit /b 1
)

echo Frontend: http://127.0.0.1:5173
call npm.cmd run dev
