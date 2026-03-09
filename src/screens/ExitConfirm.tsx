/**
 * [INPUT]: 依赖 ink 的 Box/Text/useInput，依赖 ATO 退出目标列表和退出动作回调
 * [OUTPUT]: 对外提供 ExitConfirm 组件
 * [POS]: screens/ 的退出确认屏，负责决定退出时保留还是关闭 ATO
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'

interface ExitTarget {
  label: string
  port: number
}

interface Props {
  mode: 'confirm' | 'stopping' | 'error'
  message?: string
  targets: ExitTarget[]
  onExitKeepAto: () => void
  onExitStopAto: () => void
  onCancel: () => void
}

export function ExitConfirm({
  mode,
  message,
  targets,
  onExitKeepAto,
  onExitStopAto,
  onCancel,
}: Props) {
  const [cursor, setCursor] = useState(0)
  const hasTargets = targets.length > 0

  const options = [
    {
      label: '保留 ATO 并退出',
      hint: 'CC Switch 退出，后台 ATO 保持运行',
      action: onExitKeepAto,
    },
    {
      label: hasTargets ? '关闭 ATO 后退出' : '直接退出',
      hint: hasTargets ? '尝试停止已知 ATO 端口后退出' : '当前没有检测到 ATO 目标',
      action: onExitStopAto,
    },
    {
      label: '取消',
      hint: '返回 CC Switch',
      action: onCancel,
    },
  ]

  useInput((input, key) => {
    if (mode === 'stopping') return

    if (mode === 'error') {
      if (input === 'r') return onExitStopAto()
      if (key.escape) return onCancel()
      if (key.return) return onExitKeepAto()
      return
    }

    if (key.upArrow) return setCursor(index => (index - 1 + options.length) % options.length)
    if (key.downArrow) return setCursor(index => (index + 1) % options.length)
    if (key.escape) return onCancel()
    if (key.return) return options[cursor]?.action()
  })

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold color="yellow">退出 CC Switch</Text>

      <Box marginTop={1} flexDirection="column">
        {mode === 'confirm' && (
          <Text dimColor>
            {hasTargets
              ? `检测到 ${targets.length} 个 ATO 目标，退出时可以选择保留或关闭。`
              : '当前没有检测到 ATO 目标，直接退出即可。'}
          </Text>
        )}
        {mode === 'stopping' && (
          <Text color="cyan">{message || '正在关闭 ATO...'}</Text>
        )}
        {mode === 'error' && (
          <Text color="red">{message || 'ATO 关闭失败'}</Text>
        )}
      </Box>

      {hasTargets && (
        <Box marginTop={1} flexDirection="column">
          {targets.map(target => (
            <Text key={`${target.label}-${target.port}`} dimColor>{`· ${target.label}`}</Text>
          ))}
        </Box>
      )}

      {mode === 'confirm' && (
        <Box marginTop={1} flexDirection="column">
          {options.map((option, index) => {
            const active = index === cursor
            return (
              <Box key={option.label} gap={1}>
                <Text color={active ? 'cyan' : 'gray'} bold={active}>
                  {active ? '❯' : ' '}
                </Text>
                <Text bold={active}>{option.label}</Text>
                <Text dimColor>{option.hint}</Text>
              </Box>
            )
          })}
        </Box>
      )}

      <Box marginTop={1}>
        {mode === 'confirm' && <Text dimColor>↑↓ 选择   Enter 确认   Esc 返回</Text>}
        {mode === 'stopping' && <Text dimColor>请稍候...</Text>}
        {mode === 'error' && <Text dimColor>Enter 直接退出   r 重试关闭   Esc 返回</Text>}
      </Box>
    </Box>
  )
}
