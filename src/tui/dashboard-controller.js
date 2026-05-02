// ── dashboard-controller.js ───────────────────────────────────────
// Extracts all complex state management, data polling, and API sync
// logic out of the main renderer file.

import { getAllActivities, sendMessage, listSources, listAllSessions } from '../state/jules-api.js'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { getSessions, getConfig, setConfig, store, removeSession, upsertSession } from '../state/store.js'
import { dispatchLeadOrchestrator } from '../jules_lead_orchestrator/julesorchestrator.js'

// ── Google Drive stubs ────────────────────────────────────────────
export async function saveToDrive(_content) { return false }

export function useDashboardController() {
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
  const [graphSel, setGraphSel]           = useState(0)
  const [showGraph, setShowGraph]         = useState(false)
  const [graphViewMode, setGraphViewMode] = useState('live')
  const [planNodeSel, setPlanNodeSel]     = useState(0)
  const savedDiagrams = store.get('architectureDiagrams') || []

  // ── Layout mode: 'table' | 'graph' | 'chat' | 'diff' ─────────────────────
  const [mode, setMode] = useState('table')
  const [lastLeftMode, setLastLeftMode] = useState('table')

  useEffect(() => {
    if (['table', 'graph', 'diff'].includes(mode)) {
      setLastLeftMode(mode)
    }
  }, [mode])

  const [diffFileSel, setDiffFileSel] = useState(0)
  const [diffScrollOffset, setDiffScrollOffset] = useState(0)
  const [diffFocus, setDiffFocus] = useState('files') // 'files' or 'content'

  // ── Chat state ───────────────────────────────────────────────────
  const [chatInput, setChatInput]           = useState('')
  const [messages, setMessages]             = useState([])
  const [scrollOffset, setScrollOffset] = useState(0)
  const sessionScrollRef = useRef({})
  const sessionCursorRef = useRef({})

  const [chatTab, setChatTab]               = useState('chat')
  const [chatMenuOpen, setChatMenuOpen]     = useState(false)
  const [chatMenuSel, setChatMenuSel]       = useState(0)
  const [chatTargetMode, setChatTargetMode] = useState('CREATE_ORCHESTRATOR')

  // ── Collapsed message dropdowns ──────────────────────────────────
  // Tracks which message indices are EXPANDED (default: all collapsed).
  // Key: message index (stable per session load). Value: true = expanded.
  const [expandedMessages, setExpandedMessages] = useState(new Set())

  // Which message is "focused" for keyboard toggle (separate from scroll)
  // Replaced focusedMsgIdx with chatCursorLine for line-by-line selection.
  const [chatCursorLine, setChatCursorLine] = useState(0)

  const toggleMessageExpand = useCallback((idx) => {
    setExpandedMessages(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }, [])

  // Reset expanded messages when session changes
  const resetExpandedMessages = useCallback(() => {
    setExpandedMessages(new Set())
    setChatCursorLine(0)
  }, [])

  const [notes, setNotes] = useState(() => store.get('tuiNotes', ''))

  // ── Session tracking ─────────────────────────────────────────────
  const [selectedSessionId, setSelectedSessionId] = useState(null)
  const [lastActivityIds, setLastActivityIds]     = useState({})
  const [queuedMessages, setQueuedMessages]       = useState({})
  const [queuedCycleIdx, setQueuedCycleIdx]       = useState(0)
  const [promptPreview, setPromptPreview]         = useState(null)
  const [latestProgress, setLatestProgress]       = useState(null)

  // Tracks whether we're mid-session-switch so the save effect doesn't
  // overwrite the just-restored scroll position on the same render cycle.
  const switchingSessionRef = useRef(false)

  // Save scroll position whenever it changes, but skip the write that fires
  // immediately after openAgentChat sets the restored value.
  useEffect(() => {
    if (switchingSessionRef.current) {
      switchingSessionRef.current = false
      return
    }
    const id = selectedSessionId
    if (id) {
      sessionScrollRef.current[id] = scrollOffset
      sessionCursorRef.current[id] = chatCursorLine
    }
  }, [scrollOffset, chatCursorLine]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync remote sessions with local store periodically
  useEffect(() => {
    let active = true
    let syncTimer = null
    const syncRemote = async () => {
      if (!active) return
      try {
        const res = await listAllSessions()
        const remoteSessions = res.sessions || []
        const remoteIds = new Set(remoteSessions.map(s => s.id))
        const localSessions = getSessions() || []

        let changed = false

        for (const s of localSessions) {
          if (s.state !== 'QUEUED' && !remoteIds.has(s.id)) {
            removeSession(s.id)
            changed = true
          }
        }

        for (const rs of remoteSessions) {
          const local = localSessions.find(ls => ls.id === rs.id)
          if (!local || local.state !== rs.state || local.lastUpdated !== rs.updateTime) {
            upsertSession({
              id: rs.id,
              state: rs.state,
              lastUpdated: rs.updateTime || rs.createTime,
              createdAt: rs.createTime,
              title: rs.title || local?.title || 'jules-orchestrator',
              repo: rs.sourceContext?.source || local?.repo
            })
            changed = true
          }
        }

        if (changed) {
          setSessionsData(getSessions() || [])
        }
      } catch (err) {}

      if (active) syncTimer = setTimeout(syncRemote, 10000)
    }

    syncRemote()
    return () => { active = false; clearTimeout(syncTimer) }
  }, [])

  // ── Repo picker ──────────────────────────────────────────────────
  const [repoInputMode, setRepoInputMode] = useState(false)
  const [repoInput, setRepoInput]         = useState('')
  const [sourcesList, setSourcesList]     = useState([])
  const [sourceSel, setSourceSel]         = useState(0)

  // ── Status flash ─────────────────────────────────────────────────
  const [statusFlash, setStatusFlash] = useState('')
  const [showHelp, setShowHelp]       = useState(false)

  // Read sessions from disk periodically
  const [sessionsData, setSessionsData] = useState(() => getSessions() || [])
  useEffect(() => {
    let active = true
    let t = null
    let lastHash = ''
    const poll = () => {
      if (!active) return
      const newData = getSessions() || []
      const currentHash = JSON.stringify(newData)
      if (currentHash !== lastHash) {
        lastHash = currentHash
        setSessionsData(newData)
      }
      t = setTimeout(poll, 5000)
    }
    t = setTimeout(poll, 5000)
    return () => { active = false; clearTimeout(t) }
  }, [])

  const [sortedIds, setSortedIds] = useState(() => {
    const initial = getSessions() || []
    return initial
      .slice()
      .sort((a, b) => new Date(b.lastUpdated || b.createdAt || 0).getTime() - new Date(a.lastUpdated || a.createdAt || 0).getTime())
      .map(s => s.id)
  })

  useEffect(() => {
    let active = true
    let t = null
    let lastHash = ''
    const poll = () => {
      if (!active) return
      const current = getSessions() || []
      const newSorted = current
        .slice()
        .sort((a, b) => new Date(b.lastUpdated || b.createdAt || 0).getTime() - new Date(a.lastUpdated || a.createdAt || 0).getTime())
        .map(s => s.id)

      const currentHash = JSON.stringify(newSorted)
      if (currentHash !== lastHash) {
        lastHash = currentHash
        setSortedIds(newSorted)
      }
      t = setTimeout(poll, 5 * 60 * 1000)
    }
    t = setTimeout(poll, 5 * 60 * 1000)
    return () => { active = false; clearTimeout(t) }
  }, [])

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

  const orchAgents = AGENTS.filter(a =>
    a.type === 'orchestrator' || (a.title || '').toLowerCase().includes('orchestrator'))
  const subAgents  = AGENTS.filter(a =>
    !(a.type === 'orchestrator' || (a.title || '').toLowerCase().includes('orchestrator')))
  const graphNodes = [...orchAgents, ...subAgents]

  function flash(msg, ms = 2000) {
    setStatusFlash(msg)
    setTimeout(() => setStatusFlash(''), ms)
  }

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

  // Graph selection bounds
  useEffect(() => {
    if (graphNodes.length > 0 && graphSel >= graphNodes.length)
      setGraphSel(graphNodes.length - 1)
  }, [graphNodes.length, graphSel])

  // Chat activity polling
  useEffect(() => {
    let active = true
    let p = null
    const poll = async () => {
      if (!active || mode !== 'chat' || !selectedSessionId) {
        p = setTimeout(poll, 5000)
        return
      }
      try {
        const lastId = lastActivityIds[selectedSessionId]

        const res  = await getAllActivities(selectedSessionId)
        const acts = res.activities || res || []

        if (Array.isArray(acts) && acts.length > 0) {
          const newMessages = []
          let   foundNew    = false
          const sorted      = acts.sort((a, b) =>
            new Date(a.createTime || 0) - new Date(b.createTime || 0))

          const lastIndex = lastId ? sorted.findIndex(a => a.name === lastId) : -1

          for (let i = lastIndex + 1; i < sorted.length; i++) {
            const act = sorted[i]
            foundNew = true
            if (act.userMessaged?.userMessage?.trim()) {
              newMessages.push({ role: 'user', text: act.userMessaged.userMessage })
            } else if (act.agentMessaged?.agentMessage?.trim()) {
              let msgText = act.agentMessaged.agentMessage;
              try {
                if (msgText.includes('"function"')) {
                  let jsonStr = '';
                  const codeBlockRegex = /```(?:json)?\s*(\[\s*\{[\s\S]*?\}\s*\])\s*```/;
                  const match = codeBlockRegex.exec(msgText);
                  if (match) {
                    jsonStr = match[1];
                  } else {
                    const start = msgText.indexOf('[{');
                    const end = msgText.lastIndexOf('}]');
                    if (start !== -1 && end !== -1 && end > start) {
                      jsonStr = msgText.substring(start, end + 2);
                    }
                  }
                  if (jsonStr) {
                    const parsedArr = JSON.parse(jsonStr);
                    if (Array.isArray(parsedArr)) {
                      let toolNames = [];
                      for (const tc of parsedArr) {
                        if (tc && tc.function && tc.function.name) {
                          let name = tc.function.name;
                          if (name === 'dispatch_sub_agent') {
                            try {
                              const args = JSON.parse(tc.function.arguments);
                              name = `dispatch_sub_agent (${args.module_name})`;
                            } catch(e) {}
                          }
                          toolNames.push(name);
                        }
                      }
                      if (toolNames.length > 0) {
                        msgText = msgText.replace(jsonStr, `\n\n⚙️ [TOOL CALLS: ${toolNames.join(', ')}]\n\n`).trim();
                      }
                    }
                  }
                }
              } catch (e) {}
              newMessages.push({ role: 'agent', text: msgText })
            } else if (act.originator === 'agent' || act.originator === 'system') {
              let text = act.description || ''
              if (act.planGenerated) {
                const stepsStr = act.planGenerated.plan?.steps?.map(s => `  - ${s.title}: ${s.description}`).join('\n') || ''
                text += '\n📋 Plan Generated:\n' + stepsStr
              }
              if (act.planApproved) text += '\n✅ Plan Approved'
              if (act.progressUpdated) {
                setLatestProgress(`🔄 Progress: ${act.progressUpdated.title} - ${act.progressUpdated.description}`);
              }
              if (act.sessionCompleted) text += '\n🎉 Session Completed!'
              if (act.sessionFailed) text += `\n❌ Session Failed: ${act.sessionFailed.reason}`
              if (act.artifacts && act.artifacts.length > 0) {
                act.artifacts.forEach(art => {
                  if (art.changeSet?.gitPatch) {
                    setLatestProgress(`💻 Code Changes Ready`);
                  }
                  if (art.bashOutput) {
                    setLatestProgress(`⚙️ Command Run: ${art.bashOutput.command}`);
                  }
                })
              }
              if (text.trim()) newMessages.push({ role: act.originator, text })
            }
          }

          if (newMessages.length > 0) {
            setLatestProgress(null);
            setMessages(m => [...m, ...newMessages])
            setLastActivityIds(prev => ({ ...prev, [selectedSessionId]: sorted[sorted.length - 1].name }))
          } else if (foundNew && sorted.length > 0) {
            setLastActivityIds(prev => ({ ...prev, [selectedSessionId]: sorted[sorted.length - 1].name }))
          }
        }
      } catch (_) {}

      if (active) p = setTimeout(poll, 5000)
    }

    poll()
    return () => { active = false; clearTimeout(p) }
  }, [mode, selectedSessionId, lastActivityIds])

  // Poll for new architecture diagrams
  const lastGraphUpdateRef = useRef(store.get('diagramLastUpdated') || 0)
  useEffect(() => {
    const interval = setInterval(() => {
      const storeUpdate = store.get('diagramLastUpdated') || 0
      if (storeUpdate > lastGraphUpdateRef.current) {
        lastGraphUpdateRef.current = storeUpdate
        setMessages(m => [...m, { role: 'system', text: 'magenta:➦ Diagram updated → see [ PLANNED ARCHITECTURE ]' }])
        if (showGraph) {
          setMode('graph')
          setGraphViewMode('plan')
          setPlanNodeSel(0)
        }
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [showGraph])

  // Drain queued messages
  useEffect(() => {
    for (const [id, msg] of Object.entries(queuedMessages)) {
      const agent = AGENTS.find(a => a.id === id)
      if (agent && agent.state !== 'IN_PROGRESS') {
        sendMessage(id, msg).catch(() => {})
        setMessages(m => [...m, { role: 'system', text: `[SYSTEM] Sent queued message to ${id}` }])
        setQueuedMessages(prev => { const q = { ...prev }; delete q[id]; return q })
      }
    }
  }, [queuedMessages, AGENTS])

  const openAgentChat = useCallback((agent) => {
    if (!agent) return
    setSelectedSessionId(agent.id)
    setChatTargetMode('TALK_TO_SELECTED_AGENT')
    setMode('chat')
    switchingSessionRef.current = true  // prevent save effect from overwriting the restore
    setScrollOffset(sessionScrollRef.current[agent.id] ?? 0)  // restore saved, default 0 (bottom) for new
    setChatCursorLine(sessionCursorRef.current[agent.id] ?? 0)
    resetExpandedMessages()

    getAllActivities(agent.id).then(res => {
      const acts    = res.activities || res || []
      const history = []
      if (Array.isArray(acts)) {
        const sorted = acts.sort((a, b) => new Date(a.createTime || 0) - new Date(b.createTime || 0))
        for (const act of sorted) {
          if (act.userMessaged?.userMessage?.trim()) {
            history.push({ role: 'user', text: act.userMessaged.userMessage })
          } else if (act.agentMessaged?.agentMessage?.trim()) {
            let msgText = act.agentMessaged.agentMessage;
            try {
              if (msgText.includes('"function"')) {
                let jsonStr = '';
                const codeBlockRegex = /```(?:json)?\s*(\[\s*\{[\s\S]*?\}\s*\])\s*```/;
                const match = codeBlockRegex.exec(msgText);
                if (match) {
                  jsonStr = match[1];
                } else {
                  const start = msgText.indexOf('[{');
                  const end = msgText.lastIndexOf('}]');
                  if (start !== -1 && end !== -1 && end > start) {
                    jsonStr = msgText.substring(start, end + 2);
                  }
                }
                if (jsonStr) {
                  const parsedArr = JSON.parse(jsonStr);
                  if (Array.isArray(parsedArr)) {
                    let toolNames = [];
                    for (const tc of parsedArr) {
                      if (tc && tc.function && tc.function.name) {
                        let name = tc.function.name;
                        if (name === 'dispatch_sub_agent') {
                          try {
                            const args = JSON.parse(tc.function.arguments);
                            name = `dispatch_sub_agent (${args.module_name})`;
                          } catch(e) {}
                        }
                        toolNames.push(name);
                      }
                    }
                    if (toolNames.length > 0) {
                      msgText = msgText.replace(jsonStr, `\n\n⚙️ [TOOL CALLS: ${toolNames.join(', ')}]\n\n`).trim();
                    }
                  }
                }
              }
            } catch (e) {}
            history.push({ role: 'agent', text: msgText })
          } else if (act.originator === 'agent' || act.originator === 'system') {
            let text = act.description || ''
            if (act.planGenerated) text += '\n📋 Plan Generated'
            if (act.planApproved) text += '\n✅ Plan Approved'
            if (act.progressUpdated) {
              setLatestProgress(`🔄 Progress: ${act.progressUpdated.title}`);
            }
            if (act.sessionCompleted) text += '\n🎉 Session Completed!'
            if (act.sessionFailed) text += `\n❌ Session Failed`
            if (text.trim()) history.push({ role: act.originator, text })
          }
        }
        if (sorted.length > 0) {
          setLastActivityIds(prev => ({ ...prev, [agent.id]: sorted[sorted.length - 1].name }))
        }
      }
      history.push({
        role: 'system',
        text: `Context: ${agent.id.substring(0, 8)}. State: ${agent.state}. Repo: ${agent.repoDisplay || agent.repo || 'unknown'}.`
      })
      setLatestProgress(null);
      setMessages(history)
    }).catch(e => {
      setMessages([{ role: 'system', text: `Error loading history: ${e.message}` }])
    })
  }, [resetExpandedMessages])

  async function handleSend(val) {
    if (!val.trim()) return
    const source = getConfig().source
    if (!source || source === 'NOT SET') {
      setMessages(m => [...m, { role: 'user', text: val.trim() }, { role: 'system', text: 'Error: No repo selected. Press Alt+M.' }])
      setChatInput(''); setScrollOffset(0); return
    }

    if (chatTargetMode === 'CREATE_ORCHESTRATOR' || !AGENTS || AGENTS.length === 0 ||
        (chatTargetMode === 'TALK_TO_SELECTED_AGENT' && !selectedSessionId)) {
      setChatInput(''); setScrollOffset(0)
      try {
        const { sessionId } = await dispatchLeadOrchestrator(val.trim(), 1, val.trim().substring(0, 30))
        setMessages(m => [...m, { role: 'user', text: val.trim() }, { role: 'system', text: `Dispatched orchestrator: ${sessionId}` }])
        setSelectedSessionId(sessionId)
        setChatTargetMode('TALK_TO_SELECTED_AGENT')
      } catch (e) {
        setMessages(m => [...m, { role: 'user', text: val.trim() }, { role: 'system', text: `Dispatch error: ${e.message}` }])
      }
      return
    }

    const targetAgent = AGENTS.find(a => a.id === selectedSessionId)

    if (!targetAgent) {
      setMessages(m => [...m, { role: 'system', text: 'Error: No agent found.' }]); return
    }

    const actualMessage = val.trim() === '/approve' ? 'Approve' : val.trim()

    if (targetAgent.state === 'IN_PROGRESS') {
      setQueuedMessages(prev => ({ ...prev, [targetAgent.id]: actualMessage }))
      setMessages(m => [...m, { role: 'user', text: actualMessage }, { role: 'system', text: `Message queued` }])
      setChatInput(''); setScrollOffset(0); return
    }

    setMessages(m => [...m, { role: 'user', text: actualMessage }, { role: 'system', text: 'Sending…' }])
    setChatInput(''); setScrollOffset(0)
    try {
      await sendMessage(targetAgent.id, actualMessage)
    } catch (e) {
      setMessages(m => [...m, { role: 'system', text: `Send error: ${e.message}` }])
    }
  }

  function handleRepoSubmit(val) {
    if (val.trim()) setConfig('source', val.trim())
    setRepoInputMode(false)
  }

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
    chatInput, setChatInput,
    messages, setMessages,
    scrollOffset, setScrollOffset,
    chatTab, setChatTab,
    chatMenuOpen, setChatMenuOpen,
    chatMenuSel, setChatMenuSel,
    chatTargetMode, setChatTargetMode,
    notes, setNotes,
    selectedSessionId, setSelectedSessionId,
    latestProgress, setLatestProgress,
    // ── Dropdown state ──────────────────────────────────────────────
    expandedMessages, toggleMessageExpand,
    chatCursorLine, setChatCursorLine,
    // ───────────────────────────────────────────────────────────────
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
    openAgentChat, handleSend, handleRepoSubmit
  }
}