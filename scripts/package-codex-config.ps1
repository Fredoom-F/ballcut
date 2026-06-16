param(
    [string]$OutputPath = "",
    [switch]$Clean
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$PackageName = "codex-five-layer-team-config"
$DistDir = Join-Path $Root "dist"

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $DistDir "$PackageName.zip"
}

if ($Clean -and (Test-Path -LiteralPath $DistDir)) {
    Remove-Item -LiteralPath $DistDir -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $DistDir | Out-Null

$TempRoot = Join-Path $DistDir "_package"
$TempPackage = Join-Path $TempRoot $PackageName

if (Test-Path -LiteralPath $TempRoot) {
    Remove-Item -LiteralPath $TempRoot -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $TempPackage | Out-Null

$Items = @(
    "AGENTS.md",
    "CLAUDE.md",
    "skills",
    "hooks",
    "subagents",
    "plugins",
    "scripts",
    "README.md",
    "pack.cmd",
    "install.cmd"
)

foreach ($Item in $Items) {
    $Source = Join-Path $Root $Item
    if (Test-Path -LiteralPath $Source) {
        Copy-Item -LiteralPath $Source -Destination $TempPackage -Recurse -Force
    }
}

if (Test-Path -LiteralPath $OutputPath) {
    Remove-Item -LiteralPath $OutputPath -Force
}

Compress-Archive -Path (Join-Path $TempPackage "*") -DestinationPath $OutputPath -Force
Remove-Item -LiteralPath $TempRoot -Recurse -Force

Write-Host "Package created: $OutputPath"

