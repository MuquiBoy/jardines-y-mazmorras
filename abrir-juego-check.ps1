# Devuelve por stdout el puerto de un servidor local que ya sirve esta copia.
# Un servidor solo se reutiliza si su proceso arrancó después de la última
# modificación de los archivos que carga en memoria y si el index servido
# contiene las mismas etiquetas de versión que el index local. Si encuentra una
# copia vieja de este mismo juego, la detiene para liberar el puerto.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root

$serverFiles = @(
    'server.js',
    'server/simulation.js',
    'server/template-catalog.js',
    'js/palette.js',
    'js/characters/roles.js',
    'js/bullet.js',
    'js/player.js',
    'js/enemy.js',
    'js/map.js'
)

$newest = [DateTime]::MinValue
foreach ($file in $serverFiles) {
    $time = (Get-Item -LiteralPath (Join-Path $root $file)).LastWriteTimeUtc
    if ($time -gt $newest) { $newest = $time }
}

$index = Get-Content -Raw -LiteralPath (Join-Path $root 'index.html')
$mapTag = [regex]::Match($index, 'js/map\.js\?v=[A-Za-z0-9._-]+').Value
$rolesTag = [regex]::Match($index, 'js/characters/roles\.js\?v=[A-Za-z0-9._-]+').Value
if (-not $mapTag -or -not $rolesTag) { exit 1 }

foreach ($port in 8123, 8080) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing ('http://localhost:' + $port + '/') -TimeoutSec 2
        $connection = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction Stop)[0]
        $serverProcess = Get-Process -Id $connection.OwningProcess -ErrorAction Stop
        $fresh = $serverProcess.StartTime.ToUniversalTime() -ge $newest
        $sameTags = $response.Content.Contains($mapTag) -and $response.Content.Contains($rolesTag)
        if ($fresh -and $sameTags) {
            [Console]::Write($port)
            exit 0
        }

        # This port is held by an older copy of the same game. Stop only when
        # the response and the process both identify our server, never an
        # unrelated app that happens to occupy 8123/8080.
        if ($serverProcess.ProcessName -eq 'node' -and
            $response.Content.Contains('Jardines y Mazmorras')) {
            $commandLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $($serverProcess.Id)" -ErrorAction Stop).CommandLine
            if ($commandLine -match 'server\.js') {
                Stop-Process -Id $serverProcess.Id -Force -ErrorAction Stop
                Start-Sleep -Milliseconds 500
            }
        }
    } catch { }
}

exit 1
