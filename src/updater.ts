/**
 * [INPUT]: 依赖 node:https/child_process/fs/os/path，依赖 types 的 AppStore，依赖 version 的 VERSION
 * [OUTPUT]: 对外提供 CURRENT_VERSION、checkForUpdates(store)、getInstallCommand()、canSelfUpdate()、SelfUpdateProgress 类型、startSelfUpdate()
 * [POS]: src/ 的更新模块，负责 GitHub Release 检测、缓存纠偏、版本归一化与带进度回调的独立二进制自更新
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
const MAX_REDIRECTS = 5
const DOWNLOAD_PROGRESS_STEP = 512 * 1024
const DOWNLOAD_PROGRESS_INTERVAL_MS = 120

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

function removeIfExists(filePath: string): void {
  try {
    fs.unlinkSync(filePath)
  } catch {}
}

function downloadAsset(
  downloadUrl: string,
  destinationPath: string,
  onProgress?: StartSelfUpdateOptions['onProgress'],
  redirects = 0,
): Promise<void> {
  return new Promise((resolve, reject) => {
    removeIfExists(destinationPath)

    const file = fs.createWriteStream(destinationPath)
    let settled = false

    const fail = (error: Error) => {
      if (settled) return
      settled = true
      file.destroy()
      removeIfExists(destinationPath)
      reject(error)
    }

    const req = https.get(
      downloadUrl,
      { headers: { 'User-Agent': 'cc-switch-cli', Accept: 'application/octet-stream' } },
      res => {
        const status = res.statusCode ?? 0

        if (status >= 300 && status < 400 && res.headers.location) {
          if (redirects >= MAX_REDIRECTS) {
            res.resume()
            fail(new Error('too many redirects while downloading update'))
            return
          }

          const nextUrl = new URL(res.headers.location, downloadUrl).toString()
          res.resume()
          file.close(closeError => {
            if (closeError) {
              fail(closeError)
              return
            }

            downloadAsset(nextUrl, destinationPath, onProgress, redirects + 1).then(resolve).catch(reject)
          })
          return
        }

        if (status !== 200) {
          res.resume()
          fail(new Error(`download failed: HTTP ${status}`))
          return
        }

        const totalBytes = normalizeContentLength(res.headers['content-length'])
        let downloadedBytes = 0
        let lastReportedBytes = -1
        let lastReportedAt = 0

        reportDownloadProgress(onProgress, 0, totalBytes)
        lastReportedBytes = 0
        lastReportedAt = Date.now()

        res.on('data', chunk => {
          downloadedBytes += chunk.length
          if (!shouldReportDownloadProgress(downloadedBytes, lastReportedBytes, lastReportedAt, totalBytes)) {
            return
          }

          reportDownloadProgress(onProgress, downloadedBytes, totalBytes)
          lastReportedBytes = downloadedBytes
          lastReportedAt = Date.now()
        })
        res.on('error', error => fail(error))
        res.pipe(file)
        file.on('finish', () => {
          file.close(closeError => {
            if (settled) return
            if (closeError) {
              fail(closeError)
              return
            }

            if (downloadedBytes !== lastReportedBytes) {
              reportDownloadProgress(onProgress, downloadedBytes, totalBytes)
            }
            settled = true
            resolve()
          })
        })
      },
    )

    req.on('error', error => fail(error))
    req.setTimeout(30_000, () => req.destroy(new Error('download timed out')))
    file.on('error', error => fail(error))
  })
}

function startWindowsSelfUpdate(targetPath: string, preparedPath: string): void {
  const scriptPath = path.join(os.tmpdir(), `cc-switch-update-${process.pid}.ps1`)
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$PidToWait = ${process.pid}`,
    `$TargetPath = ${quoteForPowerShell(targetPath)}`,
    `$PreparedPath = ${quoteForPowerShell(preparedPath)}`,
    `$ScriptPath = ${quoteForPowerShell(scriptPath)}`,
    '',
    'for ($i = 0; $i -lt 240; $i++) {',
    '  if (-not (Get-Process -Id $PidToWait -ErrorAction SilentlyContinue)) { break }',
    '  Start-Sleep -Milliseconds 500',
    '}',
    'Copy-Item -Path $PreparedPath -Destination $TargetPath -Force',
    'Remove-Item -Path $PreparedPath -Force -ErrorAction SilentlyContinue',
    'Remove-Item -Path $ScriptPath -Force -ErrorAction SilentlyContinue',
  ].join('\n')

  fs.writeFileSync(scriptPath, script, { encoding: 'utf-8' })
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}

function finishUnixSelfUpdate(targetPath: string, preparedPath: string): void {
  fs.chmodSync(preparedPath, 0o755)
  fs.renameSync(preparedPath, targetPath)
}

export interface SelfUpdateResult {
  started: boolean
  error?: string
}

export type SelfUpdatePhase = 'preparing' | 'downloading' | 'replacing' | 'complete'

export interface SelfUpdateProgress {
  phase: SelfUpdatePhase
  downloadedBytes?: number
  totalBytes?: number
}

interface StartSelfUpdateOptions {
  onProgress?: (progress: SelfUpdateProgress) => void
}

function emitProgress(onProgress: StartSelfUpdateOptions['onProgress'], progress: SelfUpdateProgress): void {
  onProgress?.(progress)
}

function normalizeContentLength(value: string | string[] | undefined): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function shouldReportDownloadProgress(
  downloadedBytes: number,
  lastReportedBytes: number,
  lastReportedAt: number,
  totalBytes: number | undefined,
): boolean {
  if (downloadedBytes === 0) return true
  if (totalBytes && downloadedBytes >= totalBytes) return true
  if ((downloadedBytes - lastReportedBytes) >= DOWNLOAD_PROGRESS_STEP) return true
  return (Date.now() - lastReportedAt) >= DOWNLOAD_PROGRESS_INTERVAL_MS
}

function reportDownloadProgress(
  onProgress: StartSelfUpdateOptions['onProgress'],
  downloadedBytes: number,
  totalBytes: number | undefined,
): void {
  emitProgress(onProgress, {
    phase: 'downloading',
    downloadedBytes,
    totalBytes,
  })
}

async function startSelfUpdate(options: StartSelfUpdateOptions = {}): Promise<SelfUpdateResult> {
  const { onProgress } = options
  if (!canSelfUpdate()) {
    return { started: false, error: 'self-update unavailable in source mode or on this platform' }
  }

  const assetName = resolveAssetName()
  if (!assetName) {
    return { started: false, error: 'unsupported platform or architecture' }
  }

  const targetPath = process.execPath
  const downloadUrl = `https://github.com/${REPO}/releases/latest/download/${assetName}`
  const preparedPath = `${targetPath}.tmp.${process.pid}`

  try {
    emitProgress(onProgress, { phase: 'preparing' })
    await downloadAsset(downloadUrl, preparedPath, onProgress)

    emitProgress(onProgress, { phase: 'replacing' })
    if (process.platform === 'win32') {
      startWindowsSelfUpdate(targetPath, preparedPath)
    } else {
      finishUnixSelfUpdate(targetPath, preparedPath)
    }

    emitProgress(onProgress, { phase: 'complete' })
    return { started: true }
  } catch (error) {
    removeIfExists(preparedPath)
    return {
      started: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export { startSelfUpdate }
