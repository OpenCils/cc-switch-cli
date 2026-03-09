/**
 * [INPUT]: 依赖 node:https/child_process/fs/os/path，依赖 types 的 AppStore，依赖 version 的 VERSION
 * [OUTPUT]: 对外提供 CURRENT_VERSION、checkForUpdates(store)、getInstallCommand()、canSelfUpdate()、startSelfUpdate()
 * [POS]: src/ 的更新模块，负责 GitHub Release 检测、缓存纠偏、版本归一化与独立二进制自更新
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import type { AppStore } from './types.js'
import { VERSION } from './version.js'

const REPO = 'OpenCils/cc-switch-cli'
const TTL = 24 * 60 * 60 * 1000
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/

// ---------------------- semver 比较 ----------------------
function normalizeVersion(value: string | null | undefined): string | null {
  const normalized = (value ?? '').trim().replace(/^v/, '')
  return VERSION_PATTERN.test(normalized) ? normalized : null
}

function compareVersions(a: string, b: string): number {
  const parse = (value: string) => value.split('.').map(Number)
  const [a1 = 0, a2 = 0, a3 = 0] = parse(a)
  const [b1 = 0, b2 = 0, b3 = 0] = parse(b)
  if (a1 !== b1) return a1 - b1
  if (a2 !== b2) return a2 - b2
  return a3 - b3
}

function isNewer(current: string | null | undefined, latest: string | null | undefined): boolean {
  const cur = normalizeVersion(current)
  const lat = normalizeVersion(latest)
  if (!lat) return false
  if (!cur) return true
  return compareVersions(lat, cur) > 0
}

function normalizeCachedUpdate(version?: string): string | null {
  const normalized = normalizeVersion(version)
  if (!normalized) return null
  return isNewer(CURRENT_VERSION, normalized) ? normalized : null
}

export const CURRENT_VERSION = normalizeVersion(VERSION) ?? 'unknown'

// ---------------------- 请求 GitHub API ----------------------
function fetchLatest(): Promise<string | null> {
  return new Promise(resolve => {
    const req = https.get(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      { headers: { 'User-Agent': 'cc-switch-cli', Accept: 'application/vnd.github+json' } },
      res => {
        if (res.statusCode !== 200) {
          res.resume()
          return resolve(null)
        }
        let body = ''
        res.on('data', (chunk: string) => {
          body += chunk
        })
        res.on('end', () => {
          try {
            resolve(normalizeVersion(JSON.parse(body).tag_name as string))
          } catch {
            resolve(null)
          }
        })
      },
    )
    req.on('error', () => resolve(null))
    req.setTimeout(5000, () => {
      req.destroy()
      resolve(null)
    })
  })
}

// ---------------------- 公开 API ----------------------
export interface UpdateResult {
  version: string | null
  didCheck: boolean
  checkedAt: number
}

export async function checkForUpdates(store: AppStore): Promise<UpdateResult> {
  const now = Date.now()
  const cachedVersion = normalizeCachedUpdate(store.updateAvailable)

  if (store.lastUpdateCheck && (now - store.lastUpdateCheck) < TTL) {
    return {
      version: cachedVersion,
      didCheck: false,
      checkedAt: store.lastUpdateCheck,
    }
  }

  const latest = await fetchLatest()
  const version = latest && isNewer(CURRENT_VERSION, latest) ? latest : null
  return { version, didCheck: true, checkedAt: now }
}

export function getInstallCommand(): string {
  return process.platform === 'win32'
    ? 'irm https://raw.githubusercontent.com/OpenCils/cc-switch-cli/main/install.ps1 | iex'
    : 'curl -fsSL https://raw.githubusercontent.com/OpenCils/cc-switch-cli/main/install.sh | bash'
}

// ---------------------- 自更新 ----------------------
function resolveAssetName(): string | null {
  if (process.platform === 'win32' && process.arch === 'x64') return 'cc-windows-x64.exe'
  if (process.platform === 'linux' && process.arch === 'x64') return 'cc-linux-x64'
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'cc-darwin-arm64'
  return null
}

function isNodeRuntime(): boolean {
  return /(^|[\\/])node(?:\.exe)?$/i.test(process.execPath)
}

export function canSelfUpdate(): boolean {
  return !isNodeRuntime() && resolveAssetName() !== null
}

function quoteForPowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function quoteForShell(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function startWindowsSelfUpdate(targetPath: string, downloadUrl: string): void {
  const scriptPath = path.join(os.tmpdir(), `cc-switch-update-${process.pid}.ps1`)
  const tempPath = path.join(os.tmpdir(), `cc-switch-update-${process.pid}.tmp`)
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$PidToWait = ${process.pid}`,
    `$TargetPath = ${quoteForPowerShell(targetPath)}`,
    `$DownloadUrl = ${quoteForPowerShell(downloadUrl)}`,
    `$TempPath = ${quoteForPowerShell(tempPath)}`,
    '',
    'for ($i = 0; $i -lt 240; $i++) {',
    '  if (-not (Get-Process -Id $PidToWait -ErrorAction SilentlyContinue)) { break }',
    '  Start-Sleep -Milliseconds 500',
    '}',
    'Invoke-WebRequest -UseBasicParsing -Uri $DownloadUrl -OutFile $TempPath',
    'Copy-Item -Path $TempPath -Destination $TargetPath -Force',
    'Remove-Item -Path $TempPath -Force -ErrorAction SilentlyContinue',
  ].join('\n')

  fs.writeFileSync(scriptPath, script, { encoding: 'utf-8' })
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}

function startUnixSelfUpdate(targetPath: string, downloadUrl: string): void {
  const scriptPath = path.join(os.tmpdir(), `cc-switch-update-${process.pid}.sh`)
  const tempPath = `${targetPath}.tmp.${process.pid}`
  const script = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `pid=${process.pid}`,
    `target=${quoteForShell(targetPath)}`,
    `download_url=${quoteForShell(downloadUrl)}`,
    `temp_path=${quoteForShell(tempPath)}`,
    '',
    'for _ in $(seq 1 240); do',
    '  if ! kill -0 "$pid" 2>/dev/null; then break; fi',
    '  sleep 0.5',
    'done',
    'curl -fsSL "$download_url" -o "$temp_path"',
    'chmod +x "$temp_path"',
    'mv "$temp_path" "$target"',
  ].join('\n')

  fs.writeFileSync(scriptPath, script, { encoding: 'utf-8' })
  fs.chmodSync(scriptPath, 0o755)
  const child = spawn('bash', [scriptPath], { detached: true, stdio: 'ignore' })
  child.unref()
}

export interface SelfUpdateResult {
  started: boolean
  error?: string
}

export async function startSelfUpdate(): Promise<SelfUpdateResult> {
  if (!canSelfUpdate()) {
    return { started: false, error: 'self-update unavailable in source mode or on this platform' }
  }

  const assetName = resolveAssetName()
  if (!assetName) {
    return { started: false, error: 'unsupported platform or architecture' }
  }

  const targetPath = process.execPath
  const downloadUrl = `https://github.com/${REPO}/releases/latest/download/${assetName}`

  try {
    if (process.platform === 'win32') {
      startWindowsSelfUpdate(targetPath, downloadUrl)
    } else {
      startUnixSelfUpdate(targetPath, downloadUrl)
    }
    return { started: true }
  } catch (error) {
    return {
      started: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}