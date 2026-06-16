param(
    [Parameter(Mandatory = $true)]
    [string]$TargetPath,

    [switch]$Force
)

$ErrorActionPreference = "Stop"

$SourceRoot = Split-Path -Parent $PSScriptRoot
$ResolvedTarget = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($TargetPath)

if (-not (Test-Path -LiteralPath $ResolvedTarget)) {
    New-Item -ItemType Directory -Force -Path $ResolvedTarget | Out-Null
}

$Items = @(
    "AGENTS.md",
    "CLAUDE.md",
    "skills",
    "hooks",
    "subagents",
    "plugins"
)

$Copied = New-Object System.Collections.Generic.List[string]
$Skipped = New-Object System.Collections.Generic.List[string]

foreach ($Item in $Items) {
    $Source = Join-Path $SourceRoot $Item
    $Destination = Join-Path $ResolvedTarget $Item

    if (-not (Test-Path -LiteralPath $Source)) {
        continue
    }

    if ((Test-Path -LiteralPath $Destination) -and -not $Force) {
        $Skipped.Add($Item)
        continue
    }

    Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
    $Copied.Add($Item)
}

Write-Host "Codex configuration installed to: $ResolvedTarget"

if ($Copied.Count -gt 0) {
    Write-Host "Copied: $($Copied -join ', ')"
}

if ($Skipped.Count -gt 0) {
    Write-Host "Skipped existing items: $($Skipped -join ', ')"
    Write-Host "Run again with -Force to overwrite them."
}

