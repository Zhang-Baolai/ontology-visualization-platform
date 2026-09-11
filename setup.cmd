@echo off
setlocal
cd /d "%~dp0"

echo [1/2] Preparing Python backend...
if not exist "backend\.venv\Scripts\python.exe" (
  py -3.12 -m venv "backend\.venv" 2>nul
  if errorlevel 1 python -m venv "backend\.venv"
)
if not exist "backend\.venv\Scripts\python.exe" (
  echo Could not create the Python virtual environment.
  echo Please install Python 3.12 and try again.
  pause
  exit /b 1
)
"backend\.venv\Scripts\python.exe" -m pip install -r "backend\requirements.txt"
if errorlevel 1 (
  echo Backend dependency installation failed.
  pause
  exit /b 1
)

echo [2/2] Preparing React frontend...
pushd frontend
call npm.cmd ci
if errorlevel 1 (
  popd
  echo Frontend dependency installation failed.
  pause
  exit /b 1
)
popd

echo.
echo Setup complete. Run start.cmd next.
pause
