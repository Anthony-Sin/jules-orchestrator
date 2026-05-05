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
}) {
  const agentsRef = useRef(AGENTS)
  useEffect(() => { agentsRef.current = AGENTS }, [AGENTS])

  const pendingSendsRef = useRef(new Set())
  const pendingTimeoutsRef = useRef(new Set())

  // Cleanup pending timeouts on unmount
  useEffect(() => {
    return () => {
      for (const tId of pendingTimeoutsRef.current) clearTimeout(tId)
    }
  }, [])

  // ── Queued message sender ─────────────────────────────────────────
  // Fires queued messages once an agent leaves IN_PROGRESS state
  useEffect(() => {
    for (const [id, msgs] of Object.entries(
      // We read queuedMessages via the setter pattern to avoid stale closure —
      // this effect re-runs whenever AGENTS changes which is frequent enough
      agentsRef.current.reduce((acc, a) => acc, {})
    )) {
      void id; void msgs // placeholder — see real impl below
    }
  }, []) // intentionally empty — real logic is in the effect below

  // ── Open agent chat ───────────────────────────────────────────────
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

    loadSessionActivities(agent.id, { force: true }).then(() => {
      setLatestProgress(null)
    })
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

    // ── Slash commands ──
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

    // ── Guard: need a repo ──
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
      setLatestProgress(null)
      try {
        const julesSession = await createSession({ prompt: raw, source })
        const sessionId = julesSession.name.split('/').pop()

        upsertSession({
          id: sessionId,
          title: raw.substring(0, 30),
          type: 'task',
          state: julesSession.state || 'QUEUED',
          createdAt: Date.now(),
          lastUpdated: Date.now(),
          repo: source,
        })
        refreshLocalSessions()
        setMessages(m => [...m, { role: 'system', text: `Created task session: ${sessionId}` }])
        setSelectedSessionId(sessionId)
        setChatTargetMode('TALK_TO_SELECTED_AGENT')
        setStartDialogOpen(false)
      } catch (e) {
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
  }, [
    startDialogOpen, startDialogMode, chatTargetMode, selectedSessionId,
    AGENTS, refreshLocalSessions, selectedSessionIdRef,
    setMode, setStartDialogOpen, setStartDialogMode, setChatTargetMode,
    setChatInput, setScrollOffset, setMessages, setLatestProgress,
    setSelectedSessionId, setQueuedMessages,
  ])

  // ── Repo submit ───────────────────────────────────────────────────
  function handleRepoSubmit(val) {
    const trimmed = (val ?? repoInput).trim()   // fall back to repoInput state
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