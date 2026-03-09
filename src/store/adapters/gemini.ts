/**
 * [INPUT]: 依赖 fs 的文件读写
 * [OUTPUT]: 对外提供 readGemini / writeGemini
 * [POS]: adapters/ 的 Gemini CLI 配置适配器
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 *
 * Gemini 使用 OAuth 认证，模型切换通过 settings.json
 * 当前观测到 Gemini 不在 settings.json 中存储模型信息
 * 它通过 GEMINI_MODEL 环境变量或启动参数指定模型
 */

import fs from 'fs'
import type { ToolConfig } from '../../types.js'

// ---------------------- 读取 ----------------------
export function readGemini(configPath: string): ToolConfig {
  const raw = fs.readFileSync(configPath, { encoding: 'utf-8' })
  const json = JSON.parse(raw)
  return {
    model:   json.model ?? '(OAuth 默认)',
    baseUrl: json.baseUrl ?? '',
    apiKey:  '',  // OAuth 模式无 API Key
  }
}

// ---------------------- 写入 ----------------------
export function writeGemini(configPath: string, cfg: ToolConfig): void {
  const raw = fs.readFileSync(configPath, { encoding: 'utf-8' })
  const json = JSON.parse(raw)

  if (cfg.model && cfg.model !== '(OAuth 默认)') json.model = cfg.model
  if (cfg.baseUrl) json.baseUrl = cfg.baseUrl

  fs.writeFileSync(configPath, JSON.stringify(json, null, 2), { encoding: 'utf-8' })
}
