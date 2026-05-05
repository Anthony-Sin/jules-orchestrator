import { useEffect, useCallback, useRef } from 'react'
import { sendMessage, approvePlan, createSession } from '../../state/jules-api.js'
import { getConfig, setConfig, upsertSession } from '../../state/store.js'

export function useAgentActions({
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
  sourcesList,
}) {
  const agentsRef = useRef(AGENTS)
  useEffect(() => { agentsRef.current = AGENTS }, [AGENTS])

  const pendingSendsRef = useRef(new Set())
  const pendingTimeoutsRef = useRef(new Set())

  useEffect(() => {
    return () => {
      for (const tId of pendingTimeoutsRef.current) clearTimeout(tId)
    }
  }, [])

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
      setMessages([{
        role: 'system',
        text: `Context: ${agent.id.substring(0, 8)}. State: ${agent.state}. Repo: ${agent.repoDisplay || agent.repo || 'unknown'}.`,
      }])
    }

    // 🐛 FIX: Clear the old agent's progress instantly so it doesn't bleed into the new chat
    setLatestProgress(null)
    loadSessionActivities(agent.id, { force: true })
  }, [
    buildDisplayMessages, loadSessionActivities, resetExpandedMessages,
    setSelectedSessionId, setChatTargetMode, setMode, setStartDialogOpen,
    setScrollOffset, setChatCursorLine, setMessages, setLatestProgress,
    sessionScrollRef, sessionCursorRef, sessionHistoryCacheRef,
  ])

  // ── Handle chat send ──────────────────────────────────────────────
  const handleSend = useCallback(async (val) => {
    const raw = val.trim()
    if (!raw) return

    if (raw === '/start') {
      setMode('chat')
      setStartDialogOpen(true)
      setStartDialogMode('CREATE_TASK')
      setChatTargetMode('CREATE_TASK')
      setChatInput('')
      return
    }

    if (startDialogOpen && raw === '/task') {
      setStartDialogMode('CREATE_TASK')
      setChatTargetMode('CREATE_TASK')
      setChatInput('')
      return
    }

    if (startDialogOpen && raw === '/cancel') {
      setStartDialogOpen(false)
      setChatTargetMode(selectedSessionId ? 'TALK_TO_SELECTED_AGENT' : 'CREATE_TASK')
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

    // ── Create plain task ──
    if (createMode === 'CREATE_TASK') {
      setChatInput('')
      setScrollOffset(0)
      
      // 🚀 THE FIX: Universal "Thinking..." text immediately
      setLatestProgress('Thinking...') 
      setStartDialogOpen(false)

      try {
        const sourceObj = sourcesList.find(s => s.name === source)
        const startingBranch = sourceObj?.githubRepo?.defaultBranch?.displayName || 'main'

        const julesSession = await createSession({ prompt: raw, source, startingBranch })
        const sessionId = julesSession.name.split('/').pop()

        upsertSession({
          id: sessionId,
          title: raw.substring(0, 30),
          type: 'task',
          prompt: raw,
          state: julesSession.state || 'QUEUED',
          createdAt: Date.now(),
          lastUpdated: Date.now(),
          repo: source,
        })
        refreshLocalSessions()
        setMessages(m => [...m, { role: 'system', text: `Created task session: ${sessionId}` }])
        setSelectedSessionId(sessionId)
        setChatTargetMode('TALK_TO_SELECTED_AGENT')
      } catch (e) {
        setLatestProgress(null)
        setMessages(m => [...m, { role: 'system', text: `Create task error: ${e.message}` }])
      }
      return
    }

    // ── Talk to existing agent ──
    const targetAgent = AGENTS.find(a => a.id === selectedSessionId)
    if (!targetAgent) {
      setMessages(m => [...m, { role: 'system', text: 'Error: No agent found.' }])
      return
    }

    setChatInput('')
    setScrollOffset(0)
    
    // 🚀 THE FIX: Changed from 'Sending...' to 'Thinking...'
    setLatestProgress('Thinking...')
    
    upsertSession({
      id: targetAgent.id,
      state: 'IN_PROGRESS',
      lastUpdated: Date.now()
    })
    refreshLocalSessions()

    if (raw !== '/approve') {
      setMessages(m => [...m, { role: 'user', text: raw, activityName: `local-${Date.now()}` }])
    }

    try {
      if (raw === '/approve') {
        await approvePlan(targetAgent.id)
      } else {
        await sendMessage(targetAgent.id, raw)
      }
    } catch (e) {
      setLatestProgress(null)
      setMessages(m => {
        if (selectedSessionIdRef.current !== targetAgent.id) return m
        return [...m, { role: 'system', text: `Send error: ${e.message}` }]
      })
    }
  }, [
    startDialogOpen, startDialogMode, chatTargetMode, selectedSessionId,
    AGENTS, refreshLocalSessions, selectedSessionIdRef, sourcesList,
    setMode, setStartDialogOpen, setStartDialogMode, setChatTargetMode,
    setChatInput, setScrollOffset, setMessages, setLatestProgress,
    setSelectedSessionId, setQueuedMessages,
  ])

  function handleRepoSubmit(val) {
    const trimmed = (val ?? repoInput).trim() 
    if (trimmed) setConfig('source', trimmed)
    setRepoInputMode(false)
  }

  return {
    agentsRef,
    pendingSendsRef,
    pendingTimeoutsRef,
    openAgentChat,
    handleSend,
    handleRepoSubmit,
  }
}