import Conf from 'conf'
import { DEFAULTS } from '../../config/defaults.js'

export const store = new Conf({ projectName: 'jules-orchestrator' })

// --- Quota ---
export function getQuotaUsed() {
  const record = store.get('quota', {})
  return record.used || 0
}

export function getQuotaLimit() {
  return store.get('quotaLimit', null)
}

export function setQuotaLimit(n) {
  store.set('quotaLimit', n)
}

export function quotaRemaining() {
  const limit = getQuotaLimit()
  if (limit === null) return null
  return limit - getQuotaUsed()
}

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

export async function syncQuota() {
  const { listSessions } = await import('./jules-api.js');
  try {
    const data = await listSessions();
    const sessions = Array.isArray(data) ? data : (data.sessions || []);

    const today = new Date().toISOString().split('T')[0];
    let count = 0;

    for (const session of sessions) {
      const ts = session.createTime || session.createdAt || session.lastUpdated;
      if (ts && new Date(ts).toISOString().split('T')[0] === today) {
        count++;
      }
    }

    store.set('quota', { date: today, used: count });
  } catch (err) {
    // Silently continue if syncing fails
  }
}
