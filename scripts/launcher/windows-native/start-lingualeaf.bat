@echo off
setlocal
cd /d "%~dp0"
if not exist ".data" mkdir ".data"
rem Resolve the serving port from .env (default 3000) so the health check
rem and the browser URL follow the user's configuration. Node writes the
rem value to a file and set /p reads it: for /f mangles quoted commands
rem containing special characters, redirection does not.
"runtime\node.exe" --env-file-if-exists=.env -e "console.log(process.env.PORT||3000)" > ".data\port.tmp" 2>nul
set /p PORT=<".data\port.tmp"
del ".data\port.tmp" >nul 2>&1
rem Already running? Health check first, then just open the browser.
"runtime\node.exe" --env-file-if-exists=.env -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>r.json()).then(j=>process.exit(j.status==='ok'?0:1)).catch(()=>process.exit(1))" >nul 2>&1
if not errorlevel 1 (
  echo LinguaLeaf is already running. Opening browser...
  start "" "http://127.0.0.1:%PORT%/"
  timeout /t 3 /nobreak >nul
  exit /b 0
)
if not exist "node_modules" (
  echo First run: installing production dependencies ^(needs internet, about 1 minute^)...
  rem --ignore-scripts: workspace prepare hooks need devDependencies that a
  rem production install does not carry; the packages ship their dist\ instead.
  call "runtime\npm.cmd" ci --omit=dev --ignore-scripts --no-audit --no-fund
  if errorlevel 1 (
    echo Dependency install failed. Check your internet connection, then run this again.
    pause
    exit /b 1
  )
  rem Native binding: ci skipped lifecycle scripts. The installer ships the
  rem matching prebuild (_prebuilds\); the network rebuild is only the
  rem fallback for payloads from before it was bundled.
  if not exist "node_modules\better-sqlite3\build\Release\better_sqlite3.node" (
    if exist "_prebuilds\better_sqlite3.node" (
      mkdir "node_modules\better-sqlite3\build\Release" 2>nul
      copy /y "_prebuilds\better_sqlite3.node" "node_modules\better-sqlite3\build\Release\" >nul
    )
  )
  if not exist "node_modules\better-sqlite3\build\Release\better_sqlite3.node" (
    echo Fetching SQLite native module ^(needs internet, about 1 minute^)...
    call "runtime\npm.cmd" rebuild better-sqlite3 --no-audit --no-fund
    if errorlevel 1 (
      echo SQLite native module setup failed. Check your internet connection, then run this again.
      pause
      exit /b 1
    )
  )
  rem Load-verify the binding before declaring the install ready.
  "runtime\node.exe" -e "require('better-sqlite3')" >nul 2>&1
  if errorlevel 1 (
    echo SQLite native module failed to load. See README-install.txt troubleshooting.
    pause
    exit /b 1
  )
)
if not exist ".output\server\main.js" (
  echo Missing .output\server\main.js - the installation is incomplete. Reinstall the setup package.
  pause
  exit /b 1
)
rem Detach the server from this console and record its PID, all in Node:
rem hidden PowerShell launchers trip antivirus heuristics; plain node spawn
rem does not.
"runtime\node.exe" -e "const {spawn}=require('child_process');const fs=require('fs');const out=fs.openSync('.data/server.log','a');const err=fs.openSync('.data/server.err.log','a');const p=spawn(process.execPath,['--env-file-if-exists=.env','.output/server/main.js'],{stdio:['ignore',out,err],detached:true});fs.closeSync(out);fs.closeSync(err);fs.writeFileSync('.data/server.pid',String(p.pid));p.unref();console.log('server pid '+p.pid)"
"runtime\node.exe" --env-file-if-exists=.env -e "const t=Date.now();(function p(){fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>r.json()).then(j=>process.exit(j.status==='ok'?0:1)).catch(()=>{if(Date.now()-t>20000)process.exit(1);setTimeout(p,1000)})})()"
if errorlevel 1 (
  echo Server did not become healthy within 20 seconds. See .data\server.log and .data\server.err.log
  pause
  exit /b 1
)
start "" "http://127.0.0.1:%PORT%/"
echo LinguaLeaf started on port %PORT%. To stop it, run stop-lingualeaf.bat
timeout /t 3 /nobreak >nul
