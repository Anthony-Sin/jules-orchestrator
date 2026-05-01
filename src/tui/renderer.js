// ── renderer.js ───────────────────────────────────────────────────
// Entry point for the Jules Colony TUI.
// Owns all stateful logic: sessions, chat, repo selection, keyboard nav.
// UI building blocks live in ./components.js
// Markdown rendering lives in ./markdown.js

import { parseSourceDisplay, getActivities, sendMessage, listSources } from '../state/jules-api.js'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { render, Box, Text, useInput, useApp } from 'ink'
import TextInput from 'ink-text-input'
import { getSessions, getConfig, setConfig, store } from '../state/store.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { dispatchLeadOrchestrator } from '../jules_lead_orchestrator/julesorchestrator.js'
import { useTerminalSize, MiniGraph, ChatPanel, HelpScreen, PlannedGraphViewer } from './components.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkgPath = path.join(__dirname, '..', '..', 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
export const version = pkg.version

// ── Google Drive MCP helpers ──────────────────────────────────────
async function loadDriveConfig() {
  try { return null } catch (_) { return null }
}

async function saveToDrive(content) {
  try { return false } catch (_) { return false }
}

// ── Dashboard ─────────────────────────────────────────────────────
export function Dashboard({
  inputBuffer = '',
  searchTerm  = '',
  onSelect    = () => {},
  onRowChange = () => {},
  selectedIndex = 0,
  statusMsg     = '',
  lastUpdate
}) {
  const { exit } = useApp()
  const { columns, rows } = useTerminalSize()

  const [tick, setTick] = useState(0)

  // ── Table state ──────────────────────────────────────────────────
  const [sel, setSel]                   = useState(0)
  const [tableOffset, setTableOffset]   = useState(0)

  // ── Graph state ──────────────────────────────────────────────────
  const [graphSel, setGraphSel]         = useState(0)
  const [showGraph, setShowGraph]       = useState(true)
  const [graphViewMode, setGraphViewMode] = useState('live') // 'live' | 'plan'
  const [diagramSel, setDiagramSel]       = useState(0)
  const savedDiagrams = store.get('architectureDiagrams') || []

  // ── Layout mode: 'table' | 'graph' | 'chat' ─────────────────────
  const [mode, setMode]                 = useState('table')

  // ── Chat state ───────────────────────────────────────────────────
  const [chatInput, setChatInput]         = useState('')
  const [messages, setMessages]           = useState([])
  const [scrollOffset, setScrollOffset]   = useState(0)
  const [chatTab, setChatTab]             = useState('chat')
  const [chatMenuOpen, setChatMenuOpen]   = useState(false)
  const [chatMenuSel, setChatMenuSel]     = useState(0)
  const [chatTargetMode, setChatTargetMode] = useState('CREATE_ORCHESTRATOR')

  const [notes, setNotes] = useState(() => store.get('tuiNotes', ''))

  // ── Session tracking ─────────────────────────────────────────────
  const [selectedSessionId, setSelectedSessionId]   = useState(null)
  const [lastActivityIds, setLastActivityIds]       = useState({})
  const [queuedMessages, setQueuedMessages]         = useState({})

  // ── Repo picker ──────────────────────────────────────────────────
  const [repoInputMode, setRepoInputMode] = useState(false)
  const [repoInput, setRepoInput]         = useState('')
  const [sourcesList, setSourcesList]     = useState([])
  const [sourceSel, setSourceSel]         = useState(0)

  // ── Status flash ─────────────────────────────────────────────────
  const [statusFlash, setStatusFlash]     = useState('')

  const [showHelp, setShowHelp]           = useState(false)

  // ── Layout math ──────────────────────────────────────────────────
  const TERMINAL_ROWS = Math.max(10, rows - 1)
  const isWide        = columns >= 80

  const rightPanelWidth = isWide ? Math.floor(columns * 0.38) : columns
  const leftPanelWidth  = isWide ? columns - rightPanelWidth  : columns

  const showLeftPanel  = isWide || mode !== 'chat'
  const showRightPanel = isWide || mode === 'chat'

  const repoInputHeight     = repoInputMode ? 5 : 0
  const availableBodyHeight = TERMINAL_ROWS - (4 + repoInputHeight)

  const canShowGraph = columns >= 80 && rows >= 16
  const graphVisible = showGraph && canShowGraph
  const graphHeight  = graphVisible ? availableBodyHeight : 0

  const VISIBLE_AGENTS = 0

  const chatFixedHeights  = 4
  const chatMenuHeight    = chatMenuOpen && chatTab === 'chat' ? 3 : 0
  const CHAT_VISIBLE_ROWS = Math.max(1, availableBodyHeight - (chatFixedHeights + chatMenuHeight))

  // ── Data ─────────────────────────────────────────────────────────
  const sessions = getSessions() || []
  const AGENTS   = sessions.slice().reverse()

  const [lastGraphUpdate, setLastGraphUpdate] = useState(0);

  const orchAgents = AGENTS.filter(a =>
    a.type === 'orchestrator' || (a.title || '').toLowerCase().includes('orchestrator')
  )
  const subAgents = AGENTS.filter(a =>
    !(a.type === 'orchestrator' || (a.title || '').toLowerCase().includes('orchestrator'))
  )
  const graphNodes = [...orchAgents, ...subAgents]

  // ── flash helper ─────────────────────────────────────────────────
  function flash(msg, ms = 2000) {
    setStatusFlash(msg)
    setTimeout(() => setStatusFlash(''), ms)
  }

  // ── Effects ──────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 200)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    listSources().then(res => setSourcesList(res || [])).catch(() => {})
  }, [])

  useEffect(() => { store.set('tuiNotes', notes) }, [notes])

  // Table scroll: keep selected row in view
  useEffect(() => {
    // Prevent infinite loop if the table UI is hidden
    if (VISIBLE_AGENTS <= 0) return 

    if (sel < tableOffset) setTableOffset(sel)
    else if (sel >= tableOffset + VISIBLE_AGENTS) setTableOffset(sel - VISIBLE_AGENTS + 1)
  }, [sel, VISIBLE_AGENTS, tableOffset])

  useEffect(() => {
    if (graphNodes.length > 0 && graphSel >= graphNodes.length) {
      setGraphSel(graphNodes.length - 1)
    }
  }, [graphNodes.length])

  useEffect(() => {
    let active = true
    const poll = async () => {
      if (!active || mode !== 'chat' || !selectedSessionId) return
      try {
        const res  = await getActivities(selectedSessionId)
        const acts = res.activities || res || []
        if (!Array.isArray(acts) || acts.length === 0) return

        const newMessages = []
        const lastId  = lastActivityIds[selectedSessionId]
        let foundNew  = false
        const sorted  = acts.sort((a, b) => new Date(a.createTime || 0) - new Date(b.createTime || 0))

        for (const act of sorted) {
          if (!lastId || foundNew || act.name > lastId) {
            foundNew = true
            if (act.userMessaged?.userMessage?.trim()) {
              newMessages.push({ role: 'user', text: act.userMessaged.userMessage })
            } else if (act.agentMessaged?.agentMessage?.trim()) {
              newMessages.push({ role: 'agent', text: act.agentMessaged.agentMessage })
            } else if (act.originator === 'agent' || act.originator === 'system') {
              let text = act.description || ''
              if (act.planGenerated) text += '\nPlan: ' + JSON.stringify(act.planGenerated)
              if (text.trim()) newMessages.push({ role: act.originator, text })
            }
          }
        }

        if (newMessages.length > 0) {
          setMessages(m => [...m, ...newMessages])
          setLastActivityIds(prev => ({ ...prev, [selectedSessionId]: sorted[sorted.length - 1].name }))
        } else if (!lastId && sorted.length > 0) {
          setLastActivityIds(prev => ({ ...prev, [selectedSessionId]: sorted[sorted.length - 1].name }))
        }
      } catch (_) {}
    }

    const p = setInterval(poll, 5000)
    poll()
    return () => { active = false; clearInterval(p) }
  }, [mode, selectedSessionId, lastActivityIds])
  
  const lastGraphUpdateRef = useRef(0)

  // Poll for architecture graph updates to notify the user in chat
  useEffect(() => {
    const interval = setInterval(() => {
      const storeUpdate = store.get('diagramLastUpdated', 0);
      
      if (storeUpdate > lastGraphUpdateRef.current) {
        lastGraphUpdateRef.current = storeUpdate;
        const currentDiagrams = store.get('architectureDiagrams') || [];
        
        setMessages(m => [
          ...m, 
          { role: 'system', text: 'magenta:➦ Diagram updated → see [ PLANNED ARCHITECTURE ]' }
        ]);

        // Auto-switch to the new plan diagram
        setMode('graph');
        setGraphViewMode('plan');
        setDiagramSel(Math.max(0, currentDiagrams.length - 1));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    for (const [id, msg] of Object.entries(queuedMessages)) {
      const agent = AGENTS.find(a => a.id === id)
      if (agent && agent.state !== 'IN_PROGRESS') {
        sendMessage(id, msg).catch(() => {})
        setMessages(m => [...m, { role: 'system', text: `[SYSTEM] Sent queued message to ${id}` }])
        setQueuedMessages(prev => { const q = { ...prev }; delete q[id]; return q })
      }
    }
  }, [tick, queuedMessages, AGENTS])

  // ── Open agent chat ───────────────────────────────────────────────
  const openAgentChat = useCallback((agent) => {
    if (!agent) return
    setSelectedSessionId(agent.id)
    setMode('chat')
    setScrollOffset(0)

    getActivities(agent.id).then(res => {
      const acts = res.activities || res || []
      const history = []
      if (Array.isArray(acts)) {
        const sorted = acts.sort((a, b) => new Date(a.createTime || 0) - new Date(b.createTime || 0))
        for (const act of sorted) {
          if (act.userMessaged?.userMessage?.trim()) {
            history.push({ role: 'user', text: act.userMessaged.userMessage })
          } else if (act.agentMessaged?.agentMessage?.trim()) {
            history.push({ role: 'agent', text: act.agentMessaged.agentMessage })
          } else if (act.originator === 'agent' || act.originator === 'system') {
            let text = act.description || ''
            if (act.planGenerated) text += '\nPlan: ' + JSON.stringify(act.planGenerated)
            if (text.trim()) history.push({ role: act.originator, text })
          }
        }
      }
      history.push({
        role: 'system',
        text: `Context: ${agent.id.substring(0, 8)}. State: ${agent.state}. Repo: ${agent.repoDisplay || agent.repo || 'unknown'}.`
      })
      setMessages(history)
    }).catch(e => {
      setMessages([{ role: 'system', text: `Error loading history: ${e.message}` }])
    })
  }, [])

  // ── Keyboard input ────────────────────────────────────────────────
  useInput(async (input, key) => {

    if (repoInputMode) {
      if (key.escape) { setRepoInputMode(false); return }
      if (repoInput.startsWith('/')) {
        const filtered = sourcesList.filter(s =>
          ('/' + (s.displayName || s.name)).toLowerCase().includes(repoInput.toLowerCase())
        )
        if (key.upArrow)   { setSourceSel(i => Math.max(0, i - 1)); return }
        if (key.downArrow) { setSourceSel(i => Math.min(Math.max(0, filtered.length - 1), i + 1)); return }
        if (key.return && filtered.length > 0 && filtered[sourceSel]) {
          handleRepoSubmit(filtered[sourceSel].name); return
        }
      }
      return
    }

    if (key.ctrl && input === 'c') { exit(); return }
    if (input === '?') { setShowHelp(v => !v); return }
    if (showHelp && (key.escape || input === '?')) { setShowHelp(false); return }
    if (showHelp) return

    if (key.meta && input === 't') { setMode('table'); return }
    if (key.meta && input === 'g') { 
      if (mode !== 'graph') {
        setMode('graph');
      } else {
        setGraphViewMode(v => v === 'live' ? 'plan' : 'live');
      }
      return; 
    }
    if (key.meta && input === 'e') { setMode('chat'); setScrollOffset(0); return }
    if (key.meta && input === 'n') {
      setMode('chat')
      setChatTab(t => t === 'chat' ? 'notes' : 'chat')
      return
    }
    if (key.meta && input === 'h') { setShowGraph(v => !v); return }
    if (key.meta && input === 'm') {
      setRepoInputMode(true)
      setRepoInput('/')
      setSourceSel(0)
      return
    }
    if (key.meta && input === 'r') { setTick(t => t + 1); return }

    if (key.meta && input === 's') {
      const saved = await saveToDrive(notes)
      flash(saved ? '✓ Saved to Drive' : '~ Drive sync not available in CLI')
      return
    }

    if (key.f4) { setRepoInputMode(true); setRepoInput('/'); setSourceSel(0); return }
    if (key.f1) { setMode('table'); return }
    if (key.f2) { setMode('graph'); return }
    if (key.f3) { setMode('chat'); setScrollOffset(0); return }

    if (key.escape) { setMode('table'); setChatMenuOpen(false); return }
    if (key.tab) {
      setMode(m => m === 'table' ? 'graph' : m === 'graph' ? 'chat' : 'table')
      setScrollOffset(0)
      return
    }

    if (mode === 'chat') {
      if (chatMenuOpen) {
        if (key.escape)    { setChatMenuOpen(false); setChatInput(''); return }
        if (key.upArrow)   { setChatMenuSel(i => Math.max(0, i - 1)); return }
        if (key.downArrow) { setChatMenuSel(i => Math.min(2, i + 1)); return }
        if (key.return) {
          const opts = ['CREATE_ORCHESTRATOR', 'TALK_TO_SELECTED_AGENT', 'TALK_TO_LATEST_ORCHESTRATOR']
          setChatTargetMode(opts[chatMenuSel])
          setChatMenuOpen(false)
          setChatInput('')
          if (chatMenuSel === 0)
            setMessages(m => [...m, { role: 'system', text: 'Ready for new task prompt...' }])
          return
        }
        return
      }

      if (input === '/' && chatInput === '') { setChatMenuOpen(true); setChatMenuSel(0); return }
      if (key.shift && (key.leftArrow || key.rightArrow)) {
        setChatTab(t => t === 'chat' ? 'notes' : 'chat')
        return
      }
      if (key.upArrow)   { setScrollOffset(o => o + 1); return }
      if (key.downArrow) { setScrollOffset(o => Math.max(0, o - 1)); return }
      if (key.pageUp)    { setScrollOffset(o => o + 5); return }
      if (key.pageDown)  { setScrollOffset(o => Math.max(0, o - 5)); return }
      return
    }

    if (mode === 'graph') {
      // IF IN PLAN VIEW: Use arrows to switch between diagrams
      if (graphViewMode === 'plan') {
        if (key.leftArrow || key.upArrow)   { setDiagramSel(i => Math.max(0, i - 1)); return }
        if (key.rightArrow || key.downArrow) { setDiagramSel(i => Math.min(savedDiagrams.length - 1, i + 1)); return }
        return;
      }

      // IF IN LIVE VIEW: Use arrows to navigate nodes
      const total = graphNodes.length
      if (total === 0) return

      const safeWidth = leftPanelWidth || 80;
      const usableWidth = Math.max(20, safeWidth - 4);
      const CPR = Math.max(1, Math.floor(usableWidth / 25)); 
      
      if (key.leftArrow)  { setGraphSel(i => Math.max(0, i - 1));       return }
      if (key.rightArrow) { setGraphSel(i => Math.min(total - 1, i + 1)); return }
      if (key.upArrow)    { setGraphSel(i => Math.max(0, i - CPR));       return }
      if (key.downArrow)  { setGraphSel(i => Math.min(total - 1, i + CPR)); return }
      if (key.return) {
        const agent = graphNodes[graphSel]
        if (agent) openAgentChat(agent)
        return
      }
      return
    }

    if (mode === 'table') {
      if (key.upArrow)   { setSel(i => Math.max(0, i - 1)); return }
      if (key.downArrow) { setSel(i => Math.min(Math.max(0, AGENTS.length - 1), i + 1)); return }
      if (key.return) {
        const agent = AGENTS[sel]
        if (agent) openAgentChat(agent)
      }
    }
  })

  // ── Send chat message ─────────────────────────────────────────────
  async function handleSend(val) {
    if (!val.trim()) return
    const source = getConfig().source
    if (!source || source === 'NOT SET') {
      setMessages(m => [...m,
        { role: 'user',   text: val.trim() },
        { role: 'system', text: 'Error: No repo selected. Press Alt+M to choose one.' }
      ])
      setChatInput('')
      setScrollOffset(0)
      return
    }

    if (chatTargetMode === 'CREATE_ORCHESTRATOR' || !AGENTS || AGENTS.length === 0) {
      setChatInput('')
      setScrollOffset(0)
      try {
        const { sessionId } = await dispatchLeadOrchestrator(val.trim(), 1, val.trim().substring(0, 30))
        setMessages(m => [...m,
          { role: 'user',   text: val.trim() },
          { role: 'system', text: `Dispatched orchestrator: ${sessionId}` }
        ])
        setSelectedSessionId(sessionId)
      } catch (e) {
        setMessages(m => [...m,
          { role: 'user',   text: val.trim() },
          { role: 'system', text: `Dispatch error: ${e.message}` }
        ])
      }
      return
    }

    const targetAgent = chatTargetMode === 'TALK_TO_LATEST_ORCHESTRATOR'
      ? (AGENTS.find(a => a.type === 'orchestrator') || AGENTS[0])
      : AGENTS[sel]

    if (!targetAgent) {
      setMessages(m => [...m, { role: 'system', text: 'Error: No agent found.' }])
      return
    }

    if (targetAgent.state === 'IN_PROGRESS') {
      setQueuedMessages(prev => ({ ...prev, [targetAgent.id]: val.trim() }))
      setMessages(m => [...m,
        { role: 'user',   text: val.trim() },
        { role: 'system', text: `Message queued — agent ${targetAgent.id.substring(0, 6)} is busy` }
      ])
      setChatInput('')
      setScrollOffset(0)
      return
    }

    setMessages(m => [...m,
      { role: 'user',   text: val.trim() },
      { role: 'system', text: 'Sending…' }
    ])
    setChatInput('')
    setScrollOffset(0)
    try {
      await sendMessage(targetAgent.id, val.trim())
    } catch (e) {
      setMessages(m => [...m, { role: 'system', text: `Send error: ${e.message}` }])
    }
  }

  function handleRepoSubmit(val) {
    if (val.trim()) setConfig('source', val.trim())
    setRepoInputMode(false)
  }

  if (columns < 35 || rows < 10) {
    return React.createElement(Box, { padding: 1, flexDirection: 'column' },
      React.createElement(Text, { color: 'red', bold: true }, '⚠ TERMINAL TOO SMALL'),
      React.createElement(Text, { color: 'gray' }, `Need at least 35×10 — currently ${columns}×${rows}`)
    )
  }

  const currentSource      = getConfig().source
  const currentRepoDisplay = currentSource ? parseSourceDisplay(currentSource) : 'NOT SET'

  const activeAgent      = selectedSessionId ? AGENTS.find(a => a.id === selectedSessionId) : null
  const activeAgentTitle = activeAgent?.title || 'jules-orchestrator'
  const activeAgentId    = selectedSessionId || 'NEW TASK'

  const filteredSources        = repoInput.startsWith('/') ? sourcesList.filter(s =>
    ('/' + (s.displayName || s.name)).toLowerCase().includes(repoInput.toLowerCase())
  ) : []
  const dropdownOffset         = sourceSel >= 5 ? sourceSel - 4 : 0
  const visibleDropdownSources = filteredSources.slice(dropdownOffset, dropdownOffset + 5)

  return React.createElement(Box, {
    flexDirection: 'column',
    width: columns,
    height: TERMINAL_ROWS,
    minWidth: 0,
    overflow: 'hidden'
  },

    React.createElement(Box, { flexDirection: 'row', width: '100%', height: 1, overflow: 'hidden', flexShrink: 0 },
      React.createElement(Box, { flexShrink: 1, overflow: 'hidden', minWidth: 0 },
        React.createElement(Text, { color: 'yellow', bold: true, wrap: 'truncate' }, 'JULES COLONY '),
        React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, '│ '),
        React.createElement(Text, {
          color: currentRepoDisplay === 'NOT SET' ? 'red' : 'cyan',
          dimColor: true, wrap: 'truncate'
        }, `~ ${currentRepoDisplay} `),
        React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, '│ '),
        React.createElement(Text, { color: 'magenta', dimColor: true, wrap: 'truncate' }, 'powered by jules '),
        statusFlash
          ? React.createElement(Text, { color: 'green', wrap: 'truncate' }, `│ ${statusFlash}`)
          : null
      ),
      React.createElement(Box, { flexGrow: 1, flexShrink: 1, overflow: 'hidden', minWidth: 0 },
        React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, '━'.repeat(200))
      )
    ),

    repoInputMode && React.createElement(Box, {
      flexDirection: 'column', height: 5,
      paddingX: 1, borderStyle: 'round', borderColor: 'cyan',
      flexShrink: 0, overflow: 'hidden', minWidth: 0
    },
      React.createElement(Box, { flexDirection: 'row', overflow: 'hidden', minWidth: 0 },
        React.createElement(Box, { flexShrink: 1, overflow: 'hidden', minWidth: 0 },
          React.createElement(Text, { color: 'cyan', wrap: 'truncate' }, 'Repo (/ to search): ')
        ),
        React.createElement(Box, { flexGrow: 1, overflow: 'hidden', minWidth: 0 },
          React.createElement(TextInput, {
            value:    repoInput,
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
                key:   s.name,
                color: dropdownOffset + idx === sourceSel ? 'magenta' : 'gray',
                wrap:  'truncate'
              },
                dropdownOffset + idx === sourceSel
                  ? '▶ ' + (s.displayName || s.name)
                  : '  ' + (s.displayName || s.name)
              )
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
          minHeight: 0
        },

          showLeftPanel && React.createElement(Box, {
            flexDirection: 'column', width: leftPanelWidth, paddingRight: isWide ? 1 : 0, overflow: 'hidden', minWidth: 0, minHeight: 0
          },
            graphVisible
              ? (graphViewMode === 'live'
                  ? React.createElement(MiniGraph, {
                      tick, isDimmed: mode !== 'graph', height: graphHeight, width: leftPanelWidth, sessions: AGENTS,
                      graphSel, onGraphNav: setGraphSel, onGraphSelect: (idx) => {
                        setGraphSel(idx); const agent = graphNodes[idx]; if (agent) openAgentChat(agent);
                      }
                    })
                  : React.createElement(PlannedGraphViewer, {
                      diagram: savedDiagrams[diagramSel], index: diagramSel, total: savedDiagrams.length, height: graphHeight, isDimmed: mode !== 'graph'
                    })
                )
              : React.createElement(Box, { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
                  React.createElement(Text, { color: 'gray', dimColor: true }, 'Graph hidden — alt+h to show')
                )
          ),

          showRightPanel && React.createElement(Box, {
            flexDirection: 'column',
            width: rightPanelWidth,
            overflow: 'hidden',
            minWidth: 0,
            minHeight: 0
          },
            React.createElement(ChatPanel, {
              messages,
              input:              chatInput,
              onChange:           setChatInput,
              onSubmit:           handleSend,
              focused:            mode === 'chat',
              scrollOffset,
              width:              rightPanelWidth,
              tab:                chatTab,
              notes,
              setNotes,
              isRepoInputMode:    repoInputMode,
              repoName:           currentRepoDisplay,
              agentTitle:         activeAgentTitle,
              agentId:            activeAgentId,
              visibleAgentsCount: VISIBLE_AGENTS,
              chatMenuOpen,
              chatMenuSel,
              chatVisibleRows:    CHAT_VISIBLE_ROWS
            })
          )
        ),

    React.createElement(Box, { width: '100%', height: 1, overflow: 'hidden', flexShrink: 0, minWidth: 0 },
      React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, '━'.repeat(200))
    ),

    React.createElement(Box, {
      width: '100%', height: 1, flexDirection: 'row',
      overflow: 'hidden', flexShrink: 0, minWidth: 0
    },
      !showHelp
        ? React.createElement(React.Fragment, null,
            React.createElement(Box, { flexShrink: 1, overflow: 'hidden', flexDirection: 'row', minWidth: 0 },
              React.createElement(Text, { color: 'cyan', bold: true, wrap: 'truncate' },   ' alt+g'),
              React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, ':toggle-view '),
              React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, ':graph '),
              React.createElement(Text, { color: 'cyan', bold: true, wrap: 'truncate' },   ' alt+e'),
              React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, ':chat '),
              React.createElement(Text, { color: 'cyan', bold: true, wrap: 'truncate' },   ' alt+h'),
              React.createElement(Text, {
                color:    graphVisible ? 'green' : 'gray',
                dimColor: !graphVisible,
                wrap:     'truncate'
              }, graphVisible ? ':grph✓ ' : ':grph✗ '),
              React.createElement(Text, { color: 'cyan', bold: true, wrap: 'truncate' },   ' alt+m'),
              React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, ':repo │')
            ),
            React.createElement(Box, { flexShrink: 0, flexDirection: 'row', minWidth: 0 },
              React.createElement(Text, {
                color:    mode === 'graph' ? 'magenta' : 'gray',
                bold:     mode === 'graph',
                dimColor: mode !== 'graph',
                wrap:     'truncate'
              }, ' [GRP]'),
              React.createElement(Text, {
                color:    mode === 'chat' ? 'magenta' : 'gray',
                bold:     mode === 'chat',
                dimColor: mode !== 'chat',
                wrap:     'truncate'
              }, ' [CHT]')
            ),
            React.createElement(Box, { flexGrow: 1, flexShrink: 1, overflow: 'hidden', minWidth: 0 },
              React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' },
                `  │ ↑↓←→:nav ↵:open-chat │ ?:help │ agents:${AGENTS.length}`
              )
            )
          )
        : React.createElement(Box, { flexGrow: 1, flexShrink: 1, overflow: 'hidden', minWidth: 0 },
            React.createElement(Text, { color: 'yellow', bold: true, wrap: 'truncate' }, '  [HELP MODE] '),
            React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, 'Press [ESC] or [?] to return')
          )
    )
  )
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