/**
 * [INPUT]: 依赖 ink 的 Box/Text/useInput，依赖 Banner 组件，依赖 types 的 TOOLS，依赖外部传入的更新状态与回调
 * [OUTPUT]: 对外提供 ProviderSelect 组件
 * [POS]: screens/ 的入口屏幕，展示所有检测到的安装实例、当前版本与更新入口
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { Banner } from '../components/Banner.js'
import { TOOLS, type Installation, type AppStore, instKey } from '../types.js'
import { t } from '../i18n/index.js'

interface Props {
  installations: Installation[]
  store: AppStore
  currentVersion: string
  onSelect: (inst: Installation) => void
  onExitRequest: () => void
}

export function ProviderSelect({
  installations,
  store,
  currentVersion,
  onSelect,
  onExitRequest,
}: Props) {
  const [cursor, setCursor] = useState(0)
  const items = installations

  useInput((ch, k) => {
    if (ch === 'q' || k.escape) return onExitRequest()
    if (items.length === 0) return
    if (k.upArrow) return setCursor(i => (i - 1 + items.length) % items.length)
    if (k.downArrow) return setCursor(i => (i + 1) % items.length)
    if (k.return) return onSelect(items[cursor])
  })

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {/* ---- ASCII art banner ---- */}
      <Banner />

      {/* ---- 版本信息 ---- */}
      <Box marginBottom={1}>
        <Text dimColor>{t('currentVersionLabel', { version: currentVersion })}</Text>
      </Box>

      {/* ---- 检测到的安装实例 ---- */}
      {items.length === 0 ? (
        <Text color="red">{t('noInstallations')}</Text>
      ) : (
        <Box flexDirection="column" gap={0}>
          {items.map((inst, i) => {
            const active = i === cursor
            const meta = TOOLS.find(tool => tool.id === inst.tool)!
            const envTag = `[${inst.env.label}]`
            // 从 store 获取当前激活的供应商模型
            const key = instKey(inst)
            const activeProviderId = store.active[key]
            const providers = store.providers[key] ?? []
            const activeProvider = providers.find(p => p.id === activeProviderId)
            const displayModel = activeProvider?.model ?? inst.current.model
            return (
              <Box key={`${inst.tool}-${inst.env.type}-${inst.env.distro ?? 'native'}`} paddingX={1} gap={1}>
                <Text color={active ? meta.color : 'gray'} bold={active}>
                  {active ? '❯' : ' '}
                </Text>
                <Text color={active ? meta.color : undefined} bold={active}>
                  {meta.label}
                </Text>
                <Text color={active ? 'white' : 'gray'} dimColor={!active}>
                  {envTag}
                </Text>
                <Text dimColor>{displayModel}</Text>
              </Box>
            )
          })}
        </Box>
      )}

      {/* ---- 底部快捷键提示 ---- */}
      <Box marginTop={1}>
        <Text dimColor>{t('hintSelect')}</Text>
      </Box>
    </Box>
  )
}