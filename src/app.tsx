/**
 * [INPUT]: 依赖所有 screens、store 与 ato 生命周期管理，依赖 ink 的 render/useApp/useInput，依赖 updater 的版本检测、自更新与进度回调
 * [OUTPUT]: App 根组件、程序入口，以及编译态 ATO 子进程入口
 * [POS]: src/ 的顶层路由控制器，负责三屏导航、退出前的 ATO 保留/关闭确认、首页更新状态与编译态 ATO 自举
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import React, { useState, useEffect } from 'react'
import { parseArgs } from 'util'
import { render, useApp, useInput } from 'ink'
import type { AppStore, Installation, ProviderConfig } from './types.js'
import { instKey } from './types.js'
import { detectInstallations } from './store/detect.js'
import { loadStore, saveStore } from './store/local.js'
import { getAtoStatus, startAtoProcess, stopAto } from './ato/index.js'
import { ProviderSelect } from './screens/ProviderSelect.js'
import { ProviderList } from './screens/ProviderList.js'
import { ProviderForm } from './screens/ProviderForm.js'
import { ExitConfirm } from './screens/ExitConfirm.js'
import { LanguageSelect } from './screens/LanguageSelect.js'
import { UpdateConfirm } from './screens/UpdateConfirm.js'
import { setLang, t, type Lang } from './i18n/index.js'
import {
  CURRENT_VERSION,
  canSelfUpdate,
  checkForUpdates,
  getInstallCommand,
  startSelfUpdate,
  type SelfUpdateProgress,
} from './updater.js'

// ---------------------- 路由类型 ----------------------
type Screen =
  | { name: 'select' }
  | { name: 'provider-list'; installation: Installation }
  | { name: 'provider-form'; installation: Installation; editing: ProviderConfig | null }

interface AtoExitTarget {
  env: 'windows' | 'wsl'
  label: string
  port: number
  distro?: string
}

interface ExitDialogState {
  mode: 'confirm' | 'stopping' | 'error'
  message?: string
  targets: AtoExitTarget[]
}

const UPDATE_EXIT_DELAY_MS = 900

function collectAtoTargets(store: AppStore, installations: Installation[]): AtoExitTarget[] {
  const installationMap = new Map(installations.map(inst => [instKey(inst), inst]))
  const seen = new Set<string>()
  const targets: AtoExitTarget[] = []

  for (const [storeKey, providers] of Object.entries(store.providers)) {
    const installation = installationMap.get(storeKey)
    if (!installation) continue
    if (installation.env.type !== 'windows' && installation.env.type !== 'wsl') continue

    for (const provider of providers) {
      if (!provider.useAto) continue

      const port = provider.atoPort ?? 18653
      const env = installation.env.type === 'wsl' ? 'wsl' : 'windows'
      const signature = `${env}:${installation.env.distro ?? ''}:${port}`
      if (seen.has(signature)) continue
      seen.add(signature)

      targets.push({
        env,
        label: `${installation.env.label}:${port}`,
        port,
        distro: installation.env.distro,
      })
    }
  }

  return targets.sort((a, b) => a.label.localeCompare(b.label))
}

function readStringArg(value: string | boolean | undefined): string {
  return typeof value === 'string' ? value : ''
}

function maybeRunAtoChildProcess(): boolean {
  if (!process.argv.includes('--ato-child')) {
    return false
  }

  const { values } = parseArgs({
    options: {
      'ato-child': { type: 'boolean' },
      port: { type: 'string', short: 'p' },
      upstream: { type: 'string', short: 'u' },
      key: { type: 'string', short: 'k' },
    },
    strict: false,
    allowPositionals: true,
  })

  const portArg = readStringArg(values.port)
  const upstreamArg = readStringArg(values.upstream)
  const keyArg = readStringArg(values.key)
  const port = Number.parseInt(portArg || process.env.ATO_PORT || '18653', 10)
  const upstreamUrl = upstreamArg || process.env.ATO_UPSTREAM_URL || ''
  const upstreamKey = keyArg || process.env.ATO_UPSTREAM_KEY || ''

  if (!upstreamUrl) {
    console.error('[ATO] Error: upstream URL is required')
    process.exit(1)
  }

  if (Number.isNaN(port) || port <= 0) {
    console.error(`[ATO] Error: invalid port ${portArg}`)
    process.exit(1)
  }

  void startAtoProcess({ port, upstreamUrl, upstreamKey }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[ATO] Error:', message)
    process.exit(1)
  })

  return true
}

// ---------------------- 根组件 ----------------------
function App() {
  const { exit } = useApp()
  const [installations] = useState<Installation[]>(() => detectInstallations())
  const [store, setStore] = useState<AppStore>(() => {
    const s = loadStore()
    if (s.language) setLang(s.language as Lang)
    return s
  })
  const [screen, setScreen] = useState<Screen>({ name: 'select' })
  const [exitDialog, setExitDialog] = useState<ExitDialogState | null>(null)

  // ---- 更新检测状态 ----
  const [updateChecking, setUpdateChecking] = useState(true)
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [updateProgress, setUpdateProgress] = useState<SelfUpdateProgress | null>(null)
  const [updating, setUpdating] = useState(false)
  const [updateSkipped, setUpdateSkipped] = useState(false)

  // ---- 启动时检测更新 ----
  useEffect(() => {
    let cancelled = false

    void checkForUpdates(store).then(({ version }) => {
      if (cancelled) return
      setUpdateChecking(false)
      if (version) {
        setUpdateAvailable(version)
      } else {
        // 无更新时清除缓存
        setStore(prev => {
          const next = { ...prev, updateAvailable: undefined }
          saveStore(next)
          return next
        })
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  function requestExit() {
    if (exitDialog) return
    setExitDialog({
      mode: 'confirm',
      targets: collectAtoTargets(store, installations),
    })
  }

  function handleLanguageSelect(lang: Lang) {
    setLang(lang)
    const next = { ...store, language: lang }
    saveStore(next)
    setStore(next)
  }

  async function handleUpdateRequest() {
    if (updating) return

    setUpdating(true)
    setUpdateError(null)
    setUpdateProgress({ phase: 'preparing' })

    const result = await startSelfUpdate({
      onProgress: progress => {
        setUpdateProgress(progress)
      },
    })
    if (!result.started) {
      setUpdating(false)
      setUpdateProgress(null)
      setUpdateError(result.error ?? 'unknown error')
      return
    }

    await new Promise(resolve => setTimeout(resolve, UPDATE_EXIT_DELAY_MS))
    exit()
  }

  async function stopAtoAndExit() {
    if (!exitDialog || exitDialog.mode === 'stopping') return

    setExitDialog({
      ...exitDialog,
      mode: 'stopping',
      message: exitDialog.targets.length === 0
        ? t('noAtoConfig')
        : t('stoppingNAto', { count: exitDialog.targets.length }),
    })

    const results = await Promise.all(exitDialog.targets.map(async target => {
      const status = await getAtoStatus(target.port, target.env, target.distro)
      if (!status.running) {
        return { target, ok: true }
      }

      const stopped = await stopAto(target.port, target.env, target.distro)
      return { target, ok: stopped }
    }))

    const failed = results.filter(result => !result.ok).map(result => result.target.label)
    if (failed.length > 0) {
      setExitDialog({
        ...exitDialog,
        mode: 'error',
        message: t('stopFailed', { labels: failed.join('，') }),
      })
      return
    }

    exit()
  }

  useInput((input, key) => {
    if (key.ctrl && input === 'c' && !exitDialog) {
      requestExit()
    }
  })

  // ---- 语言选择 ----
  if (!store.language) {
    return <LanguageSelect onSelect={handleLanguageSelect} />
  }

  // ---- 退出确认 ----
  if (exitDialog) {
    return (
      <ExitConfirm
        message={exitDialog.message}
        mode={exitDialog.mode}
        targets={exitDialog.targets}
        onCancel={() => setExitDialog(null)}
        onExitKeepAto={exit}
        onExitStopAto={() => void stopAtoAndExit()}
      />
    )
  }

  // ---- 更新确认（检测到更新且用户未跳过）----
  if (updateAvailable && !updateSkipped) {
    return (
      <UpdateConfirm
        currentVersion={CURRENT_VERSION}
        newVersion={updateAvailable}
        canSelfUpdate={canSelfUpdate()}
        installCmd={getInstallCommand()}
        updating={updating}
        progress={updateProgress}
        error={updateError}
        onUpdate={() => void handleUpdateRequest()}
        onSkip={() => setUpdateSkipped(true)}
      />
    )
  }

  // ---- 主界面 ----
  if (screen.name === 'select') {
    return (
      <ProviderSelect
        installations={installations}
        store={store}
        currentVersion={CURRENT_VERSION}
        onSelect={inst => setScreen({ name: 'provider-list', installation: inst })}
        onExitRequest={requestExit}
      />
    )
  }

  if (screen.name === 'provider-list') {
    const { installation } = screen
    return (
      <ProviderList
        installation={installation}
        store={store}
        onStoreChange={setStore}
        onAdd={() => setScreen({ name: 'provider-form', installation, editing: null })}
        onEdit={p => setScreen({ name: 'provider-form', installation, editing: p })}
        onBack={() => setScreen({ name: 'select' })}
      />
    )
  }

  const { installation, editing } = screen
  return (
    <ProviderForm
      installation={installation}
      store={store}
      editing={editing}
      onStoreChange={setStore}
      onBack={() => setScreen({ name: 'provider-list', installation })}
    />
  )
}

// ---------------------- 启动 ----------------------
if (!maybeRunAtoChildProcess()) {
  render(<App />, { exitOnCtrlC: false })
}
