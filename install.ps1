# cc-switch-cli Windows 安装脚本
# 用法: irm https://raw.githubusercontent.com/OWNER/cc-switch-cli/main/install.ps1 | iex

$ErrorActionPreference = "Stop"

$Repo = "OpenCils/cc-switch-cli"
$BinaryName = "cc.exe"
$AssetName = "cc-windows-x64.exe"
$InstallDir = "$env:USERPROFILE\.local\bin"

# ---------------------- 下载二进制 ----------------------
$DownloadUrl = "https://github.com/$Repo/releases/latest/download/$AssetName"

Write-Host "⬇️  下载 $AssetName ..." -ForegroundColor Cyan

if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

$OutPath = Join-Path $InstallDir $BinaryName
Invoke-RestMethod -Uri $DownloadUrl -OutFile $OutPath

# ---------------------- 配置 PATH ----------------------
$CurrentPath = [Environment]::GetEnvironmentVariable("Path", "User")

if ($CurrentPath -notlike "*$InstallDir*") {
    [Environment]::SetEnvironmentVariable(
        "Path",
        "$InstallDir;$CurrentPath",
        "User"
    )
    $env:Path = "$InstallDir;$env:Path"
    Write-Host "✅ 已将 $InstallDir 添加到用户 PATH" -ForegroundColor Green
}

Write-Host ""
Write-Host "✅ cc-switch-cli 安装成功！" -ForegroundColor Green
Write-Host "   重新打开终端后输入 'cc' 启动" -ForegroundColor Yellow
