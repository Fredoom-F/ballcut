$connections = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 4173 -State Listen -ErrorAction SilentlyContinue

if (-not $connections) {
    Write-Host "Jianqiu is not running."
    exit 0
}

$connections |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $_" -ErrorAction SilentlyContinue
        if ($process -and $process.Name -eq "node.exe" -and $process.CommandLine -match "server\.js") {
            Stop-Process -Id $_
            Write-Host "Jianqiu service stopped."
        } else {
            Write-Warning "Port 4173 is owned by another program and was not stopped."
        }
    }
