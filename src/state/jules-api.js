import fetch from 'node-fetch'
import { DEFAULTS } from '../../config/defaults.js'
import { getConfig } from '../state/store.js'

function apiKey() {
  const key = getConfig().apiKey
  if (!key) throw new Error('No API key set. Run: jorch config set-key YOUR_KEY')
  return key
}

function headers() {
  return { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey() }
}

const FETCH_TIMEOUT_MS = 15000

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...options, signal: controller.signal })
    clearTimeout(id)
    return res
  } catch (err) {
    clearTimeout(id)
    throw err
  }
}

export async function createSession({ prompt, source, startingBranch, requirePlanApproval = false, tools }) {
  // If the TUI passed us a branch, use it. Otherwise, fall back to config or 'main'
  const targetBranch = startingBranch || getConfig().branch || 'main';

  const payload = {
    prompt,
    sourceContext: { 
      source,
      githubRepoContext: { startingBranch: targetBranch }
    },
    requirePlanApproval,
    automationMode: getConfig().autoPr !== false ? "AUTO_CREATE_PR" : undefined,
  }

  const res = await fetchWithTimeout(`${DEFAULTS.JULES_API_BASE}/sessions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload),
  })
  
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Jules API error ${res.status} | Payload Sent: ${JSON.stringify(payload)} | API Msg: ${errText}`);
  }
  
  return res.json()
}
export async function getSession(sessionId) {
  const res = await fetchWithTimeout(`${DEFAULTS.JULES_API_BASE}/sessions/${sessionId}`, { headers: headers() })
  if (!res.ok) throw new Error(`Jules API error ${res.status}`)
  const data = await res.json()

  const mapped = { ...data }
  if (data.updateTime) mapped.lastUpdated = data.updateTime
  if (data.createTime) mapped.createdAt = data.createTime
  if (data.url) mapped.julesUrl = data.url
  if (data.outputs?.[0]?.pullRequest) {
    mapped.pullRequestUrl = data.outputs[0].pullRequest.url
    mapped.pullRequestTitle = data.outputs[0].pullRequest.title
  }
  if (data.sourceContext?.source) {
    mapped.repoDisplay = parseSourceDisplay(data.sourceContext.source)
  }
  return mapped
}

export async function getSessionActivities(sessionId) {
  return getActivities(sessionId)
}

export async function listSessions(pageToken = null) {
  const url = new URL(`${DEFAULTS.JULES_API_BASE}/sessions`)
  url.searchParams.append('pageSize', '100')
  if (pageToken) url.searchParams.append('pageToken', pageToken)

  const res = await fetchWithTimeout(url.toString(), { headers: headers() })
  if (!res.ok) throw new Error(`Jules API error ${res.status}`)
  return res.json()
}

export async function listAllSessions() {
  let allSessions = []
  let pageToken = null

  do {
    const res = await listSessions(pageToken)
    if (res.sessions) {
      allSessions = allSessions.concat(res.sessions)
    }
    pageToken = res.nextPageToken
  } while (pageToken)

  return { sessions: allSessions }
}

export async function deleteSession(sessionId) {
  const res = await fetchWithTimeout(`${DEFAULTS.JULES_API_BASE}/sessions/${sessionId}`, {
    method: 'DELETE',
    headers: headers(),
  })
  if (!res.ok) throw new Error(`Jules API error ${res.status}`)
  return res.json()
}

export async function sendMessage(sessionId, message) {
  const res = await fetchWithTimeout(`${DEFAULTS.JULES_API_BASE}/sessions/${sessionId}:sendMessage`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ prompt: message }),
  })
  if (!res.ok) throw new Error(`Jules API error ${res.status}`)
  return res.json()
}

export async function approvePlan(sessionId) {
  const res = await fetchWithTimeout(`${DEFAULTS.JULES_API_BASE}/sessions/${sessionId}:approvePlan`, {
    method: 'POST',
    headers: headers(),
  })
  if (!res.ok) throw new Error(`Jules API error ${res.status}`)
  return res.json()
}

export async function getActivities(sessionId, pageToken = null) {
  const url = new URL(`${DEFAULTS.JULES_API_BASE}/sessions/${sessionId}/activities`)
  url.searchParams.append('pageSize', '100')
  if (pageToken) url.searchParams.append('pageToken', pageToken)

  const res = await fetchWithTimeout(url.toString(), { headers: headers() })
  if (!res.ok) throw new Error(`Jules API error ${res.status}`)
  return res.json()
}

export async function getAllActivities(sessionId) {
  let allActivities = []
  let pageToken = null

  do {
    const res = await getActivities(sessionId, pageToken)
    if (res.activities) {
      allActivities = allActivities.concat(res.activities)
    }
    pageToken = res.nextPageToken
  } while (pageToken)

  return { activities: allActivities }
}

export function parseSourceDisplay(source) {
  if (!source) return source
  const match = source.match(/^sources\/github[-/](.*)/)
  if (!match) return source

  return match[1].includes('/') ? match[1] : match[1].replace('-', '/')
}

export async function listSources() {
  const res = await fetchWithTimeout(`${DEFAULTS.JULES_API_BASE}/sources`, { headers: headers() })
  if (!res.ok) throw new Error(`Jules API error ${res.status}`)
  const data = await res.json()

  const sources = data.sources || data || []
  if (Array.isArray(sources)) {
    return sources.map(source => ({
      ...source,
      displayName: parseSourceDisplay(source.name)
    }))
  }
  return data
}
