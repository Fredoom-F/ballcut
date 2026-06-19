$connections = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 4173 -State Listen -ErrorAction SilentlyContinue
$runtimeRoot = Join-Path $env:LOCALAPPDATA "Jianqiu"
$pidFile = Join-Path $runtimeRoot "server.pid"

if (-not $connections) {
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    Write-Host "Jianqiu is not running."
    exit 0
}

$connections |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $_" -ErrorAction SilentlyContinue
        if ($process -and $process.Name -eq "node.exe" -and $process.CommandLine -match "server\.js") {
            Stop-Process -Id $_
            Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
            Write-Host "Jianqiu service stopped."
        } else {
            Write-Warning "Port 4173 is owned by another program and was not stopped."
        }
    }
