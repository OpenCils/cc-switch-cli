/**
 * [INPUT]: 依赖 fs 的文件读写
 * [OUTPUT]: 对外提供 readClaude / writeClaude
 * [POS]: adapters/ 的 Claude Code 配置适配器
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 *
 * Claude Code 配置格式 (~/.claude/settings.json):
 * {
 *   "env": {
 *     "ANTHROPIC_MODEL": "claude-opus-4-6",
 *     "ANTHROPIC_BASE_URL": "https://...",
 *     "ANTHROPIC_AUTH_TOKEN": "sk-..."
 *   }
 * }
 */

import fs from 'fs'
import type { ToolConfig } from '../../types.js'

function setEnvValue(env: Record<string, string>, key: string, value: string): void {
  if (value) {
    env[key] = value
    return
  }
  delete env[key]
}

// 剥离 UTF-8 BOM，文件不存在/损坏时返回空对象
function safeReadJson(configPath: string): any {
  try {
    const raw = fs.readFileSync(configPath, { encoding: 'utf-8' }).replace(/^\uFEFF/, '')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

// ---------------------- 读取 ----------------------
export function readClaude(configPath: string): ToolConfig {
  const json = safeReadJson(configPath)
  const env = json.env ?? {}
  return {
    model:   env.ANTHROPIC_MODEL       ?? env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? '',
    baseUrl: env.ANTHROPIC_BASE_URL    ?? '',
    apiKey:  env.ANTHROPIC_AUTH_TOKEN  ?? '',
  }
}

// ---------------------- 写入 ----------------------
export function writeClaude(configPath: string, cfg: ToolConfig): void {
  const json = safeReadJson(configPath)
  if (!json.env) json.env = {}

  setEnvValue(json.env, 'ANTHROPIC_MODEL', cfg.model)
  setEnvValue(json.env, 'ANTHROPIC_BASE_URL', cfg.baseUrl)
  setEnvValue(json.env, 'ANTHROPIC_AUTH_TOKEN', cfg.apiKey)

  fs.writeFileSync(configPath, JSON.stringify(json, null, 2), { encoding: 'utf-8' })
}