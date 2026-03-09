# cc-switch-cli installer for Windows
# Usage: irm https://raw.githubusercontent.com/OpenCils/cc-switch-cli/main/install.ps1 | iex

$ErrorActionPreference = "Stop"

$Repo = "OpenCils/cc-switch-cli"
$BinaryName = "cc.exe"
$AssetName = "cc-windows-x64.exe"
$InstallDir = "$env:USERPROFILE\.local\bin"

# ---------------------- Download binary ----------------------
$DownloadUrl = "https://github.com/$Repo/releases/latest/download/$AssetName"

Write-Host "Downloading $AssetName ..." -ForegroundColor Cyan

if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

$OutPath = Join-Path $InstallDir $BinaryName
Invoke-RestMethod -Uri $DownloadUrl -OutFile $OutPath

# ---------------------- Configure PATH ----------------------
$CurrentPath = [Environment]::GetEnvironmentVariable("Path", "User")

if ($CurrentPath -notlike "*$InstallDir*") {
    [Environment]::SetEnvironmentVariable(
        "Path",
        "$InstallDir;$CurrentPath",
        "User"
    )
    $env:Path = "$InstallDir;$env:Path"
    Write-Host "Added $InstallDir to user PATH" -ForegroundColor Green
}

Write-Host ""
Write-Host "cc-switch-cli installed successfully!" -ForegroundColor Green
Write-Host "Reopen your terminal and type 'cc' to launch." -ForegroundColor Yellow
