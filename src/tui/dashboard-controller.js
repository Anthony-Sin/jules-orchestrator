import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { getSessions, store } from '../state/store.js'
import { sendMessage } from '../state/jules-api.js'
import { useSessionManager, sortSessionsByRecent } from './hooks/useSessionManager.js'
import { useAgentActions } from './hooks/useAgentActions.js'

export { extractToolCallsFromMessage } from './hooks/useSessionManager.js'

export async function saveToDrive(_content) {
  return false
}

export function useDashboardController() {

  // ── UI / Navigation state ─────────────────────────────────────────
  const [tick, setTick] = useState(0)
  const [sel, setSel] = useState(0)
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

  const [graphSel, setGraphSel] = useState(0)
  const [showGraph, setShowGraph] = useState(false)
  const [graphViewMode, setGraphViewMode] = useState('live')
  const [planNodeSel, setPlanNodeSel] = useState(0)
  const [savedDiagrams, setSavedDiagrams] = useState(() => store.get('architectureDiagrams') || [])

  const [mode, setMode] = useState('table')
  const [lastLeftMode, setLastLeftMode] = useState('table')
  useEffect(() => {
    if (['table', 'graph', 'diff'].includes(mode)) setLastLeftMode(mode)
  }, [mode])

  // ── Diff state ────────────────────────────────────────────────────
  const [diffFileSel, setDiffFileSel] = useState(0)
  const [diffScrollOffset, setDiffScrollOffset] = useState(0)
  const [diffFocus, setDiffFocus] = useState('files')
  const [diffFileCount, setDiffFileCount] = useState(0)
  const [diffRefreshBySession, setDiffRefreshBySession] = useState({})

  useEffect(() => {
    setDiffScrollOffset(0)
  }, [diffFileSel])

  // ── Chat state ────────────────────────────────────────────────────
  const [chatInput, setChatInput] = useState('')
  const [messages, setMessages] = useState([])
  const [scrollOffset, setScrollOffset] = useState(0)
  const sessionScrollRef = useRef({})
  const sessionCursorRef = useRef({})

  const [chatTab, setChatTab] = useState('chat')
  const [chatMenuOpen, setChatMenuOpen] = useState(false)
  const [chatMenuSel, setChatMenuSel] = useState(0)
  const [chatTargetMode, setChatTargetMode] = useState('CREATE_ORCHESTRATOR')
  const [startDialogOpen, setStartDialogOpen] = useState(false)
  const [startDialogMode, setStartDialogMode] = useState('CREATE_ORCHESTRATOR')

  const [expandedMessages, setExpandedMessages] = useState(new Set())
  const [chatCursorLine, setChatCursorLine] = useState(0)

  const toggleMessageExpand = useCallback((idx) => {
    setExpandedMessages(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }, [])

  const resetExpandedMessages = useCallback(() => {
    setExpandedMessages(new Set())
  }, [])

  // ── Notes ─────────────────────────────────────────────────────────
  const [notes, setNotes] = useState(() => store.get('tuiNotes', ''))
  useEffect(() => { store.set('tuiNotes', notes) }, [notes])

  // ── Session selection ─────────────────────────────────────────────
  const [selectedSessionId, setSelectedSessionId] = useState(null)
  const [queuedMessages, setQueuedMessages] = useState({})
  const [queuedCycleIdx, setQueuedCycleIdx] = useState(0)
  const [promptPreview, setPromptPreview] = useState(null)
  const [latestProgress, setLatestProgress] = useState(null)

  const selectedSessionIdRef = useRef(selectedSessionId)
  useEffect(() => { selectedSessionIdRef.current = selectedSessionId }, [selectedSessionId])

  // Save scroll/cursor position per session
  const lastSessionIdRef = useRef(selectedSessionId)
  useEffect(() => {
    if (lastSessionIdRef.current !== selectedSessionId) {
      lastSessionIdRef.current = selectedSessionId
      return
    }
    const id = selectedSessionId
    if (id) {
      sessionScrollRef.current[id] = scrollOffset
      sessionCursorRef.current[id] = chatCursorLine
    }
  }, [scrollOffset, chatCursorLine, selectedSessionId])

  useEffect(() => {
    setDiffScrollOffset(0)
  }, [selectedSessionId])

  // ── Repo / sources state ──────────────────────────────────────────
  const [repoInputMode, setRepoInputMode] = useState(false)
  const [repoInput, setRepoInput] = useState('')
  const [sourcesList, setSourcesList] = useState([])
  const [sourceSel, setSourceSel] = useState(0)

  // ── Flash / help ──────────────────────────────────────────────────
  const [statusFlash, setStatusFlash] = useState('')
  const [showHelp, setShowHelp] = useState(false)

  function flash(msg, ms = 2000) {
    setStatusFlash(msg)
    setTimeout(() => setStatusFlash(''), ms)
  }

  // ── Sessions data ─────────────────────────────────────────────────
  const [sessionsData, setSessionsData] = useState(() => getSessions() || [])
  const [sortedIds, setSortedIds] = useState(() => sortSessionsByRecent(getSessions() || []).map(s => s.id))

  // ── Tick (spinner / animation) ────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 200)
    return () => clearInterval(t)
  }, [])

  // ── Chat menu auto-open on "/" ────────────────────────────────────
  useEffect(() => {
    if (chatMenuOpen && chatInput !== '/') {
      setChatMenuOpen(false)
    } else if (mode === 'chat' && chatTab === 'chat' && chatInput === '/') {
      setChatMenuOpen(true)
      setChatMenuSel(0)
    }
  }, [chatInput, chatMenuOpen, mode, chatTab])

  // ── Session manager (sync + polling + tool execution) ─────────────
  const {
    refreshLocalSessions,
    loadSessionActivities,
    buildDisplayMessages,
    sessionHistoryCacheRef,
  } = useSessionManager({
    mode,
    selectedSessionIdRef,
    setSessionsData,
    setSortedIds,
    setMessages,
    setLatestProgress,
    setDiffRefreshBySession,
    setSourcesList,
    setSavedDiagrams,
    setMode,
    setGraphViewMode,
    setPlanNodeSel,
    showGraph,
  })

  // ── FIX #2: AGENTS with sub-agent hierarchy ───────────────────────
  // Previously AGENTS was a flat list and sub-agents were never linked
  // to their orchestrator parent. buildRows() looks for agent.subAgents[]
  // but nothing ever populated it. Now we derive that from parentOrchestratorId
  // which JulesTools.js already sets on every dispatched sub-agent.
  const AGENTS = useMemo(() => {
    const dataMap = {}
    sessionsData.forEach(s => { dataMap[s.id] = s })

    // Build ordered flat list (preserving sort order)
    const mapped = []
    const seen = new Set()

    sessionsData.forEach(s => {
      if (!sortedIds.includes(s.id)) { mapped.push(s); seen.add(s.id) }
    })
    sortedIds.forEach(id => {
      if (dataMap[id] && !seen.has(id)) { mapped.push(dataMap[id]); seen.add(id) }
    })

    // Attach sub-agents to their orchestrator parents.
    // A session is an orchestrator if its type is 'orchestrator' OR its title
    // starts with 'ORCHESTRATOR—' (set by dispatchLeadOrchestrator).
    return mapped.map(agent => {
      const isOrch =
        agent.type === 'orchestrator' ||
        (agent.title || '').startsWith('ORCHESTRATOR—')

      if (isOrch) {
        const subs = mapped.filter(a => a.parentOrchestratorId === agent.id)
        return { ...agent, subAgents: subs }
      }
      return agent
    })
  }, [sessionsData, sortedIds])

  // Separate lists for graph view
  const orchAgents = AGENTS.filter(a =>
    a.type === 'orchestrator' || (a.title || '').startsWith('ORCHESTRATOR—'))
  const subAgents = AGENTS.filter(a =>
    !(a.type === 'orchestrator' || (a.title || '').startsWith('ORCHESTRATOR—')))
  const graphNodes = [...orchAgents, ...subAgents]

  const selectedAgent = useMemo(
    () => selectedSessionId ? AGENTS.find(a => a.id === selectedSessionId) : null,
    [AGENTS, selectedSessionId]
  )

  const showApproveHint = selectedAgent?.state === 'AWAITING_PLAN_APPROVAL'

  // Clamp graph selection
  useEffect(() => {
    if (graphNodes.length > 0 && graphSel >= graphNodes.length) {
      setGraphSel(graphNodes.length - 1)
    }
  }, [graphNodes.length, graphSel])

  // ── Agent actions (handleSend, openAgentChat, queued msgs) ────────
  const {
    agentsRef,
    pendingSendsRef,
    pendingTimeoutsRef,
    openAgentChat,
    handleSend,
    handleRepoSubmit,
  } = useAgentActions({
    AGENTS,
    selectedSessionId,
    selectedSessionIdRef,
    startDialogOpen,
    startDialogMode,
    chatTargetMode,
    sessionScrollRef,
    sessionCursorRef,
    sessionHistoryCacheRef,
    refreshLocalSessions,
    loadSessionActivities,
    buildDisplayMessages,
    resetExpandedMessages,
    setSelectedSessionId,
    setChatTargetMode,
    setMode,
    setStartDialogOpen,
    setStartDialogMode,
    setScrollOffset,
    setChatCursorLine,
    setChatInput,
    setMessages,
    setLatestProgress,
    setQueuedMessages,
    setRepoInputMode,
  })

  // ── Queued message sender ─────────────────────────────────────────
  // Fires queued messages once target agent leaves IN_PROGRESS
  useEffect(() => {
    for (const [id, msgs] of Object.entries(queuedMessages)) {
      if (!msgs || msgs.length === 0) continue
      const msg = msgs[0]

      const agent = agentsRef.current.find(a => a.id === id)
      if (agent && agent.state !== 'IN_PROGRESS' && !pendingSendsRef.current.has(id)) {
        pendingSendsRef.current.add(id)

        const tId = setTimeout(() => {
          sendMessage(id, msg).catch(() => {})
          setMessages(m => {
            if (selectedSessionIdRef.current !== id) return m
            return [...m, { role: 'system', text: `[SYSTEM] Sent queued message to ${id}` }]
          })
          setQueuedMessages(prev => {
            const nextQueue = { ...prev }
            if (nextQueue[id]) {
              const updated = [...nextQueue[id]]
              updated.shift()
              if (updated.length === 0) delete nextQueue[id]
              else nextQueue[id] = updated
            }
            return nextQueue
          })
          pendingSendsRef.current.delete(id)
          pendingTimeoutsRef.current.delete(tId)
        }, 5000)

        pendingTimeoutsRef.current.add(tId)
      }
    }
  }, [queuedMessages, AGENTS, agentsRef, pendingSendsRef, pendingTimeoutsRef, selectedSessionIdRef, setMessages, setQueuedMessages])

  const diffRefreshToken = selectedSessionId ? (diffRefreshBySession[selectedSessionId] || 0) : 0

  // ── Return ────────────────────────────────────────────────────────
  return {
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
    notes, setNotes,
    selectedSessionId, setSelectedSessionId,
    latestProgress: selectedAgent && ['IN_PROGRESS', 'PLANNING'].includes(selectedAgent.state)
      ? (latestProgress || 'Thinking...')
      : null,
    setLatestProgress,
    expandedMessages, toggleMessageExpand,
    chatCursorLine, setChatCursorLine,
    queuedMessages, setQueuedMessages,
    queuedCycleIdx, setQueuedCycleIdx,
    promptPreview, setPromptPreview,
    repoInputMode, setRepoInputMode,
    repoInput, setRepoInput,
    sourcesList, setSourcesList,
    sourceSel, setSourceSel,
    statusFlash, setStatusFlash, flash,
    showHelp, setShowHelp,
    AGENTS,
    graphNodes,
    openAgentChat, handleSend, handleRepoSubmit,
  }
}