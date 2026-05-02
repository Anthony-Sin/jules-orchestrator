// ── hooks.js ─────────────────────────────────────────────────────
// Shared React hooks for the Jules Colony TUI.

import { useState, useEffect } from 'react'

// ── useTerminalSize ───────────────────────────────────────────────
// Debounced terminal resize hook.
export function useTerminalSize() {
  const [size, setSize] = useState({
    columns: process.stdout.columns || 80,
    rows:    process.stdout.rows    || 24
  })
  useEffect(() => {
    let t
    const onResize = () => {
      clearTimeout(t)
      t = setTimeout(() => setSize({
        columns: process.stdout.columns,
        rows:    process.stdout.rows
      }), 30)
    }
    process.stdout.on('resize', onResize)
    return () => { process.stdout.off('resize', onResize); clearTimeout(t) }
  }, [])
  return size
}
