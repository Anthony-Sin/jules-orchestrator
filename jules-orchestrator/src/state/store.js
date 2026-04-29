import Conf from 'conf'
import { DEFAULTS } from '../../config/defaults.js'

const store = new Conf({ projectName: 'jules-orchestrator' })

// --- Quota ---
export function getQuotaUsed() {
  const today = new Date().toISOString().slice(0, 10)
  const record = store.get('quota', {})
  if (record.date !== today) return 0
  return record.used || 0
}

export function incrementQuota() {
  const today = new Date().toISOString().slice(0, 10)
  const record = store.get('quota', {})
  const used = record.date === today ? (record.used || 0) + 1 : 1
  store.set('quota', { date: today, used })
  return used
}

export function quotaRemaining() {
  return DEFAULTS.DAILY_QUOTA - getQuotaUsed()
}

// --- Sessions ---
export function getSessions() {
  return store.get('sessions', [])
}

export function upsertSession(session) {
  const sessions = getSessions()
  const idx = sessions.findIndex(s => s.id === session.id)
  if (idx >= 0) sessions[idx] = { ...sessions[idx], ...session }
  else sessions.push(session)
  store.set('sessions', sessions)
}

export function removeSession(id) {
  const sessions = getSessions().filter(s => s.id !== id)
  store.set('sessions', sessions)
}

export function getActiveSessions() {
  return getSessions().filter(s =>
    !['COMPLETED', 'FAILED', 'KILLED'].includes(s.state)
  )
}

// --- Task queue ---
export function getQueue() {
  return store.get('queue', [])
}

export function enqueue(task) {
  const queue = getQueue()
  queue.push({ ...task, queuedAt: Date.now() })
  queue.sort((a, b) => b.priority - a.priority)
  store.set('queue', queue)
}

export function dequeue(type) {
  const queue = getQueue()
  const idx = queue.findIndex(t => t.type === type)
  if (idx < 0) return null
  const [task] = queue.splice(idx, 1)
  store.set('queue', queue)
  return task
}

// --- File lock map ---
export function getFileLocks() {
  return store.get('fileLocks', {})
}

// Helpers for path locking
function normalizePath(p) {
  return p.endsWith('/') ? p.slice(0, -1) : p
}

function isConflict(lockedKey, reqKey) {
  if (lockedKey === reqKey) return true
  // DOMAIN keys are exact match only
  if (lockedKey.startsWith('DOMAIN:') || reqKey.startsWith('DOMAIN:')) return false

  const lPath = normalizePath(lockedKey)
  const rPath = normalizePath(reqKey)

  if (lPath === rPath) return true
  return rPath.startsWith(lPath + '/') || lPath.startsWith(rPath + '/')
}

export function lockFiles(sessionId, files) {
  const locks = getFileLocks()
  for (const f of files) locks[f] = sessionId
  store.set('fileLocks', locks)
}

export function unlockFiles(sessionId) {
  const locks = getFileLocks()
  for (const f of Object.keys(locks)) {
    if (locks[f] === sessionId) delete locks[f]
  }
  store.set('fileLocks', locks)
}

export function checkFileLockConflicts(files) {
  const locks = getFileLocks()
  const conflicts = []

  for (const file of files) {
    for (const lockedFile of Object.keys(locks)) {
      if (isConflict(lockedFile, file)) {
        conflicts.push({ file, lockedBy: locks[lockedFile] })
        break // Avoid duplicate conflicts for the same requested file
      }
    }
  }

  return conflicts
}

// --- Config (API key etc) ---
export function getConfig() {
  return store.get('config', {})
}

export function setConfig(key, value) {
  const config = getConfig()
  config[key] = value
  store.set('config', config)
}

export async function syncQuota() {
  const { listSessions } = await import('./jules-api.js');
  try {
    const res = await listSessions();
    const sessions = res.sessions || res || []; // Handle array or object wrapper
    const today = new Date().toISOString().slice(0, 10);
    const apiQuotaUsed = sessions.filter(s => {
      const d = s.createTime || s.createdAt || s.lastUpdated;
      if (!d) return false;
      return new Date(d).toISOString().slice(0, 10) === today;
    }).length;

    const record = store.get('quota', {});
    if (record.date !== today || record.used !== apiQuotaUsed) {
      store.set('quota', { date: today, used: apiQuotaUsed });
    }
  } catch (err) {
    // Silently continue if syncing fails
  }
}
