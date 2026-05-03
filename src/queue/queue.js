import { getQueue, setQueue, checkFileLockConflicts, getSessions, unlockFiles, upsertSession } from '../state/store.js'

export function enqueue(task) {
  if (!task || !task.type) {
    throw new Error('Task must have a type');
  }
  const queue = getQueue()
  queue.push({ ...task, queuedAt: Date.now() })
  queue.sort((a, b) => (b.priority || 0) - (a.priority || 0))
  setQueue(queue)
}

export function dequeue(type) {
  const queue = getQueue()

  // Dependency check logic: wake up any PAUSED agents if their target is COMPLETED
  const allSessions = getSessions() || [];
  for (const dep of allSessions) {
    if (dep.state === 'PAUSED' && dep.waitingOn) {
      const targetSession = allSessions.find(s => s.id === dep.waitingOn);
      if (targetSession && targetSession.state === 'COMPLETED') {
        upsertSession({ id: dep.id, state: 'QUEUED', waitingOn: null });
      }
    }
  }

  // Find the highest priority task that matches the type and has no file lock conflicts
  const idx = queue.findIndex(t => {
    if (t.type !== type) return false;

    // Check if the task has overlapping files with currently running sessions
    const estimatedFiles = t.estimatedFiles || [];
    let conflicts = checkFileLockConflicts(estimatedFiles);

    if (conflicts.length > 0) {
      // Check if any of the conflicting sessions are dead
      const sessions = getSessions() || [];
      const deadStates = ['FAILED', 'KILLED', 'COMPLETED'];
      const deadSessionIds = new Set();

      for (const conflict of conflicts) {
        const lockingSession = sessions.find(s => s.id === conflict.lockedBy);
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
