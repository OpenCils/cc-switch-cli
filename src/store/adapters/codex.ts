/**
 * [INPUT]: 依赖 fs 的文件读写
 * [OUTPUT]: 对外提供 readCodex / writeCodex
 * [POS]: adapters/ 的 Codex 配置适配器
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 *
 * Codex 配置格式 (~/.codex/config.toml):
 * model_provider = "right_code"
 * model = "gpt-5.4-xhigh"
 * [model_providers.right_code]
 * base_url = "https://..."
 */

import fs from 'fs'
import type { ToolConfig } from '../../types.js'

// ---------------------- 简易 TOML 解析 ----------------------
// 只解析 Codex config.toml 需要的顶层键值和 model_providers section
function parseCodexToml(text: string) {
  const result: Record<string, string> = {}
  const providers: Record<string, Record<string, string>> = {}

  let currentSection = ''
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    // section header: [model_providers.xxx]
    const secMatch = trimmed.match(/^\[model_providers\.(.+)]$/)
    if (secMatch) {
      currentSection = secMatch[1]
      providers[currentSection] = {}
      continue
    }

    // 跳过其他 section（如 [mcp_servers.xxx]）
    const otherSec = trimmed.match(/^\[(.+)]$/)
    if (otherSec) {
      currentSection = '__skip__'
      continue
    }

    // key = value
    const kvMatch = trimmed.match(/^(\w+)\s*=\s*"(.+)"$/)
    if (!kvMatch) continue

    if (currentSection && currentSection !== '__skip__') {
      providers[currentSection][kvMatch[1]] = kvMatch[2]
    } else if (!currentSection) {
      result[kvMatch[1]] = kvMatch[2]
    }
  }

  return { top: result, providers }
}

// ---------------------- 读取 ----------------------
export function readCodex(configPath: string): ToolConfig {
  const raw = fs.readFileSync(configPath, { encoding: 'utf-8' })
  const parsed = parseCodexToml(raw)
  const providerName = parsed.top.model_provider ?? ''
  const provider = parsed.providers[providerName] ?? {}
  return {
    model:   parsed.top.model ?? '',
    baseUrl: provider.base_url ?? '',
    apiKey:  '',  // Codex 使用 auth.json，不在 config.toml 中
  }
}

// ---------------------- 写入 ----------------------
export function writeCodex(configPath: string, cfg: ToolConfig): void {
  let raw = fs.readFileSync(configPath, { encoding: 'utf-8' })

  // 替换顶层 model = "..."
  if (cfg.model) {
    raw = raw.replace(
      /^model\s*=\s*"[^"]*"/m,
      `model = "${cfg.model}"`,
    )
  }

  // 替换 provider section 的 base_url
  if (cfg.baseUrl) {
    raw = raw.replace(
      /^base_url\s*=\s*"[^"]*"/m,
      `base_url = "${cfg.baseUrl}"`,
    )
  }

  fs.writeFileSync(configPath, raw, { encoding: 'utf-8' })
}
