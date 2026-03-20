/**
 * [INPUT]: 依赖 react 的 state/ref/effect，依赖 ink 的 Text/useInput；接受受控 value 与 onChange/onSubmit
 * [OUTPUT]: 对外提供 StableTextInput 组件
 * [POS]: components/ 的稳定文本输入组件，修复 raw mode 下多段粘贴被后续 chunk 覆盖的问题
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import React, { useEffect, useRef, useState } from 'react'
import { Text, useInput } from 'ink'

interface Props {
  value: string
  placeholder?: string
  focus?: boolean
  mask?: string
  showCursor?: boolean
  onChange: (value: string) => void
  onSubmit?: (value: string) => void
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function renderPlaceholder(placeholder: string, focus: boolean, showCursor: boolean) {
  if (!focus || !showCursor) {
    return <Text dimColor>{placeholder}</Text>
  }

  const head = placeholder[0] ?? ' '
  const tail = placeholder.slice(1)

  return (
    <Text>
      <Text color="black" backgroundColor="white">{head}</Text>
      {tail ? <Text dimColor>{tail}</Text> : null}
    </Text>
  )
}

function renderValue(value: string, cursorOffset: number, focus: boolean, showCursor: boolean) {
  if (!focus || !showCursor) {
    return <Text>{value}</Text>
  }

  const safeOffset = clamp(cursorOffset, 0, value.length)
  const before = value.slice(0, safeOffset)
  const current = value[safeOffset] ?? ' '
  const after = value.slice(safeOffset + (safeOffset < value.length ? 1 : 0))

  return (
    <Text>
      {before}
      <Text color="black" backgroundColor="white">{current}</Text>
      {after}
    </Text>
  )
}

export function StableTextInput({
  value,
  placeholder = '',
  focus = true,
  mask,
  showCursor = true,
  onChange,
  onSubmit,
}: Props) {
  const [cursorOffset, setCursorOffset] = useState(value.length)
  const valueRef = useRef(value)
  const cursorRef = useRef(value.length)

  useEffect(() => {
    valueRef.current = value
    const nextCursor = clamp(cursorRef.current, 0, value.length)
    cursorRef.current = nextCursor
    setCursorOffset(nextCursor)
  }, [value])

  function syncCursor(nextCursor: number, valueLength: number) {
    const safeCursor = clamp(nextCursor, 0, valueLength)
    cursorRef.current = safeCursor
    setCursorOffset(safeCursor)
    return safeCursor
  }

  useInput((input, key) => {
    if (key.upArrow ||
      key.downArrow ||
      (key.ctrl && input === 'c') ||
      key.tab ||
      (key.shift && key.tab)) {
      return
    }

    const originalValue = valueRef.current
    const originalCursor = cursorRef.current

    if (key.return) {
      onSubmit?.(originalValue)
      return
    }

    let nextValue = originalValue
    let nextCursor = originalCursor

    if (key.leftArrow) {
      nextCursor -= 1
    } else if (key.rightArrow) {
      nextCursor += 1
    } else if (key.backspace || key.delete) {
      if (originalCursor > 0) {
        nextValue =
          originalValue.slice(0, originalCursor - 1) +
          originalValue.slice(originalCursor)
        nextCursor -= 1
      }
    } else if (input.length > 0) {
      nextValue =
        originalValue.slice(0, originalCursor) +
        input +
        originalValue.slice(originalCursor)
      nextCursor += input.length
    }

    const safeCursor = syncCursor(nextCursor, nextValue.length)
    valueRef.current = nextValue

    if (nextValue !== originalValue) {
      onChange(nextValue)
      return
    }

    if (safeCursor !== cursorOffset) {
      setCursorOffset(safeCursor)
    }
  }, { isActive: focus })

  const displayValue = mask ? mask.repeat(value.length) : value

  if (!displayValue && placeholder) {
    return renderPlaceholder(placeholder, focus, showCursor)
  }

  return renderValue(displayValue, cursorOffset, focus, showCursor)
}
