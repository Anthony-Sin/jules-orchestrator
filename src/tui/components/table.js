import React from 'react'
import { Box, Text } from 'ink'
import { parseSourceDisplay } from '../../state/jules-api.js'
import Spinner from 'ink-spinner'
import { THEME } from '../theme.js'

export const STATUS_COLOR = {
  IN_PROGRESS: 'cyanBright',
  COMPLETED: 'greenBright',
  AWAITING_PLAN_APPROVAL: 'yellowBright',
  AWAITING_USER_FEEDBACK: 'yellowBright',
  FAILED: 'redBright',
  QUEUED: 'gray',
  PLANNING: 'magentaBright',
  PAUSED: 'yellow',
  KILLED: 'red',
}

export const STATUS_SHORT = {
  IN_PROGRESS: 'ACTIVE',
  COMPLETED: 'DONE',
  AWAITING_PLAN_APPROVAL: 'WAIT',
  AWAITING_USER_FEEDBACK: 'WAIT',
  FAILED: 'FAIL',
  QUEUED: 'QUEUE',
  PLANNING: 'PLAN',
  PAUSED: 'PAUSE',
  KILLED: 'DEAD',
}

// Columns sizes optimized to accommodate the new uniform 3-space gaps
const COLUMN_LAYOUT = {
  tight:   { id: 6, title: 18, repo: 14, status: 6, progress: 2, time: 4 },
  compact: { id: 6, title: 25, repo: 20, status: 6, progress: 2, time: 4 },
  full:    { id: 6, title: 35, repo: 25, status: 6, progress: 2, time: 4 },
}

