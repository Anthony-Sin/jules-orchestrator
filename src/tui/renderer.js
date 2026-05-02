// ── renderer.js ───────────────────────────────────────────────────
// Entry point for the Jules Colony TUI.
// Owns all stateful logic: sessions, chat, repo selection, keyboard nav.
//
// Layout split:
//   tui/components/table.js  — AgentRow, FillBar
//   tui/components/graph.js  — MiniGraph, PlannedGraphViewer  (hidden — returns null)
//   tui/components/chat.js   — ChatPanel
//   tui/components/help.js   — HelpScreen
//   tui/markdown.js          — unchanged

import { parseSourceDisplay, getActivities, sendMessage, listSources, deleteSession } from '../state/jules-api.js'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { render, Box, Text, useInput, useApp } from 'ink'
import TextInput from 'ink-text-input'
import { getSessions, getConfig, setConfig, store, removeSession } from '../state/store.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { dispatchLeadOrchestrator } from '../jules_lead_orchestrator/julesorchestrator.js'

// ── Component imports ─────────────────────────────────────────────
import { AgentRow, SubAgentRow, EmptySubAgentsRow, buildRows } from './components/table.js'
import { useTerminalSize } from './hooks.js'          // see note at bottom
import { MiniGraph, PlannedGraphViewer, GRAPH_NODE_W } from './components/graph.js'
import { ChatPanel } from './components/chat.js'
import { HelpScreen } from './components/help.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkgPath   = path.join(__dirname, '..', '..', 'package.json')
const pkg       = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
export const version = pkg.version

// ── Google Drive stubs ────────────────────────────────────────────
async function saveToDrive(_content) { return false }

