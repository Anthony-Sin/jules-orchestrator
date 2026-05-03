// ── renderer.js ───────────────────────────────────────────────────
// Entry point for the Jules Colony TUI.
// Handles UI layout math, the Ink render tree, and keyboard input.

import React, { useEffect } from 'react'
import { render, Box, Text, useInput, useApp } from 'ink'
import TextInput from 'ink-text-input'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import { parseSourceDisplay, deleteSession } from '../state/jules-api.js'
import { getConfig, removeSession } from '../state/store.js'

import { AgentRow, SubAgentRow, EmptySubAgentsRow, buildRows } from './components/table.js'
import { useTerminalSize } from './hooks.js'
import { MiniGraph, PlannedGraphViewer, GRAPH_NODE_W } from './components/graph.js'
import { ChatPanel } from './components/chat.js'
import { HelpScreen } from './components/help.js'
import { GitDiffViewer, applyDiff } from './components/gitdiff.js'

// Import our massive state controller
import { useDashboardController, saveToDrive } from './dashboard-controller.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkgPath   = path.join(__dirname, '..', '..', 'package.json')
const pkg       = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
export const version = pkg.version

export function Dashboard({ searchTerm = '' }) {
  const { exit } = useApp()
  const { columns, rows } = useTerminalSize()

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
    mode, setMode, lastLeftMode,
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
    openAgentChat, handleSend, handleRepoSubmit
  } = useDashboardController()

  // Memoized Table Rows
  const allRows = React.useMemo(() => buildRows(AGENTS, expandedIds), [AGENTS, expandedIds])

  // ── Derived layout ───────────────────────────────────────────────
  const TERMINAL_ROWS = Math.max(10, rows - 1)
  const isWide        = columns >= 80

  const rightPanelWidth = isWide ? Math.floor(columns * 0.38) : columns
  const leftPanelWidth  = isWide ? columns - rightPanelWidth  : columns

  const showLeftPanel  = isWide || mode !== 'chat'
  const showRightPanel = isWide || mode === 'chat'

  const repoInputHeight     = repoInputMode ? 5 : 0
  const availableBodyHeight = TERMINAL_ROWS - (5 + repoInputHeight)

  const canShowGraph  = showGraph && columns >= 100 && rows >= 15
  const graphVisible  = canShowGraph
  const graphHeight   = graphVisible ? availableBodyHeight : 0

  const VISIBLE_AGENTS = Math.max(1, availableBodyHeight - 3)

  const chatWrapLimit    = Math.max(10, rightPanelWidth - 6)
  const inputLines       = (mode === 'chat' && chatTab === 'chat')
    ? Math.max(1, Math.ceil(chatInput.length / chatWrapLimit))
    : 1
  const inputExtraHeight = Math.min(3, inputLines - 1)
  const chatFixedHeights = 4
  const chatMenuHeight   = chatMenuOpen && chatTab === 'chat' ? 5 : 0
  const progressHeight   = (latestProgress || promptPreview) && chatTab === 'chat' ? 3 : 0
  const CHAT_VISIBLE_ROWS = Math.max(1,
    availableBodyHeight - (chatFixedHeights + chatMenuHeight + inputExtraHeight + progressHeight))

  // Table scroll: keep selected row in view
  useEffect(() => {
    if (VISIBLE_AGENTS <= 0) return
    if (sel < tableOffset) setTableOffset(sel)
    else if (sel >= tableOffset + VISIBLE_AGENTS) setTableOffset(sel - VISIBLE_AGENTS + 1)
  }, [sel, VISIBLE_AGENTS, tableOffset, setTableOffset])

  // ── Keyboard input ────────────────────────────────────────────────
  useInput(async (input, key) => {
    if (repoInputMode) {
      if (key.escape) { setRepoInputMode(false); return }
      if (repoInput.startsWith('/')) {
        const filtered = sourcesList.filter(s =>
          ('/' + (s.displayName || s.name)).toLowerCase().includes(repoInput.toLowerCase()))
        if (key.upArrow)   { setSourceSel(i => Math.max(0, i - 1)); return }
        if (key.downArrow) { setSourceSel(i => Math.min(Math.max(0, filtered.length - 1), i + 1)); return }
        if (key.return && filtered.length > 0 && filtered[sourceSel]) {
          handleRepoSubmit(filtered[sourceSel].name); return
        }
      }
      return
    }

    if (key.ctrl && input === 'c') { exit(); return }
    if (key.meta && input === '?') { setShowHelp(v => !v); return }
    if (showHelp && (key.escape || (key.meta && input === '?'))) { setShowHelp(false); return }
    if (showHelp) return

    if (key.meta && input === 'd' && mode === 'table') {
      const agent = AGENTS[sel]
      if (agent) {
        flash(`Deleting session ${agent.id.substring(0, 6)}...`)
        deleteSession(agent.id)
          .then(() => {
            removeSession(agent.id)
            flash(`✓ Deleted session ${agent.id.substring(0, 6)}`)
          })
          .catch(err => {
            flash(`Delete failed: ${err.message}`)
          })
      }
      return
    }

    if (key.meta && input === 'q') {
      const entries = Object.entries(queuedMessages)
      if (entries.length > 0) {
        let nextIdx = queuedCycleIdx + 1
        if (nextIdx >= entries.length) nextIdx = 0
        setQueuedCycleIdx(nextIdx)
        const [id, msg] = entries[nextIdx]
        setChatInput(msg)
      }
      return
    }

    if (key.meta && input && input >= '1' && input <= '9') {
      const promptNum = input;
      const notesLines = (notes || '').split('\n');
      let foundPrompt = false;
      let promptText = '';

      for (let i = 0; i < notesLines.length; i++) {
        const line = notesLines[i];
        if (line.trim().startsWith(`${promptNum}.`)) {
          foundPrompt = true;
          promptText += line.replace(new RegExp(`^\\s*${promptNum}\\.\\s*`), '') + '\n';
        } else if (foundPrompt) {
          if (/^\s*\d+\./.test(line)) {
            break; // next prompt reached
          } else {
            promptText += line + '\n';
          }
        }
      }

      if (foundPrompt && promptText.trim()) {
        const finalPrompt = promptText.trim();
        setChatInput(finalPrompt);
        setPromptPreview(`Prompt ${promptNum}: ${finalPrompt.split('\n')[0].substring(0, 50)}...`);
        setTimeout(() => setPromptPreview(null), 3000);
      } else {
        flash(`Prompt ${promptNum} not found in notes.`);
      }
      return;
    }

    if (key.meta && input === 't') { setMode('table'); return }
    if (key.meta && input === 'g') {
      if (columns < 100 || rows < 15) { flash('Terminal too small for Diff View (need 100x15)'); return }
      if (mode !== 'diff') { setMode('diff') }
      else { setMode('table') }
      return
    }
    if (key.meta && input === 'a' && mode === 'diff' && activeAgentId) {
      flash('Applying diff...')
      import('./components/gitdiff.js').then(({ applyDiff }) => {
        import('../state/jules-api.js').then(({ getAllActivities }) => {
          getAllActivities(activeAgentId).then(res => {
            const acts = res.activities || res || []
            const sorted = [...acts].sort((a, b) => new Date(a.createTime || 0) - new Date(b.createTime || 0))
            let diffStr = null
            for (let i = sorted.length - 1; i >= 0; i--) {
              const act = sorted[i]
              if (act.artifacts && act.artifacts.length > 0) {
                for (const art of act.artifacts) {
                  if (art.changeSet?.gitPatch?.unidiffPatch) {
                    diffStr = art.changeSet.gitPatch.unidiffPatch
                    break
                  }
                }
              }
              if (diffStr) break
            }
            if (diffStr) {
              applyDiff(diffStr).then(() => flash('✓ Diff applied successfully'))
                .catch(err => flash(`✗ Failed to apply diff: ${err.message}`))
            } else {
              flash('✗ No diff found to apply')
            }
          })
        })
      })
      return
    }
    if (key.meta && input === 'e') { setMode('chat'); return }
    if (key.meta && input === 'n') { setMode('chat'); setChatTab(t => t === 'chat' ? 'notes' : 'chat'); return }
    if (key.meta && input === 'h') { setShowGraph(v => !v); return }
    if (key.meta && input === 'm') { setRepoInputMode(true); setRepoInput('/'); setSourceSel(0); return }
    if (key.meta && input === 'r') { setTick(t => t + 1); return }
    if (key.meta && input === 's') {
      const saved = await saveToDrive(notes)
      flash(saved ? '✓ Saved to Drive' : '~ Drive sync not available in CLI')
      return
    }

    if (key.f4) { setRepoInputMode(true); setRepoInput('/'); setSourceSel(0); return }
    if (key.f1) { setMode('table'); return }
    if (key.f2) {
      if (columns < 100 || rows < 15) { flash('Terminal too small for Graph View'); return }
      setShowGraph(true); setMode('graph'); return
    }
    if (key.f3) { setMode('chat'); return }

    if (key.escape) { setMode('table'); setChatMenuOpen(false); return }
    if (key.tab) {
      if (mode === 'diff') {
        if (diffFocus === 'files') {
          setDiffFocus('content')
        } else {
          setDiffFocus('files')
          setMode('chat')
        }
      } else if (mode === 'chat' && lastLeftMode === 'diff') {
        setMode('diff')
        setDiffFocus('files')
      } else {
        setMode(m => {
          if (m === 'table') return showGraph ? 'graph' : 'chat'
          if (m === 'graph') return 'chat'
          if (m === 'chat') return lastLeftMode
          return 'table'
        })
      }
      return
    }

    if (mode === 'chat') {
      if (chatMenuOpen) {
        if (key.escape)    { setChatMenuOpen(false); setChatInput(''); return }
        if (key.upArrow)   { setChatMenuSel(i => Math.max(0, i - 1)); return }
        if (key.downArrow) { setChatMenuSel(i => Math.min(2, i + 1)); return }
        if (key.return) {
          if (chatMenuSel === 2) { // Approve Plan
            setChatMenuOpen(false)
            setChatInput('')
            handleSend('/approve')
            return
          }
          const opts = ['CREATE_ORCHESTRATOR', 'CREATE_ORCHESTRATOR']
          setChatTargetMode(opts[chatMenuSel])
          setChatMenuOpen(false)
          setChatInput('')
          if (chatMenuSel === 0) {
            setMessages([{ role: 'system', text: '[SYSTEM] Warning: This will create a new session/task.' }])
          } else if (chatMenuSel === 1) {
            setMessages([{ role: 'system', text: '[SYSTEM] Warning: This will create a brand new Orchestrator.' }])
          }
          return
        }
        return
      }
      if (key.shift && (key.leftArrow || key.rightArrow)) {
        setChatTab(t => t === 'chat' ? 'notes' : 'chat'); return
      }

      // We will let chat.js handle up/down arrow and alt+space natively for line-by-line navigation
      // when tab === 'chat', but we need to catch page up/page down.
      if (key.pageUp)    { setScrollOffset(o => o + 5); return }
      if (key.pageDown)  { setScrollOffset(o => Math.max(0, o - 5)); return }
      return
    }

    if (mode === 'diff') {
      if (diffFocus === 'files') {
        if (key.leftArrow) { setDiffFileSel(i => Math.max(0, i - 1)); return }
        if (key.rightArrow) { setDiffFileSel(i => i + 1); return } // bounded in gitdiff component
        if (key.return) { setDiffFocus('content'); return }
      } else {
        if (key.upArrow) { setDiffScrollOffset(o => Math.max(0, o - 1)); return }
        if (key.downArrow) { setDiffScrollOffset(o => o + 1); return }
        if (key.pageUp) { setDiffScrollOffset(o => Math.max(0, o - 10)); return }
        if (key.pageDown) { setDiffScrollOffset(o => o + 10); return }
      }
      return
    }

    if (mode === 'graph') {
      if (graphViewMode === 'plan') {
        const currentDiagram = savedDiagrams[0]
        const nodes = currentDiagram?.nodes || []
        if (nodes.length === 0) return

        const conns = currentDiagram?.connections || []
        const adj = {}; const inDeg = {}; const incoming = {}
        nodes.forEach(n => { adj[n] = []; inDeg[n] = 0; incoming[n] = [] })
        conns.forEach(c => {
          const [u, v] = c.split('->').map(s => s.trim())
          if (adj[u] && inDeg[v] !== undefined) { adj[u].push(v); inDeg[v]++; incoming[v].push(u) }
        })
        const baseTiers = []
        let cur = nodes.filter(n => inDeg[n] === 0)
        if (cur.length === 0) cur = [nodes[0]]
        const vis = new Set(cur)
        while (cur.length > 0) {
          baseTiers.push(cur)
          const nxt = []
          cur.forEach(u => adj[u].forEach(v => { if (!vis.has(v)) { vis.add(v); nxt.push(v) } }))
          cur = nxt
        }
        const uncon = nodes.filter(n => !vis.has(n))
        if (uncon.length > 0) baseTiers.push(uncon)

        const selNodeLabel = nodes[planNodeSel] || nodes[0]
        const activePath   = new Set([selNodeLabel])
        let currNode = selNodeLabel
        while (currNode) {
          const parents = incoming[currNode] || []
          if (parents.length === 0) break
          currNode = parents[0]; activePath.add(currNode)
        }

        const tiers = []
        for (let t = 0; t < baseTiers.length; t++) {
          if (t === 0) { tiers.push(baseTiers[0]); continue }
          const prevActive = tiers[t-1].filter(n => activePath.has(n))
          const allowed    = new Set()
          prevActive.forEach(p => (adj[p] || []).forEach(c => allowed.add(c)))
          const vis2       = baseTiers[t].filter(n => allowed.has(n))
          if (vis2.length > 0) tiers.push(vis2)
        }

        let selTier = 0; let selCol = 0
        outer: for (let t = 0; t < tiers.length; t++) {
          for (let c = 0; c < tiers[t].length; c++) {
            if (nodes.indexOf(tiers[t][c]) === planNodeSel) { selTier = t; selCol = c; break outer }
          }
        }

        if (key.leftArrow)  { if (selCol > 0) setPlanNodeSel(nodes.indexOf(tiers[selTier][selCol - 1])); return }
        if (key.rightArrow) { if (selCol < tiers[selTier].length - 1) setPlanNodeSel(nodes.indexOf(tiers[selTier][selCol + 1])); return }
        if (key.upArrow) {
          if (selTier > 0) {
            const parents2 = incoming[selNodeLabel] || []
            if (parents2.length > 0) setPlanNodeSel(nodes.indexOf(parents2[0]))
            else setPlanNodeSel(nodes.indexOf(tiers[selTier - 1][Math.min(selCol, tiers[selTier - 1].length - 1)]))
          }
          return
        }
        if (key.downArrow) { if (selTier < tiers.length - 1) setPlanNodeSel(nodes.indexOf(tiers[selTier + 1][0])); return }
        return
      }

      const total     = graphNodes.length
      if (total === 0) return
      const usableWidth = Math.max(20, (leftPanelWidth || 80) - 4)
      const CPR         = Math.max(1, Math.floor(usableWidth / (GRAPH_NODE_W + 1)))
      const totalRows2  = Math.ceil(total / CPR)
      const currentRow  = Math.floor(graphSel / CPR)
      const currentCol  = graphSel % CPR

      if (key.leftArrow)  { if (currentCol > 0) setGraphSel(currentRow * CPR + currentCol - 1); return }
      if (key.rightArrow) {
        const rowEnd = Math.min(CPR - 1, total - 1 - currentRow * CPR)
        if (currentCol < rowEnd) setGraphSel(currentRow * CPR + currentCol + 1)
        return
      }
      if (key.upArrow)   { if (currentRow > 0) setGraphSel(Math.min((currentRow - 1) * CPR + currentCol, total - 1)); return }
      if (key.downArrow) { if (currentRow < totalRows2 - 1) setGraphSel(Math.min((currentRow + 1) * CPR + currentCol, total - 1)); return }
      if (key.return)    { const agent = graphNodes[graphSel]; if (agent) openAgentChat(agent); return }
      return
    }

    if (mode === 'table') {
      if (key.upArrow)   { setSel(i => Math.max(0, i - 1)); return }
      if (key.downArrow) { setSel(i => Math.min(Math.max(0, AGENTS.length - 1), i + 1)); return }
      if (key.rightArrow) {
        const agent = AGENTS[sel]
        if (agent && (Array.isArray(agent.subAgents) || agent.isOrchestrator || agent.type === 'orchestrator')) toggleExpand(agent.id)
        return
      }
      if (key.leftArrow) {
        const agent = AGENTS[sel]
        if (agent) setExpandedIds(prev => { const next = new Set(prev); next.delete(agent.id); return next })
        return
      }
      if (key.return) { const agent = AGENTS[sel]; if (agent) openAgentChat(agent) }
    }
  })

  // ── Too-small guard ───────────────────────────────────────────────
  if (columns < 80 || rows < 10) {
    return React.createElement(Box, { padding: 1, flexDirection: 'column', borderStyle: 'double', borderColor: 'red' },
      React.createElement(Text, { color: 'red',    bold: true }, '⚠ TERMINAL TOO SMALL'),
      React.createElement(Text, { color: 'gray'              }, 'Need at least 80×10 for Table View (100×15 for Graph View)'),
      React.createElement(Text, { color: 'yellow'            }, `Currently: ${columns}×${rows} — Please stretch your window horizontally.`)
    )
  }

  const currentSource      = getConfig().source
  const currentRepoDisplay = currentSource ? parseSourceDisplay(currentSource) : 'NOT SET'
  const activeAgent        = selectedSessionId ? AGENTS.find(a => a.id === selectedSessionId) : null
  const activeAgentTitle   = activeAgent?.title || 'jules-orchestrator'
  const activeAgentId      = selectedSessionId  || 'NEW TASK'

  const filteredSources        = repoInput.startsWith('/') ? sourcesList.filter(s =>
    ('/' + (s.displayName || s.name)).toLowerCase().includes(repoInput.toLowerCase())) : []
  const dropdownOffset         = sourceSel >= 5 ? sourceSel - 4 : 0
  const visibleDropdownSources = filteredSources.slice(dropdownOffset, dropdownOffset + 5)

  const queuedEntries = Object.entries(queuedMessages)

  // ── Render ────────────────────────────────────────────────────────
  return React.createElement(Box, {
    flexDirection: 'column',
    width: columns, height: TERMINAL_ROWS,
    minWidth: 0, overflow: 'hidden'
  },
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

    React.createElement(Box, { width: '100%', height: 1, overflow: 'hidden', flexShrink: 0, minWidth: 0 },
      React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, '─'.repeat(200))
    ),

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

    showHelp
      ? React.createElement(HelpScreen)
      : React.createElement(Box, { flexDirection: 'row', height: availableBodyHeight, overflow: 'hidden', minWidth: 0, minHeight: 0 },
          showLeftPanel && React.createElement(Box, {
            flexDirection: 'column', width: leftPanelWidth, paddingRight: isWide ? 1 : 0, overflow: 'hidden', minWidth: 0, minHeight: 0
          },
            // Show diff if mode is diff, OR if chat is focused and the last left mode was diff
            (mode === 'diff' || (mode === 'chat' && lastLeftMode === 'diff'))
              ? React.createElement(GitDiffViewer, {
                  sessionId: activeAgentId,
                  width: leftPanelWidth - (isWide ? 1 : 0),
                  height: availableBodyHeight,
                  isDimmed: mode !== 'diff',
                  fileSel: diffFileSel,
                  scrollOffset: diffScrollOffset,
                  diffFocus: mode === 'diff' ? diffFocus : null,
                  setDiffFileSel // pass setter to bound correctly inside component
                })
              : ((mode === 'table' || (mode === 'chat' && lastLeftMode === 'table') || !graphVisible)
                  ? React.createElement(Box, { flexDirection: 'column', flexGrow: 1, overflow: 'hidden' },
                      React.createElement(Box, { height: 1, justifyContent: 'center' },
                        React.createElement(Text, { color: mode === 'table' ? 'cyanBright' : 'gray', bold: mode === 'table' },
                          `  AGENT LIST  [${AGENTS.length > 0 ? sel + 1 : 0}/${AGENTS.length}]  ·  ${currentRepoDisplay}`)
                      ),
                      React.createElement(Box, { height: 1, overflow: 'hidden' },
                        React.createElement(Text, { color: 'gray', dimColor: true }, '─'.repeat(100))
                      ),
                      AGENTS.length === 0
                        ? React.createElement(Box, { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
                            React.createElement(Text, { color: 'gray', dimColor: true }, 'No agents yet'))
                        : (() => {
                            const sessionRows = allRows.filter(r => r.type === 'session')
                            const visibleSessionIdxs = sessionRows.slice(tableOffset, tableOffset + VISIBLE_AGENTS).map(r => AGENTS.indexOf(r.data))
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
                              if (row.type === 'sub') return React.createElement(SubAgentRow, { key: 'sub-' + (row.data.id || i), agent: row.data, tick, isLast: row.isLast })
                              const agentIdx = AGENTS.indexOf(row.data)
                              return React.createElement(AgentRow, {
                                key: row.data.id, agent: row.data, selected: agentIdx === sel, tick, isDimmed: mode !== 'table', expanded: row.expanded,
                              })
                            })
                          })()
                    )
                  : (graphViewMode === 'live'
                      ? React.createElement(MiniGraph, {
                          tick, isDimmed: mode !== 'graph', height: graphHeight, width: leftPanelWidth, sessions: AGENTS, graphSel, onGraphNav: setGraphSel,
                          onGraphSelect: (idx) => { setGraphSel(idx); const agent = graphNodes[idx]; if (agent) openAgentChat(agent) }
                        })
                      : React.createElement(PlannedGraphViewer, {
                          diagram: savedDiagrams[0], selectedNodeIdx: planNodeSel, height: graphHeight, isDimmed: mode !== 'graph'
                        })
                    ))
          ),

          showRightPanel && React.createElement(Box, {
            flexDirection: 'column', width: rightPanelWidth, overflow: 'hidden', minWidth: 0, minHeight: 0
          },
            React.createElement(ChatPanel, {
              messages, input: chatInput, onChange: setChatInput, onSubmit: handleSend, focused: mode === 'chat',
              scrollOffset, setScrollOffset, width: rightPanelWidth, tab: chatTab, notes, setNotes, isRepoInputMode: repoInputMode,
              repoName: currentRepoDisplay, agentTitle: activeAgentTitle, agentId: activeAgentId, chatTargetMode,
              visibleAgentsCount: VISIBLE_AGENTS, chatMenuOpen, chatMenuSel, chatVisibleRows: CHAT_VISIBLE_ROWS, latestProgress, promptPreview,
              expandedMessages, toggleMessageExpand, chatCursorLine, setChatCursorLine
            })
          )
        ),

    React.createElement(Box, { width: '100%', height: 1, overflow: 'hidden', flexShrink: 0, minWidth: 0 },
      React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, '━'.repeat(200))
    ),

    React.createElement(Box, { width: '100%', height: 1, flexDirection: 'row', overflow: 'hidden', flexShrink: 0, minWidth: 0 },
      !showHelp
        ? React.createElement(React.Fragment, null,
            React.createElement(Box, { flexGrow: 1, flexShrink: 1, overflow: 'hidden', flexDirection: 'row', minWidth: 0, justifyContent: 'space-between' },
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
                React.createElement(Text, { color: 'cyanBright', bold: true }, mode === 'diff' ? ' [DIF]' : mode === 'graph' ? ' [GRP]' : mode === 'chat' ? ' [CHT]' : ' [TBL]')
              )
            )
          )
        : React.createElement(Box, { flexGrow: 1, flexShrink: 1, overflow: 'hidden', minWidth: 0 },
            React.createElement(Text, { color: 'cyanBright', bold: true, wrap: 'truncate' }, '  [HELP MODE] '),
            React.createElement(Text, { color: 'gray',   dimColor: true, wrap: 'truncate' }, 'Press [ESC] or [Alt+?] to return')
          )
    )
  )
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