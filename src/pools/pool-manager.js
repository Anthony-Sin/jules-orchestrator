import { enqueue, dequeue } from '../queue/queue.js'
import { DEFAULTS } from '../../config/defaults.js'
import {
  getActiveSessions, upsertSession, removeSession,
  syncQuota, quotaRemaining,
  lockFiles, unlockFiles, checkFileLockConflicts,
} from '../state/store.js'
import { createSession, getSession, deleteSession, sendMessage, approvePlan, listSessions } from '../state/jules-api.js'
import { getConfig } from '../state/store.js'

const TERMINAL_STATES = ['COMPLETED', 'FAILED', 'KILLED']

export function getPoolSessions(type) {
  return getActiveSessions().filter(s => s.poolType === type)
}

export function poolSlotsFree(type) {
  const max = type === 'frontend'
    ? DEFAULTS.POOL_SIZE_FRONTEND
    : DEFAULTS.POOL_SIZE_BACKEND
  return max - getPoolSessions(type).length
}

export async function dispatchTask(task) {
  await syncQuota()
  const { type, prompt, title, estimatedFiles, id } = task
  const config = getConfig()

  if (!config.source) throw new Error('No source set. Run: jorch config set-source sources/github-owner-repo')

  // Check file lock conflicts
  const conflicts = checkFileLockConflicts(estimatedFiles)
  if (conflicts.length > 0) {
    enqueue(task)
    return { queued: true, reason: `file conflict: ${conflicts.map(c => c.file).join(', ')}` }
  }

  // Check quota
  if (quotaRemaining() <= 2) {
    enqueue(task)
    return { queued: true, reason: 'quota nearly exhausted' }
  }

  // Check pool slot
  if (poolSlotsFree(type) <= 0) {
    enqueue(task)
    return { queued: true, reason: `${type} pool full` }
  }

  // Build the agent prompt
  const agentRole = type === 'frontend' ? 'Worker Agent 2 (frontend)' : 'Worker Agent 3 (backend)'
  const fullPrompt = buildAgentPrompt(agentRole, type, title, prompt)

  // Create Jules session
  const julesSession = await createSession({
    prompt: fullPrompt,
    source: config.source,
    startingBranch: config.branch || 'main',
    requirePlanApproval: false,
  })

  const sessionId = julesSession.name?.split('/').pop() || julesSession.id

  // Track it
  lockFiles(sessionId, estimatedFiles)
  const sessionData = {
    id: sessionId,
    taskId: id,
    title,
    type,
    poolType: type,
    state: julesSession.state || 'QUEUED',
    createdAt: Date.now(),
    lastUpdated: Date.now(),
    repo: config.source,
  }

  try {
    const fresh = await getSession(sessionId)
    if (fresh.title) sessionData.title = fresh.title
    if (fresh.state) sessionData.state = fresh.state
    if (fresh.createdAt) sessionData.createdAt = fresh.createdAt
    if (fresh.julesUrl) sessionData.julesUrl = fresh.julesUrl
    if (fresh.repoDisplay) sessionData.repoDisplay = fresh.repoDisplay
    else if (fresh.sourceContext?.source) sessionData.repoDisplay = parseSourceDisplay(fresh.sourceContext.source)
    if (fresh.pullRequestUrl) sessionData.pullRequestUrl = fresh.pullRequestUrl
    if (fresh.pullRequestTitle) sessionData.pullRequestTitle = fresh.pullRequestTitle
  } catch (_) {}

  upsertSession(sessionData)

  return { queued: false, sessionId }
}

export async function dispatchConflictResolver(description, branchA, branchB) {
  await syncQuota()
  const config = getConfig()
  if (!config.source) throw new Error('No source set.')

  if (quotaRemaining() <= 2) throw new Error('Quota too low to spawn conflict resolver.')

  const prompt = `You are a conflict resolver agent.
Two branches have merge conflicts: ${branchA} and ${branchB}.
The user has accepted both changes. Your job is to:
1. Pull both branches
2. Resolve all merge conflicts by keeping both sets of changes where possible
3. Ensure the code compiles and tests pass
4. Commit the resolution with a clear message
Description of the conflict: ${description}`

  const julesSession = await createSession({
    prompt,
    source: config.source,
    startingBranch: config.branch || 'main',
  })

  const sessionId = julesSession.name?.split('/').pop() || julesSession.id
  upsertSession({
    id: sessionId,
    title: `Conflict resolver: ${branchA} + ${branchB}`,
    type: 'conflict',
    poolType: 'conflict',
    state: 'QUEUED',
    createdAt: Date.now(),
    lastUpdated: Date.now(),
    repo: config.source,
  })

  return sessionId
}

