/**
 * [INPUT]: 依赖 ink 的 Box/Text/useInput，依赖 i18n 的 t/LANG_LABELS/Lang
 * [OUTPUT]: 对外提供 LanguageSelect 组件
 * [POS]: screens/ 的首次启动语言选择屏，选完后持久化并进入主流程
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { type Lang, LANG_LABELS, t } from '../i18n/index.js'

const LANGS: Lang[] = ['en', 'zh', 'ja', 'ko']

interface Props {
  onSelect: (lang: Lang) => void
}

export function LanguageSelect({ onSelect }: Props) {
  const [cursor, setCursor] = useState(0)

  useInput((ch, k) => {
    if (k.upArrow)   return setCursor(i => (i - 1 + LANGS.length) % LANGS.length)
    if (k.downArrow) return setCursor(i => (i + 1) % LANGS.length)
    if (k.return)    return onSelect(LANGS[cursor])
  })

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold color="cyan">{t('selectLanguage')}</Text>

      <Box flexDirection="column" marginTop={1}>
        {LANGS.map((lang, i) => {
          const active = i === cursor
          return (
            <Box key={lang} paddingX={1} gap={1}>
              <Text color={active ? 'cyan' : 'gray'} bold={active}>
                {active ? '❯' : ' '}
              </Text>
              <Text bold={active} color={active ? 'white' : undefined}>
                {LANG_LABELS[lang]}
              </Text>
            </Box>
          )
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>{t('hintLang')}</Text>
      </Box>
    </Box>
  )
}
