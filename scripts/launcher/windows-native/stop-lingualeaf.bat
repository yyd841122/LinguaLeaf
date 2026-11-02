@echo off
setlocal
cd /d "%~dp0"
if not exist ".data\server.pid" (
  echo No running LinguaLeaf record. Nothing to stop.
  timeout /t 3 /nobreak >nul
  exit /b 0
)
set /p PID=<".data\server.pid"
if "%PID%"=="" (
  echo PID file is empty or unreadable - cannot stop reliably. Delete .data\server.pid if the server is already gone.
  pause
  exit /b 1
)
rem /F is required: a detached node process has no window, so the graceful
rem WM_CLOSE delivery reports success while the process ignores it. The
rem server is crash-tolerant (SQLite in WAL mode), so termination is safe.
taskkill /F /PID %PID% >nul 2>&1
del ".data\server.pid" >nul 2>&1
echo LinguaLeaf stopped.
timeout /t 3 /nobreak >nul
