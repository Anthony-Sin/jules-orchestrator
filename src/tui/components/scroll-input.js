import React, { useEffect, useState, useRef } from 'react'
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
  const [scrollOffset, setScrollOffset] = useState(0)
  
  const latestValue = useRef(value)
  const latestCursor = useRef(cursorOffset)

  useEffect(() => {
    latestValue.current = value
    setCursorOffset(offset => {
      const newOffset = Math.min(offset, value.length)
      latestCursor.current = newOffset
      return newOffset
    })
  }, [value])

  useInput((input, key) => {
    if (!focus) return
    if (key.upArrow || key.downArrow || key.tab || (key.shift && key.tab) || (key.ctrl && input === 'c')) return

    if (key.return) {
      onSubmit?.(latestValue.current)
      return
    }

    let nextCursor = latestCursor.current
    let nextValue = latestValue.current

    if (key.leftArrow) {
      nextCursor = Math.max(0, nextCursor - 1)
    } else if (key.rightArrow) {
      nextCursor = Math.min(nextValue.length, nextCursor + 1)
    } else if (key.backspace || key.delete) {
      if (nextCursor > 0) {
        nextValue = nextValue.slice(0, nextCursor - 1) + nextValue.slice(nextCursor)
        nextCursor = nextCursor - 1
      }
    } else if (input && !key.meta && !key.ctrl) {
      nextValue = nextValue.slice(0, nextCursor) + input + nextValue.slice(nextCursor)
      nextCursor = nextCursor + input.length
    }

    latestCursor.current = nextCursor
    latestValue.current = nextValue
    setCursorOffset(nextCursor)
    
    if (nextValue !== value) {
      onChange?.(nextValue)
    }
  }, { isActive: focus })

  const width = Math.max(8, visibleWidth)
  const rows = Math.max(1, maxRows)

  const wrapped = buildWrappedLines(value, width)
  const cursor = getCursorPos(value, cursorOffset, width)

  if (cursor.line >= wrapped.length) {
    wrapped.push('')
  }

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

  // --- THE FIX IS HERE ---
  // Force the scroll offset to snap back if the container expands and reveals empty space
  const maxPossibleScroll = Math.max(0, wrapped.length - rows)
  const safeScrollOffset = Math.min(scrollOffset, maxPossibleScroll)
  
  const start = Math.max(0, safeScrollOffset)
  const end = Math.min(wrapped.length, start + rows)
  const visibleLines = wrapped.slice(start, end)
  // -----------------------

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