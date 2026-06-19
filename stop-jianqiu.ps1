$runtimeRoot = Join-Path $env:LOCALAPPDATA "Jianqiu"
$pidFile = Join-Path $runtimeRoot "server.pid"
$nodePidFile = Join-Path $runtimeRoot "node.pid"
$stopFile = Join-Path $runtimeRoot "stop.requested"

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
Set-Content -LiteralPath $stopFile -Value "stop" -Encoding ascii
$stoppedManagedProcess = $false

if (Test-Path -LiteralPath $pidFile) {
    $watchdogPid = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue
    if ($watchdogPid) {
        $watchdog = Get-Process -Id $watchdogPid -ErrorAction SilentlyContinue
        if ($watchdog) {
            Stop-Process -Id $watchdogPid -Force -ErrorAction SilentlyContinue
            $stoppedManagedProcess = $true
        }
    }
}

Start-Sleep -Milliseconds 300
$connections = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 4173 -State Listen -ErrorAction SilentlyContinue

if (-not $connections) {
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $nodePidFile -Force -ErrorAction SilentlyContinue
    if ($stoppedManagedProcess) {
        Write-Host "Jianqiu service stopped."
    } else {
        Write-Host "Jianqiu is not running."
    }
    exit 0
}

$connections |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $_" -ErrorAction SilentlyContinue
        if ($process -and $process.Name -eq "node.exe" -and $process.CommandLine -match "server\.js") {
            Stop-Process -Id $_
            Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath $nodePidFile -Force -ErrorAction SilentlyContinue
            Write-Host "Jianqiu service stopped."
        } else {
            Write-Warning "Port 4173 is owned by another program and was not stopped."
        }
    }
