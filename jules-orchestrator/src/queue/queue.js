import { getQueue, setQueue, checkFileLockConflicts } from '../state/store.js'

export function enqueue(task) {
  const queue = getQueue()
  queue.push({ ...task, queuedAt: Date.now() })
  queue.sort((a, b) => b.priority - a.priority)
  setQueue(queue)
}

export function dequeue(type) {
  const queue = getQueue()

  // Find the highest priority task that matches the type and has no file lock conflicts
  const idx = queue.findIndex(t => {
    if (t.type !== type) return false;

    // Check if the task has overlapping files with currently running sessions
    const estimatedFiles = t.estimatedFiles || [];
    const conflicts = checkFileLockConflicts(estimatedFiles);

    // If there are conflicts, skip it and check the next one
    return conflicts.length === 0;
  });

  if (idx < 0) return null;

  // Remove the chosen task from the queue and save
  const [task] = queue.splice(idx, 1)
  setQueue(queue)
  return task
}
