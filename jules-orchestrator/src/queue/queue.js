import { getQueue, store, checkFileLockConflicts } from '../state/store.js'

export function enqueue(task) {
  const queue = getQueue()
  queue.push({ ...task, queuedAt: Date.now() })
  queue.sort((a, b) => b.priority - a.priority)
  store.set('queue', queue)
}

export function dequeue(type) {
  const queue = getQueue()

  for (let idx = 0; idx < queue.length; idx++) {
    const task = queue[idx]
    if (task.type === type) {
      if (task.estimatedFiles && task.estimatedFiles.length > 0) {
        const conflicts = checkFileLockConflicts(task.estimatedFiles)
        if (conflicts.length > 0) {
          continue // skip locked task
        }
      }

      queue.splice(idx, 1)
      store.set('queue', queue)
      return task
    }
  }

  return null
}
