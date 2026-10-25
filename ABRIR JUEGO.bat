@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -Command "try { $p=(Invoke-WebRequest -UseBasicParsing 'http://localhost:8080/' -TimeoutSec 2).Content; if ($p.Contains('Abyss Engine')) {exit 0} else {exit 1} } catch {exit 1}"
if not errorlevel 1 (
    start "" http://localhost:8080
    exit /b 0
)
set "NODE_EXE="
where node >nul 2>nul && set "NODE_EXE=node"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\OpenAI\Codex\runtimes\cua_node\2b841c3d44b123ec\bin\node.exe" set "NODE_EXE=%LOCALAPPDATA%\OpenAI\Codex\runtimes\cua_node\2b841c3d44b123ec\bin\node.exe"
if not defined NODE_EXE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not defined NODE_EXE (
    echo No se encontro Node.js. Abrire la version individual sin conexion.
    start "" "%~dp0index.html"
    pause
    exit /b 1
)
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8080"
echo Jardines y Mazmorras esta iniciando. Deja esta ventana abierta mientras juegas.
"%NODE_EXE%" server.js
pause
