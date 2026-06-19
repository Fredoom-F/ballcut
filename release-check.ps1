param(
    [switch]$IncludeRealVideo
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$appRoot = Join-Path $projectRoot "app"
$healthUrl = "http://127.0.0.1:4173/health"
$expectedVersion = "0.4.3"

function Invoke-CheckedCommand([string]$filePath, [string[]]$arguments, [string]$workingDirectory) {
    $process = Start-Process `
        -FilePath $filePath `
        -ArgumentList $arguments `
        -WorkingDirectory $workingDirectory `
        -NoNewWindow `
        -Wait `
        -PassThru
    if ($process.ExitCode -ne 0) {
        throw "$filePath failed with exit code $($process.ExitCode)"
    }
}

Write-Host "1/4 Running Jianqiu automated tests..."
Invoke-CheckedCommand "python" @("../tests/run_all.py") $appRoot

Write-Host "2/4 Checking PowerShell scripts..."
$parseErrors = @()
Get-ChildItem -LiteralPath $projectRoot -Filter "*.ps1" | ForEach-Object {
    [System.Management.Automation.Language.Parser]::ParseFile(
        $_.FullName,
        [ref]$null,
        [ref]$parseErrors
    ) | Out-Null
}
if ($parseErrors.Count) {
    throw ($parseErrors | ForEach-Object { $_.Message } | Out-String)
}

Write-Host "3/4 Checking local service..."
try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 3
} catch {
    & (Join-Path $projectRoot "start-jianqiu.ps1") -NoBrowser
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 5
}
if (
    $health.status -ne "ok" -or
    $health.service -ne "jianqiu" -or
    $health.version -ne $expectedVersion -or
    $health.analyzerReady -ne $true
) {
    throw "Local service health check did not match Jianqiu $expectedVersion"
}

Write-Host "4/4 Checking temporary upload cleanup..."
$temporaryUploads = Get-ChildItem ([IO.Path]::GetTempPath()) -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match "^jianqiu-[a-f0-9]{24}\.(video|mp4|mov|m4v|avi|webm|mkv)$" }
if ($temporaryUploads) {
    throw "Temporary Jianqiu uploads remain: $($temporaryUploads.Name -join ', ')"
}

if ($IncludeRealVideo) {
    Write-Host "Running real-video ETA regression..."
    Invoke-CheckedCommand "python" @("../tests/test_real_progress.py") $appRoot
    Write-Host "Running full real-video regression..."
    Invoke-CheckedCommand "python" @("../tests/test_real_video.py") $appRoot
}

Write-Host "Jianqiu release check passed. Service $expectedVersion is healthy."
