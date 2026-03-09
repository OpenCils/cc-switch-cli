/**
 * [INPUT]: ATO 配置（端口、上游地址、密钥）
 * [OUTPUT]: 对外提供带类型的 ATO 服务壳：HTTP 服务实例、进程启动、健康检查与端口探测
 * [POS]: ato/ 的 TypeScript 适配层，向上游暴露稳定类型，向下游委托 runtime.mjs 单一真相源
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import type http from 'http'

const runtime = await import(new URL('./runtime.mjs', import.meta.url).href)

// ---------------------- 配置 ----------------------
export interface AtoConfig {
  port: number
  upstreamUrl: string
  upstreamKey: string
}

// ---------------------- 公开 API ----------------------
export function createAtoServer(config: AtoConfig): http.Server {
  return runtime.createAtoServer(config) as http.Server
}

export function startAtoProcess(config: AtoConfig): Promise<number> {
  return runtime.startAtoProcess(config) as Promise<number>
}

export function isPortInUse(port: number): Promise<boolean> {
  return runtime.isPortInUse(port) as Promise<boolean>
}

export function checkAtoRunning(port: number): Promise<boolean> {
  return runtime.checkAtoRunning(port) as Promise<boolean>
}
