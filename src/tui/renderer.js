// ── renderer.js ───────────────────────────────────────────────────
// Entry point for the Jules Colony TUI.
// Owns only the render tree and wires together the two hooks that
// handle layout math (useLayout) and keyboard input (useKeyboard).

import React, { useEffect } from 'react'
import { render, Box, Text, useApp } from 'ink'
import TextInput from 'ink-text-input'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import { parseSourceDisplay } from '../state/jules-api.js'
import { getConfig } from '../state/store.js'

import { AgentRow, SubAgentRow, EmptySubAgentsRow, buildRows } from './components/table.js'
import { MiniGraph, PlannedGraphViewer, GRAPH_NODE_W } from './components/graph.js'
import { ChatPanel } from './components/chat.js'
import { HelpScreen } from './components/help.js'
import { GitDiffViewer } from './components/gitdiff.js'

import { useDashboardController, saveToDrive } from './dashboard-controller.js'
import { useLayout } from './hooks/useLayout.js'
import { useKeyboard } from './hooks/useKeyboard.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkgPath   = path.join(__dirname, '..', '..', 'package.json')
const pkg       = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
export const version = pkg.version

export function Dashboard({ searchTerm = '' }) {
  const { exit } = useApp()

  const ctrl = useDashboardController()
  const {
    tick, setTick,
    sel, setSel,
    tableOffset, setTableOffset,
    expandedIds, setExpandedIds, toggleExpand,
    graphSel, setGraphSel,
    showGraph, setShowGraph,
    graphViewMode, setGraphViewMode,
    planNodeSel, setPlanNodeSel,
    savedDiagrams,
    mode, setMode,
    lastLeftMode,
    diffFileSel, setDiffFileSel,
    diffScrollOffset, setDiffScrollOffset,
    diffFocus, setDiffFocus,
    chatInput, setChatInput,
    messages, setMessages,
    scrollOffset, setScrollOffset,
    chatTab, setChatTab,
    chatMenuOpen, setChatMenuOpen,
    chatMenuSel, setChatMenuSel,
    chatTargetMode, setChatTargetMode,
    expandedMessages, toggleMessageExpand,
    chatCursorLine, setChatCursorLine,
    notes, setNotes,
    selectedSessionId, latestProgress,
    queuedMessages, setQueuedMessages,
    queuedCycleIdx, setQueuedCycleIdx,
    promptPreview, setPromptPreview,
    repoInputMode, setRepoInputMode,
    repoInput, setRepoInput,
    sourcesList,
    sourceSel, setSourceSel,
    statusFlash, flash,
    showHelp, setShowHelp,
    AGENTS,
    graphNodes,
    openAgentChat, handleSend, handleRepoSubmit,
  } = ctrl

  // ── Layout ────────────────────────────────────────────────────────
  const layout = useLayout({
    mode,
    showGraph,
    repoInputMode,
    chatMenuOpen,
    chatTab,
    chatInput,
    hasLatestProgress: !!latestProgress,
    hasPromptPreview:  !!promptPreview,
  })
  const {
    columns, rows,
    TERMINAL_ROWS, isWide,
    rightPanelWidth, leftPanelWidth,
    showLeftPanel, showRightPanel,
    availableBodyHeight,
    graphVisible, graphHeight,
    VISIBLE_AGENTS,
    CHAT_VISIBLE_ROWS,
  } = layout

  // ── Keyboard ──────────────────────────────────────────────────────
  useKeyboard({
    exit,
    mode, setMode, lastLeftMode,
    showHelp, setShowHelp,
    repoInputMode, setRepoInputMode,
    repoInput, setRepoInput,
    sourcesList, sourceSel, setSourceSel,
    handleRepoSubmit,
    sel, setSel, AGENTS, expandedIds, setExpandedIds, toggleExpand, VISIBLE_AGENTS,
    showGraph, setShowGraph,
    graphSel, setGraphSel, graphNodes, graphViewMode,
    planNodeSel, setPlanNodeSel, savedDiagrams,
    openAgentChat,
    columns, rows, leftPanelWidth,
    diffFocus, setDiffFocus,
    diffFileSel, setDiffFileSel,
    diffScrollOffset, setDiffScrollOffset,
    chatInput, setChatInput,
    chatTab, setChatTab,
    chatMenuOpen, setChatMenuOpen,
    chatMenuSel, setChatMenuSel,
    setChatTargetMode, setMessages,
    setScrollOffset, handleSend,
    selectedSessionId,
    queuedMessages, queuedCycleIdx, setQueuedCycleIdx,
    notes, setPromptPreview,
    setTick,
    flash,
    saveToDrive,
  })

  // ── Derived display values ────────────────────────────────────────
  const currentSource      = getConfig().source
  const currentRepoDisplay = currentSource ? parseSourceDisplay(currentSource) : 'NOT SET'
  const activeAgent        = selectedSessionId ? AGENTS.find(a => a.id === selectedSessionId) : null
  const activeAgentTitle   = activeAgent?.title || 'jules-orchestrator'
  const activeAgentId      = selectedSessionId  || 'NEW TASK'

  const filteredSources        = repoInput.startsWith('/') ? sourcesList.filter(s =>
    ('/' + (s.displayName || s.name)).toLowerCase().includes(repoInput.toLowerCase())) : []
  const dropdownOffset         = sourceSel >= 5 ? sourceSel - 4 : 0
  const visibleDropdownSources = filteredSources.slice(dropdownOffset, dropdownOffset + 5)

  const allRows       = React.useMemo(() => buildRows(AGENTS, expandedIds), [AGENTS, expandedIds])
  const queuedEntries = Object.entries(queuedMessages)

  // ── Table scroll: keep selected row in view ───────────────────────
  useEffect(() => {
    if (VISIBLE_AGENTS <= 0 || AGENTS.length === 0) return

    // Find the row index of the currently selected agent
    const selectedAgentId = AGENTS[sel]?.id
    const selRowIdx = allRows.findIndex(r => r.type === 'session' && r.data.id === selectedAgentId)
    if (selRowIdx < 0) return

    if (selRowIdx < tableOffset) {
      setTableOffset(selRowIdx)
    } else if (selRowIdx >= tableOffset + VISIBLE_AGENTS) {
      setTableOffset(selRowIdx - VISIBLE_AGENTS + 1)
    }
  }, [sel, VISIBLE_AGENTS, tableOffset, setTableOffset, allRows, AGENTS])

  // ── Too-small guard ───────────────────────────────────────────────
  if (columns < 80 || rows < 10) {
    return React.createElement(Box, { padding: 1, flexDirection: 'column', borderStyle: 'double', borderColor: 'red' },
      React.createElement(Text, { color: 'red',    bold: true }, '⚠ TERMINAL TOO SMALL'),
      React.createElement(Text, { color: 'gray'              }, 'Need at least 80×10 for Table View (100×15 for Graph View)'),
      React.createElement(Text, { color: 'yellow'            }, `Currently: ${columns}×${rows} — Please stretch your window horizontally.`)
    )
  }

  // ── Render ────────────────────────────────────────────────────────
  return React.createElement(Box, {
    flexDirection: 'column',
    width: columns, height: TERMINAL_ROWS,
    minWidth: 0, overflow: 'hidden'
  },

    // ── Top bar ─────────────────────────────────────────────────────
    React.createElement(Box, {
      flexDirection: 'row', width: '100%', height: 1,
      overflow: 'hidden', flexShrink: 0, justifyContent: 'space-between'
    },
      React.createElement(Box, { flexShrink: 1, overflow: 'hidden', minWidth: 0, flexDirection: 'row' },
        React.createElement(Text, { color: 'whiteBright', bold: true, wrap: 'truncate' }, 'JULES COLONY '),
        React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, '│ '),
        React.createElement(Text, { color: currentRepoDisplay === 'NOT SET' ? 'red' : 'cyan', wrap: 'truncate' }, `~ ${currentRepoDisplay} `),
        React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, '│ '),
        React.createElement(Text, { color: 'blue', dimColor: true, wrap: 'truncate' }, 'powered by jules '),
        statusFlash ? React.createElement(Text, { color: 'green', wrap: 'truncate' }, `│ ${statusFlash}`) : null
      ),
      React.createElement(Box, { flexShrink: 0, flexDirection: 'row', minWidth: 0 },
        queuedEntries.length > 0 && React.createElement(React.Fragment, null,
          React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, '│ '),
          React.createElement(Text, { color: 'magentaBright', wrap: 'truncate' }, `⧖ ${queuedEntries.length} queued (Alt+/) `)
        ),
        React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, '│ '),
        React.createElement(Text, { color: 'greenBright', wrap: 'truncate' },
          (() => {
            const n = AGENTS.filter(a => ['IN_PROGRESS','PLANNING','AWAITING_USER_FEEDBACK','AWAITING_PLAN_APPROVAL'].includes(a.state)).length
            return `✓ ${n} active ${n === 1 ? 'agent' : 'agents'} `
          })()
        )
      )
    ),

    // ── Top separator ───────────────────────────────────────────────
    React.createElement(Box, { width: '100%', height: 1, overflow: 'hidden', flexShrink: 0, minWidth: 0 },
      React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, '─'.repeat(200))
    ),

    // ── Repo picker ─────────────────────────────────────────────────
    repoInputMode && React.createElement(Box, {
      flexDirection: 'column', height: 5, paddingX: 1,
      borderStyle: 'round', borderColor: 'cyan',
      flexShrink: 0, overflow: 'hidden', minWidth: 0
    },
      React.createElement(Box, { flexDirection: 'row', overflow: 'hidden', minWidth: 0 },
        React.createElement(Box, { flexShrink: 1, overflow: 'hidden', minWidth: 0 },
          React.createElement(Text, { color: 'cyan', wrap: 'truncate' }, 'Repo (/ to search): ')
        ),
        React.createElement(Box, { flexGrow: 1, overflow: 'hidden', minWidth: 0 },
          React.createElement(TextInput, {
            value: repoInput,
            onChange: (v) => { setRepoInput(v); setSourceSel(0) },
            onSubmit: repoInput.startsWith('/') ? () => {} : handleRepoSubmit
          })
        )
      ),
      repoInput.startsWith('/') && React.createElement(Box, { flexDirection: 'column', overflow: 'hidden', minWidth: 0 },
        filteredSources.length === 0
          ? React.createElement(Text, { color: 'gray', wrap: 'truncate' }, '  No repositories found…')
          : visibleDropdownSources.map((s, idx) =>
              React.createElement(Text, {
                key: s.name, color: dropdownOffset + idx === sourceSel ? 'cyanBright' : 'gray', wrap: 'truncate'
              }, dropdownOffset + idx === sourceSel ? '▶ ' + (s.displayName || s.name) : '  ' + (s.displayName || s.name))
            )
      )
    ),

    React.createElement(Box, { width: '100%', height: 1, flexShrink: 0 }),

    // ── Main body ───────────────────────────────────────────────────
    showHelp
      ? React.createElement(HelpScreen)
      : React.createElement(Box, { flexDirection: 'row', height: availableBodyHeight, overflow: 'hidden', minWidth: 0, minHeight: 0 },

          // ── Left panel ──────────────────────────────────────────
          showLeftPanel && React.createElement(Box, {
            flexDirection: 'column', width: leftPanelWidth, paddingRight: isWide ? 1 : 0,
            overflow: 'hidden', minWidth: 0, minHeight: 0
          },
            _renderLeftPanel({
              mode, lastLeftMode, graphVisible, graphViewMode,
              activeAgentId, leftPanelWidth, isWide, availableBodyHeight,
              diffFileSel, setDiffFileSel, diffScrollOffset, diffFocus,
              graphHeight, tick, graphSel, setGraphSel, graphNodes, openAgentChat,
              savedDiagrams, planNodeSel,
              AGENTS, sel, tableOffset, VISIBLE_AGENTS, allRows, expandedIds, toggleExpand,
            })
          ),

          // ── Right panel (chat) ───────────────────────────────────
          showRightPanel && React.createElement(Box, {
            flexDirection: 'column', width: rightPanelWidth, overflow: 'hidden', minWidth: 0, minHeight: 0
          },
            React.createElement(ChatPanel, {
              messages, input: chatInput, onChange: setChatInput, onSubmit: handleSend,
              focused: mode === 'chat',
              scrollOffset, setScrollOffset, width: rightPanelWidth, tab: chatTab,
              notes, setNotes, isRepoInputMode: repoInputMode,
              repoName: currentRepoDisplay, agentTitle: activeAgentTitle, agentId: activeAgentId,
              chatTargetMode,
              visibleAgentsCount: VISIBLE_AGENTS, chatMenuOpen, chatMenuSel,
              chatVisibleRows: CHAT_VISIBLE_ROWS, latestProgress, promptPreview,
              expandedMessages, toggleMessageExpand, chatCursorLine, setChatCursorLine,
            })
          )
        ),

    // ── Bottom separator ────────────────────────────────────────────
    React.createElement(Box, { width: '100%', height: 1, overflow: 'hidden', flexShrink: 0, minWidth: 0 },
      React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, '━'.repeat(200))
    ),

    // ── Status bar ──────────────────────────────────────────────────
    React.createElement(Box, { width: '100%', height: 1, flexDirection: 'row', overflow: 'hidden', flexShrink: 0, minWidth: 0 },
      !showHelp
        ? React.createElement(Box, { flexGrow: 1, flexShrink: 1, overflow: 'hidden', flexDirection: 'row', minWidth: 0, justifyContent: 'space-between' },
            React.createElement(Box, { flexDirection: 'row', flexShrink: 1, minWidth: 0, overflow: 'hidden' },
              React.createElement(Text, { color: 'whiteBright', bold: true, wrap: 'truncate' }, ' alt+q'),
              React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, ' :qmsg '),
              React.createElement(Text, { color: 'whiteBright', bold: true, wrap: 'truncate' }, ' alt+g'),
              React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, ' :diff '),
              React.createElement(Text, { color: 'whiteBright', bold: true, wrap: 'truncate' }, ' alt+a'),
              React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, ' :patch '),
              React.createElement(Text, { color: 'whiteBright', bold: true, wrap: 'truncate' }, ' alt+e'),
              React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, ' :chat '),
              React.createElement(Text, { color: 'whiteBright', bold: true, wrap: 'truncate' }, ' alt+m'),
              React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, ' :repo '),
              React.createElement(Text, { color: 'whiteBright', bold: true, wrap: 'truncate' }, ' alt+d'),
              React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, ' :del │ '),
              React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, '↑↓:nav →:exp ←:col ↵:chat │ '),
              React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, 'alt+?:help │ '),
              React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, `agents:${AGENTS.length}`)
            ),
            React.createElement(Box, { flexShrink: 0, flexDirection: 'row' },
              React.createElement(Text, { color: 'cyanBright', bold: true },
                mode === 'diff' ? ' [DIF]' : mode === 'graph' ? ' [GRP]' : mode === 'chat' ? ' [CHT]' : ' [TBL]')
            )
          )
        : React.createElement(Box, { flexGrow: 1, flexShrink: 1, overflow: 'hidden', minWidth: 0 },
            React.createElement(Text, { color: 'cyanBright', bold: true, wrap: 'truncate' }, '  [HELP MODE] '),
            React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, 'Press [ESC] or [Alt+?] to return')
          )
    )
  )
}

