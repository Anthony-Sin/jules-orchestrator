import React, { useEffect } from 'react'
import { render, Box, Text, useApp, Spacer } from 'ink'
import TextInput from 'ink-text-input'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import { parseSourceDisplay } from '../state/jules-api.js'
import { getConfig, getGovernorConfig } from '../state/store.js'

import { AgentRow, buildRows } from './components/table.js'
import { ChatPanel } from './components/chat.js'
import { HelpScreen } from './components/help.js'
import { GitDiffViewer } from './components/gitdiff.js'

import { useDashboardController, saveToDrive } from './dashboard-controller.js'
import { useLayout } from './hooks/useLayout.js'
import { useKeyboard } from './hooks/useKeyboard.js'
import { THEME } from './theme.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkgPath = path.join(__dirname, '..', '..', 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
export const version = pkg.version

function truncateShortcutBar(columns, text) {
  const max = Math.max(16, columns - 12)
  if (text.length <= max) return text
  return text.slice(0, Math.max(0, max - 3)) + '...'
}

function toRepoName(sourceDisplay) {
  if (!sourceDisplay || sourceDisplay === 'NOT SET') return 'NOT SET'
  const parts = String(sourceDisplay).split('/').filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : sourceDisplay
}

export function Dashboard({ searchTerm = '' }) {
  const { exit } = useApp()

  const ctrl = useDashboardController()
  const {
    tick, setTick,
    sel, setSel,
    tableOffset, setTableOffset,
    mode, setMode,
    lastLeftMode,
    diffFileSel, setDiffFileSel,
    diffScrollOffset, setDiffScrollOffset,
    diffFocus, setDiffFocus,
    diffFileCount, setDiffFileCount,
    diffRefreshToken,
    chatInput, setChatInput,
    messages, setMessages,
    scrollOffset, setScrollOffset,
    chatTab, setChatTab,
    chatMenuOpen, setChatMenuOpen,
    chatMenuSel, setChatMenuSel,
    chatTargetMode, setChatTargetMode,
    startDialogOpen, setStartDialogOpen,
    startDialogMode, setStartDialogMode,
    showApproveHint,
    expandedMessages, toggleMessageExpand,
    chatCursorLine, setChatCursorLine,
    notes, setNotes,
    selectedSessionId, latestProgress,
    queuedMessages, queuedCycleIdx, setQueuedCycleIdx,
    promptPreview, setPromptPreview,
    repoInputMode, setRepoInputMode,
    repoInput, setRepoInput,
    sourcesList,
    sourceSel, setSourceSel,
    statusFlash, flash,
    showHelp, setShowHelp,
    AGENTS,
    openAgentChat, handleSend, handleRepoSubmit,
  } = ctrl

  // FIX: Moved filteredSources up so useKeyboard can receive it
  const filteredSources = repoInput.startsWith('/')
    ? sourcesList.filter(s => ('/' + (s.displayName || s.name)).toLowerCase().includes(repoInput.toLowerCase()))
    : []

  const currentSource = getConfig().source
  const currentRepoDisplay = currentSource ? parseSourceDisplay(currentSource) : 'NOT SET'
  const currentRepoName = toRepoName(currentRepoDisplay)
  const activeAgent = selectedSessionId ? AGENTS.find(a => a.id === selectedSessionId) : null
  const activeAgentTitle = activeAgent?.title || 'agent'
  const activeAgentId = selectedSessionId || 'NEW TASK'
  // Derive if our new unified banner should be visible
  const isBannerVisible = activeAgent && ['QUEUED', 'PLANNING', 'IN_PROGRESS', 'AWAITING_PLAN_APPROVAL', 'AWAITING_USER_FEEDBACK', 'PAUSED'].includes(activeAgent.state);

  const layout = useLayout({
    mode,
    repoInputMode,
    chatMenuOpen,
    chatTab,
    chatInput,
    hasLatestProgress: isBannerVisible || !!promptPreview,
    hasPromptPreview: !!promptPreview,
    hasStartDialog: startDialogOpen,
    hasApproveHint: false, // We unified this, so tell the layout engine to ignore the old one!
  })

  const [expandedNodes, setExpandedNodes] = React.useState(new Set())
  const toggleNodeExpansion = React.useCallback((id) => {
    setExpandedNodes(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const allRows = React.useMemo(() => buildRows(AGENTS, expandedNodes), [AGENTS, expandedNodes])

  const {
    columns, rows,
    TERMINAL_ROWS, isWide, isCompact, isTight,
    rightPanelWidth, leftPanelWidth,
    showLeftPanel, showRightPanel,
    availableBodyHeight,
    VISIBLE_AGENTS,
    CHAT_VISIBLE_ROWS,
  } = layout

  useKeyboard({
    exit,
    mode, setMode, lastLeftMode,
    showHelp, setShowHelp,
    repoInputMode, setRepoInputMode,
    repoInput, setRepoInput,
    sourcesList, sourceSel, setSourceSel,
    filteredSources, // <--- ADDED: Passing this into useKeyboard
    handleRepoSubmit,
    sel, setSel, AGENTS, VISIBLE_AGENTS,
    openAgentChat,
    allRows,
    toggleNodeExpansion,
    columns, rows, leftPanelWidth,
    diffFocus, setDiffFocus,
    diffFileSel, setDiffFileSel,
    diffFileCount,
    diffScrollOffset, setDiffScrollOffset,
    chatInput, setChatInput,
    chatTab, setChatTab,
    chatMenuOpen, setChatMenuOpen,
    chatMenuSel, setChatMenuSel,
    setChatTargetMode,
    startDialogOpen, setStartDialogOpen,
    startDialogMode, setStartDialogMode,
    setMessages,
    setScrollOffset, handleSend,
    selectedSessionId,
    queuedMessages, queuedCycleIdx, setQueuedCycleIdx,
    notes, setPromptPreview,
    setTick,
    flash,
    saveToDrive,
  })


  const [repoDropdownOffset, setRepoDropdownOffset] = React.useState(0)

  // FIXED PAGINATION: Show exactly 2 items to fit within height: 5
  React.useEffect(() => {
    setRepoDropdownOffset(prev => {
      if (sourceSel < prev) return sourceSel
      if (sourceSel >= prev + 2) return sourceSel - 1 
      return prev
    })
  }, [sourceSel])

  const visibleDropdownSources = filteredSources.slice(repoDropdownOffset, repoDropdownOffset + 2)

  const queuedEntries = Object.entries(queuedMessages)

  useEffect(() => {
    if (VISIBLE_AGENTS <= 0 || AGENTS.length === 0) return

    const selectedAgentId = AGENTS[sel]?.id
    const selRowIdx = allRows.findIndex(r => r.type === 'session' && r.data.id === selectedAgentId)
    if (selRowIdx < 0) return

    if (selRowIdx < tableOffset) {
      setTableOffset(selRowIdx)
    } else if (selRowIdx >= tableOffset + VISIBLE_AGENTS) {
      setTableOffset(selRowIdx - VISIBLE_AGENTS + 1)
    }
  }, [sel, VISIBLE_AGENTS, tableOffset, setTableOffset, allRows, AGENTS])

  if (columns < 70 || rows < 10) {
    return React.createElement(Box, {
      padding: 1,
      flexDirection: 'column',
      borderStyle: 'double',
      borderColor: THEME.panelBorder,
    },
      React.createElement(Text, { color: THEME.error, bold: true }, 'TERMINAL TOO SMALL'),
      React.createElement(Text, { color: THEME.subtleText }, 'Need at least 70x10 for dashboard view.'),
      React.createElement(Text, { color: THEME.warning }, `Current size: ${columns}x${rows}`)
    )
  }

  const activeCount = AGENTS.filter(a => ['IN_PROGRESS', 'PLANNING', 'AWAITING_USER_FEEDBACK', 'AWAITING_PLAN_APPROVAL'].includes(a.state)).length
  const overnightMode = getGovernorConfig().overnightMode

  const shortcutTokensFull = [
    'alt+q queue',
    'alt+g diff',
    'alt+a apply',
    'alt+e chat',
    'alt+m repo',
    'alt+d delete',
    'arrows nav',
    'alt+? help',
    `agents:${AGENTS.length}`,
  ]

  const shortcutTokensCompact = [
    'alt+g diff',
    'alt+e chat',
    'alt+m repo',
    'arrows nav',
    `a:${AGENTS.length}`,
  ]

  const shortcutTokensTight = [
    'alt+g',
    'alt+e',
    'alt+m',
    `a:${AGENTS.length}`,
  ]

  const shortcutBar = isTight
    ? shortcutTokensTight.join(' | ')
    : isCompact
      ? shortcutTokensCompact.join(' | ')
      : shortcutTokensFull.join(' | ')

  return React.createElement(Box, {
    flexDirection: 'column',
    width: columns,
    height: TERMINAL_ROWS,
    minWidth: 0,
    overflow: 'hidden',
  },
    React.createElement(Box, {
      flexDirection: 'row',
      width: '100%',
      height: 1,
      overflow: 'hidden',
      flexShrink: 0,
    },
      React.createElement(Text, { color: THEME.text, bold: true, wrap: 'truncate' }, 'Current Repo: '),
      React.createElement(Text, { color: 'blueBright', bold: true, wrap: 'truncate' }, currentRepoDisplay),
      statusFlash && React.createElement(Text, { color: THEME.text, bold: true, wrap: 'truncate' }, ` | ${statusFlash}`),
      React.createElement(Spacer),
      queuedEntries.length > 0 && React.createElement(Text, { color: THEME.accentSoft, wrap: 'truncate' }, `${queuedEntries.length} queued`),
      queuedEntries.length > 0 && React.createElement(Text, { color: THEME.subtleText }, ' | '),
      overnightMode && React.createElement(Text, { color: 'magentaBright', bold: true, wrap: 'truncate' }, `[OVERNIGHT: ON] `),
      React.createElement(Text, { color: THEME.accent, bold: true, wrap: 'truncate' }, `[Active Agents: ${activeCount}]`)
    ),

    React.createElement(Box, { width: '100%', height: 1, overflow: 'hidden', flexShrink: 0, minWidth: 0 },
      React.createElement(Text, { color: THEME.subtleText, dimColor: true, wrap: 'truncate' }, '-'.repeat(200))
    ),

    // FIXED HEIGHT: Hardcoded back to 5 so it aligns with `useLayout`
    repoInputMode && React.createElement(Box, {
      flexDirection: 'column',
      height: 5,
      paddingX: 1,
      borderStyle: 'round',
      borderColor: THEME.panelFocusBorder,
      flexShrink: 0,
      overflow: 'hidden',
      minWidth: 0,
    },
      React.createElement(Box, { flexDirection: 'row', overflow: 'hidden', minWidth: 0 },
        React.createElement(Box, { flexShrink: 1, overflow: 'hidden', minWidth: 0 },
          React.createElement(Text, { color: THEME.accentSoft, wrap: 'truncate' }, 'Repo (/ to search): ')
        ),
        React.createElement(Box, { flexGrow: 1, overflow: 'hidden', minWidth: 0 },
          React.createElement(TextInput, {
            value: repoInput,
            onChange: (v) => { setRepoInput(v); setSourceSel(0) },
            onSubmit: () => {
              if (repoInput.startsWith('/')) {
                // Submit the highlighted dropdown item
                if (filteredSources && filteredSources.length > 0 && filteredSources[sourceSel]) {
                  handleRepoSubmit(filteredSources[sourceSel].name || '')
                  setSourceSel(0)
                } else if (repoInput.length > 1) {
                  // Fallback: If no matches, assume they typed a valid custom path anyway
                  handleRepoSubmit(repoInput.substring(1))
                  setSourceSel(0)
                } else {
                  flash('Please type a repository name.')
                }
              } else {
                // Submit custom typed string
                handleRepoSubmit(repoInput)
              }
            }
          })
        )
      ),
      repoInput.startsWith('/') && React.createElement(Box, { flexDirection: 'column', overflow: 'hidden', minWidth: 0 },
        filteredSources.length === 0
          ? React.createElement(Text, { color: THEME.subtleText, wrap: 'truncate' }, '  No repositories found...')
          : visibleDropdownSources.map((s, idx) =>
              React.createElement(Text, {
                key: s.name,
                color: repoDropdownOffset + idx === sourceSel ? THEME.accent : THEME.subtleText,
                wrap: 'truncate',
              }, repoDropdownOffset + idx === sourceSel ? '> ' + (s.displayName || s.name) : '  ' + (s.displayName || s.name))
            )
      )
    ),

    showHelp
      ? React.createElement(HelpScreen)
      : React.createElement(Box, {
          flexDirection: 'row',
          height: availableBodyHeight,
          overflow: 'hidden',
          minWidth: 0,
          minHeight: 0,
        },
          showLeftPanel && React.createElement(Box, {
            flexDirection: 'column',
            width: leftPanelWidth,
            paddingRight: isWide ? 1 : 0,
            overflow: 'hidden',
            minWidth: 0,
            minHeight: 0,
          },
            _renderLeftPanel({
              mode, lastLeftMode,
              activeAgentId, leftPanelWidth, isWide, availableBodyHeight,
              diffFileSel, setDiffFileSel, diffScrollOffset, diffFocus,
              diffRefreshToken, setDiffFileCount,
              tick, openAgentChat,
              AGENTS, sel, tableOffset, VISIBLE_AGENTS, allRows,
            })
          ),

          showRightPanel && React.createElement(Box, {
            flexDirection: 'column',
            width: rightPanelWidth,
            overflow: 'hidden',
            minWidth: 0,
            minHeight: 0,
          },
            React.createElement(ChatPanel, {
              messages,
              input: chatInput,
              onChange: setChatInput,
              onSubmit: handleSend,
              focused: mode === 'chat',
              scrollOffset,
              setScrollOffset,
              width: rightPanelWidth,
              tab: chatTab,
              notes,
              setNotes,
              isRepoInputMode: repoInputMode,
              repoName: currentRepoName,
              agentTitle: activeAgentTitle,
              agentId: activeAgentId,
              agentState: activeAgent?.state,
              chatTargetMode,
              visibleAgentsCount: VISIBLE_AGENTS,
              chatMenuOpen,
              chatMenuSel,
              chatVisibleRows: CHAT_VISIBLE_ROWS,
              latestProgress,
              promptPreview,
              expandedMessages,
              toggleMessageExpand,
              chatCursorLine,
              setChatCursorLine,
              startDialogOpen,
              startDialogMode,
              showApproveHint,
            })
          )
        ),

    React.createElement(Box, { width: '100%', height: 1, overflow: 'hidden', flexShrink: 0, minWidth: 0 },
      React.createElement(Text, { color: THEME.subtleText, dimColor: true, wrap: 'truncate' }, '='.repeat(200))
    ),

    React.createElement(Box, { width: '100%', height: 1, flexDirection: 'row', overflow: 'hidden', flexShrink: 0, minWidth: 0 },
      !showHelp
        ? React.createElement(Box, {
            flexGrow: 1,
            flexShrink: 1,
            overflow: 'hidden',
            flexDirection: 'row',
            minWidth: 0,
          },
            React.createElement(Text, { color: THEME.subtleText, wrap: 'truncate' }, truncateShortcutBar(columns, shortcutBar)),
            React.createElement(Spacer),
            React.createElement(Text, { color: THEME.accent, bold: true },
              mode === 'diff' ? '[DIF]' : mode === 'chat' ? '[CHT]' : '[TBL]'
            )
          )
        : React.createElement(Box, { flexGrow: 1, flexShrink: 1, overflow: 'hidden', minWidth: 0 },
            React.createElement(Text, { color: THEME.accent, bold: true, wrap: 'truncate' }, '[HELP MODE] '),
            React.createElement(Text, { color: THEME.subtleText, wrap: 'truncate' }, 'Press ESC or Alt+? to return')
          )
    )
  )
}

function _renderLeftPanel({
  mode, lastLeftMode,
  activeAgentId, leftPanelWidth, isWide, availableBodyHeight,
  diffFileSel, setDiffFileSel, diffScrollOffset, diffFocus,
  diffRefreshToken, setDiffFileCount,
  tick, openAgentChat,
  AGENTS, sel, tableOffset, VISIBLE_AGENTS, allRows,
}) {
  if (mode === 'diff' || (mode === 'chat' && lastLeftMode === 'diff')) {
    return React.createElement(GitDiffViewer, {
      sessionId: activeAgentId,
      width: leftPanelWidth - (isWide ? 1 : 0),
      height: availableBodyHeight,
      isDimmed: mode !== 'diff',
      fileSel: diffFileSel,
      scrollOffset: diffScrollOffset,
      diffFocus: mode === 'diff' ? diffFocus : null,
      setDiffFileSel,
      refreshToken: diffRefreshToken,
      setDiffFileCount,
    })
  }

  return React.createElement(Box, { flexDirection: 'column', flexGrow: 1, overflow: 'hidden' },
    React.createElement(Box, { height: 1, justifyContent: 'center' },
      React.createElement(Text, { color: mode === 'table' ? THEME.accentMuted : THEME.subtleText, bold: mode === 'table' },
        `AGENT LIST [`),
      React.createElement(Text, { color: mode === 'table' ? THEME.accent : THEME.subtleText, bold: mode === 'table' },
        `${AGENTS.length > 0 ? sel + 1 : 0}/${AGENTS.length}`),
      React.createElement(Text, { color: mode === 'table' ? THEME.accentMuted : THEME.subtleText, bold: mode === 'table' },
        `]`)
    ),
    React.createElement(Box, { height: 1, overflow: 'hidden' },
      React.createElement(Text, { color: mode === 'table' ? THEME.accent : THEME.subtleText, dimColor: true }, '-'.repeat(100))
    ),
    AGENTS.length === 0
      ? React.createElement(Box, { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
          React.createElement(Text, { color: THEME.subtleText, dimColor: true }, 'No agents yet'))
      : _renderTableRows({ allRows, AGENTS, sel, tableOffset, VISIBLE_AGENTS, tick, mode })
  )
}

function _renderTableRows({ allRows, AGENTS, sel, tableOffset, VISIBLE_AGENTS, tick, mode }) {
  const visibleRows = allRows.slice(tableOffset, tableOffset + VISIBLE_AGENTS)

  return visibleRows.map((row, i) => {
    // We compare with the visible row index, which is tableOffset + i, instead of agentIdx, because sel now refers to allRows index
    const isSelected = (tableOffset + i) === sel
    return React.createElement(AgentRow, {
      key: row.data.id,
      agent: row.data,
      selected: isSelected,
      tick,
      isDimmed: mode !== 'table',
      isExpanded: row.isExpanded,
      hasChildren: row.hasChildren,
      depth: row.depth,
    })
  })
}

let inkInstance = null

export function renderDashboard(searchTerm = '') {
  if (!inkInstance) {
    console.clear()
    inkInstance = render(React.createElement(Dashboard, { searchTerm }))
  } else {
    inkInstance.rerender(React.createElement(Dashboard, { searchTerm }))
  }
}