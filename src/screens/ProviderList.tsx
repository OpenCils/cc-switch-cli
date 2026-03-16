/**
 * [INPUT]: 依赖 ink，依赖 types/store 的 AppStore 操作和 adapters 的配置写入
 * [OUTPUT]: 对外提供 ProviderList 组件
 * [POS]: screens/ 的供应商列表屏幕，展示/激活/删除供应商，跳转添加/编辑
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import React, { useEffect, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import type { AppStore, Installation, ProviderConfig } from '../types.js'
import { TOOLS, instKey } from '../types.js'
import { removeProvider, saveStore, setActive, updateProvider } from '../store/local.js'
import { writeConfig } from '../store/adapters/index.js'
import { writeConfigWsl } from '../store/write-wsl.js'
import { getAtoStatus, isPortInUse, startAto } from '../ato/index.js'
import { t } from '../i18n/index.js'

interface Props {
  installation: Installation
  store: AppStore
  onStoreChange: (s: AppStore) => void
  onAdd: () => void
  onEdit: (provider: ProviderConfig) => void
  onBack: () => void
}

interface ApplyResult {
  ok: boolean
  error?: string
  warning?: string
  appliedProvider: ProviderConfig
  nextStore: AppStore
}

const DEFAULT_ATO_PORT = 18653
const MAX_PORT_SCAN = 30

export function ProviderList({ installation, store, onStoreChange, onAdd, onEdit, onBack }: Props) {
  const storeKey = instKey(installation)
  const providers = store.providers[storeKey] ?? []
  const activeId = store.active[storeKey]
  const meta = TOOLS.find(t => t.id === installation.tool)!

  const totalItems = providers.length + 1
  const [cursor, setCursor] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [feedbackIsError, setFeedbackIsError] = useState(false)
  const [activating, setActivating] = useState(false)
  const [atoStatus, setAtoStatus] = useState<{ running: boolean; port: number } | null>(null)

  const activeProvider = providers.find(provider => provider.id === activeId) ?? null
  const statusPort = activeProvider?.useAto ? (activeProvider.atoPort ?? DEFAULT_ATO_PORT) : null

  useEffect(() => {
    async function check() {
      if (!statusPort) {
        setAtoStatus(null)
        return
      }

      const status = await getAtoStatus(
        statusPort,
        installation.env.type === 'wsl' ? 'wsl' : 'windows',
        installation.env.type === 'wsl' ? installation.env.distro : undefined,
      )
      setAtoStatus(status.running ? { running: true, port: status.port } : null)
    }

    void check()
  }, [installation.env, statusPort])

  const onProvider = cursor > 0 && cursor <= providers.length
  const curProvider = onProvider ? providers[cursor - 1] : null

  function withUpdatedProvider(baseStore: AppStore, provider: ProviderConfig): AppStore {
    return updateProvider(baseStore, storeKey, provider)
  }

  async function resolveAtoPort(provider: ProviderConfig): Promise<{ port: number; changed: boolean }> {
    const desiredPort = provider.atoPort ?? DEFAULT_ATO_PORT
    const env = installation.env.type === 'wsl' ? 'wsl' : 'windows'
    const distro = installation.env.type === 'wsl' ? installation.env.distro : undefined
    const status = await getAtoStatus(desiredPort, env, distro)

    if (status.running && status.upstreamUrl === provider.atoUpstreamUrl) {
      return { port: desiredPort, changed: false }
    }

    if (!(await isPortInUse(desiredPort))) {
      return { port: desiredPort, changed: false }
    }

    for (let offset = 1; offset <= MAX_PORT_SCAN; offset++) {
      const candidate = desiredPort + offset
      if (!(await isPortInUse(candidate))) {
        return { port: candidate, changed: true }
      }
    }

    throw new Error(t('atoPortConflict', { ports: `${desiredPort}-${desiredPort + MAX_PORT_SCAN}` }))
  }

  async function applyProvider(provider: ProviderConfig): Promise<ApplyResult> {
    let nextProvider = provider
    let nextStore = store
    let warning = ''
    let resolvedPort = provider.atoPort ?? DEFAULT_ATO_PORT

    if (provider.useAto) {
      if (!provider.atoUpstreamUrl || !provider.atoApiKey) {
        return { ok: false, error: t('atoMissingConfig'), appliedProvider: provider, nextStore }
      }

      const resolved = await resolveAtoPort(provider)
      resolvedPort = resolved.port

      if (resolved.changed) {
        nextProvider = {
          ...provider,
          atoPort: resolved.port,
        }
        warning = t('atoPortChanged', { old: String(provider.atoPort ?? DEFAULT_ATO_PORT), new: String(resolved.port) })
      }

      const result = await startAto({
        port: resolvedPort,
        upstreamUrl: nextProvider.atoUpstreamUrl ?? '',
        upstreamKey: nextProvider.atoApiKey ?? '',
        distro: installation.env.type === 'wsl' ? installation.env.distro : undefined,
      })

      if (result.success || result.error?.includes('already running')) {
        setAtoStatus({ running: true, port: resolvedPort })
        if (resolved.changed) {
          nextStore = withUpdatedProvider(nextStore, nextProvider)
        }
      } else {
        return {
          ok: false,
          error: t('atoStartFailed', { error: result.error ?? '' }),
          appliedProvider: nextProvider,
          nextStore,
        }
      }
    }

    const cfg = {
      model: nextProvider.model,
      baseUrl: nextProvider.useAto ? `http://127.0.0.1:${resolvedPort}` : (nextProvider.baseUrl ?? ''),
      apiKey: nextProvider.useAto ? (nextProvider.atoApiKey ?? '') : (nextProvider.apiKey ?? ''),
    }

    if (installation.env.type === 'wsl') {
      writeConfigWsl(installation.tool, installation.configPath, installation.env.distro!, cfg)
    } else {
      writeConfig(installation.tool, installation.configPath, cfg)
    }

    return {
      ok: true,
      warning,
      appliedProvider: nextProvider,
      nextStore,
    }
  }

  async function activateProvider(provider: ProviderConfig) {
    if (activating) return

    setActivating(true)
    setFeedback(t('activating', { name: provider.name }))

    try {
      const result = await applyProvider(provider)
      if (!result.ok) {
        setFeedbackIsError(true)
      setFeedback(t('activateFailed', { error: result.error ?? '' }))
        return
      }

      const next = setActive(result.nextStore, storeKey, result.appliedProvider.id)
      saveStore(next)
      onStoreChange(next)
      setFeedbackIsError(false)
      setFeedback(result.warning ? t('activatedWarning', { name: provider.name, warning: result.warning }) : t('activated', { name: provider.name }))
    } catch (err: any) {
      setFeedbackIsError(true)
      setFeedback(t('activateFailed', { error: err?.message || String(err) }))
    } finally {
      setActivating(false)
    }
  }

  useInput((ch, k) => {
    if (confirmDelete) {
      if (ch === 'd' && curProvider) {
        const next = removeProvider(store, storeKey, curProvider.id)
        saveStore(next)
        onStoreChange(next)
        setCursor(i => Math.min(i, (next.providers[storeKey] ?? []).length))
        setFeedbackIsError(false)
        setFeedback(t('deleted'))
      }
      setConfirmDelete(false)
      return
    }

    if (feedback && !activating) setFeedback('')

    if (k.upArrow)   return setCursor(i => (i - 1 + totalItems) % totalItems)
    if (k.downArrow) return setCursor(i => (i + 1) % totalItems)
    if (k.escape)    return onBack()

    if (k.return) {
      if (cursor === 0) return onAdd()
      if (curProvider) return onEdit(curProvider)
    }

    if ((ch === ' ' || ch === 's' || ch === 'a') && curProvider) {
      void activateProvider(curProvider)
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
            {cursor === 0 ? '❯' : ' '} {t('addProvider')}
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
                  {p.useAto && <Text dimColor>(:{p.atoPort ?? DEFAULT_ATO_PORT})</Text>}
                </Box>
              )
            })}
          </Box>
        )}
      </Box>

      {/* ---- 底部反馈/提示 ---- */}
      <Box marginTop={1}>
        {feedback ? (
          <Text color={feedbackIsError ? 'red' : 'green'} bold>{feedback}</Text>
        ) : confirmDelete ? (
          <Text color="red" bold>{t('confirmDelete', { name: curProvider?.name ?? '' })}</Text>
        ) : (
          <Text dimColor>{activating ? t('activatingAto') : t('hintList')}</Text>
        )}
      </Box>
    </Box>
  )
}
