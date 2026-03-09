/**
 * [INPUT]: 依赖 claude/codex/gemini 三个适配器
 * [OUTPUT]: 对外提供 readConfig / writeConfig 统一入口
 * [POS]: adapters/ 的统一分发器，根据 Tool 类型路由到对应适配器
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import type { Tool, ToolConfig } from '../../types.js'
import { readClaude, writeClaude } from './claude.js'
import { readCodex, writeCodex } from './codex.js'
import { readGemini, writeGemini } from './gemini.js'
import { readOpenclaw, writeOpenclaw } from './openclaw.js'

type Reader = (path: string) => ToolConfig
type Writer = (path: string, cfg: ToolConfig) => void

const readers: Record<Tool, Reader> = {
  claude:   readClaude,
  codex:    readCodex,
  gemini:   readGemini,
  openclaw: readOpenclaw,
}

const writers: Record<Tool, Writer> = {
  claude:   writeClaude,
  codex:    writeCodex,
  gemini:   writeGemini,
  openclaw: writeOpenclaw,
}

export function readConfig(tool: Tool, configPath: string): ToolConfig {
  return readers[tool](configPath)
}

export function writeConfig(tool: Tool, configPath: string, cfg: ToolConfig): void {
  writers[tool](configPath, cfg)
}
