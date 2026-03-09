#!/usr/bin/env node
/**
 * [INPUT]: 命令行参数（port/upstream/key）与 ATO 环境变量
 * [OUTPUT]: 对外提供独立 ATO 代理进程入口
 * [POS]: ato/ 的 CLI 壳，只做参数解析并委托 runtime.mjs 单一真相源
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { parseArgs } from 'util'
import { startAtoProcess } from './runtime.mjs'

function readStringArg(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

const { values } = parseArgs({
  options: {
    port: { type: 'string', short: 'p', default: '18653' },
    upstream: { type: 'string', short: 'u', default: '' },
    key: { type: 'string', short: 'k', default: '' },
  },
})

const portArg = readStringArg(values.port, '18653')
const upstreamUrl = readStringArg(values.upstream) || process.env.ATO_UPSTREAM_URL || ''
const upstreamKey = readStringArg(values.key) || process.env.ATO_UPSTREAM_KEY || ''
const port = Number.parseInt(portArg, 10)

if (!upstreamUrl) {
  console.error('[ATO] Error: upstream URL is required')
  process.exit(1)
}

if (Number.isNaN(port) || port <= 0) {
  console.error(`[ATO] Error: invalid port ${portArg}`)
  process.exit(1)
}

void startAtoProcess({ port, upstreamUrl, upstreamKey }).catch(error => {
  const message = error instanceof Error ? error.message : String(error)
  console.error('[ATO] Error:', message)
  process.exit(1)
})
