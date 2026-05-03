import React, { useEffect, useState } from 'react'
import { Box, Text, useInput } from 'ink'

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function buildWrappedLines(value, width) {
  const safeWidth = Math.max(1, width)
  const lines = ['']

  for (const ch of String(value || '')) {
    if (ch === '\n') {
      lines.push('')
      continue
    }

    const lastIdx = lines.length - 1
    if (lines[lastIdx].length >= safeWidth) {
      lines.push(ch)
    } else {
      lines[lastIdx] += ch
    }
  }

  return lines
}

function getCursorPos(value, cursorOffset, width) {
  const safeWidth = Math.max(1, width)
  const safeOffset = clamp(cursorOffset, 0, String(value || '').length)
  let line = 0
  let col = 0

  for (let i = 0; i < safeOffset; i++) {
    const ch = value[i]
    if (ch === '\n') {
      line++
      col = 0
      continue
    }

    col++
    if (col >= safeWidth) {
      line++
      col = 0
    }
  }

  return { line, col }
}

export function ScrollInput({
  value = '',
  onChange,
  onSubmit,
  focus = true,
  placeholder = '',
  visibleWidth = 40,
  maxRows = 4,
}) {
  const [cursorOffset, setCursorOffset] = useState(value.length)

  useEffect(() => {
    setCursorOffset(offset => Math.min(offset, value.length))
  }, [value])

  useInput((input, key) => {
    if (!focus) return
    if (key.upArrow || key.downArrow || key.tab || (key.shift && key.tab) || (key.ctrl && input === 'c')) return

    if (key.return) {
      onSubmit?.(value)
      return
    }

    let nextCursor = cursorOffset
    let nextValue = value

    if (key.leftArrow) {
      nextCursor = Math.max(0, cursorOffset - 1)
    } else if (key.rightArrow) {
      nextCursor = Math.min(value.length, cursorOffset + 1)
    } else if (key.backspace || key.delete) {
      if (cursorOffset > 0) {
        nextValue = value.slice(0, cursorOffset - 1) + value.slice(cursorOffset)
        nextCursor = cursorOffset - 1
      }
    } else if (input && !key.meta && !key.ctrl) {
      nextValue = value.slice(0, cursorOffset) + input + value.slice(cursorOffset)
      nextCursor = cursorOffset + input.length
    }

    setCursorOffset(nextCursor)
    if (nextValue !== value) onChange?.(nextValue)
  }, { isActive: focus })

  const [scrollOffset, setScrollOffset] = useState(0)

  const width = Math.max(8, visibleWidth)
  const rows = Math.max(1, maxRows)

  if (!value) {
    if (!placeholder) {
      return React.createElement(Box, { minWidth: 0 },
        React.createElement(Text, { backgroundColor: focus ? 'white' : undefined, color: focus ? 'black' : 'gray' }, ' ')
      )
    }

    if (!focus) {
      return React.createElement(Box, { minWidth: 0, overflow: 'hidden' },
        React.createElement(Text, { color: 'gray', wrap: 'truncate' }, placeholder)
      )
    }

    const first = placeholder[0] || ' '
    const rest = placeholder.slice(1)
    return React.createElement(Box, { minWidth: 0, overflow: 'hidden', flexDirection: 'row' },
      React.createElement(Text, { backgroundColor: 'white', color: 'black' }, first),
      React.createElement(Text, { color: 'gray', wrap: 'truncate' }, rest)
    )
  }

  const wrapped = buildWrappedLines(value, width)
  const cursor = getCursorPos(value, cursorOffset, width)

  useEffect(() => {
    setScrollOffset(prev => {
      let newOffset = prev
      if (cursor.line < newOffset) {
        newOffset = cursor.line
      } else if (cursor.line >= newOffset + rows) {
        newOffset = cursor.line - rows + 1
      }
      return newOffset
    })
  }, [cursor.line, rows])

  const start = Math.max(0, Math.min(scrollOffset, wrapped.length - 1))
  const end = Math.min(wrapped.length, start + rows)
  const visibleLines = wrapped.slice(start, end)

  return React.createElement(Box, {
    minWidth: 0,
    overflow: 'hidden',
    flexDirection: 'column',
  },
  ...visibleLines.map((line, idx) => {
    const absoluteLine = start + idx
    const isCursorLine = absoluteLine === cursor.line
    const safeLine = line || ''

    if (!isCursorLine) {
      return React.createElement(Box, { key: `ln_${absoluteLine}`, minWidth: 0, overflow: 'hidden' },
        React.createElement(Text, { color: focus ? 'white' : 'gray', wrap: 'truncate' }, safeLine || ' ')
      )
    }

    const cursorCol = clamp(cursor.col, 0, safeLine.length)
    const before = safeLine.slice(0, cursorCol)
    const at = cursorCol < safeLine.length ? safeLine[cursorCol] : ' '
    const after = cursorCol < safeLine.length ? safeLine.slice(cursorCol + 1) : ''

    return React.createElement(Box, { key: `ln_${absoluteLine}`, minWidth: 0, overflow: 'hidden', flexDirection: 'row' },
      React.createElement(Text, { color: focus ? 'white' : 'gray', wrap: 'truncate' }, before),
      React.createElement(Text, {
        backgroundColor: focus ? 'white' : undefined,
        color: focus ? 'black' : 'gray',
      }, at),
      React.createElement(Text, { color: focus ? 'white' : 'gray', wrap: 'truncate' }, after)
    )
  })
  )
}