// ── Dashboard ─────────────────────────────────────────────────────
export function Dashboard({ searchTerm = '' }) {
  const { exit } = useApp()
  const { columns, rows } = useTerminalSize()

  const [tick, setTick] = useState(0)

  // ── Table state ──────────────────────────────────────────────────
  const [sel, setSel]                 = useState(0)
  const [tableOffset, setTableOffset] = useState(0)
  const [expandedIds, setExpandedIds] = useState(new Set())

  const toggleExpand = useCallback((id) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // ── Graph state ──────────────────────────────────────────────────
  // graphViewMode / planNodeSel kept so graph.js can be re-enabled without touching this file
  const [graphSel, setGraphSel]           = useState(0)
  const [showGraph, setShowGraph]         = useState(false)   // ← starts hidden
  const [graphViewMode, setGraphViewMode] = useState('live')
  const [planNodeSel, setPlanNodeSel]     = useState(0)
  const savedDiagrams = store.get('architectureDiagrams') || []

  // ── Layout mode: 'table' | 'graph' | 'chat' ─────────────────────
  // Default is now always 'table'; graph requires explicit Alt+G
  const [mode, setMode] = useState('table')

  // ── Chat state ───────────────────────────────────────────────────
  const [chatInput, setChatInput]           = useState('')
  const [messages, setMessages]             = useState([])
  const [scrollOffset, setScrollOffset]     = useState(0)
  const [chatTab, setChatTab]               = useState('chat')
  const [chatMenuOpen, setChatMenuOpen]     = useState(false)
  const [chatMenuSel, setChatMenuSel]       = useState(0)
  const [chatTargetMode, setChatTargetMode] = useState('CREATE_ORCHESTRATOR')

  const [notes, setNotes] = useState(() => store.get('tuiNotes', ''))

  // ── Session tracking ─────────────────────────────────────────────
  const [selectedSessionId, setSelectedSessionId] = useState(null)
  const [lastActivityIds, setLastActivityIds]     = useState({})
  const [queuedMessages, setQueuedMessages]       = useState({})

  // ── Repo picker ──────────────────────────────────────────────────
  const [repoInputMode, setRepoInputMode] = useState(false)
  const [repoInput, setRepoInput]         = useState('')
  const [sourcesList, setSourcesList]     = useState([])
  const [sourceSel, setSourceSel]         = useState(0)

  // ── Status flash ─────────────────────────────────────────────────
  const [statusFlash, setStatusFlash] = useState('')
  const [showHelp, setShowHelp]       = useState(false)

  // ── Derived layout ───────────────────────────────────────────────
  const TERMINAL_ROWS = Math.max(10, rows - 1)
  const isWide        = columns >= 80

  const rightPanelWidth = isWide ? Math.floor(columns * 0.38) : columns
  const leftPanelWidth  = isWide ? columns - rightPanelWidth  : columns

  const showLeftPanel  = isWide || mode !== 'chat'
  const showRightPanel = isWide || mode === 'chat'

  const repoInputHeight     = repoInputMode ? 5 : 0
  const availableBodyHeight = TERMINAL_ROWS - (5 + repoInputHeight)

  // Graph is hidden until you decide — graphHeight is 0
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
  const CHAT_VISIBLE_ROWS = Math.max(1,
    availableBodyHeight - (chatFixedHeights + chatMenuHeight + inputExtraHeight))

  // ── Data ─────────────────────────────────────────────────────────
  const sessions  = getSessions() || []
  const AGENTS    = sessions
    .slice()
    .sort((a, b) => {
      const ta = new Date(a.lastUpdated || a.createdAt || 0).getTime()
      const tb = new Date(b.lastUpdated || b.createdAt || 0).getTime()
      return tb - ta
    })

  const orchAgents = AGENTS.filter(a =>
    a.type === 'orchestrator' || (a.title || '').toLowerCase().includes('orchestrator'))
  const subAgents  = AGENTS.filter(a =>
    !(a.type === 'orchestrator' || (a.title || '').toLowerCase().includes('orchestrator')))
  const graphNodes = [...orchAgents, ...subAgents]

  // ── Helpers ───────────────────────────────────────────────────────
  function flash(msg, ms = 2000) {
    setStatusFlash(msg)
    setTimeout(() => setStatusFlash(''), ms)
  }

  // ── Effects ──────────────────────────────────────────────────────

  // Tick for animations
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 200)
    return () => clearInterval(t)
  }, [])

  // Load repo sources
  useEffect(() => {
    listSources().then(res => setSourcesList(res || [])).catch(() => {})
  }, [])

  // Auto-close slash menu
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
    if (VISIBLE_AGENTS <= 0) return
    if (sel < tableOffset) setTableOffset(sel)
    else if (sel >= tableOffset + VISIBLE_AGENTS) setTableOffset(sel - VISIBLE_AGENTS + 1)
  }, [sel, VISIBLE_AGENTS, tableOffset])

  // Graph selection bounds
  useEffect(() => {
    if (graphNodes.length > 0 && graphSel >= graphNodes.length)
      setGraphSel(graphNodes.length - 1)
  }, [graphNodes.length])

  // Chat activity polling
  useEffect(() => {
    let active = true
    const poll = async () => {
      if (!active || mode !== 'chat' || !selectedSessionId) return
      try {
        const res  = await getActivities(selectedSessionId)
        const acts = res.activities || res || []
        if (!Array.isArray(acts) || acts.length === 0) return

        const newMessages = []
        const lastId      = lastActivityIds[selectedSessionId]
        let   foundNew    = false
        const sorted      = acts.sort((a, b) =>
          new Date(a.createTime || 0) - new Date(b.createTime || 0))

        for (const act of sorted) {
          if (!lastId || foundNew || act.name > lastId) {
            foundNew = true
            if (act.userMessaged?.userMessage?.trim())
              newMessages.push({ role: 'user', text: act.userMessaged.userMessage })
            else if (act.agentMessaged?.agentMessage?.trim())
              newMessages.push({ role: 'agent', text: act.agentMessaged.agentMessage })
            else if (act.originator === 'agent' || act.originator === 'system') {
              let text = act.description || ''
              if (act.planGenerated) text += '\nPlan: ' + JSON.stringify(act.planGenerated)
              if (text.trim()) newMessages.push({ role: act.originator, text })
            }
          }
        }

        if (newMessages.length > 0) {
          setMessages(m => [...m, ...newMessages])
          setLastActivityIds(prev => ({
            ...prev,
            [selectedSessionId]: sorted[sorted.length - 1].name
          }))
        } else if (!lastId && sorted.length > 0) {
          setLastActivityIds(prev => ({
            ...prev,
            [selectedSessionId]: sorted[sorted.length - 1].name
          }))
        }
      } catch (_) {}
    }
    const p = setInterval(poll, 5000)
    poll()
    return () => { active = false; clearInterval(p) }
  }, [mode, selectedSessionId, lastActivityIds])

  // Poll for new architecture diagrams
  const lastGraphUpdateRef = useRef(store.get('diagramLastUpdated') || 0)
  useEffect(() => {
    const interval = setInterval(() => {
      const storeUpdate = store.get('diagramLastUpdated') || 0
      if (storeUpdate > lastGraphUpdateRef.current) {
        lastGraphUpdateRef.current = storeUpdate
        setMessages(m => [...m, {
          role: 'system',
          text: 'magenta:➦ Diagram updated → see [ PLANNED ARCHITECTURE ]'
        }])
        // Only switch to graph if it's actually enabled
        if (showGraph) {
          setMode('graph')
          setGraphViewMode('plan')
          setPlanNodeSel(0)
        }
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [showGraph])

  // Drain queued messages once agent becomes available
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
    setChatTargetMode('TALK_TO_SELECTED_AGENT')
    setMode('chat')
    setScrollOffset(0)

    getActivities(agent.id).then(res => {
      const acts    = res.activities || res || []
      const history = []
      if (Array.isArray(acts)) {
        const sorted = acts.sort((a, b) =>
          new Date(a.createTime || 0) - new Date(b.createTime || 0))
        for (const act of sorted) {
          if (act.userMessaged?.userMessage?.trim())
            history.push({ role: 'user', text: act.userMessaged.userMessage })
          else if (act.agentMessaged?.agentMessage?.trim())
            history.push({ role: 'agent', text: act.agentMessaged.agentMessage })
          else if (act.originator === 'agent' || act.originator === 'system') {
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

    // ── Repo picker intercepts all keys ──
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

    // ── Session Deletion ──
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

    // ── Queue Item Deletion ──
    if (key.meta && input && input >= '1' && input <= '9') {
      const idx = parseInt(input, 10) - 1
      const entries = Object.entries(queuedMessages)
      if (idx >= 0 && idx < Math.min(entries.length, 9)) {
        const [idToRemove] = entries[idx]
        setQueuedMessages(prev => {
          const next = { ...prev }
          delete next[idToRemove]
          return next
        })
        flash(`Deleted queued message for ${idToRemove.substring(0, 6)}`)
      }
      return
    }

    // ── Mode switches ──
    if (key.meta && input === 't') { setMode('table'); return }
    if (key.meta && input === 'g') {
      if (columns < 100 || rows < 15) {
        flash('Terminal too small for Graph View (need 100x15)'); return
      }
      if (mode !== 'graph') {
        setShowGraph(true)
        setMode('graph')
      } else {
        setGraphViewMode(v => v === 'live' ? 'plan' : 'live')
      }
      return
    }
    if (key.meta && input === 'e') { setMode('chat'); setScrollOffset(0); return }
    if (key.meta && input === 'n') {
      setMode('chat')
      setChatTab(t => t === 'chat' ? 'notes' : 'chat')
      return
    }
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
      if (columns < 100 || rows < 15) { flash('Terminal too small for Graph View (need 100x15)'); return }
      setShowGraph(true); setMode('graph'); return
    }
    if (key.f3) { setMode('chat'); setScrollOffset(0); return }

    if (key.escape) { setMode('table'); setChatMenuOpen(false); return }
    if (key.tab) {
      setMode(m => m === 'table' ? (showGraph ? 'graph' : 'chat') : m === 'graph' ? 'chat' : 'table')
      setScrollOffset(0)
      return
    }

    // ── Chat mode keys ────────────────────────────────────────────
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
      if (key.shift && (key.leftArrow || key.rightArrow)) {
        setChatTab(t => t === 'chat' ? 'notes' : 'chat'); return
      }
      if (key.upArrow)   { setScrollOffset(o => o + 1); return }
      if (key.downArrow) { setScrollOffset(o => Math.max(0, o - 1)); return }
      if (key.pageUp)    { setScrollOffset(o => o + 5); return }
      if (key.pageDown)  { setScrollOffset(o => Math.max(0, o - 5)); return }
      return
    }

    // ── Graph mode keys ───────────────────────────────────────────
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
        if (key.rightArrow) {
          if (selCol < tiers[selTier].length - 1)
            setPlanNodeSel(nodes.indexOf(tiers[selTier][selCol + 1]))
          return
        }
        if (key.upArrow) {
          if (selTier > 0) {
            const parents2 = incoming[selNodeLabel] || []
            if (parents2.length > 0) setPlanNodeSel(nodes.indexOf(parents2[0]))
            else setPlanNodeSel(nodes.indexOf(tiers[selTier - 1][Math.min(selCol, tiers[selTier - 1].length - 1)]))
          }
          return
        }
        if (key.downArrow) {
          if (selTier < tiers.length - 1) setPlanNodeSel(nodes.indexOf(tiers[selTier + 1][0]))
          return
        }
        return
      }

      // Live view nav
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

    // ── Table mode keys ───────────────────────────────────────────
    if (mode === 'table') {
      if (key.upArrow)   { setSel(i => Math.max(0, i - 1)); return }
      if (key.downArrow) { setSel(i => Math.min(Math.max(0, AGENTS.length - 1), i + 1)); return }
      if (key.rightArrow) {
        const agent = AGENTS[sel]
        if (agent && (Array.isArray(agent.subAgents) || agent.isOrchestrator || agent.type === 'orchestrator')) {
          toggleExpand(agent.id)
        }
        return
      }
      if (key.leftArrow) {
        const agent = AGENTS[sel]
        if (agent) setExpandedIds(prev => { const next = new Set(prev); next.delete(agent.id); return next })
        return
      }
      if (key.return)    { const agent = AGENTS[sel]; if (agent) openAgentChat(agent) }
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
      setChatInput(''); setScrollOffset(0); return
    }

    if (chatTargetMode === 'CREATE_ORCHESTRATOR' || !AGENTS || AGENTS.length === 0 ||
        (chatTargetMode === 'TALK_TO_SELECTED_AGENT' && !selectedSessionId)) {
      setChatInput(''); setScrollOffset(0)
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
      : AGENTS.find(a => a.id === selectedSessionId)

    if (!targetAgent) {
      setMessages(m => [...m, { role: 'system', text: 'Error: No agent found.' }]); return
    }

    if (targetAgent.state === 'IN_PROGRESS') {
      setQueuedMessages(prev => ({ ...prev, [targetAgent.id]: val.trim() }))
      setMessages(m => [...m,
        { role: 'user',   text: val.trim() },
        { role: 'system', text: `Message queued — agent ${targetAgent.id.substring(0, 6)} is busy` }
      ])
      setChatInput(''); setScrollOffset(0); return
    }

    setMessages(m => [...m,
      { role: 'user',   text: val.trim() },
      { role: 'system', text: 'Sending…' }
    ])
    setChatInput(''); setScrollOffset(0)
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
    // ── Queue Overlay ──
    queuedEntries.length > 0 && React.createElement(Box, {
      position: 'absolute',
      right: 1,
      top: 1,
      flexDirection: 'column',
      borderStyle: 'single',
      borderColor: 'magenta',
      paddingX: 1,
      backgroundColor: '#000000',
      zIndex: 100
    },
      React.createElement(Text, { color: 'magentaBright', bold: true }, ' QUEUED MESSAGES '),
      queuedEntries.slice(0, 9).map(([id, msg], idx) => {
        const ag = AGENTS.find(a => a.id === id)
        const title = ag ? (ag.title || id.substring(0, 6)) : id.substring(0, 6)
        const preview = msg.length > 20 ? msg.substring(0, 17) + '...' : msg
        return React.createElement(Text, { key: id, color: 'gray' },
          React.createElement(Text, { color: 'white' }, `[alt+${idx + 1}] `),
          React.createElement(Text, { color: 'cyan' }, `${title}: `),
          `"${preview}"`
        )
      })
    ),

    // ── Top bar ──
    React.createElement(Box, {
      flexDirection: 'row', width: '100%', height: 1,
      overflow: 'hidden', flexShrink: 0, justifyContent: 'space-between'
    },
      React.createElement(Box, { flexShrink: 1, overflow: 'hidden', minWidth: 0, flexDirection: 'row' },
        React.createElement(Text, { color: 'whiteBright', bold: true, wrap: 'truncate' }, 'JULES COLONY '),
        React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, '│ '),
        React.createElement(Text, {
          color: currentRepoDisplay === 'NOT SET' ? 'red' : 'cyan',
          wrap: 'truncate'
        }, `~ ${currentRepoDisplay} `),
        React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, '│ '),
        React.createElement(Text, { color: 'blue', dimColor: true, wrap: 'truncate' }, 'powered by jules '),
        statusFlash
          ? React.createElement(Text, { color: 'green', wrap: 'truncate' }, `│ ${statusFlash}`)
          : null
      ),
      React.createElement(Box, { flexShrink: 0, flexDirection: 'row', minWidth: 0 },
        React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, '│ '),
        React.createElement(Text, { color: 'greenBright', wrap: 'truncate' },
          (() => {
            const n = AGENTS.filter(a =>
              ['IN_PROGRESS','PLANNING','AWAITING_USER_FEEDBACK','AWAITING_PLAN_APPROVAL'].includes(a.state)
            ).length
            return `✓ ${n} active ${n === 1 ? 'agent' : 'agents'} `
          })()
        )
      )
    ),

    // ── Top bar / body separator ──
    React.createElement(Box, {
      width: '100%', height: 1, overflow: 'hidden', flexShrink: 0, minWidth: 0
    },
      React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' },
        '─'.repeat(200))
    ),

    // ── Repo picker ──
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
                color: dropdownOffset + idx === sourceSel ? 'cyanBright' : 'gray',
                wrap:  'truncate'
              },
                dropdownOffset + idx === sourceSel
                  ? '▶ ' + (s.displayName || s.name)
                  : '  ' + (s.displayName || s.name)
              )
            )
      )
    ),

    // ── Padding row ──
    React.createElement(Box, { width: '100%', height: 1, flexShrink: 0 }),

    // ── Body ──
    showHelp
      ? React.createElement(HelpScreen)
      : React.createElement(Box, {
          flexDirection: 'row',
          height: availableBodyHeight,
          overflow: 'hidden', minWidth: 0, minHeight: 0
        },

          // Left panel
          showLeftPanel && React.createElement(Box, {
            flexDirection: 'column',
            width: leftPanelWidth,
            paddingRight: isWide ? 1 : 0,
            overflow: 'hidden', minWidth: 0, minHeight: 0
          },
            // ── Always show table; graph components return null when hidden ──
            mode === 'table' || !graphVisible
              ? React.createElement(Box, { flexDirection: 'column', flexGrow: 1, overflow: 'hidden' },
                  React.createElement(Box, { height: 1, justifyContent: 'center' },
                    React.createElement(Text, { color: mode === 'table' ? 'cyanBright' : 'gray', bold: mode === 'table' },
                      `  AGENT LIST  [${AGENTS.length > 0 ? sel + 1 : 0}/${AGENTS.length}]  ·  ${currentRepoDisplay}`)
                  ),
                  React.createElement(Box, { height: 1, overflow: 'hidden' },
                    React.createElement(Text, { color: 'gray', dimColor: true },
                      '─'.repeat(100))
                  ),
                  AGENTS.length === 0
                    ? React.createElement(Box, { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
                        React.createElement(Text, { color: 'gray', dimColor: true }, 'No agents yet'))
                    : (() => {
                        const allRows = buildRows(AGENTS, expandedIds)
                        const sessionRows = allRows.filter(r => r.type === 'session')
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
                          if (row.type === 'empty')
                            return React.createElement(EmptySubAgentsRow, { key: 'empty-' + row.parentId })
                          if (row.type === 'sub')
                            return React.createElement(SubAgentRow, { key: 'sub-' + (row.data.id || i), agent: row.data, tick, isLast: row.isLast })
                          const agentIdx = AGENTS.indexOf(row.data)
                          return React.createElement(AgentRow, {
                            key:      row.data.id,
                            agent:    row.data,
                            selected: agentIdx === sel,
                            tick,
                            isDimmed: mode !== 'table',
                            expanded: row.expanded,
                          })
                        })
                      })()
                )
              : (graphViewMode === 'live'
                  ? React.createElement(MiniGraph, {
                      tick, isDimmed: mode !== 'graph',
                      height: graphHeight, width: leftPanelWidth,
                      sessions: AGENTS, graphSel,
                      onGraphNav: setGraphSel,
                      onGraphSelect: (idx) => {
                        setGraphSel(idx)
                        const agent = graphNodes[idx]
                        if (agent) openAgentChat(agent)
                      }
                    })
                  : React.createElement(PlannedGraphViewer, {
                      diagram: savedDiagrams[0],
                      selectedNodeIdx: planNodeSel,
                      height: graphHeight,
                      isDimmed: mode !== 'graph'
                    })
                )
          ),

          // Right panel (chat)
          showRightPanel && React.createElement(Box, {
            flexDirection: 'column',
            width: rightPanelWidth,
            overflow: 'hidden', minWidth: 0, minHeight: 0
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
              chatTargetMode,
              visibleAgentsCount: VISIBLE_AGENTS,
              chatMenuOpen,
              chatMenuSel,
              chatVisibleRows:    CHAT_VISIBLE_ROWS
            })
          )
        ),

    // ── Bottom separator ──
    React.createElement(Box, { width: '100%', height: 1, overflow: 'hidden', flexShrink: 0, minWidth: 0 },
      React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, '━'.repeat(200))
    ),

    // ── Status bar ──
    React.createElement(Box, {
      width: '100%', height: 1, flexDirection: 'row',
      overflow: 'hidden', flexShrink: 0, minWidth: 0
    },
      !showHelp
        ? React.createElement(React.Fragment, null,
            React.createElement(Box, {
              flexGrow: 1, flexShrink: 1, overflow: 'hidden',
              flexDirection: 'row', minWidth: 0, justifyContent: 'space-between'
            },
              React.createElement(Box, { flexDirection: 'row', flexShrink: 1, minWidth: 0, overflow: 'hidden' },
                React.createElement(Text, { color: 'whiteBright', bold: true, wrap: 'truncate' }, ' alt+g'),
                React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, ' :graph '),
                React.createElement(Text, { color: 'whiteBright', bold: true, wrap: 'truncate' }, ' alt+e'),
                React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, ' :chat '),
                React.createElement(Text, { color: 'whiteBright', bold: true, wrap: 'truncate' }, ' alt+m'),
                React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, ' :repo '),
                React.createElement(Text, { color: 'whiteBright', bold: true, wrap: 'truncate' }, ' alt+d'),
                React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, ' :del │ '),
                React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, '↑↓:nav →:exp ←:col ↵:chat │ '),
                React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, `agents:${AGENTS.length}`)
              ),
              React.createElement(Box, { flexShrink: 0, flexDirection: 'row' },
                React.createElement(Text, { color: 'cyanBright', bold: true },
                  mode === 'graph' ? ' [GRP]' : mode === 'chat' ? ' [CHT]' : ' [TBL]')
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