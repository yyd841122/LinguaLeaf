@echo off
rem LinguaLeaf double-click entry. Desktop shortcut target: this file.
rem Starts the service inside WSL (prod build, pinned 127.0.0.1:3000), and
rem on success opens the default browser from the Windows side - per plan
rem T1/F2, browser reachability is a Windows-side fact, so the browser is
rem opened here, not inside WSL.
wsl.exe -d Ubuntu-24.04 -u youyd --cd /home/youyd/projects/claudeProjects/LinguaLeaf -- /bin/bash scripts/launcher/launch.sh
if errorlevel 1 (
  echo.
  echo LinguaLeaf failed to start - see the message above.
  pause
  exit /b 1
)
start "" "http://127.0.0.1:3000/"
if errorlevel 1 (
  echo.
  echo The browser did not open. LinguaLeaf is still running at:
  echo     http://127.0.0.1:3000/
  pause
  exit /b 0
)
rem Keep the window a few seconds so the started/reused hint stays readable
rem (spec acceptance 3: the reuse hint must reach the double-click entry).
timeout /t 5 /nobreak >nul
exit /b 0
