import { useEffect, useCallback, useRef } from 'react'
import { getAllActivities, listAllSessions, listSources, sendMessage } from '../../state/jules-api.js'
import { getSessions, store, removeSession, upsertSession } from '../../state/store.js'
import { handleOrchestratorToolCall } from '../../jules_lead_orchestrator/JulesTools.js'
import fs from 'fs'

// ── Pure helpers (no React) ───────────────────────────────────────

export function activitiesSignature(acts) {
  if (!Array.isArray(acts) || acts.length === 0) return ''
  const last = acts[acts.length - 1]
  return `${acts.length}:${last?.name || ''}:${last?.updateTime || last?.createTime || ''}`
}

export function sortActivities(acts) {
  return [...acts].sort((a, b) => new Date(a.createTime || 0) - new Date(b.createTime || 0))
}

export function sortSessionsByRecent(sessions) {
  return sessions
    .slice()
    .sort((a, b) => new Date(b.lastUpdated || b.createdAt || 0).getTime() - new Date(a.lastUpdated || a.createdAt || 0).getTime())
}

// ── FIX #1: Strip prompt boilerplate from Jules-returned titles ───
// Jules returns the raw prompt text as the session title, which begins
// with "### AGENT IDENTITY" or "### SYSTEM IDENTITY". We never want
// to display that — prefer the clean title we set locally.
function cleanRemoteTitle(rawTitle) {
  if (!rawTitle) return null
  const trimmed = rawTitle.trim()
  // Reject anything that looks like a prompt preamble
  if (trimmed.startsWith('#')) return null
  if (trimmed.startsWith('{')) return null
  if (trimmed.startsWith('[')) return null
  if (trimmed.length > 80) return null  // Real titles are short
  return trimmed
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

export function extractToolCallsFromMessage(msgText) {
  try {
    if (!msgText.includes('"function"')) return msgText

    let jsonStr = ''
    const codeBlockRegex = /```(?:json)?\s*(\[\s*\{[\s\S]*?\}\s*\])\s*```/
    const match = codeBlockRegex.exec(msgText)
    if (match) {
      jsonStr = match[1]
    } else {
        // ← FIX: normalize whitespace so "[ {" matches the same as "[{"
        const normalizedText = msgText.replace(/\[\s+\{/g, '[{').replace(/\}\s+\]/g, '}]')
        const start = normalizedText.indexOf('[{')
        const end = normalizedText.lastIndexOf('}]')
        if (start !== -1 && end !== -1 && end > start) {
            // Extract from the ORIGINAL msgText using the same indices
            const potentialJson = msgText.substring(
            msgText.indexOf('['),
            msgText.lastIndexOf(']') + 1
            )
            try {
            JSON.parse(potentialJson)
            jsonStr = potentialJson
            } catch (_) {}
        }
    }

    if (jsonStr) {
      let parsedArr = JSON.parse(jsonStr)
      if (!Array.isArray(parsedArr)) parsedArr = [parsedArr]

      // Same format-agnostic normalization as the executor:
      // handles flat {name,arguments}, nested {function:{name,arguments}},
      // and "parameters" instead of "arguments" in any combination.
      const toolNames = []
      for (const tc of parsedArr) {
        if (!tc || typeof tc !== 'object') continue
        const isFlatFormat = typeof tc.name === 'string' && !tc.function
        const fnName = isFlatFormat ? tc.name : tc.function?.name
        if (!fnName) continue

        let displayName = fnName
        if (fnName === 'dispatch_sub_agent') {
          try {
            const rawArgs = isFlatFormat
              ? (tc.arguments ?? tc.parameters ?? tc.args ?? {})
              : (tc.function?.arguments ?? tc.function?.parameters ?? tc.function?.args ?? {})
            const args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs
            displayName = `dispatch_sub_agent (${args.module_name})`
          } catch (_) {}
        }
        toolNames.push(displayName)
      }
      if (toolNames.length > 0) {
        msgText = msgText.replace(jsonStr, `\n\n[TOOL CALLS: ${toolNames.join(', ')}]\n\n`).trim()
      }
    }
  } catch (_) {}

  return msgText
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
    const title = act.progressUpdated.title || 'Coding'
    const desc = act.progressUpdated.description ? ` - ${act.progressUpdated.description}` : ''
    return `${title}${desc}`
  }
  if (!Array.isArray(act.artifacts)) return null
  for (const art of act.artifacts) {
    if (art.changeSet?.gitPatch) return 'Generating code patches...'
    if (art.bashOutput?.command) return `Executing: ${art.bashOutput.command}`
  }
  return null
}

