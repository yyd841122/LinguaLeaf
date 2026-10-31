@echo off
rem LinguaLeaf stop entry - graceful SIGTERM to the launcher-managed
rem instance inside WSL. Never kills by port; reports and keeps records on
rem timeout.
wsl.exe -d Ubuntu-24.04 -u youyd --cd /home/youyd/projects/claudeProjects/LinguaLeaf -- /bin/bash scripts/launcher/stop.sh
if errorlevel 1 (
  echo.
  echo LinguaLeaf stop failed - see the message above.
  pause
  exit /b 1
)
exit /b 0
