/**
 * [INPUT]: 依赖 os/fs/path/child_process，依赖 adapters 的 readConfig，依赖 types
 * [OUTPUT]: 对外提供 detectInstallations 函数
 * [POS]: src/store/ 的环境探测器，扫描本机所有工具安装实例
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { execSync } from 'child_process'
import type { Environment, Installation, Tool } from '../types.js'
import { TOOLS } from '../types.js'
import { readConfig } from './adapters/index.js'

// ---------------------- 配置文件名映射 ----------------------
const CONFIG_FILES: Record<Tool, string> = {
  claude:   'settings.json',
  codex:    'config.toml',
  gemini:   'settings.json',
  openclaw: 'openclaw.json',
}

// ---------------------- 工具命令名（Windows 二进制检测用）----------------------
const TOOL_CMDS: Record<Tool, string> = {
  claude: 'claude', codex: 'codex', gemini: 'gemini', openclaw: 'openclaw',
}

// ---------------------- 检测本机环境 ----------------------
function detectLocalEnv(): Environment {
  const platform = os.platform()
  if (platform === 'win32') return { type: 'windows', label: 'Windows', homePath: os.homedir() }
  if (platform === 'darwin') return { type: 'mac', label: 'macOS', homePath: os.homedir() }
  return { type: 'linux', label: 'Linux', homePath: os.homedir() }
}

// ---------------------- 检测 WSL 发行版 ----------------------
function detectWslDistros(): Environment[] {
  if (os.platform() !== 'win32') return []

  try {
    const raw = execSync('wsl -l -v', { encoding: 'utf-8', timeout: 5000 })
    const envs: Environment[] = []

    for (const line of raw.split('\n')) {
      const cleaned = line.replace(/\0/g, '').replace(/\r/g, '').trim()
      if (!cleaned) continue

      const match = cleaned.match(/^\*?\s*(\S+)\s+(Running|Stopped)\s+(\d+)/)
      if (!match) continue

      const distro = match[1]
      try {
        const home = execSync(`wsl -d ${distro} -- printenv HOME`, {
          encoding: 'utf-8', timeout: 5000,
        }).trim()
        envs.push({ type: 'wsl', label: `WSL: ${distro}`, distro, homePath: home })
      } catch { /* 跳过无法访问的发行版 */ }
    }
    return envs
  } catch {
    return []
  }
}

// ---------------------- Windows 上检查命令是否存在 ----------------------
function cmdExistsWin(cmd: string): boolean {
  try {
    execSync(`where ${cmd}`, { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] })
    return true
  } catch {
    return false
  }
}

// ---------------------- 检查本地工具（Windows/Mac/Linux）----------------------
function probeLocal(env: Environment, tool: Tool): Installation | null {
  // Windows 检查命令存在
  if (env.type === 'windows' && !cmdExistsWin(TOOL_CMDS[tool])) return null

  const meta = TOOLS.find(t => t.id === tool)!
  const configFile = path.join(env.homePath, meta.configDir, CONFIG_FILES[tool])
  if (!fs.existsSync(configFile)) return null

  try {
    return { tool, env, configPath: configFile, current: readConfig(tool, configFile) }
  } catch {
    return { tool, env, configPath: configFile, current: { model: '(读取失败)', baseUrl: '', apiKey: '' } }
  }
}

// ---------------------- 检查 WSL 工具 ----------------------
// WSL 中 which/npm 在非交互 shell 下不可靠（nvm 路径缺失）
// 以配置文件存在为判据：有配置 = 曾安装并使用
function probeWsl(env: Environment, tool: Tool): Installation | null {
  const meta = TOOLS.find(t => t.id === tool)!
  const configFile = `${env.homePath}/${meta.configDir}/${CONFIG_FILES[tool]}`

  try {
    const raw = execSync(
      `wsl -d ${env.distro} -- cat ${configFile}`,
      { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    if (!raw.trim()) return null

    const tmpDir = os.tmpdir()
    const tmpFile = path.join(tmpDir, `cc-switch-${tool}-${env.distro}-${Date.now()}`)
    fs.writeFileSync(tmpFile, raw, { encoding: 'utf-8' })
    const current = readConfig(tool, tmpFile)
    fs.unlinkSync(tmpFile)

    return { tool, env, configPath: configFile, current }
  } catch {
    return null
  }
}

// ---------------------- 主检测函数 ----------------------
export function detectInstallations(): Installation[] {
  const results: Installation[] = []
  const localEnv = detectLocalEnv()
  const wslEnvs = detectWslDistros()

  for (const meta of TOOLS) {
    const local = probeLocal(localEnv, meta.id)
    if (local) results.push(local)

    for (const wslEnv of wslEnvs) {
      const wsl = probeWsl(wslEnv, meta.id)
      if (wsl) results.push(wsl)
    }
  }

  return results
}
