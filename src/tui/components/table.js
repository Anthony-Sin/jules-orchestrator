// ── components/table.js ──────────────────────────────────────────
// AgentRow, FillBar, status maps, ago helper
// Used by renderer.js for the default table view.
// Added: orchestrator expand/collapse with sub-agent tree rows.

import React, { useState, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import { parseSourceDisplay } from '../../state/jules-api.js'

// ── Status maps ───────────────────────────────────────────────────
export const STATUS_COLOR = {
  IN_PROGRESS: 'cyanBright', COMPLETED: 'greenBright', AWAITING_PLAN_APPROVAL: 'blueBright',
  AWAITING_USER_FEEDBACK: 'blueBright', FAILED: 'redBright', QUEUED: 'cyan',
  PLANNING: 'cyan', PAUSED: 'blue', KILLED: 'red'
}

export const STATUS_SHORT = {
  IN_PROGRESS: 'ACTIVE', COMPLETED: 'DONE', AWAITING_PLAN_APPROVAL: 'WAIT',
  AWAITING_USER_FEEDBACK: 'WAIT', FAILED: 'FAIL', QUEUED: 'QUEUE',
  PLANNING: 'PLAN', PAUSED: 'PAUSE', KILLED: 'DEAD'
}

// ── ago ───────────────────────────────────────────────────────────
export function ago(ms) {
  if (!ms) return '--'
  const s = Math.floor((Date.now() - new Date(ms).getTime()) / 1000)
  if (s < 5)     return 'now'
  if (s < 60)    return `${s}s`
  if (s < 3600)  return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

// ── FillBar ───────────────────────────────────────────────────────
export function FillBar({ tick, width = 7, isDimmed, state }) {
  let filled
  if      (state === 'IN_PROGRESS' || state === 'PLANNING')
    filled = Math.floor(width * (0.5 + 0.5 * Math.sin(tick / 5)))
  else if (state === 'COMPLETED') filled = width
  else                            filled = 0
  filled = Math.min(width, Math.max(0, filled))

  const color = isDimmed ? 'gray'
    : state === 'COMPLETED'   ? 'greenBright'
    : state === 'IN_PROGRESS' ? 'cyanBright'
    : state === 'PLANNING'    ? 'cyan'
    : state === 'FAILED'      ? 'red'
    : 'gray'

  const pct = state === 'COMPLETED'   ? '100%'
    : state === 'IN_PROGRESS'         ? ' ...'
    : state === 'PLANNING'            ? 'PLAN'
    : '   0%'

  return React.createElement(Text, null,
    React.createElement(Text, { color, dimColor: isDimmed }, '#'.repeat(filled)),
    React.createElement(Text, { color: 'gray', dimColor: true }, '.'.repeat(width - filled)),
    React.createElement(Text, { color: isDimmed ? 'gray' : 'white', dimColor: isDimmed }, ' ' + pct)
  )
}

// ── isOrchestrator helper ─────────────────────────────────────────
function isOrch(agent) {
  return (
    agent.isOrchestrator === true ||
    agent.type === 'orchestrator' ||
    agent.role === 'ORCHESTRATOR' ||
    Array.isArray(agent.subAgents)
  )
}

// ── AgentRow (original, unchanged) ───────────────────────────────
export function AgentRow({ agent, selected, tick, isDimmed, expanded, onToggle }) {
  const sc   = STATUS_COLOR[agent.state || 'UNKNOWN'] || 'white'
  const ss   = STATUS_SHORT[agent.state || 'UNKNOWN'] || (agent.state || '???').substring(0, 5)
  const hi   = selected && !isDimmed
  const tc   = (base) => isDimmed ? 'gray' : (hi ? 'whiteBright' : base)

  const msElapsed   = Date.now() - new Date(agent.lastUpdated || agent.createdAt || 0).getTime()
  const minsElapsed = msElapsed / 60000

  let recencyColor = 'gray'
  if      (minsElapsed < 10)   recencyColor = 'greenBright'
  else if (minsElapsed < 60)   recencyColor = 'cyanBright'
  else if (minsElapsed < 1440) recencyColor = 'cyan'

  const shortId    = (agent.id    || '').substring(0, 6)
  const subAgents  = agent.subAgents || []
  const orch       = isOrch(agent)

  // title: orchestrators get arrow + optional badge
  const arrow      = orch ? (expanded ? 'v ' : '> ') : '  '
  const badge      = orch && !expanded ? ` [+${subAgents.length}]` : ''
  const rawTitle   = (agent.title || '').substring(0, 10)
  const titleStr   = arrow + rawTitle + badge

  const parsed     = parseSourceDisplay(agent.repoDisplay || agent.repo || '')
  const repoStr    = parsed.includes('/') ? parsed.split('/')[1] : parsed

  return React.createElement(Box, {
    paddingX: 1, width: '100%', height: 1, overflow: 'hidden',
    backgroundColor: hi ? 'blue' : undefined,
    flexDirection: 'row', minWidth: 0
  },
    React.createElement(Box, { width: 2, flexShrink: 0 },
      React.createElement(Text, { color: tc('cyanBright'), bold: !isDimmed },
        hi ? '> ' : '  ')
    ),
    React.createElement(Box, { width: 7, flexShrink: 0, overflow: 'hidden' },
      React.createElement(Text, { color: tc('blue'), bold: !isDimmed, wrap: 'truncate' },
        shortId)
    ),
    React.createElement(Box, { width: 18, flexShrink: 1, minWidth: 5, overflow: 'hidden' },
      React.createElement(Text, {
        color: orch ? tc('cyanBright') : tc(recencyColor),
        bold: !isDimmed,
        underline: orch && !isDimmed,
        wrap: 'truncate'
      }, titleStr)
    ),
    React.createElement(Box, { flexGrow: 1, flexShrink: 1, minWidth: 5, overflow: 'hidden' },
      React.createElement(Text, { color: tc('white'), wrap: 'truncate', dimColor: isDimmed },
        repoStr)
    ),
    React.createElement(Box, { width: 7, flexShrink: 0, overflow: 'hidden' },
      React.createElement(Text, { color: tc(sc), bold: !isDimmed, wrap: 'truncate' },
        ss)
    ),
    React.createElement(Box, { width: 14, flexShrink: 1, minWidth: 5, overflow: 'hidden' },
      React.createElement(FillBar, { tick, width: 6, isDimmed, state: agent.state })
    ),
    React.createElement(Box, { width: 4, flexShrink: 0, overflow: 'hidden' },
      React.createElement(Text, { color: tc('gray'), dimColor: true, wrap: 'truncate' },
        ago(agent.lastUpdated || agent.createdAt))
    )
  )
}

// ── SubAgentRow ───────────────────────────────────────────────────
export function SubAgentRow({ agent, tick, isLast }) {
  const sc      = STATUS_COLOR[agent.state || 'UNKNOWN'] || 'white'
  const ss      = STATUS_SHORT[agent.state || 'UNKNOWN'] || (agent.state || '???').substring(0, 5)
  const shortId = (agent.id || '').substring(0, 6)
  const title   = (agent.title || agent.role || 'agent').substring(0, 14)
  const parsed  = parseSourceDisplay(agent.repoDisplay || agent.repo || '')
  const repoStr = parsed.includes('/') ? parsed.split('/')[1] : parsed
  const conn    = isLast ? '`- ' : '|- '

  return React.createElement(Box, {
    paddingX: 1, width: '100%', height: 1, overflow: 'hidden',
    flexDirection: 'row', minWidth: 0
  },
    // indent + tree connector
    React.createElement(Box, { width: 2, flexShrink: 0 },
      React.createElement(Text, null, '  ')
    ),
    React.createElement(Box, { width: 7, flexShrink: 0, overflow: 'hidden' },
      React.createElement(Text, { color: 'gray' }, conn),
      React.createElement(Text, { color: 'blue', wrap: 'truncate' }, shortId)
    ),
    React.createElement(Box, { width: 18, flexShrink: 1, minWidth: 5, overflow: 'hidden' },
      React.createElement(Text, { color: 'white', wrap: 'truncate' }, '   ' + title)
    ),
    React.createElement(Box, { flexGrow: 1, flexShrink: 1, minWidth: 5, overflow: 'hidden' },
      React.createElement(Text, { color: 'gray', wrap: 'truncate', dimColor: true }, repoStr)
    ),
    React.createElement(Box, { width: 7, flexShrink: 0, overflow: 'hidden' },
      React.createElement(Text, { color: sc, wrap: 'truncate' }, ss)
    ),
    React.createElement(Box, { width: 14, flexShrink: 1, minWidth: 5, overflow: 'hidden' },
      React.createElement(FillBar, { tick, width: 6, isDimmed: false, state: agent.state })
    ),
    React.createElement(Box, { width: 4, flexShrink: 0, overflow: 'hidden' },
      React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' },
        ago(agent.lastUpdated || agent.createdAt))
    )
  )
}

// ── EmptySubAgentsRow ─────────────────────────────────────────────
export function EmptySubAgentsRow() {
  return React.createElement(Box, {
    paddingX: 1, width: '100%', height: 1,
    flexDirection: 'row', minWidth: 0
  },
    React.createElement(Text, { color: 'gray' }, '       `- '),
    React.createElement(Text, { color: 'gray', dimColor: true }, 'none yet')
  )
}

// ── buildRows: flattens sessions + sub-agents when expanded ───────
export function buildRows(sessions, expandedIds) {
  const rows = []
  for (const agent of sessions) {
    const orch      = isOrch(agent)
    const subAgents = agent.subAgents || []
    const expanded  = orch && expandedIds.has(agent.id)
    rows.push({ type: 'session', data: agent, orch, subCount: subAgents.length, expanded })
    if (expanded) {
      if (subAgents.length === 0) {
        rows.push({ type: 'empty', parentId: agent.id })
      } else {
        subAgents.forEach((sub, i) =>
          rows.push({ type: 'sub', data: sub, isLast: i === subAgents.length - 1, parentId: agent.id })
        )
      }
    }
  }
  return rows
}