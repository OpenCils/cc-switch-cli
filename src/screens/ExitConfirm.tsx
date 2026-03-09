/**
 * [INPUT]: 依赖 ink 的 Box/Text/useInput，依赖 ATO 退出目标列表和退出动作回调
 * [OUTPUT]: 对外提供 ExitConfirm 组件
 * [POS]: screens/ 的退出确认屏，负责决定退出时保留还是关闭 ATO
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { t } from '../i18n/index.js'

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
      label: t('keepAtoAndExit'),
      hint: t('keepAtoHint'),
      action: onExitKeepAto,
    },
    {
      label: hasTargets ? t('stopAtoAndExit') : t('directExit'),
      hint: hasTargets ? t('stopAtoHint') : t('directExitHint'),
      action: onExitStopAto,
    },
    {
      label: t('cancelExit'),
      hint: t('cancelExitHint'),
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
      <Text bold color="yellow">{t('exitTitle')}</Text>

      <Box marginTop={1} flexDirection="column">
        {mode === 'confirm' && (
          <Text dimColor>
            {hasTargets
              ? t('atoDetected', { count: targets.length })
              : t('noAtoDetected')}
          </Text>
        )}
        {mode === 'stopping' && (
          <Text color="cyan">{message || t('stoppingAto')}</Text>
        )}
        {mode === 'error' && (
          <Text color="red">{message || t('atoStopFailed')}</Text>
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
        {mode === 'confirm' && <Text dimColor>{t('hintExitConfirm')}</Text>}
        {mode === 'stopping' && <Text dimColor>{t('hintExitWait')}</Text>}
        {mode === 'error' && <Text dimColor>{t('hintExitError')}</Text>}
      </Box>
    </Box>
  )
}
