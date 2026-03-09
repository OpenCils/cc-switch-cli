/**
 * [INPUT]: 依赖所有 screens 和 store，依赖 ink 的 render/useApp
 * [OUTPUT]: App 根组件 + 程序入口
 * [POS]: src/ 的顶层路由控制器，三屏状态机（select → provider-list → provider-form）
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import React, { useState } from 'react'
import { render, useApp } from 'ink'
import type { AppStore, Installation, ProviderConfig } from './types.js'
import { detectInstallations } from './store/detect.js'
import { loadStore } from './store/local.js'
import { ProviderSelect } from './screens/ProviderSelect.js'
import { ProviderList } from './screens/ProviderList.js'
import { ProviderForm } from './screens/ProviderForm.js'

// ---------------------- 路由类型 ----------------------
type Screen =
  | { name: 'select' }
  | { name: 'provider-list'; installation: Installation }
  | { name: 'provider-form'; installation: Installation; editing: ProviderConfig | null }

// ---------------------- 根组件 ----------------------
function App() {
  const { exit } = useApp()
  const [installations] = useState<Installation[]>(() => detectInstallations())
  const [store, setStore] = useState<AppStore>(loadStore)
  const [screen, setScreen] = useState<Screen>({ name: 'select' })

  if (screen.name === 'select') {
    return (
      <ProviderSelect
        installations={installations}
        onSelect={inst => setScreen({ name: 'provider-list', installation: inst })}
        onExit={exit}
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

  // provider-form
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
render(<App />)
