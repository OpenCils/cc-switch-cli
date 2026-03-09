/**
 * [INPUT]: 依赖 fs 的文件读写
 * [OUTPUT]: 对外提供 readOpenclaw / writeOpenclaw
 * [POS]: adapters/ 的 OpenClaw 配置适配器
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 *
 * OpenClaw 配置格式 (~/.openclaw/openclaw.json):
 * {
 *   "agents": {
 *     "defaults": {
 *       "model": { "primary": "openai-codex/gpt-5.3-codex" }
 *     }
 *   }
 * }
 */

import fs from 'fs'
import type { ToolConfig } from '../../types.js'

// ---------------------- 读取 ----------------------
export function readOpenclaw(configPath: string): ToolConfig {
  const raw = fs.readFileSync(configPath, { encoding: 'utf-8' })
  const json = JSON.parse(raw)
  const model = json.agents?.defaults?.model?.primary ?? ''
  return {
    model,
    baseUrl: '',
    apiKey:  '',  // OpenClaw 使用 OAuth
  }
}

// ---------------------- 写入 ----------------------
export function writeOpenclaw(configPath: string, cfg: ToolConfig): void {
  const raw = fs.readFileSync(configPath, { encoding: 'utf-8' })
  const json = JSON.parse(raw)

  // 确保嵌套路径存在
  if (!json.agents) json.agents = {}
  if (!json.agents.defaults) json.agents.defaults = {}
  if (!json.agents.defaults.model) json.agents.defaults.model = {}

  if (cfg.model) json.agents.defaults.model.primary = cfg.model

  fs.writeFileSync(configPath, JSON.stringify(json, null, 2), { encoding: 'utf-8' })
}
