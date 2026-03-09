/**
 * [INPUT]: 依赖 fs/os/path/crypto，依赖 types 的 AppStore/ProviderConfig
 * [OUTPUT]: 对外提供 loadStore/saveStore/addProvider/updateProvider/removeProvider/setActive/newId
 * [POS]: src/store/ 的本地持久化层，管理 ~/.cc-switch.json
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import type { AppStore, ProviderConfig } from '../types.js'

const STORE_PATH = path.join(os.homedir(), '.cc-switch.json')

const DEFAULT_STORE: AppStore = { providers: {}, active: {} }

// ---------------------- 读取 ----------------------
export function loadStore(): AppStore {
  if (!fs.existsSync(STORE_PATH)) return structuredClone(DEFAULT_STORE)
  try {
    const raw = fs.readFileSync(STORE_PATH, { encoding: 'utf-8' })
    return JSON.parse(raw) as AppStore
  } catch {
    return structuredClone(DEFAULT_STORE)
  }
}

// ---------------------- 写入 ----------------------
export function saveStore(store: AppStore): void {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), { encoding: 'utf-8' })
}

// ---------------------- 生成唯一 ID ----------------------
export function newId(): string {
  return crypto.randomUUID()
}

// ---------------------- 添加供应商 ----------------------
export function addProvider(store: AppStore, key: string, provider: ProviderConfig): AppStore {
  const next = structuredClone(store)
  if (!next.providers[key]) next.providers[key] = []
  next.providers[key].push(provider)
  // 第一个供应商自动激活
  if (!next.active[key]) next.active[key] = provider.id
  return next
}

// ---------------------- 更新供应商 ----------------------
export function updateProvider(store: AppStore, key: string, provider: ProviderConfig): AppStore {
  const next = structuredClone(store)
  const list = next.providers[key] ?? []
  const idx = list.findIndex(p => p.id === provider.id)
  if (idx !== -1) list[idx] = provider
  return next
}

// ---------------------- 删除供应商 ----------------------
export function removeProvider(store: AppStore, key: string, id: string): AppStore {
  const next = structuredClone(store)
  next.providers[key] = (next.providers[key] ?? []).filter(p => p.id !== id)
  if (next.active[key] === id) {
    next.active[key] = next.providers[key][0]?.id ?? null
  }
  return next
}

// ---------------------- 激活供应商 ----------------------
export function setActive(store: AppStore, key: string, id: string): AppStore {
  const next = structuredClone(store)
  next.active[key] = id
  return next
}
