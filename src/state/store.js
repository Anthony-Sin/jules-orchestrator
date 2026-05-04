import Conf from 'conf'
import { DEFAULTS } from '../../config/defaults.js'

export const store = new Conf({ projectName: 'jules-orchestrator' })

// --- Sessions ---
export function getSessions() {
  return store.get('sessions', [])
}

/**
 * @typedef {Object} Session
 * @property {string} id
 * @property {string} title
 * @property {string} type
 * @property {string} poolType
 * @property {string} state - e.g., QUEUED, AWAITING_USER_FEEDBACK, PAUSED, IN_PROGRESS, COMPLETED, FAILED
 * @property {number|string} createdAt
 * @property {number|string} lastUpdated
 * @property {string} repo
 * @property {string} [repoDisplay]
 * @property {string} [taskId]
 * @property {string} [pullRequestUrl]
 * @property {string} [pullRequestTitle]
 * @property {string} [julesUrl]
 */

export function upsertSession(session) {
  const sessions = getSessions()

  // Strip undefined values to prevent overwriting existing fields
  const cleanSession = { ...session }
  for (const key of Object.keys(cleanSession)) {
    if (cleanSession[key] === undefined) {
      delete cleanSession[key]
    }
  }

  const idx = sessions.findIndex(s => s.id === cleanSession.id)
  if (idx >= 0) sessions[idx] = { ...sessions[idx], ...cleanSession }
  else sessions.push(cleanSession)
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

export function setQueue(queue) {
  store.set('queue', queue)
}

// --- File lock map ---
export function getFileLocks() {
  return store.get('fileLocks', {})
}

// Helpers for path locking
function normalizePath(p) {
  return p.endsWith('/') ? p.slice(0, -1) : p
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
  const lockKeys = Object.keys(locks)

  if (lockKeys.length === 0 || files.length === 0) return conflicts

  // Build indices for fast lookup
  const domainLocks = new Map()
  const pathLocks = new Map()
  const childLocks = new Map()

  for (let j = 0; j < lockKeys.length; j++) {
    const lockedKey = lockKeys[j]
    const sessionId = locks[lockedKey]
    const conflictInfo = { file: lockedKey, lockedBy: sessionId, index: j }

    if (lockedKey.startsWith('DOMAIN:')) {
      if (!domainLocks.has(lockedKey)) {
        domainLocks.set(lockedKey, conflictInfo)
      }
      continue
    }

    const lPath = normalizePath(lockedKey)
    if (!pathLocks.has(lPath)) {
      pathLocks.set(lPath, conflictInfo)
    }

    const segments = lPath.split('/')
    // If lock is 'a/b/c', it conflicts with 'a/b' and 'a' (requested as directories)
    for (let k = 1; k < segments.length; k++) {
      const parentPath = segments.slice(0, k).join('/')
      if (!childLocks.has(parentPath)) {
        childLocks.set(parentPath, conflictInfo)
      }
    }
  }

  const uniqueFiles = Array.from(new Set(files))

  for (const file of uniqueFiles) {
    let best = null

    if (file.startsWith('DOMAIN:')) {
      best = domainLocks.get(file) || null
    } else {
      const rPath = normalizePath(file)
      best = pathLocks.get(rPath) || null

      // Check if any parent of rPath is locked
      const segments = rPath.split('/')
      for (let k = 1; k < segments.length; k++) {
        const parentPath = segments.slice(0, k).join('/')
        const c = pathLocks.get(parentPath)
        if (c && (!best || c.index < best.index)) {
          best = c
        }
      }

      // Check if any child of rPath is locked
      const c = childLocks.get(rPath)
      if (c && (!best || c.index < best.index)) {
        best = c
      }
    }

    if (best) {
      conflicts.push({ file, lockedBy: best.lockedBy })
    }
  }

  return conflicts
}

// --- Config (API key etc) ---

/**
 * @typedef {Object} Config
 * @property {string} [apiKey]
 * @property {boolean} [autoPr]
 */

export function getConfig() {
  return store.get('config', {})
}

export function setConfig(key, value) {
  const config = getConfig()
  config[key] = value
  store.set('config', config)
}

// --- Architecture Diagram ---
export function getArchitectureDiagrams() {
  return store.get('architectureDiagrams', [])
}
