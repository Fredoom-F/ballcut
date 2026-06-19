param(
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$appRoot = Join-Path $projectRoot "app"
$runtimeRoot = Join-Path $env:LOCALAPPDATA "Jianqiu"
$stdoutLog = Join-Path $runtimeRoot "server.log"
$stderrLog = Join-Path $runtimeRoot "server-error.log"
$pidFile = Join-Path $runtimeRoot "server.pid"
$healthUrl = "http://127.0.0.1:4173/health"
$expectedVersion = "0.3.0"

function Test-JianqiuService {
    try {
        $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
        return $health.status -eq "ok" -and
            $health.service -eq "jianqiu" -and
            $health.version -eq $expectedVersion -and
            $health.analyzerReady -eq $true
    } catch {
        return $false
    }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js was not found. Install Node.js first."
    exit 1
}

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "Python was not found. Run setup-jianqiu.cmd first."
    exit 1
}

python -c "import cv2,numpy" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "OpenCV or NumPy is missing. Run setup-jianqiu.cmd first."
    exit 1
}

if (Test-JianqiuService) {
    Write-Host "Jianqiu is already running: http://127.0.0.1:4173/"
    if (-not $NoBrowser) {
        Start-Process $healthUrl.Replace("/health", "/")
    }
    exit 0
}

$listener = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 4173 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
if ($listener) {
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
    if ($owner -and $owner.Name -eq "node.exe" -and $owner.CommandLine -match "server\.js") {
        Stop-Process -Id $listener.OwningProcess -Force
        Start-Sleep -Milliseconds 400
    } else {
        Write-Host "Port 4173 is in use by another program."
        exit 1
    }
}

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
$process = Start-Process `
    -FilePath "node" `
    -ArgumentList "server.js" `
    -WorkingDirectory $appRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru
Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ascii

$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    Start-Sleep -Milliseconds 250
    if (Test-JianqiuService) {
        $ready = $true
        break
    }
    if ($process.HasExited) {
        break
    }
}

if (-not $ready) {
    Write-Host "Jianqiu failed to start. Error log: $stderrLog"
    exit 1
}

Write-Host "Jianqiu started in the background. Closing this window will not stop it."
Write-Host "Open: http://127.0.0.1:4173/"
if (-not $NoBrowser) {
    Start-Process "http://127.0.0.1:4173/"
}
