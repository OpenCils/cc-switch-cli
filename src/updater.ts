/**
 * [INPUT]: 依赖 node:https，依赖 types 的 AppStore，依赖 version 的 VERSION
 * [OUTPUT]: 对外提供 checkForUpdates(store) — 后台查 GitHub Releases API，24h 缓存
 *           对外提供 getInstallCommand() — 返回当前平台的安装命令
 * [POS]: src/ 的更新检测器，非阻塞，结果由 app.tsx 的 useEffect 处理
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import https from 'node:https'
import type { AppStore } from './types.js'
import { VERSION } from './version.js'

const REPO = 'OpenCils/cc-switch-cli'
const TTL  = 24 * 60 * 60 * 1000   // 24h

// ---------------------- semver 比较 ----------------------
function isNewer(cur: string, lat: string): boolean {
  const p = (v: string) => v.replace(/^v/, '').split('.').map(Number)
  const [cA = 0, cB = 0, cC = 0] = p(cur)
  const [lA = 0, lB = 0, lC = 0] = p(lat)
  if (lA !== cA) return lA > cA
  if (lB !== cB) return lB > cB
  return lC > cC
}

// ---------------------- 请求 GitHub API ----------------------
function fetchLatest(): Promise<string | null> {
  return new Promise(resolve => {
    const req = https.get(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      { headers: { 'User-Agent': 'cc-switch-cli', Accept: 'application/vnd.github+json' } },
      res => {
        if (res.statusCode !== 200) { res.resume(); return resolve(null) }
        let body = ''
        res.on('data', (c: string) => body += c)
        res.on('end', () => {
          try { resolve((JSON.parse(body).tag_name as string).replace(/^v/, '')) }
          catch { resolve(null) }
        })
      }
    )
    req.on('error', () => resolve(null))
    req.setTimeout(5000, () => { req.destroy(); resolve(null) })
  })
}

// ---------------------- 公开 API ----------------------

export interface UpdateResult {
  version: string | null   // 新版本号，null 表示已是最新
  didCheck: boolean        // 是否实际调用了 API（false = 来自缓存）
  checkedAt: number        // 本次检查时间戳
}

export async function checkForUpdates(store: AppStore): Promise<UpdateResult> {
  const now = Date.now()

  // 24h 内有缓存 → 直接用
  if (store.lastUpdateCheck && (now - store.lastUpdateCheck) < TTL) {
    return { version: store.updateAvailable ?? null, didCheck: false, checkedAt: store.lastUpdateCheck }
  }

  const latest = await fetchLatest()
  const version = (latest && isNewer(VERSION, latest)) ? latest : null
  return { version, didCheck: true, checkedAt: now }
}

// 返回当前平台的安装命令（用于更新提示）
export function getInstallCommand(): string {
  return process.platform === 'win32'
    ? 'irm https://raw.githubusercontent.com/OpenCils/cc-switch-cli/main/install.ps1 | iex'
    : 'curl -fsSL https://raw.githubusercontent.com/OpenCils/cc-switch-cli/main/install.sh | bash'
}

export { VERSION }
