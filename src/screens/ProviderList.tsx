/**
 * [INPUT]: 依赖 ink，依赖 types/store 的 AppStore 操作和 adapters 的配置写入
 * [OUTPUT]: 对外提供 ProviderList 组件
 * [POS]: screens/ 的供应商列表屏幕，展示/激活/删除供应商，跳转添加/编辑
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import React, { useState, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'
import type { AppStore, Installation, ProviderConfig } from '../types.js'
import { TOOLS, instKey } from '../types.js'
import { setActive, removeProvider, saveStore } from '../store/local.js'
import { writeConfig } from '../store/adapters/index.js'
import { writeConfigWsl } from '../store/write-wsl.js'
import { startAto, stopAto, getAtoStatus } from '../ato/index.js'

interface Props {
  installation: Installation
  store: AppStore
  onStoreChange: (s: AppStore) => void
  onAdd: () => void
  onEdit: (provider: ProviderConfig) => void
  onBack: () => void
}

export function ProviderList({ installation, store, onStoreChange, onAdd, onEdit, onBack }: Props) {
  const storeKey = instKey(installation)
  const providers = store.providers[storeKey] ?? []
  const activeId = store.active[storeKey]
  const meta = TOOLS.find(t => t.id === installation.tool)!

  const totalItems = providers.length + 1
  const [cursor, setCursor] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [atoStatus, setAtoStatus] = useState<{ running: boolean; port: number } | null>(null)

  // 检测 ATO 状态
  useEffect(() => {
    async function check() {
      const status = await getAtoStatus(
        5000,
        installation.env.type === 'wsl' ? 'wsl' : 'windows',
        installation.env.type === 'wsl' ? installation.env.distro : undefined,
      )
      setAtoStatus(status.running ? status : null)
    }
    check()
  }, [installation.env])

  const onProvider = cursor > 0 && cursor <= providers.length
  const curProvider = onProvider ? providers[cursor - 1] : null

  // 激活供应商
  async function applyProvider(provider: ProviderConfig) {
    const cfg = {
      model: provider.model,
      baseUrl: provider.useAto ? `http://127.0.0.1:${provider.atoPort ?? 5000}` : provider.baseUrl,
      apiKey: provider.useAto ? '' : provider.apiKey,
    }

    // 如果是 ATO 供应商，尝试启动代理（失败也继续，可能已在运行）
    if (provider.useAto && provider.atoUpstreamUrl && provider.atoApiKey) {
      const result = await startAto({
        port: provider.atoPort ?? 5000,
        upstreamUrl: provider.atoUpstreamUrl,
        upstreamKey: provider.atoApiKey,
        distro: installation.env.type === 'wsl' ? installation.env.distro : undefined,
      })
      if (result.success) {
        setAtoStatus({ running: true, port: provider.atoPort ?? 5000 })
      } else if (result.error?.includes('already running')) {
        setAtoStatus({ running: true, port: provider.atoPort ?? 5000 })
      } else {
        // 启动失败，但继续写入配置（用户可能手动启动了 ATO）
        setFeedback(`警告: ATO 启动失败 (${result.error})，仍将写入配置`)
      }
    }

    // 写入工具配置（无论 ATO 是否成功）
    if (installation.env.type === 'wsl') {
      writeConfigWsl(installation.tool, installation.configPath, installation.env.distro!, cfg)
    } else {
      writeConfig(installation.tool, installation.configPath, cfg)
    }
  }

  useInput((ch, k) => {
    if (confirmDelete) {
      if (ch === 'd' && curProvider) {
        const next = removeProvider(store, storeKey, curProvider.id)
        saveStore(next)
        onStoreChange(next)
        setCursor(i => Math.min(i, (next.providers[storeKey] ?? []).length))
        setFeedback('已删除')
      }
      setConfirmDelete(false)
      return
    }

    if (feedback) setFeedback('')

    if (k.upArrow)   return setCursor(i => (i - 1 + totalItems) % totalItems)
    if (k.downArrow) return setCursor(i => (i + 1) % totalItems)
    if (k.escape)    return onBack()

    if (k.return) {
      if (cursor === 0) return onAdd()
      if (curProvider) return onEdit(curProvider)
    }

    if ((ch === ' ' || ch === 's' || ch === 'a') && curProvider) {
      const next = setActive(store, storeKey, curProvider.id)
      saveStore(next)
      onStoreChange(next)
      applyProvider(curProvider)
      setFeedback(`✓ 已激活: ${curProvider.name}`)
      return
    }

    if (ch === 'd' && onProvider) {
      setConfirmDelete(true)
    }
  })

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {/* ---- 顶栏 ---- */}
      <Box marginBottom={1} gap={1}>
        <Text dimColor>CC Switch ›</Text>
        <Text bold color={meta.color}>{meta.label}</Text>
        <Text dimColor>› {installation.env.label}</Text>
        {atoStatus && (
          <Text color="green" dimColor> (ATO:{atoStatus.port})</Text>
        )}
      </Box>

      {/* ---- 列表 ---- */}
      <Box flexDirection="column">
        <Box paddingX={1} gap={1}>
          <Text color={cursor === 0 ? 'cyan' : 'gray'} bold={cursor === 0}>
            {cursor === 0 ? '❯' : ' '} + 添加供应商
          </Text>
        </Box>

        {providers.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            {providers.map((p, i) => {
              const idx = i + 1
              const isActive = p.id === activeId
              const isCursor = idx === cursor
              return (
                <Box key={p.id} paddingX={1} gap={1}>
                  <Text color={isCursor ? meta.color : undefined} bold={isCursor}>
                    {isCursor ? '❯' : ' '}
                  </Text>
                  <Text color={isActive ? 'green' : undefined}>
                    {isActive ? '●' : '○'}
                  </Text>
                  <Text bold={isCursor}>{p.name}</Text>
                  {p.useAto && <Text color="yellow" dimColor>[ATO]</Text>}
                  <Text dimColor>{p.model}</Text>
                </Box>
              )
            })}
          </Box>
        )}
      </Box>

      {/* ---- 底部反馈/提示 ---- */}
      <Box marginTop={1}>
        {feedback ? (
          <Text color="green" bold>{feedback}</Text>
        ) : confirmDelete ? (
          <Text color="red" bold>确认删除 "{curProvider?.name}"？再按 d / Esc 取消</Text>
        ) : (
          <Text dimColor>↑↓ 移动   Enter 进入   s 激活   d 删除   Esc 返回</Text>
        )}
      </Box>
    </Box>
  )
}