// ── Left panel renderer (pure function, no hooks) ─────────────────
function _renderLeftPanel({
  mode, lastLeftMode, graphVisible, graphViewMode,
  activeAgentId, leftPanelWidth, isWide, availableBodyHeight,
  diffFileSel, setDiffFileSel, diffScrollOffset, diffFocus,
  graphHeight, tick, graphSel, setGraphSel, graphNodes, openAgentChat,
  savedDiagrams, planNodeSel,
  AGENTS, sel, tableOffset, VISIBLE_AGENTS, allRows, expandedIds, toggleExpand,
}) {
  // Diff view (stays visible when chat is focused, dimmed)
  if (mode === 'diff' || (mode === 'chat' && lastLeftMode === 'diff')) {
    return React.createElement(GitDiffViewer, {
      sessionId: activeAgentId,
      width:  leftPanelWidth - (isWide ? 1 : 0),
      height: availableBodyHeight,
      isDimmed: mode !== 'diff',
      fileSel: diffFileSel,
      scrollOffset: diffScrollOffset,
      diffFocus: mode === 'diff' ? diffFocus : null,
      setDiffFileSel,
    })
  }

  // Graph view
  if (graphVisible && (mode === 'graph' || (mode === 'chat' && lastLeftMode === 'graph'))) {
    if (graphViewMode === 'live') {
      return React.createElement(MiniGraph, {
        tick, isDimmed: mode !== 'graph',
        height: graphHeight, width: leftPanelWidth,
        sessions: AGENTS, graphSel,
        onGraphNav: setGraphSel,
        onGraphSelect: (idx) => { setGraphSel(idx); const agent = graphNodes[idx]; if (agent) openAgentChat(agent) },
      })
    }
    return React.createElement(PlannedGraphViewer, {
      diagram: savedDiagrams[0], selectedNodeIdx: planNodeSel,
      height: graphHeight, isDimmed: mode !== 'graph',
    })
  }

  // Table view (default)
  return React.createElement(Box, { flexDirection: 'column', flexGrow: 1, overflow: 'hidden' },
    React.createElement(Box, { height: 1, justifyContent: 'center' },
      React.createElement(Text, { color: mode === 'table' ? 'cyanBright' : 'gray', bold: mode === 'table' },
        `  AGENT LIST  [${AGENTS.length > 0 ? sel + 1 : 0}/${AGENTS.length}]`)
    ),
    React.createElement(Box, { height: 1, overflow: 'hidden' },
      React.createElement(Text, { color: 'gray', dimColor: true }, '─'.repeat(100))
    ),
    AGENTS.length === 0
      ? React.createElement(Box, { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
          React.createElement(Text, { color: 'gray', dimColor: true }, 'No agents yet'))
      : _renderTableRows({ allRows, AGENTS, sel, tableOffset, VISIBLE_AGENTS, tick, mode })
  )
}

// ── Table rows renderer ───────────────────────────────────────────
function _renderTableRows({ allRows, AGENTS, sel, tableOffset, VISIBLE_AGENTS, tick, mode }) {
  const sessionRows        = allRows.filter(r => r.type === 'session')
  const visibleSessionIdxs = sessionRows
    .slice(tableOffset, tableOffset + VISIBLE_AGENTS)
    .map(r => AGENTS.indexOf(r.data))

  const visibleRows = allRows.filter(r => {
    if (r.type === 'session') return visibleSessionIdxs.includes(AGENTS.indexOf(r.data))
    if (r.type === 'sub' || r.type === 'empty') {
      const parent = AGENTS.find(a => a.id === r.parentId)
      return parent && visibleSessionIdxs.includes(AGENTS.indexOf(parent))
    }
    return false
  })

  return visibleRows.map((row, i) => {
    if (row.type === 'empty') return React.createElement(EmptySubAgentsRow, { key: 'empty-' + row.parentId })
    if (row.type === 'sub')   return React.createElement(SubAgentRow, { key: 'sub-' + (row.data.id || i), agent: row.data, tick, isLast: row.isLast })
    const agentIdx = AGENTS.indexOf(row.data)
    return React.createElement(AgentRow, {
      key: row.data.id, agent: row.data,
      selected: agentIdx === sel,
      tick, isDimmed: mode !== 'table', expanded: row.expanded,
    })
  })
}

// ── Render entry point ────────────────────────────────────────────
let inkInstance = null

export function renderDashboard(searchTerm = '') {
  if (!inkInstance) {
    console.clear()
    inkInstance = render(React.createElement(Dashboard, { searchTerm }))
  } else {
    inkInstance.rerender(React.createElement(Dashboard, { searchTerm }))
  }
}