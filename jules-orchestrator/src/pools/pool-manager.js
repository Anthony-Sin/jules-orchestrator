import { DEFAULTS } from '../../config/defaults.js'
import {
  getActiveSessions, upsertSession, removeSession,
  syncQuota, quotaRemaining, enqueue, dequeue,
  lockFiles, unlockFiles, checkFileLockConflicts,
} from '../state/store.js'
import { enqueue, dequeue } from '../queue/queue.js'
import { createSession, getSession, deleteSession } from '../state/jules-api.js'
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
  await syncQuota()
  lockFiles(sessionId, estimatedFiles)
  upsertSession({
    id: sessionId,
    taskId: id,
    title,
    type,
    poolType: type,
    state: julesSession.state || 'QUEUED',
    createdAt: Date.now(),
    lastUpdated: Date.now(),
  })

  return { queued: false, sessionId }
}

export async function dispatchConflictResolver(description, branchA, branchB) {
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
  await syncQuota()
  upsertSession({
    id: sessionId,
    title: `Conflict resolver: ${branchA} + ${branchB}`,
    type: 'conflict',
    poolType: 'conflict',
    state: 'QUEUED',
    createdAt: Date.now(),
    lastUpdated: Date.now(),
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

export async function pollAndUpdate() {
  const active = getActiveSessions()
  const updated = []

  for (const session of active) {
    try {
      const fresh = await getSession(session.id)
      const newState = fresh.state || session.state

      upsertSession({ id: session.id, state: newState, lastUpdated: Date.now() })

      if (TERMINAL_STATES.includes(newState)) {
        unlockFiles(session.id)
        // Try to fill the freed slot from queue
        const next = dequeue(session.poolType)
        if (next) await dispatchTask(next)
      }

      updated.push({ id: session.id, state: newState, title: session.title })
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
