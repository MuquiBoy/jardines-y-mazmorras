@echo off
setlocal
cd /d "%~dp0"

rem Reuse a server only if it is serving this exact updated copy.
rem abrir-juego-check.ps1 returns the port of a live server whose process
rem started after the newest server-loaded file and whose index still carries
rem the same version tags as the local index.html. A stale server is rejected.
set "REUSE_PORT="
for /f %%P in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0abrir-juego-check.ps1" 2^>nul') do set "REUSE_PORT=%%P"
if defined REUSE_PORT (
    start "" http://localhost:%REUSE_PORT%/
    exit /b 0
)

set "NODE_EXE="
where node >nul 2>nul && set "NODE_EXE=node"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\OpenAI\Codex\runtimes\cua_node\2b841c3d44b123ec\bin\node.exe" set "NODE_EXE=%LOCALAPPDATA%\OpenAI\Codex\runtimes\cua_node\2b841c3d44b123ec\bin\node.exe"
if not defined NODE_EXE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\jardines-tools\node\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\jardines-tools\node\node.exe"
if not defined NODE_EXE (
    echo No se encontro Node.js. Abre Jardines y Mazmorras desde la carpeta del proyecto.
    pause
    exit /b 1
)

rem Prefer port 8123, the same one used by the desktop shortcut. If another
rem app already occupies it, ask Windows for any free port instead.
for /f %%P in ('powershell -NoProfile -Command "$p=8123; $l=[System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback,$p); try { $l.Start(); $l.Stop() } catch { $l=[System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback,0); $l.Start(); $p=$l.LocalEndpoint.Port; $l.Stop() }; [Console]::Write($p)"') do set "PORT=%%P"
if not defined PORT set "PORT=8123"
echo Jardines y Mazmorras esta iniciando en http://localhost:%PORT%/
start "" /b powershell -NoProfile -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:%PORT%/'"
"%NODE_EXE%" server.js
pause
