import { useTerminalSize } from '../hooks.js'

export function useLayout({
  mode,
  showGraph,
  repoInputMode,
  chatMenuOpen,
  chatTab,
  chatInput,
  hasLatestProgress,
  hasPromptPreview,
  hasStartDialog,
  hasApproveHint,
}) {
  const { columns, rows } = useTerminalSize()

  const TERMINAL_ROWS = Math.max(10, rows)
  const isWide = columns >= 100
  const isCompact = columns < 110
  const isTight = columns < 92

  const rightPanelWidth = isWide ? Math.max(34, Math.floor(columns * 0.42)) : columns
  const leftPanelWidth = isWide ? columns - rightPanelWidth : columns

  const showLeftPanel = isWide || mode !== 'chat'
  const showRightPanel = isWide || mode === 'chat'

  const repoInputHeight = repoInputMode ? 8 : 0
  const fixedChromeRows = 5
  const availableBodyHeight = Math.max(1, TERMINAL_ROWS - (fixedChromeRows + repoInputHeight))



  const VISIBLE_AGENTS = Math.max(1, availableBodyHeight - 2)

  const chatWrapLimit = Math.max(10, rightPanelWidth - 6)
  const inputRows = (mode === 'chat' && chatTab === 'chat')
    ? Math.max(
        1,
        String(chatInput || '')
          .split('\n')
          .reduce((count, line) => {
            const safeLen = Math.max(1, line.length)
            return count + Math.max(1, Math.ceil(safeLen / chatWrapLimit))
          }, 0)
      )
    : 1

  const inputExtraHeight = Math.min(3, inputRows - 1)
  const chatFixedHeights = 4
  
  const chatMenuHeight = chatMenuOpen && chatTab === 'chat' ? 5 : 0
  
  // FIX: Force the layout engine to reclaim the progress bar space when the Start Dialog is open
  const progressHeight = (hasLatestProgress || hasPromptPreview) && chatTab === 'chat' && !hasStartDialog ? 3 : 0
  
  const startDialogHeight = 0
  const approveHintHeight = hasApproveHint && chatTab === 'chat' ? 3 : 0

  const CHAT_VISIBLE_ROWS = Math.max(1,
    availableBodyHeight - (
      chatFixedHeights +
      chatMenuHeight +
      inputExtraHeight +
      progressHeight +
      startDialogHeight +
      approveHintHeight
    )
  )

  return {
    columns,
    rows,
    TERMINAL_ROWS,
    isWide,
    isCompact,
    isTight,
    rightPanelWidth,
    leftPanelWidth,
    showLeftPanel,
    showRightPanel,
    repoInputHeight,
    availableBodyHeight,
    VISIBLE_AGENTS,
    chatWrapLimit,
    CHAT_VISIBLE_ROWS,
  }
}