// ── Hook ─────────────────────────────────────────────────────────

export function useSessionManager({
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
}) {
  const sessionHistoryCacheRef = useRef(new Map())

  // ── Refresh local store into React state ─────────────────────────
  const refreshLocalSessions = useCallback(() => {
    const sessions = getSessions() || []
    setSessionsData(sessions)
    setSortedIds(sortSessionsByRecent(sessions).map(s => s.id))
  }, [setSessionsData, setSortedIds])

  // ── Build display messages from cache ────────────────────────────
  const buildDisplayMessages = useCallback((sessionId) => {
    const cache = sessionHistoryCacheRef.current.get(sessionId)
    const baseMessages = cache?.messages || []
    const agents = getSessions() || []
    const agent = agents.find(a => a.id === sessionId)
    const contextText = `Context: ${sessionId.substring(0, 8)}. State: ${agent?.state || 'unknown'}. Repo: ${agent?.repoDisplay || agent?.repo || 'unknown'}.`
    return [...baseMessages, { role: 'system', text: contextText }]
  }, [])

  // ── Update cache + execute tool calls (with dedup guard) ─────────
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

    // Persisted set of activity names that have already had tools fired.
    // This survives restarts and prevents double-execution on reload.
    const firedKey = `firedToolActivities:${sessionId}`
    const alreadyFired = new Set(store.get(firedKey, []))

    let latestProgressText = null
    for (let i = appendStart; i < sorted.length; i++) {
      const act = sorted[i]

      // Build display message
      const msg = toHistoryMessage(act)
      if (msg) next.messages.push(msg)

      const agentText = act.agentMessaged?.agentMessage

      // ── FIX #4: Skip [TOOL_RESULT:] and [AGENT_UPDATE:] messages ──
      // The orchestrator sends these back to itself as confirmations.
      // Re-parsing them would cause duplicate tool dispatches.
      const isToolResult = agentText?.trimStart().startsWith('[TOOL_RESULT:')
      const isAgentUpdate = agentText?.trimStart().startsWith('[AGENT_UPDATE:')
      const isSystemReply = isToolResult || isAgentUpdate

      // Execute tool calls — only for new activities not yet fired,
      // and only for genuine orchestrator tool-call messages (not confirmations).
      if (
        agentText &&
        agentText.includes('"function"') &&
        !isSystemReply &&
        act.name &&
        !alreadyFired.has(act.name)
      ) {
        try {
          let jsonStr = ''
          const codeBlockMatch = /```(?:json)?\s*(\[\s*\{[\s\S]*?\}\s*\])\s*```/.exec(agentText)
          if (codeBlockMatch) {
            jsonStr = codeBlockMatch[1]
          } else {
            const start = agentText.indexOf('[{')
            const end = agentText.lastIndexOf('}]')
            if (start !== -1 && end !== -1 && end > start) {
                const candidate = agentText.substring(start, end + 1)
              try { JSON.parse(candidate); jsonStr = candidate } catch (_) {}
            }
          }
          if (jsonStr) {
            let parsed = JSON.parse(jsonStr)
            // Jules occasionally outputs a single object instead of an array
            if (!Array.isArray(parsed)) parsed = [parsed]

            // Normalize all tool call formats Jules might output into a
            // consistent { function: { name, arguments } } shape:
            //
            // Format A (correct):  { type, function: { name, arguments: {...} } }
            // Format B (no type):  { function: { name, arguments: {...} } }
            // Format C (flat):     { name, arguments: {...} }
            // Format D (params):   { name, parameters: {...} }  (any of above)
            // Format E (obj args): arguments is a plain object, not a JSON string
            const normalizeToolCall = (tc) => {
              if (!tc || typeof tc !== 'object') return null

              // Detect flat format: { name, arguments/parameters }
              const isFlatFormat = typeof tc.name === 'string' && !tc.function

              const fnName = isFlatFormat ? tc.name : tc.function?.name
              if (!fnName) return null

              const rawArgs = isFlatFormat
                ? (tc.arguments ?? tc.parameters ?? tc.args ?? {})
                : (tc.function?.arguments ?? tc.function?.parameters ?? tc.function?.args ?? {})

              const normalizedArgs = typeof rawArgs === 'string'
                ? rawArgs
                : JSON.stringify(rawArgs)

              return { function: { name: fnName, arguments: normalizedArgs } }
            }

            const normalized = parsed.map(normalizeToolCall).filter(Boolean)
            if (normalized.length > 0) {
              for (const tc of normalized) {
                handleOrchestratorToolCall(tc, sessionId).catch(() => {})
              }
              // Mark this activity as fired and persist immediately
              alreadyFired.add(act.name)
              store.set(firedKey, [...alreadyFired])
            }
          }
        } catch (_) {}
      }

      const progressText = getProgressText(act)
      if (progressText) latestProgressText = progressText
    }

    next.lastActivityId = sorted.length > 0 ? sorted[sorted.length - 1].name : null
    sessionHistoryCacheRef.current.set(sessionId, next)
    return { changed: true, latestProgressText }
  }, [])

  // ── Load activities for a session ────────────────────────────────
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
  }, [updateSessionHistoryCache, buildDisplayMessages, selectedSessionIdRef, setMessages, setLatestProgress, setDiffRefreshBySession])

  // ── Remote sync (every 10s) ───────────────────────────────────────
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
          const prevState = local?.state

          // ── FIX #1: Trust our locally-set title over Jules raw prompt title ──
          // Jules returns the full prompt text as rs.title, which starts with
          // "### AGENT IDENTITY ...". We only fall back to it if we have nothing
          // better, and we filter it through cleanRemoteTitle() to reject prompts.
          const resolvedTitle =
            // 1. Orchestrator titles we set (protected prefix)
            (local?.title?.startsWith('ORCHESTRATOR—') ? local.title : null) ||
            // 2. Any locally-set title that isn't the default placeholder
            (local?.title && local.title !== 'jules-orchestrator' ? local.title : null) ||
            // 3. A clean remote title (short, no markdown headers)
            cleanRemoteTitle(rs.title) ||
            // 4. Last resort
            local?.title ||
            'jules-orchestrator'

          upsertSession({
            id: shortId,
            state: rs.state,
            lastUpdated: rs.updateTime || rs.createTime,
            createdAt: rs.createTime,
            title: resolvedTitle,
            repo: rs.sourceContext?.source || local?.repo,
            // Preserve fields set locally that Jules API doesn't know about
            type: local?.type,
            parentOrchestratorId: local?.parentOrchestratorId,
          })
          changed = true

          // ── FIX #3: Notify orchestrator when a sub-agent changes state ──
          // The orchestrator's system prompt says it reacts to [AGENT_UPDATE: ...]
          // messages, but nothing was sending them. Now we do.
          if (
            local?.parentOrchestratorId &&
            rs.state &&
            prevState &&
            rs.state !== prevState
          ) {
            sendMessage(
              local.parentOrchestratorId,
              `[AGENT_UPDATE: ${shortId}] State changed to ${rs.state}`
            ).catch(() => {
              // Non-fatal — orchestrator may already be done
            })
          }
        }

        if (changed) refreshLocalSessions()
      } catch (_) {}

      if (active) syncTimer = setTimeout(syncRemote, 10000)
    }

    syncRemote()
    return () => { active = false; clearTimeout(syncTimer) }
  }, [refreshLocalSessions])

  // ── Local store poll (every 5s) ───────────────────────────────────
  useEffect(() => {
    let active = true
    let pollTimer = null

    const poll = () => {
      if (!active) return
      refreshLocalSessions()
      pollTimer = setTimeout(poll, 5000)
    }

    pollTimer = setTimeout(poll, 5000)
    return () => { active = false; clearTimeout(pollTimer) }
  }, [refreshLocalSessions])

  // ── File watcher for instant local updates ────────────────────────
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
    } catch (_) { return }

    return () => { clearTimeout(debounceTimer); watcher?.close() }
  }, [refreshLocalSessions])

  // ── Activity poller for selected session ──────────────────────────
  useEffect(() => {
    let active = true
    let timer = null

    const poll = async () => {
      if (!active) return
      const id = selectedSessionIdRef.current
      if (!id) { timer = setTimeout(poll, 4000); return }
      await loadSessionActivities(id)
      const interval = (mode === 'chat' || mode === 'diff') ? 3000 : 6000
      timer = setTimeout(poll, interval)
    }

    poll()
    return () => { active = false; clearTimeout(timer) }
  }, [loadSessionActivities, mode, selectedSessionIdRef])

  // ── Architecture diagram watcher ──────────────────────────────────
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
  }, [showGraph, setSavedDiagrams, setMessages, setMode, setGraphViewMode, setPlanNodeSel, selectedSessionIdRef])

  // ── Sources list (one-time load) ──────────────────────────────────
  useEffect(() => {
    listSources().then(res => setSourcesList(res || [])).catch(() => {})
  }, [setSourcesList])

  return {
    refreshLocalSessions,
    loadSessionActivities,
    buildDisplayMessages,
    sessionHistoryCacheRef,
  }
}