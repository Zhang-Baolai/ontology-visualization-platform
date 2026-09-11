@echo off
setlocal
cd /d "%~dp0backend"

if not exist ".venv\Scripts\python.exe" (
  echo Backend environment is missing. Run setup.cmd first.
  pause
  exit /b 1
)

rem Use the bundled public examples unless the user explicitly sets ONTOLOGY_ROOT.

echo Backend: http://127.0.0.1:8000
echo API docs: http://127.0.0.1:8000/docs
".venv\Scripts\python.exe" -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