export async function killSession(sessionId) {
  try {
    await deleteSession(sessionId)
  } catch (_) {}
  unlockFiles(sessionId)
  upsertSession({ id: sessionId, state: 'KILLED', lastUpdated: Date.now() })
}

export async function replyToSession(sessionId, message) {
  await syncQuota()
  return await sendMessage(sessionId, message)
}

export async function approveSessionPlan(sessionId) {
  await syncQuota()
  return await approvePlan(sessionId)
}

export async function pollAndUpdate() {
  await syncQuota()
  const active = getActiveSessions()
  const updated = []

  for (const session of active) {
    try {
      const fresh = await getSession(session.id)
      const newState = fresh.state || session.state

      const updates = { id: session.id, state: newState, lastUpdated: Date.now() }

      if (fresh.title) updates.title = fresh.title
      if (fresh.createdAt) updates.createdAt = fresh.createdAt
      if (fresh.julesUrl) updates.julesUrl = fresh.julesUrl
      if (fresh.pullRequestUrl) updates.pullRequestUrl = fresh.pullRequestUrl
      if (fresh.pullRequestTitle) updates.pullRequestTitle = fresh.pullRequestTitle
      if (fresh.repoDisplay) updates.repoDisplay = fresh.repoDisplay
      else if (fresh.sourceContext?.source) updates.repoDisplay = parseSourceDisplay(fresh.sourceContext.source)

      if (TERMINAL_STATES.includes(newState)) {
        // Specifically for terminal state, do one last check for outputs
        if (fresh.outputs?.[0]?.pullRequest) {
          updates.pullRequestUrl = fresh.outputs[0].pullRequest.url
          updates.pullRequestTitle = fresh.outputs[0].pullRequest.title
        }

        upsertSession(updates)
        unlockFiles(session.id)
        // Try to fill the freed slot from queue
        const next = dequeue(session.poolType)
        if (next) await dispatchTask(next)
      } else {
        upsertSession(updates)
      }

      updated.push({ id: session.id, state: newState, title: updates.title || session.title })
    } catch (_) {}
  }

  return updated
}

function buildAgentPrompt(role, type, title, task) {
  const domain = type === 'frontend'
    ? 'You work ONLY on frontend files: components, pages, hooks, styles. Do NOT touch API routes or backend files.'
    : 'You work ONLY on backend files: API routes, services, database. Do NOT touch component or page files.'

  return `You are ${role}.
${domain}

Pull from main before starting. Complete the following task fully — no placeholders, no TODOs, no console.log.
Run tsc --noEmit and lint before committing. Write a clean commit message.

TASK: ${title}

DETAILS:
${task}`
}

function parseSourceDisplay(source) {
  if (!source || !source.startsWith('sources/github-')) return source
  const stripped = source.slice('sources/github-'.length)
  const firstDashIdx = stripped.indexOf('-')
  if (firstDashIdx === -1) return stripped
  return stripped.slice(0, firstDashIdx) + '/' + stripped.slice(firstDashIdx + 1)
}

export async function syncSessions() {
  await syncQuota()
  try {
    const data = await listSessions()
    const sessions = Array.isArray(data) ? data : (data.sessions || [])

    for (const remote of sessions) {
      let repoDisplay = remote.sourceContext?.source || ''
      if (repoDisplay.startsWith('sources/github-')) {
        let stripped = repoDisplay.slice('sources/github-'.length)
        let firstDash = stripped.indexOf('-')
        if (firstDash !== -1) {
          repoDisplay = stripped.slice(0, firstDash) + '/' + stripped.slice(firstDash + 1)
        } else {
          repoDisplay = stripped
        }
      }

      const sessionData = {
        id: remote.id || (remote.name ? remote.name.split('/').pop() : ''),
        title: remote.title || 'Unknown task',
        state: remote.state || 'UNKNOWN',
        createdAt: remote.createTime || Date.now(),
        lastUpdated: remote.updateTime || Date.now(),
        repo: remote.sourceContext?.source || 'unknown',
        repoDisplay,
        julesUrl: remote.url
      }

      if (remote.outputs?.[0]?.pullRequest) {
        sessionData.pullRequestUrl = remote.outputs[0].pullRequest.url
        sessionData.pullRequestTitle = remote.outputs[0].pullRequest.title
      }

      if (sessionData.id) {
        upsertSession(sessionData)
      }
    }
  } catch (err) {
    // Ignore fail
  }
}
