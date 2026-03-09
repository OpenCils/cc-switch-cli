/**
 * [INPUT]: 依赖 child_process/os/fs/path，依赖 adapters 的 writeConfig
 * [OUTPUT]: 对外提供 writeConfigWsl 函数
 * [POS]: src/store/ 的 WSL 写入桥接器，通过 wsl 命令将配置写入 WSL 文件系统
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { execSync } from 'child_process'
import type { Tool, ToolConfig } from '../types.js'
import { writeConfig } from './adapters/index.js'

export function writeConfigWsl(tool: Tool, wslPath: string, distro: string, cfg: ToolConfig): void {
  const tmpFile = path.join(os.tmpdir(), `cc-switch-wsl-write-${Date.now()}`)

  // 1. 从 WSL 读取当前文件到临时文件
  const raw = execSync(
    `wsl -d ${distro} -- cat ${wslPath}`,
    { encoding: 'utf-8', timeout: 5000 },
  )
  fs.writeFileSync(tmpFile, raw, { encoding: 'utf-8' })

  // 2. 用适配器修改临时文件
  writeConfig(tool, tmpFile, cfg)

  // 3. 将修改后的内容通过 wslpath 转换后用 wsl cp 写回
  //    Windows 临时文件可通过 /mnt/c/... 在 WSL 中访问
  const winTmp = tmpFile.replace(/\\/g, '/')
  const driveLetter = winTmp[0].toLowerCase()
  const wslTmpPath = `/mnt/${driveLetter}${winTmp.slice(2)}`

  execSync(
    `wsl -d ${distro} -- cp ${wslTmpPath} ${wslPath}`,
    { encoding: 'utf-8', timeout: 5000 },
  )

  // 4. 清理
  fs.unlinkSync(tmpFile)
}
