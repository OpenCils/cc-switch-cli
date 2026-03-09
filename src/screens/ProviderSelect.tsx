/**
 * [INPUT]: 依赖 ink 的 Box/Text/useInput，依赖 Banner 组件，依赖 types 的 TOOLS
 * [OUTPUT]: 对外提供 ProviderSelect 组件
 * [POS]: screens/ 的入口屏幕，展示检测到的所有安装实例
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { Banner } from '../components/Banner.js'
import { TOOLS, type Installation } from '../types.js'

interface Props {
  installations: Installation[]
  onSelect: (inst: Installation) => void
  onExitRequest: () => void
}

export function ProviderSelect({ installations, onSelect, onExitRequest }: Props) {
  const [cursor, setCursor] = useState(0)
  const items = installations

  useInput((ch, k) => {
    if (k.upArrow)   return setCursor(i => (i - 1 + items.length) % items.length)
    if (k.downArrow) return setCursor(i => (i + 1) % items.length)
    if (ch === 'q' || k.escape) return onExitRequest()
    if (k.return && items.length > 0) return onSelect(items[cursor])
  })

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>

      {/* ---- ASCII art banner ---- */}
      <Banner />

      {/* ---- 检测到的安装实例 ---- */}
      {items.length === 0 ? (
        <Text color="red">未检测到任何已安装的工具</Text>
      ) : (
        <Box flexDirection="column" gap={0}>
          {items.map((inst, i) => {
            const active = i === cursor
            const meta = TOOLS.find(t => t.id === inst.tool)!
            const envTag = inst.env.type === 'wsl'
              ? `[${inst.env.label}]`
              : `[${inst.env.label}]`
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
                <Text dimColor>{inst.current.model}</Text>
              </Box>
            )
          })}
        </Box>
      )}

      {/* ---- 底部快捷键提示 ---- */}
      <Box marginTop={1}>
        <Text dimColor>↑↓ 移动   Enter 进入   q / Esc / Ctrl+C 退出</Text>
      </Box>

    </Box>
  )
}
