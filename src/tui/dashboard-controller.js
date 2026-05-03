import { getAllActivities, sendMessage, listSources, listAllSessions, approvePlan, createSession } from '../state/jules-api.js'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { getSessions, getConfig, setConfig, store, removeSession, upsertSession } from '../state/store.js'
import { dispatchLeadOrchestrator } from '../jules_lead_orchestrator/julesorchestrator.js'
import fs from 'fs'

export async function saveToDrive(_content) {
  return false
}

export function extractToolCallsFromMessage(msgText) {
  try {
    if (!msgText.includes('"function"')) return msgText

    let jsonStr = ''
    const codeBlockRegex = /```(?:json)?\s*(\[\s*\{[\s\S]*?\}\s*\])\s*```/
    const match = codeBlockRegex.exec(msgText)
    if (match) {
      jsonStr = match[1]
    } else {
      const start = msgText.indexOf('[{')
      const end = msgText.lastIndexOf('}]')
      if (start !== -1 && end !== -1 && end > start) {
        const potentialJson = msgText.substring(start, end + 2)
        try {
          JSON.parse(potentialJson)
          jsonStr = potentialJson
        } catch (_) {}
      }
    }

    if (jsonStr) {
      const parsedArr = JSON.parse(jsonStr)
      if (Array.isArray(parsedArr)) {
        const toolNames = []
        for (const tc of parsedArr) {
          if (tc && tc.function && tc.function.name) {
            let name = tc.function.name
            if (name === 'dispatch_sub_agent') {
              try {
                const args = JSON.parse(tc.function.arguments)
                name = `dispatch_sub_agent (${args.module_name})`
              } catch (_) {}
            }
            toolNames.push(name)
          }
        }
        if (toolNames.length > 0) {
          msgText = msgText.replace(jsonStr, `\n\n[TOOL CALLS: ${toolNames.join(', ')}]\n\n`).trim()
        }
      }
    }
  } catch (_) {}

  return msgText
}

function activitiesSignature(acts) {
  if (!Array.isArray(acts) || acts.length === 0) return ''
  const last = acts[acts.length - 1]
  return `${acts.length}:${last?.name || ''}:${last?.updateTime || last?.createTime || ''}`
}

function sortActivities(acts) {
  return [...acts].sort((a, b) => new Date(a.createTime || 0) - new Date(b.createTime || 0))
}

function sortSessionsByRecent(sessions) {
  return sessions
    .slice()
    .sort((a, b) => new Date(b.lastUpdated || b.createdAt || 0).getTime() - new Date(a.lastUpdated || a.createdAt || 0).getTime())
}

function formatSystemActivityText(act) {
  let text = act.description || ''
  if (act.planGenerated) {
    const stepsStr = act.planGenerated.plan?.steps
      ?.map(s => `  - ${s.title}: ${s.description}`)
      .join('\n') || ''
    text += '\nPlan Generated:\n' + stepsStr
  }
  if (act.planApproved) text += '\nPlan Approved'
  if (act.sessionCompleted) text += '\nSession Completed'
  if (act.sessionFailed) text += `\nSession Failed: ${act.sessionFailed.reason || 'Unknown'}`
  return text
}

function toHistoryMessage(act) {
  if (act.userMessaged?.userMessage?.trim()) {
    return { role: 'user', text: act.userMessaged.userMessage, activityName: act.name }
  }
  if (act.agentMessaged?.agentMessage?.trim()) {
    return {
      role: 'agent',
      text: extractToolCallsFromMessage(act.agentMessaged.agentMessage),
      activityName: act.name,
      isPlan: false,
    }
  }
  if (act.originator === 'agent' || act.originator === 'system') {
    const text = formatSystemActivityText(act)
    if (!text.trim()) return null
    return {
      role: act.originator,
      text,
      activityName: act.name,
      isPlan: Boolean(act.planGenerated),
    }
  }
  return null
}

