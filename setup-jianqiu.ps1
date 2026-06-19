$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Get-MajorVersion([string]$value) {
    $match = [regex]::Match($value, "\d+")
    if (-not $match.Success) {
        return 0
    }
    return [int]$match.Value
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js was not found. Install Node.js 18 or newer."
    exit 1
}

$nodeVersion = (& node --version).Trim()
if ((Get-MajorVersion $nodeVersion) -lt 18) {
    Write-Host "Node.js $nodeVersion is too old. Install Node.js 18 or newer."
    exit 1
}

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "Python was not found. Install Python 3.10 or newer."
    exit 1
}

$pythonVersion = (& python -c "import sys; print('.'.join(map(str,sys.version_info[:3])))").Trim()
$pythonParts = $pythonVersion.Split(".")
if ([int]$pythonParts[0] -lt 3 -or ([int]$pythonParts[0] -eq 3 -and [int]$pythonParts[1] -lt 10)) {
    Write-Host "Python $pythonVersion is too old. Install Python 3.10 or newer."
    exit 1
}

Write-Host "Installing local analysis dependencies..."
& python -m pip install -r (Join-Path $projectRoot "requirements.txt")
if ($LASTEXITCODE -ne 0) {
    Write-Host "Dependency installation failed. Check pip and network access."
    exit 1
}

& python -c "import cv2,numpy; print('OpenCV',cv2.__version__,'NumPy',numpy.__version__)"
if ($LASTEXITCODE -ne 0) {
    Write-Host "OpenCV environment verification failed."
    exit 1
}

foreach ($scriptPath in @("app\server.js", "app\app.js")) {
    & node --check (Join-Path $projectRoot $scriptPath)
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Application script verification failed: $scriptPath"
        exit 1
    }
}

Write-Host "Jianqiu environment is ready."
Write-Host "Node.js $nodeVersion; Python $pythonVersion."
Write-Host "Run start-jianqiu.cmd to open the application."
