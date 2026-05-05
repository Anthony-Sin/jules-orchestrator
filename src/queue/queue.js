import { getQueue, setQueue, checkFileLockConflicts, getSessions, unlockFiles, upsertSession } from '../state/store.js'
import { sendMessage } from '../state/jules-api.js'

export async function wakePausedAgents() {
  const allSessions = getSessions() || []
  const sessionsMap = new Map()
  for (const session of allSessions) {
    sessionsMap.set(session.id, session)
  }

  const woke = []
  for (const dep of allSessions) {
    if (dep.state === 'PAUSED' && dep.waitingOn) {
      const targetSession = sessionsMap.get(dep.waitingOn)
      if (targetSession && (targetSession.state === 'COMPLETED' || targetSession.state === 'FAILED')) {
        upsertSession({ id: dep.id, state: 'QUEUED', waitingOn: null })
        woke.push(dep.id)

        // Notify the dependent agent that it has been resumed
        try {
          await sendMessage(dep.id, `[RESUMED] Agent ${targetSession.id} has reached a terminal state (${targetSession.state}). You may proceed.`)
        } catch (_) {}

        // Notify the parent orchestrator if applicable
        if (dep.parentOrchestratorId) {
          try {
            await sendMessage(dep.parentOrchestratorId, `[AGENT_UPDATE: ${dep.id}] Resumed because dependency ${targetSession.id} reached state ${targetSession.state}.`)
          } catch (_) {}
        }
      }
    }
  }
  return woke
}

export function enqueue(task) {
  if (!task || !task.type) {
    throw new Error('Task must have a type');
  }
  const queue = getQueue()
  queue.push({ ...task, queuedAt: Date.now() })
  queue.sort((a, b) => {
    const priA = a.priority || 0
    const priB = b.priority || 0
    if (priA !== priB) return priB - priA
    return (a.queuedAt || 0) - (b.queuedAt || 0)
  })
  setQueue(queue)
}

export function dequeue(type) {
  const queue = getQueue()

  const allSessionsArray = getSessions() || [];
  // Create a Map for O(1) session lookups to avoid O(N^2) or O(N*M) performance bottlenecks
  const sessionsMap = new Map();
  for (const session of allSessionsArray) {
    sessionsMap.set(session.id, session);
  }

  const deadStates = ['FAILED', 'KILLED', 'COMPLETED'];

  // Find the highest priority task that matches the type and has no file lock conflicts
  const idx = queue.findIndex(t => {
    if (t.type !== type) return false;

    // Check if the task has overlapping files with currently running sessions
    const estimatedFiles = t.estimatedFiles || [];
    let conflicts = checkFileLockConflicts(estimatedFiles);

    if (conflicts.length > 0) {
      // Check if any of the conflicting sessions are dead
      const deadSessionIds = new Set();

      for (const conflict of conflicts) {
        const lockingSession = sessionsMap.get(conflict.lockedBy);
        // If the session doesn't exist, or it is in a dead state, it's an orphaned lock
        if (!lockingSession || deadStates.includes(lockingSession.state)) {
          deadSessionIds.add(conflict.lockedBy);
        }
      }

      if (deadSessionIds.size > 0) {
        for (const deadId of deadSessionIds) {
          unlockFiles(deadId);
        }
        // If we cleared any dead locks, re-evaluate conflicts
        conflicts = checkFileLockConflicts(estimatedFiles);
      }
    }

    // If there are still conflicts, skip it and check the next one
    return conflicts.length === 0;
  });

  if (idx < 0) return null;

  // Remove the chosen task from the queue and save
  const [task] = queue.splice(idx, 1)
  setQueue(queue)
  return task
}
