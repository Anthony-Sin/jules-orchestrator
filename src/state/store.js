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
  const lockKeys = Object.keys(locks)

  if (lockKeys.length === 0 || files.length === 0) return conflicts

  const exactLocks = new Map()
  const pathLocks = []

  for (let i = 0; i < lockKeys.length; i++) {
    const k = lockKeys[i]
    if (k.startsWith('DOMAIN:')) {
      exactLocks.set(k, locks[k])
    } else {
      const norm = normalizePath(k)
      pathLocks.push({
        val: locks[k],
        norm,
        normPrefix: norm + '/'
      })
    }
  }

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    if (file.startsWith('DOMAIN:')) {
      if (exactLocks.has(file)) {
        conflicts.push({ file, lockedBy: exactLocks.get(file) })
      }
      continue
    }

    const reqNorm = normalizePath(file)
    const reqNormPrefix = reqNorm + '/'

    for (let j = 0; j < pathLocks.length; j++) {
      const pLock = pathLocks[j]
      if (
        pLock.norm === reqNorm ||
        reqNorm.startsWith(pLock.normPrefix) ||
        pLock.norm.startsWith(reqNormPrefix)
      ) {
        conflicts.push({ file, lockedBy: pLock.val })
        break // Avoid duplicate conflicts for the same requested file
      }
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
export function getArchitectureDiagram() {
  return store.get('architectureDiagram', null)
}