export function ago(ms) {
  if (!ms) return '--'
  const s = Math.floor((Date.now() - new Date(ms).getTime()) / 1000)
  if (s < 5) return 'now'
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function getLayoutProfile() {
  const columns = process.stdout?.columns || 80
  if (columns < 90) return 'tight'
  if (columns < 115) return 'compact'
  return 'full'
}

function trimCell(value, width) {
  const text = String(value || '')
  if (width <= 1) return text.slice(0, 1)
  if (text.length <= width) return text
  return `${text.slice(0, Math.max(1, width - 3))}...`
}

function extractRepoName(repo) {
  const parsed = parseSourceDisplay(repo || '')
  if (!parsed) return 'unknown'
  if (!parsed.includes('/')) return parsed
  const parts = parsed.split('/')
  return parts[parts.length - 1]
}

function isOrch(agent) {
  return (
    agent.isOrchestrator === true ||
    agent.type === 'orchestrator' ||
    agent.role === 'ORCHESTRATOR' ||
    Array.isArray(agent.subAgents)
  )
}

// The Perfect 3-Space Gap 
function Gap({ rowBg }) {
  return React.createElement(Box, { width: 3, flexShrink: 0 },
    React.createElement(Text, { backgroundColor: rowBg }, '   ')
  )
}

export function AgentRow({ agent, selected, tick, isDimmed, expanded }) {
  const profile = getLayoutProfile()
  const layout = COLUMN_LAYOUT[profile]

  const state = agent.state || 'UNKNOWN'
  
  // Strict unified color for ALL text elements in the row
  const baseColor = STATUS_COLOR[state] || THEME.text
  const textColor = baseColor
  
  const stateShort = STATUS_SHORT[state] || state.substring(0, 6)
  const isFocused = selected && !isDimmed
  
  const rowBg = selected ? (isDimmed ? '#2b2b2b' : THEME.focusBg) : undefined

  const shortId = (agent.id || '').slice(0, layout.id)
  const subAgents = agent.subAgents || []
  const orch = isOrch(agent)
  const arrow = orch ? (expanded ? 'v ' : '> ') : '  '
  const badge = orch && !expanded ? ` [+${subAgents.length}]` : ''
  const rawTitle = agent.title || 'agent'
  const titleWithChrome = `${arrow}${rawTitle}${badge}`
  const titleStr = trimCell(titleWithChrome, layout.title)
  const repoStr = extractRepoName(agent.repoDisplay || agent.repo || '')
  const repoTrimmed = trimCell(repoStr, layout.repo)
  const ageStr = ago(agent.lastUpdated || agent.createdAt)

  return React.createElement(Box, {
    width: '100%',
    height: 1,
    overflow: 'hidden',
    backgroundColor: rowBg,
    flexDirection: 'row',
  },
    React.createElement(Box, { width: 2, flexShrink: 0 }, 
      React.createElement(Text, { color: textColor, bold: !isDimmed, dimColor: isDimmed, backgroundColor: rowBg }, isFocused ? '> ' : '  ')
    ),
    React.createElement(Box, { width: layout.id, flexShrink: 0 }, 
      React.createElement(Text, { color: textColor, bold: !isDimmed, dimColor: isDimmed, backgroundColor: rowBg }, shortId.padEnd(layout.id, ' '))
    ),
    React.createElement(Gap, { rowBg }),
    React.createElement(Box, { width: layout.title, flexShrink: 0 }, 
      React.createElement(Text, { color: textColor, bold: !isDimmed, underline: orch && !isDimmed, dimColor: isDimmed, wrap: 'truncate', backgroundColor: rowBg }, titleStr)
    ),
    React.createElement(Gap, { rowBg }),
    React.createElement(Box, { width: layout.repo, flexShrink: 0 }, 
      React.createElement(Text, { color: textColor, dimColor: isDimmed, wrap: 'truncate', backgroundColor: rowBg }, repoTrimmed)
    ),
    React.createElement(Gap, { rowBg }),
    React.createElement(Box, { width: layout.status, flexShrink: 0 }, 
      React.createElement(Text, { color: textColor, bold: !isDimmed, dimColor: isDimmed, backgroundColor: rowBg }, stateShort.padEnd(layout.status, ' '))
    ),
    React.createElement(Gap, { rowBg }),
    React.createElement(Box, { width: layout.progress, flexShrink: 0 }, 
      React.createElement(Text, { color: textColor, dimColor: isDimmed, backgroundColor: rowBg }, state === 'COMPLETED' ? '::' : React.createElement(Spinner, { type: 'dots' }))
    ),
    layout.time > 0 && React.createElement(Gap, { rowBg }),
    layout.time > 0 && React.createElement(Box, { width: layout.time, flexShrink: 0 }, 
      React.createElement(Text, { color: textColor, dimColor: isDimmed, backgroundColor: rowBg }, ageStr)
    ),
    React.createElement(Box, { flexGrow: 1 })
  )
}

export function SubAgentRow({ agent, tick, isLast, selected = false, isDimmed = false }) {
  const profile = getLayoutProfile()
  const layout = COLUMN_LAYOUT[profile]
  const state = agent.state || 'UNKNOWN'
  
  const baseColor = STATUS_COLOR[state] || THEME.text
  const textColor = baseColor
  
  const stateShort = STATUS_SHORT[state] || state.substring(0, 6)
  const isFocused = selected && !isDimmed
  const rowBg = selected ? (isDimmed ? '#2b2b2b' : THEME.focusBg) : undefined

  const shortId = (agent.id || '').slice(0, 4) 
  const title = trimCell(agent.title || agent.role || 'agent', layout.title - 2)
  const repoStr = extractRepoName(agent.repoDisplay || agent.repo || '')
  const repoTrimmed = trimCell(repoStr, layout.repo)
  
  const connector = isLast ? '└─' : '├─'
  const ageStr = ago(agent.lastUpdated || agent.createdAt)

  return React.createElement(Box, {
    width: '100%',
    height: 1,
    overflow: 'hidden',
    backgroundColor: rowBg,
    flexDirection: 'row',
  },
    React.createElement(Box, { width: 2, flexShrink: 0 }, 
      React.createElement(Text, { color: textColor, bold: !isDimmed, dimColor: isDimmed, backgroundColor: rowBg }, isFocused ? '> ' : '  ')
    ),
    React.createElement(Box, { width: layout.id, flexShrink: 0, flexDirection: 'row' }, 
      React.createElement(Text, { color: textColor, dimColor: isDimmed, backgroundColor: rowBg }, connector),
      React.createElement(Text, { color: textColor, dimColor: isDimmed, backgroundColor: rowBg }, shortId.padEnd(layout.id - connector.length, ' '))
    ),
    React.createElement(Gap, { rowBg }),
    React.createElement(Box, { width: layout.title, flexShrink: 0 }, 
      React.createElement(Text, { color: textColor, dimColor: isDimmed, wrap: 'truncate', backgroundColor: rowBg }, `  ${title}`)
    ),
    React.createElement(Gap, { rowBg }),
    React.createElement(Box, { width: layout.repo, flexShrink: 0 }, 
      React.createElement(Text, { color: textColor, dimColor: isDimmed, wrap: 'truncate', backgroundColor: rowBg }, repoTrimmed)
    ),
    React.createElement(Gap, { rowBg }),
    React.createElement(Box, { width: layout.status, flexShrink: 0 }, 
      React.createElement(Text, { color: textColor, bold: !isDimmed, dimColor: isDimmed, backgroundColor: rowBg }, stateShort.padEnd(layout.status, ' '))
    ),
    React.createElement(Gap, { rowBg }),
    React.createElement(Box, { width: layout.progress, flexShrink: 0 }, 
      React.createElement(Text, { color: textColor, dimColor: isDimmed, backgroundColor: rowBg }, state === 'COMPLETED' ? '::' : React.createElement(Spinner, { type: 'dots' }))
    ),
    layout.time > 0 && React.createElement(Gap, { rowBg }),
    layout.time > 0 && React.createElement(Box, { width: layout.time, flexShrink: 0 }, 
      React.createElement(Text, { color: textColor, dimColor: isDimmed, backgroundColor: rowBg }, ageStr)
    ),
    React.createElement(Box, { flexGrow: 1 })
  )
}

export function EmptySubAgentsRow({ selected = false, isDimmed = false }) {
  const rowBg = selected ? (isDimmed ? '#2b2b2b' : THEME.focusBg) : undefined
  const textColor = THEME.subtleText
  
  return React.createElement(Box, {
    width: '100%',
    height: 1,
    flexDirection: 'row',
    backgroundColor: rowBg,
    overflow: 'hidden'
  },
    React.createElement(Box, { width: 2, flexShrink: 0 }),
    React.createElement(Box, { width: 6, flexShrink: 0 }, 
      React.createElement(Text, { color: textColor, dimColor: true, backgroundColor: rowBg }, '└─    ')
    ),
    React.createElement(Gap, { rowBg }),
    React.createElement(Box, { flexGrow: 1 }, 
      React.createElement(Text, { color: textColor, dimColor: true, backgroundColor: rowBg }, 'none yet')
    )
  )
}

export function buildRows(sessions, expandedIds) {
  const rows = []
  for (const agent of sessions) {
    const orch = isOrch(agent)
    const subAgents = agent.subAgents || []
    const expanded = orch && expandedIds.has(agent.id)
    rows.push({ type: 'session', data: agent, orch, subCount: subAgents.length, expanded })
    if (expanded) {
      if (subAgents.length === 0) {
        rows.push({ type: 'empty', parentId: agent.id })
      } else {
        subAgents.forEach((sub, i) => {
          rows.push({ type: 'sub', data: sub, isLast: i === subAgents.length - 1, parentId: agent.id })
        })
      }
    }
  }
  return rows
}