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

export async function createSession({ prompt, source, startingBranch = 'main', requirePlanApproval = false }) {
  const res = await fetch(`${DEFAULTS.JULES_API_BASE}/sessions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      prompt,
      sourceContext: { source, githubRepoContext: { startingBranch } },
      requirePlanApproval,
      automationMode: "AUTO_CREATE_PR",
    }),
  })
  if (!res.ok) throw new Error(`Jules API error ${res.status}: ${await res.text()}`)
  return res.json()
}

export async function getSession(sessionId) {
  const res = await fetch(`${DEFAULTS.JULES_API_BASE}/sessions/${sessionId}`, { headers: headers() })
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

export async function listSessions() {
  const res = await fetch(`${DEFAULTS.JULES_API_BASE}/sessions`, { headers: headers() })
  if (!res.ok) throw new Error(`Jules API error ${res.status}`)
  return res.json()
}

export async function deleteSession(sessionId) {
  const res = await fetch(`${DEFAULTS.JULES_API_BASE}/sessions/${sessionId}`, {
    method: 'DELETE',
    headers: headers(),
  })
  if (!res.ok) throw new Error(`Jules API error ${res.status}`)
  return res.json()
}

export async function sendMessage(sessionId, message) {
  const res = await fetch(`${DEFAULTS.JULES_API_BASE}/sessions/${sessionId}:sendMessage`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ message }),
  })
  if (!res.ok) throw new Error(`Jules API error ${res.status}`)
  return res.json()
}

export async function approvePlan(sessionId) {
  const res = await fetch(`${DEFAULTS.JULES_API_BASE}/sessions/${sessionId}:approvePlan`, {
    method: 'POST',
    headers: headers(),
  })
  if (!res.ok) throw new Error(`Jules API error ${res.status}`)
  return res.json()
}

export async function getActivities(sessionId) {
  const res = await fetch(`${DEFAULTS.JULES_API_BASE}/sessions/${sessionId}/activities`, { headers: headers() })
  if (!res.ok) throw new Error(`Jules API error ${res.status}`)
  return res.json()
}

export function parseSourceDisplay(sourceName) {
  if (!sourceName) return ''
  return sourceName
}

export async function listSources() {
  const res = await fetch(`${DEFAULTS.JULES_API_BASE}/sources`, { headers: headers() })
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
