/**
 * [INPUT]: 依赖 react 的 useEffect/useState，依赖 ink 的 Box/Text/useStdout，依赖 figlet，依赖 assets/ansiShadowFont 的内嵌字体
 * [OUTPUT]: 对外提供 Banner 组件
 * [POS]: 通用组件，被 ProviderSelect 顶部消费，按终端宽度切换品牌字标
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import React, { useEffect, useState } from 'react'
import { Box, Text, useStdout } from 'ink'
import figlet from 'figlet'
import { ANSI_SHADOW_FONT } from '../assets/ansiShadowFont.js'

type BannerVariant = {
  lines: string[]
  colors: string[]
  minWidth: number
  bold?: boolean
}

// 内嵌字体注册，消除对文件系统的依赖（bun 独立二进制中无 node_modules）
figlet.parseFont('ANSI Shadow', ANSI_SHADOW_FONT as unknown as figlet.Fonts)

// 预生成三档字标，避免运行时再去读字体文件或等待计算。
const LARGE_ART = figlet.textSync('CC  Switch', {
  font: 'ANSI Shadow',
  horizontalLayout: 'default',
})

const MEDIUM_ART = [
  '   ___  ___   ___          _  _        _',
  '  / __|/ __| / __|__ __ __(_)| |_  __ | |_',
  " | (__| (__  \\__ \\\\ V  V /| ||  _|/ _|| ' \\",
  '  \\___|\\___| |___/ \\_/\\_/ |_| \\__|\\__||_||_|',
].join('\n')

const SMALL_ART = [
  '  _  _    __                   ',
  ' /  /    (_       o _|_  _ |_  ',
  ' \\_ \\_   __) \\/\\/ |  |_ (_ | | ',
].join('\n')

const INLINE_ART = 'CC Switch'
const HORIZONTAL_PADDING = 4

function normalizeLines(art: string): string[] {
  const lines = art.split('\n').map(line => line.replace(/\s+$/u, ''))

  while (lines.length > 0 && lines.at(-1) === '') {
    lines.pop()
  }

  return lines
}

function createVariant(art: string, colors: string[], bold = false): BannerVariant {
  const lines = normalizeLines(art)

  return {
    lines,
    colors,
    bold,
    minWidth: lines.reduce((max, line) => Math.max(max, line.length), 0),
  }
}

const VARIANTS: BannerVariant[] = [
  createVariant(LARGE_ART, ['white', 'white', 'cyan', 'cyan', 'blueBright', 'blue']),
  createVariant(MEDIUM_ART, ['white', 'cyan', 'cyan', 'blue']),
  createVariant(SMALL_ART, ['white', 'cyan', 'blue']),
  createVariant(INLINE_ART, ['cyan'], true),
]

function getAvailableWidth(stdout: NodeJS.WriteStream | undefined): number {
  const columns = stdout?.columns ?? 80
  return Math.max(columns - HORIZONTAL_PADDING, 0)
}

function pickVariant(availableWidth: number): BannerVariant {
  return VARIANTS.find(variant => availableWidth >= variant.minWidth) ?? VARIANTS.at(-1)!
}

export function Banner() {
  const { stdout } = useStdout()
  const [availableWidth, setAvailableWidth] = useState(() => getAvailableWidth(stdout))

  useEffect(() => {
    const syncWidth = () => {
      const nextWidth = getAvailableWidth(stdout)
      setAvailableWidth(currentWidth => (currentWidth === nextWidth ? currentWidth : nextWidth))
    }

    syncWidth()
    stdout?.on('resize', syncWidth)

    return () => {
      stdout?.removeListener('resize', syncWidth)
    }
  }, [stdout])

  const variant = pickVariant(availableWidth)

  return (
    <Box flexDirection="column" marginBottom={1}>
      {variant.lines.map((line, i) => (
        <Text key={i} color={(variant.colors[i] ?? 'gray') as any} bold={variant.bold}>
          {line}
        </Text>
      ))}
    </Box>
  )
}
