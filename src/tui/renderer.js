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
import { useTerminalSize, MiniGraph, ChatPanel, HelpScreen, PlannedGraphViewer, GRAPH_NODE_W } from './components.js'

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
  const [planNodeSel, setPlanNodeSel]     = useState(0) // <-- CHANGED THIS
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

  // --- CLEAN NATIVE WRAPPING MATH (CAPPED) ---
  const chatWrapLimit = Math.max(10, rightPanelWidth - 6) 
  
  const inputLines = (mode === 'chat' && chatTab === 'chat') 
    ? Math.max(1, Math.ceil(chatInput.length / chatWrapLimit)) 
    : 1
    
  // Cap the extra height at 3 (which means 4 lines total)
  const inputExtraHeight = Math.min(3, inputLines - 1) 
  // -------------------------------------------

  const chatFixedHeights  = 4
  const chatMenuHeight    = chatMenuOpen && chatTab === 'chat' ? 3 : 0
  
  const CHAT_VISIBLE_ROWS = Math.max(1, availableBodyHeight - (chatFixedHeights + chatMenuHeight + inputExtraHeight))
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

  useEffect(() => {
    if (chatMenuOpen && !chatInput.startsWith('/')) {
      setChatMenuOpen(false)
    } else if (mode === 'chat' && chatTab === 'chat' && chatInput === '/') {
      setChatMenuOpen(true)
      setChatMenuSel(0)
    }
  }, [chatInput, chatMenuOpen, mode, chatTab])


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
  
  // Initialize to the CURRENT timestamp so it doesn't trigger on old diagrams!
  const lastGraphUpdateRef = useRef(store.get('diagramLastUpdated') || 0);

  // Poll for architecture graph updates to notify the user in chat
  useEffect(() => {
    const interval = setInterval(() => {
      const storeUpdate = store.get('diagramLastUpdated') || 0;
      
      if (storeUpdate > lastGraphUpdateRef.current) {
        lastGraphUpdateRef.current = storeUpdate;
        
        setMessages(m => [
          ...m, 
          { role: 'system', text: 'magenta:➦ Diagram updated → see [ PLANNED ARCHITECTURE ]' }
        ]);

        // Auto-switch to the new plan diagram
        setMode('graph');
        setGraphViewMode('plan');
        setPlanNodeSel(0); 
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
    setChatTargetMode('TALK_TO_SELECTED_AGENT') // <--- ADD THIS LINE
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
    if (key.meta && input === '?') { setShowHelp(v => !v); return }
    if (showHelp && (key.escape || (key.meta && input === '?'))) { setShowHelp(false); return }
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
            setMessages(m => [...m, { role: 'system', text: '[SYSTEM] Warning: This will create a new session/task.' }])
          return
        }
        return
      }

      // removed slash trigger
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
      // ── PLAN VIEW nav ────────────────────────────────────────────
      if (graphViewMode === 'plan') {
        const currentDiagram = savedDiagrams[0]
        const nodes = currentDiagram?.nodes || []
        const nodeCount = nodes.length
        if (nodeCount === 0) return

        // Rebuild the same tier layout the viewer uses so CPR matches exactly
        const conns = currentDiagram?.connections || []
        const adj = {}; const inDeg = {}
        nodes.forEach(n => { adj[n] = []; inDeg[n] = 0 })
        conns.forEach(c => {
          const [u, v] = c.split('->').map(s => s.trim())
          if (adj[u] && inDeg[v] !== undefined) { adj[u].push(v); inDeg[v]++ }
        })
        const tiers = []
        let cur = nodes.filter(n => inDeg[n] === 0)
        if (cur.length === 0) cur = [nodes[0]]
        const vis = new Set(cur)
        while (cur.length > 0) {
          tiers.push(cur)
          const nxt = []
          cur.forEach(u => adj[u].forEach(v => { if (!vis.has(v)) { vis.add(v); nxt.push(v) } }))
          cur = nxt
        }
        const uncon = nodes.filter(n => !vis.has(n))
        if (uncon.length > 0) tiers.push(uncon)

        // Find which tier+col the currently selected node is in
        let selTier = 0; let selCol = 0
        outer: for (let t = 0; t < tiers.length; t++) {
          for (let c = 0; c < tiers[t].length; c++) {
            if (nodes.indexOf(tiers[t][c]) === planNodeSel) {
              selTier = t; selCol = c; break outer
            }
          }
        }

        if (key.leftArrow) {
          // Move left within the same tier (clamp — no row wrapping)
          if (selCol > 0) {
            const newNode = tiers[selTier][selCol - 1]
            setPlanNodeSel(nodes.indexOf(newNode))
          }
          return
        }
        if (key.rightArrow) {
          if (selCol < tiers[selTier].length - 1) {
            const newNode = tiers[selTier][selCol + 1]
            setPlanNodeSel(nodes.indexOf(newNode))
          }
          return
        }
        if (key.upArrow) {
          // Move up a tier, keep same column if possible
          if (selTier > 0) {
            const targetCol = Math.min(selCol, tiers[selTier - 1].length - 1)
            setPlanNodeSel(nodes.indexOf(tiers[selTier - 1][targetCol]))
          }
          return
        }
        if (key.downArrow) {
          // Move down a tier, keep same column if possible
          if (selTier < tiers.length - 1) {
            const targetCol = Math.min(selCol, tiers[selTier + 1].length - 1)
            setPlanNodeSel(nodes.indexOf(tiers[selTier + 1][targetCol]))
          }
          return
        }
        return
      }

      // ── LIVE VIEW nav ─────────────────────────────────────────────
      const total = graphNodes.length
      if (total === 0) return

      const safeWidth   = leftPanelWidth || 80
      const usableWidth = Math.max(20, safeWidth - 4)
      const CPR         = Math.max(1, Math.floor(usableWidth / (GRAPH_NODE_W + 1)))
      const totalRows   = Math.ceil(total / CPR)
      const currentRow  = Math.floor(graphSel / CPR)
      const currentCol  = graphSel % CPR

      if (key.leftArrow) {
        // Stay on same row — clamp at column 0
        if (currentCol > 0) setGraphSel(currentRow * CPR + currentCol - 1)
        return
      }
      if (key.rightArrow) {
        // Stay on same row — clamp at last node in this row
        const rowEnd = Math.min(CPR - 1, total - 1 - currentRow * CPR)
        if (currentCol < rowEnd) setGraphSel(currentRow * CPR + currentCol + 1)
        return
      }
      if (key.upArrow) {
        if (currentRow > 0) {
          // Keep same column, but clamp to last node if new row is shorter
          const newIdx = (currentRow - 1) * CPR + currentCol
          setGraphSel(Math.min(newIdx, total - 1))
        }
        return
      }
      if (key.downArrow) {
        if (currentRow < totalRows - 1) {
          const newIdx = (currentRow + 1) * CPR + currentCol
          setGraphSel(Math.min(newIdx, total - 1))
        }
        return
      }
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
        setChatTargetMode('TALK_TO_SELECTED_AGENT')
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
      : AGENTS.find(a => a.id === selectedSessionId) // <--- REPLACE 'AGENTS[sel]' WITH THIS

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
                      diagram: savedDiagrams[0], 
                      selectedNodeIdx: planNodeSel, // <-- CHANGED THIS
                      height: graphHeight, 
                      isDimmed: mode !== 'graph'
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
              React.createElement(Text, { color: 'yellowBright', bold: true, wrap: 'truncate' }, ' Alt+G'),
              React.createElement(Text, { color: 'gray', wrap: 'truncate' }, ' view:graph '),
              React.createElement(Text, { color: 'yellowBright', bold: true, wrap: 'truncate' }, ' Alt+E'),
              React.createElement(Text, { color: 'gray', wrap: 'truncate' }, ' view:chat '),
              React.createElement(Text, { color: 'yellowBright', bold: true, wrap: 'truncate' }, ' Alt+H'),
              React.createElement(Text, {
                color:    graphVisible ? 'greenBright' : 'red',
                bold:     true,
                wrap:     'truncate'
              }, graphVisible ? ' grph✓ ' : ' grph✗ '),
              React.createElement(Text, { color: 'yellowBright', bold: true, wrap: 'truncate' }, ' Alt+M'),
              React.createElement(Text, { color: 'gray', wrap: 'truncate' }, ' repo │ ')
            ),
            React.createElement(Box, { flexShrink: 0, flexDirection: 'row', minWidth: 0 },
              React.createElement(Text, {
                color:    mode === 'graph' ? 'black' : 'gray',
                backgroundColor: mode === 'graph' ? 'cyanBright' : undefined,
                bold:     mode === 'graph',
                dimColor: mode !== 'graph',
                wrap:     'truncate'
              }, mode === 'graph' ? ' [ GRAPH ] ' : ' [ GRAPH ] '),
              React.createElement(Text, {
                color:    mode === 'chat' ? 'black' : 'gray',
                backgroundColor: mode === 'chat' ? 'cyanBright' : undefined,
                bold:     mode === 'chat',
                dimColor: mode !== 'chat',
                wrap:     'truncate'
              }, mode === 'chat' ? ' [ CHAT ] ' : ' [ CHAT ] ')
            ),
            React.createElement(Box, { flexGrow: 1, flexShrink: 1, overflow: 'hidden', minWidth: 0 },
              React.createElement(Text, { color: 'gray', wrap: 'truncate' },
                `  │ ↑↓←→:nav ↵:open │ Alt+?:help │ agents:${AGENTS.length}`
              )
            )
          )
        : React.createElement(Box, { flexGrow: 1, flexShrink: 1, overflow: 'hidden', minWidth: 0 },
            React.createElement(Text, { color: 'yellow', bold: true, wrap: 'truncate' }, '  [HELP MODE] '),
            React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, 'Press [ESC] or [Alt+?] to return')
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