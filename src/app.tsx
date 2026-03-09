/**
 * [INPUT]: 依赖所有 screens、store 与 ato 生命周期管理，依赖 ink 的 render/useApp/useInput，依赖 updater 的版本检测与自更新
 * [OUTPUT]: App 根组件 + 程序入口
 * [POS]: src/ 的顶层路由控制器，负责三屏导航、退出前的 ATO 保留/关闭确认，以及首页更新状态
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import React, { useState, useEffect } from 'react'
import { render, useApp, useInput } from 'ink'
import type { AppStore, Installation, ProviderConfig } from './types.js'
import { instKey } from './types.js'
import { detectInstallations } from './store/detect.js'
import { loadStore, saveStore } from './store/local.js'
import { getAtoStatus, stopAto } from './ato/index.js'
import { ProviderSelect } from './screens/ProviderSelect.js'
import { ProviderList } from './screens/ProviderList.js'
import { ProviderForm } from './screens/ProviderForm.js'
import { ExitConfirm } from './screens/ExitConfirm.js'
import { LanguageSelect } from './screens/LanguageSelect.js'
import { setLang, t, type Lang } from './i18n/index.js'
import { CURRENT_VERSION, canSelfUpdate, checkForUpdates, getInstallCommand, startSelfUpdate } from './updater.js'

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
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)

  // ---- 启动后台更新检测，不阻塞 UI ----
  useEffect(() => {
    let cancelled = false

    void checkForUpdates(store).then(({ version, didCheck, checkedAt }) => {
      if (cancelled) return

      setUpdateAvailable(version)
      setStore(prev => {
        const prevVersion = prev.updateAvailable ?? null
        if (!didCheck && prevVersion === version) {
          return prev
        }

        const next = {
          ...prev,
          lastUpdateCheck: checkedAt,
          updateAvailable: version ?? undefined,
        }
        saveStore(next)
        return next
      })
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
    if (!updateAvailable || updating) return

    setUpdating(true)
    setUpdateError(null)

    const result = await startSelfUpdate()
    if (!result.started) {
      setUpdating(false)
      setUpdateError(result.error ?? 'unknown error')
      return
    }

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

  if (!store.language) {
    return <LanguageSelect onSelect={handleLanguageSelect} />
  }

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

  if (screen.name === 'select') {
    return (
      <ProviderSelect
        installations={installations}
        currentVersion={CURRENT_VERSION}
        updateAvailable={updateAvailable}
        installCmd={getInstallCommand()}
        canSelfUpdate={canSelfUpdate()}
        updateError={updateError}
        updating={updating}
        onSelect={inst => setScreen({ name: 'provider-list', installation: inst })}
        onExitRequest={requestExit}
        onUpdateRequest={() => void handleUpdateRequest()}
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
render(<App />, { exitOnCtrlC: false })