function getProgressText(act) {
  if (act.progressUpdated) {
    return `Progress: ${act.progressUpdated.title} - ${act.progressUpdated.description || ''}`.trim()
  }
  if (!Array.isArray(act.artifacts)) return null
  for (const art of act.artifacts) {
    if (art.changeSet?.gitPatch) return 'Code changes ready'
    if (art.bashOutput?.command) return `Command run: ${art.bashOutput.command}`
  }
  return null
}

export function useDashboardController() {
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

  const [diffFileSel, setDiffFileSel] = useState(0)
  const [diffScrollOffset, setDiffScrollOffset] = useState(0)
  const [diffFocus, setDiffFocus] = useState('files')
  const [diffFileCount, setDiffFileCount] = useState(0)
  const [diffRefreshBySession, setDiffRefreshBySession] = useState({})

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

  const [notes, setNotes] = useState(() => store.get('tuiNotes', ''))
  useEffect(() => {
    store.set('tuiNotes', notes)
  }, [notes])

  const [selectedSessionId, setSelectedSessionId] = useState(null)
  const [queuedMessages, setQueuedMessages] = useState({})
  const [queuedCycleIdx, setQueuedCycleIdx] = useState(0)
  const [promptPreview, setPromptPreview] = useState(null)
  const [latestProgress, setLatestProgress] = useState(null)

  useEffect(() => {
    setDiffScrollOffset(0)
  }, [diffFileSel, selectedSessionId])

  const selectedSessionIdRef = useRef(selectedSessionId)
  useEffect(() => { selectedSessionIdRef.current = selectedSessionId }, [selectedSessionId])

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

  const [repoInputMode, setRepoInputMode] = useState(false)
  const [repoInput, setRepoInput] = useState('')
  const [sourcesList, setSourcesList] = useState([])
  const [sourceSel, setSourceSel] = useState(0)

  const [statusFlash, setStatusFlash] = useState('')
  const [showHelp, setShowHelp] = useState(false)

  const [sessionsData, setSessionsData] = useState(() => getSessions() || [])
  const [sortedIds, setSortedIds] = useState(() => sortSessionsByRecent(getSessions() || []).map(s => s.id))

  const sessionHistoryCacheRef = useRef(new Map())

  const refreshLocalSessions = useCallback(() => {
    const sessions = getSessions() || []
    setSessionsData(sessions)
    setSortedIds(sortSessionsByRecent(sessions).map(s => s.id))
  }, [])

  const updateSessionHistoryCache = useCallback((sessionId, acts) => {
    const sorted = sortActivities(acts)
    const signature = activitiesSignature(sorted)

    const existing = sessionHistoryCacheRef.current.get(sessionId) || {
      signature: '',
      lastActivityId: null,
      messages: [],
    }

    if (existing.signature === signature) {
      return { changed: false, latestProgressText: null }
    }

    const next = {
      signature,
      lastActivityId: existing.lastActivityId,
      messages: existing.messages,
    }

    let appendStart = 0
    if (next.lastActivityId && next.messages.length > 0) {
      const idx = sorted.findIndex(a => a.name === next.lastActivityId)
      if (idx >= 0) {
        appendStart = idx + 1
      } else {
        next.messages = []
        appendStart = 0
      }
    } else {
      next.messages = []
      appendStart = 0
    }

    let latestProgressText = null
    for (let i = appendStart; i < sorted.length; i++) {
      const act = sorted[i]
      const msg = toHistoryMessage(act)
      if (msg) next.messages.push(msg)
      const progressText = getProgressText(act)
      if (progressText) latestProgressText = progressText
    }

    next.lastActivityId = sorted.length > 0 ? sorted[sorted.length - 1].name : null
    sessionHistoryCacheRef.current.set(sessionId, next)
    return { changed: true, latestProgressText }
  }, [])

  const buildDisplayMessages = useCallback((sessionId) => {
    const cache = sessionHistoryCacheRef.current.get(sessionId)
    const baseMessages = cache?.messages || []
    const agents = getSessions() || []
    const agent = agents.find(a => a.id === sessionId)
    const contextText = `Context: ${sessionId.substring(0, 8)}. State: ${agent?.state || 'unknown'}. Repo: ${agent?.repoDisplay || agent?.repo || 'unknown'}.`
    return [...baseMessages, { role: 'system', text: contextText }]
  }, [])

  const loadSessionActivities = useCallback(async (sessionId, { force = false } = {}) => {
    try {
      const res = await getAllActivities(sessionId)
      const acts = res.activities || res || []
      if (!Array.isArray(acts)) return false

      const { changed, latestProgressText } = updateSessionHistoryCache(sessionId, acts)
      if (changed) {
        setDiffRefreshBySession(prev => ({ ...prev, [sessionId]: (prev[sessionId] || 0) + 1 }))
      }
      if (latestProgressText) {
        setLatestProgress(latestProgressText)
      }

      if (force || (changed && selectedSessionIdRef.current === sessionId)) {
        setMessages(buildDisplayMessages(sessionId))
      }
      return changed
    } catch (e) {
      if (force && selectedSessionIdRef.current === sessionId) {
        setMessages([{ role: 'system', text: `Error loading history: ${e.message}` }])
      }
      return false
    }
  }, [updateSessionHistoryCache, buildDisplayMessages])

  useEffect(() => {
    let active = true
    let syncTimer = null

    const syncRemote = async () => {
      if (!active) return
      try {
        const res = await listAllSessions()
        const remoteSessions = res.sessions || []
        const remoteIds = new Set(remoteSessions.map(s => s.name.split('/').pop()))
        const localSessions = getSessions() || []

        let changed = false
        for (const s of localSessions) {
          if (!['QUEUED', 'AWAITING_PLAN_APPROVAL', 'AWAITING_USER_FEEDBACK', 'PAUSED'].includes(s.state) && !remoteIds.has(s.id)) {
            removeSession(s.id)
            changed = true
          }
        }

        for (const rs of remoteSessions) {
          const shortId = rs.name.split('/').pop()
          const local = localSessions.find(ls => ls.id === shortId)
          if (!local || local.state !== rs.state || local.lastUpdated !== rs.updateTime) {
            upsertSession({
              id: shortId,
              state: rs.state,
              lastUpdated: rs.updateTime || rs.createTime,
              createdAt: rs.createTime,
              title: rs.title || local?.title || 'jules-orchestrator',
              repo: rs.sourceContext?.source || local?.repo,
            })
            changed = true
          }
        }

        if (changed) refreshLocalSessions()
      } catch (_) {}

      if (active) syncTimer = setTimeout(syncRemote, 10000)
    }

    syncRemote()
    return () => {
      active = false
      clearTimeout(syncTimer)
    }
  }, [refreshLocalSessions])

  useEffect(() => {
    let active = true
    let pollTimer = null

    const poll = () => {
      if (!active) return
      refreshLocalSessions()
      pollTimer = setTimeout(poll, 5000)
    }

    pollTimer = setTimeout(poll, 5000)
    return () => {
      active = false
      clearTimeout(pollTimer)
    }
  }, [refreshLocalSessions])

  useEffect(() => {
    const storePath = store.path
    if (!storePath || !fs.existsSync(storePath)) return

    let debounceTimer = null
    let watcher = null

    try {
      watcher = fs.watch(storePath, () => {
        clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => refreshLocalSessions(), 40)
      })
    } catch (_) {
      return
    }

    return () => {
      clearTimeout(debounceTimer)
      watcher?.close()
    }
  }, [refreshLocalSessions])

  const AGENTS = useMemo(() => {
    const dataMap = {}
    sessionsData.forEach(s => { dataMap[s.id] = s })

    const mapped = []
    const seen = new Set()

    sessionsData.forEach(s => {
      if (!sortedIds.includes(s.id)) {
        mapped.push(s)
        seen.add(s.id)
      }
    })

    sortedIds.forEach(id => {
      if (dataMap[id] && !seen.has(id)) {
        mapped.push(dataMap[id])
        seen.add(id)
      }
    })

    return mapped
  }, [sessionsData, sortedIds])

  const agentsRef = useRef(AGENTS)
  useEffect(() => { agentsRef.current = AGENTS }, [AGENTS])

  const orchAgents = AGENTS.filter(a =>
    a.type === 'orchestrator' || (a.title || '').toLowerCase().includes('orchestrator'))
  const subAgents = AGENTS.filter(a =>
    !(a.type === 'orchestrator' || (a.title || '').toLowerCase().includes('orchestrator')))
  const graphNodes = [...orchAgents, ...subAgents]

  const selectedAgent = useMemo(
    () => selectedSessionId ? AGENTS.find(a => a.id === selectedSessionId) : null,
    [AGENTS, selectedSessionId]
  )

  const showApproveHint = selectedAgent?.state === 'AWAITING_PLAN_APPROVAL'

  function flash(msg, ms = 2000) {
    setStatusFlash(msg)
    setTimeout(() => setStatusFlash(''), ms)
  }

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 200)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    listSources().then(res => setSourcesList(res || [])).catch(() => {})
  }, [])

  useEffect(() => {
    if (chatMenuOpen && !chatInput.startsWith('/')) {
      setChatMenuOpen(false)
    } else if (mode === 'chat' && chatTab === 'chat' && chatInput === '/') {
      setChatMenuOpen(true)
      setChatMenuSel(0)
    }
  }, [chatInput, chatMenuOpen, mode, chatTab])

  useEffect(() => {
    if (graphNodes.length > 0 && graphSel >= graphNodes.length) {
      setGraphSel(graphNodes.length - 1)
    }
  }, [graphNodes.length, graphSel])

  useEffect(() => {
    let active = true
    let timer = null

    const poll = async () => {
      if (!active) return
      const id = selectedSessionIdRef.current
      if (!id) {
        timer = setTimeout(poll, 4000)
        return
      }

      await loadSessionActivities(id)
      const interval = (mode === 'chat' || mode === 'diff') ? 3000 : 6000
      timer = setTimeout(poll, interval)
    }

    poll()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [loadSessionActivities, mode])

  const lastGraphUpdateRef = useRef(store.get('diagramLastUpdated') || 0)
  useEffect(() => {
    const interval = setInterval(() => {
      const storeUpdate = store.get('diagramLastUpdated') || 0
      if (storeUpdate > lastGraphUpdateRef.current) {
        lastGraphUpdateRef.current = storeUpdate
        setSavedDiagrams(store.get('architectureDiagrams') || [])
        setMessages(m => {
          if (!selectedSessionIdRef.current) return m
          return [...m, { role: 'system', text: 'Diagram updated. Open [ PLANNED ARCHITECTURE ] to view it.' }]
        })
        if (showGraph) {
          setMode('graph')
          setGraphViewMode('plan')
          setPlanNodeSel(0)
        }
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [showGraph])

  const pendingSendsRef = useRef(new Set())
  const pendingTimeoutsRef = useRef(new Set())
  useEffect(() => {
    return () => {
      for (const tId of pendingTimeoutsRef.current) clearTimeout(tId)
    }
  }, [])

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
  }, [queuedMessages, AGENTS])

  const openAgentChat = useCallback((agent) => {
    if (!agent) return

    setSelectedSessionId(agent.id)
    setChatTargetMode('TALK_TO_SELECTED_AGENT')
    setMode('chat')
    setStartDialogOpen(false)
    setScrollOffset(sessionScrollRef.current[agent.id] ?? 0)
    setChatCursorLine(sessionCursorRef.current[agent.id] ?? 0)
    resetExpandedMessages()

    const cached = sessionHistoryCacheRef.current.get(agent.id)
    if (cached) {
      setMessages(buildDisplayMessages(agent.id))
    } else {
      setMessages([
        {
          role: 'system',
          text: `Context: ${agent.id.substring(0, 8)}. State: ${agent.state}. Repo: ${agent.repoDisplay || agent.repo || 'unknown'}.`,
        },
      ])
    }

    loadSessionActivities(agent.id, { force: true }).then(() => {
      setLatestProgress(null)
    })
  }, [buildDisplayMessages, loadSessionActivities, resetExpandedMessages])

  const handleSend = useCallback(async (val) => {
    const raw = val.trim()
    if (!raw) return

    if (raw === '/start') {
      setMode('chat')
      setStartDialogOpen(true)
      setStartDialogMode('CREATE_ORCHESTRATOR')
      setChatTargetMode('CREATE_ORCHESTRATOR')
      setChatInput('')
      return
    }

    if (startDialogOpen && (raw === '/task' || raw === '/orchestrator')) {
      const nextMode = raw === '/task' ? 'CREATE_TASK' : 'CREATE_ORCHESTRATOR'
      setStartDialogMode(nextMode)
      setChatTargetMode(nextMode)
      setChatInput('')
      return
    }

    if (startDialogOpen && raw === '/cancel') {
      setStartDialogOpen(false)
      setChatTargetMode(selectedSessionId ? 'TALK_TO_SELECTED_AGENT' : 'CREATE_ORCHESTRATOR')
      setChatInput('')
      return
    }

    const source = getConfig().source
    if (!source || source === 'NOT SET') {
      setMessages(m => [...m, { role: 'system', text: 'Error: No repo selected. Press Alt+M.' }])
      setChatInput('')
      setScrollOffset(0)
      return
    }

    const createMode = startDialogOpen ? startDialogMode : chatTargetMode

    if (createMode === 'CREATE_TASK') {
      setChatInput('')
      setScrollOffset(0)
      try {
        const { name } = await createSession({ prompt: raw, source })
        const sessionId = name.split('/').pop()
        setMessages(m => [...m, { role: 'system', text: `Created task session: ${sessionId}` }])
        setSelectedSessionId(sessionId)
        setChatTargetMode('TALK_TO_SELECTED_AGENT')
        setStartDialogOpen(false)
      } catch (e) {
        setMessages(m => [...m, { role: 'system', text: `Create task error: ${e.message}` }])
      }
      return
    }

    if (createMode === 'CREATE_ORCHESTRATOR') {
      setChatInput('')
      setScrollOffset(0)
      try {
        const { sessionId } = await dispatchLeadOrchestrator(raw, 1, raw.substring(0, 30))
        setMessages(m => [...m, { role: 'system', text: `Dispatched orchestrator: ${sessionId}` }])
        setSelectedSessionId(sessionId)
        setChatTargetMode('TALK_TO_SELECTED_AGENT')
        setStartDialogOpen(false)
      } catch (e) {
        setMessages(m => [...m, { role: 'system', text: `Dispatch error: ${e.message}` }])
      }
      return
    }

    const targetAgent = AGENTS.find(a => a.id === selectedSessionId)
    if (!targetAgent) {
      setMessages(m => [...m, { role: 'system', text: 'Error: No agent found.' }])
      return
    }

    if (targetAgent.state === 'IN_PROGRESS') {
      setQueuedMessages(prev => ({
        ...prev,
        [targetAgent.id]: [...(prev[targetAgent.id] || []), raw],
      }))
      setMessages(m => [...m, { role: 'system', text: 'Message queued' }])
      setChatInput('')
      setScrollOffset(0)
      return
    }

    setMessages(m => [...m, { role: 'system', text: 'Sending...' }])
    setChatInput('')
    setScrollOffset(0)

    try {
      if (raw === '/approve') {
        await approvePlan(targetAgent.id)
      } else {
        await sendMessage(targetAgent.id, raw)
      }
    } catch (e) {
      setMessages(m => {
        if (selectedSessionIdRef.current !== targetAgent.id) return m
        return [...m, { role: 'system', text: `Send error: ${e.message}` }]
      })
    }
  }, [startDialogOpen, startDialogMode, chatTargetMode, selectedSessionId, AGENTS])

  function handleRepoSubmit(val) {
    if (val.trim()) setConfig('source', val.trim())
    setRepoInputMode(false)
  }

  const diffRefreshToken = selectedSessionId ? (diffRefreshBySession[selectedSessionId] || 0) : 0

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
    latestProgress, setLatestProgress,
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
