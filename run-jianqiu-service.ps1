param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot,
    [Parameter(Mandatory = $true)]
    [string]$RuntimeRoot
)

$ErrorActionPreference = "Stop"
$appRoot = Join-Path $ProjectRoot "app"
$stopFile = Join-Path $RuntimeRoot "stop.requested"
$nodePidFile = Join-Path $RuntimeRoot "node.pid"
$stdoutLog = Join-Path $RuntimeRoot "server.log"
$stderrLog = Join-Path $RuntimeRoot "server-error.log"
$watchdogLog = Join-Path $RuntimeRoot "watchdog.log"

while (-not (Test-Path -LiteralPath $stopFile)) {
    try {
        $node = Start-Process `
            -FilePath "node" `
            -ArgumentList "server.js" `
            -WorkingDirectory $appRoot `
            -WindowStyle Hidden `
            -RedirectStandardOutput $stdoutLog `
            -RedirectStandardError $stderrLog `
            -PassThru
        Set-Content -LiteralPath $nodePidFile -Value $node.Id -Encoding ascii
        $node.WaitForExit()
        Remove-Item -LiteralPath $nodePidFile -Force -ErrorAction SilentlyContinue
        if (-not (Test-Path -LiteralPath $stopFile)) {
            Add-Content -LiteralPath $watchdogLog -Value "$(Get-Date -Format o) node exited with code $($node.ExitCode); restarting"
            Start-Sleep -Seconds 1
        }
    } catch {
        Add-Content -LiteralPath $watchdogLog -Value "$(Get-Date -Format o) watchdog error: $($_.Exception.Message)"
        Start-Sleep -Seconds 2
    }
}

Remove-Item -LiteralPath $nodePidFile -Force -ErrorAction SilentlyContinue
