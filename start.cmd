@echo off
setlocal
cd /d "%~dp0"

if not exist "backend\.venv\Scripts\python.exe" (
  echo Dependencies are not ready. Run setup.cmd first.
  pause
  exit /b 1
)
if not exist "frontend\node_modules" (
  echo Dependencies are not ready. Run setup.cmd first.
  pause
  exit /b 1
)

echo [Startup check] Verifying ports 8000 and 5173...
netstat -ano -p tcp | findstr /R /C:":8000 .*LISTENING" >nul
if not errorlevel 1 (
  echo [ERROR] Port 8000 is already in use by an old backend process.
  echo Close the old Ontology API window or stop that process, then run start.cmd again.
  pause
  exit /b 1
)
netstat -ano -p tcp | findstr /R /C:":5173 .*LISTENING" >nul
if not errorlevel 1 (
  echo [ERROR] Port 5173 is already in use by an old frontend process.
  echo Close the old Ontology Frontend window or stop that process, then run start.cmd again.
  pause
  exit /b 1
)

start "Ontology API" cmd /k call "%~dp0start-backend.cmd"
start "Ontology Frontend" cmd /k call "%~dp0start-frontend.cmd"
timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:5173"

echo Ontology Visualization is starting in two terminal windows.
