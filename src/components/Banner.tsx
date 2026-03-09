/**
 * [INPUT]: 依赖 react/ink 的渲染能力，依赖 figlet 的 ASCII 字体渲染
 * [OUTPUT]: 对外提供 Banner 组件
 * [POS]: 通用组件，被 ProviderSelect 顶部消费，品牌标识层
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import React from 'react'
import { Box, Text } from 'ink'
import figlet from 'figlet'

// 构建时同步生成 ASCII art，避免运行时延迟
const ART = figlet.textSync('CC  Switch', {
  font: 'ANSI Shadow',
  horizontalLayout: 'default',
})

// 将 art 按行分割，逐行渲染以支持渐变色效果
const LINES = ART.split('\n')

// 每行对应的颜色，从亮到暗，模拟截图中的立体光影
const LINE_COLORS = ['white', 'white', 'cyan', 'cyan', 'blueBright', 'blue']

export function Banner() {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {LINES.map((line, i) => (
        <Text key={i} color={(LINE_COLORS[i] ?? 'gray') as any}>
          {line}
        </Text>
      ))}
    </Box>
  )
}
