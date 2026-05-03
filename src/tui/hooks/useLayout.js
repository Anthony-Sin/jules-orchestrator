// ── hooks/useLayout.js ────────────────────────────────────────────
// Derives all panel dimensions and visibility flags from terminal size
// and current UI state. Keeps renderer.js free of layout arithmetic.

import { useTerminalSize } from '../hooks.js'

/**
 * @param {object} params
 * @param {string}  params.mode           - 'table' | 'graph' | 'chat' | 'diff'
 * @param {boolean} params.showGraph
 * @param {boolean} params.repoInputMode
 * @param {boolean} params.chatMenuOpen
 * @param {string}  params.chatTab        - 'chat' | 'notes'
 * @param {string}  params.chatInput
 * @param {boolean} params.hasLatestProgress
 * @param {boolean} params.hasPromptPreview
 */
export function useLayout({
  mode,
  showGraph,
  repoInputMode,
  chatMenuOpen,
  chatTab,
  chatInput,
  hasLatestProgress,
  hasPromptPreview,
}) {
  const { columns, rows } = useTerminalSize()

  // ── Terminal bounds ──────────────────────────────────────────────
  const TERMINAL_ROWS = Math.max(10, rows - 1)
  const isWide        = columns >= 80

  // ── Panel widths ─────────────────────────────────────────────────
  const rightPanelWidth = isWide ? Math.floor(columns * 0.38) : columns
  const leftPanelWidth  = isWide ? columns - rightPanelWidth  : columns

  // ── Panel visibility ─────────────────────────────────────────────
  const showLeftPanel  = isWide || mode !== 'chat'
  const showRightPanel = isWide || mode === 'chat'

  // ── Vertical budget ──────────────────────────────────────────────
  const repoInputHeight     = repoInputMode ? 5 : 0
  const availableBodyHeight = TERMINAL_ROWS - (5 + repoInputHeight)

  // ── Graph ────────────────────────────────────────────────────────
  const canShowGraph = showGraph && columns >= 100 && rows >= 15
  const graphVisible = canShowGraph
  const graphHeight  = graphVisible ? availableBodyHeight : 0

  // ── Table ────────────────────────────────────────────────────────
  const VISIBLE_AGENTS = Math.max(1, availableBodyHeight - 3)

  // ── Chat ─────────────────────────────────────────────────────────
  const chatWrapLimit    = Math.max(10, rightPanelWidth - 6)
  const inputLines       = (mode === 'chat' && chatTab === 'chat')
    ? Math.max(1, Math.ceil((chatInput || '').length / chatWrapLimit))
    : 1
  const inputExtraHeight  = Math.min(3, inputLines - 1)
  const chatFixedHeights  = 4
  const chatMenuHeight    = chatMenuOpen && chatTab === 'chat' ? 5 : 0
  const progressHeight    = (hasLatestProgress || hasPromptPreview) && chatTab === 'chat' ? 3 : 0
  const CHAT_VISIBLE_ROWS = Math.max(1,
    availableBodyHeight - (chatFixedHeights + chatMenuHeight + inputExtraHeight + progressHeight))

  return {
    columns,
    rows,
    TERMINAL_ROWS,
    isWide,
    rightPanelWidth,
    leftPanelWidth,
    showLeftPanel,
    showRightPanel,
    repoInputHeight,
    availableBodyHeight,
    canShowGraph,
    graphVisible,
    graphHeight,
    VISIBLE_AGENTS,
    chatWrapLimit,
    CHAT_VISIBLE_ROWS,
  }
}