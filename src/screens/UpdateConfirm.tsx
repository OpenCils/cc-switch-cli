/**
 * [INPUT]: 依赖 ink 的 Box/Text/useInput，依赖更新相关回调
 * [OUTPUT]: 对外提供 UpdateConfirm 组件
 * [POS]: screens/ 的更新确认屏，启动时如有新版本则弹出询问用户
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { t } from '../i18n/index.js'

interface Props {
  currentVersion: string
  newVersion: string
  canSelfUpdate: boolean
  installCmd?: string
  onUpdate: () => void
  onSkip: () => void
  updating?: boolean
  error?: string | null
}

export function UpdateConfirm({
  currentVersion,
  newVersion,
  canSelfUpdate,
  installCmd,
  onUpdate,
  onSkip,
  updating = false,
  error,
}: Props) {
  const [cursor, setCursor] = useState(0)

  const options = canSelfUpdate
    ? [
        { label: t('updateNow'), hint: t('updateNowHint'), action: onUpdate },
        { label: t('skipUpdate'), hint: t('skipUpdateHint'), action: onSkip },
      ]
    : [
        { label: t('continueUsing'), hint: t('continueUsingHint'), action: onSkip },
      ]

  useInput((input, key) => {
    if (updating) return

    if (key.upArrow) return setCursor(i => (i - 1 + options.length) % options.length)
    if (key.downArrow) return setCursor(i => (i + 1) % options.length)
    if (key.escape) return onSkip()
    if (key.return) return options[cursor]?.action()
  })

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {/* ---- 标题 ---- */}
      <Box marginBottom={1}>
        <Text bold color="yellow">{t('updateAvailableTitle')}</Text>
      </Box>

      {/* ---- 版本信息 ---- */}
      <Box marginBottom={1} flexDirection="column">
        <Text dimColor>{t('updateFromTo', { current: currentVersion, new: newVersion })}</Text>
      </Box>

      {/* ---- 错误提示 ---- */}
      {error && (
        <Box marginBottom={1}>
          <Text color="red">{t('updateStartFailed', { error })}</Text>
        </Box>
      )}

      {/* ---- 更新中状态 ---- */}
      {updating ? (
        <Box marginBottom={1}>
          <Text color="cyan">{t('updateStarting')}</Text>
        </Box>
      ) : (
        <>
          {/* ---- 无法自更新时显示手动命令 ---- */}
          {!canSelfUpdate && installCmd && (
            <Box marginBottom={1} flexDirection="column">
              <Text dimColor>{t('updateInstallHint')}</Text>
              <Text color="cyan">{installCmd}</Text>
            </Box>
          )}

          {/* ---- 选项 ---- */}
          <Box flexDirection="column" marginTop={1}>
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

          {/* ---- 提示 ---- */}
          <Box marginTop={1}>
            <Text dimColor>{t('hintUpdateConfirm')}</Text>
          </Box>
        </>
      )}
    </Box>
  )
}
