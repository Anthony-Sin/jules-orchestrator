import React from 'react'
import { Box, Text } from 'ink'
import { parseSourceDisplay } from '../../state/jules-api.js'
import { InkSpinner } from './ink-spinner.js'
import { THEME } from '../theme.js'

export const STATUS_COLOR = {
  IN_PROGRESS: THEME.accent,
  COMPLETED: 'greenBright',
  AWAITING_PLAN_APPROVAL: THEME.accentSoft,
  AWAITING_USER_FEEDBACK: THEME.accentSoft,
  FAILED: THEME.error,
  QUEUED: THEME.accentMuted,
  PLANNING: THEME.accent,
  PAUSED: THEME.accentMuted,
  KILLED: THEME.error,
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

const COLUMN_LAYOUT = {
  tight: { id: 6, title: 18, status: 5, progress: 9, time: 3, repoMin: 8 },
  compact: { id: 6, title: 20, status: 5, progress: 10, time: 3, repoMin: 10 },
  full: { id: 6, title: 22, status: 5, progress: 11, time: 3, repoMin: 12 },
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

function Cell({ width, children, grow = false, minWidth = 0 }) {
  return React.createElement(
    Box,
    {
      width: grow ? undefined : width,
      minWidth: grow ? minWidth : width,
      flexGrow: grow ? 1 : 0,
      flexShrink: grow ? 1 : 0,
      overflow: 'hidden',
      height: 1,
    },
    children
  )
}

function Gap() {
  return React.createElement(Box, { width: 1, flexShrink: 0 },
    React.createElement(Text, { color: THEME.separator }, ' ')
  )
}

export function FillBar({ tick = 0, width = 6, isDimmed, state }) {
  const color = isDimmed ? 'gray' : (STATUS_COLOR[state] || THEME.subtleText)
  const isActive = state === 'IN_PROGRESS' || state === 'PLANNING'

  if (isActive) {
    return React.createElement(Text, null,
      React.createElement(InkSpinner, { tick, color, dimColor: isDimmed, type: 'dots' }),
      React.createElement(Text, { color: isDimmed ? 'gray' : THEME.text, dimColor: isDimmed }, '..')
    )
  }

  const filled = state === 'COMPLETED' ? width : 0
  const pct = state === 'COMPLETED' ? '100%' : '0%'

  return React.createElement(Text, null,
    React.createElement(Text, { color, dimColor: isDimmed }, '='.repeat(filled)),
    React.createElement(Text, { color: 'gray', dimColor: true }, '.'.repeat(width - filled)),
    React.createElement(Text, { color: isDimmed ? 'gray' : THEME.text, dimColor: isDimmed }, pct)
  )
}

export function AgentRow({ agent, selected, tick, isDimmed, expanded }) {
  const profile = getLayoutProfile()
  const layout = COLUMN_LAYOUT[profile]

  const state = agent.state || 'UNKNOWN'
  const stateColor = STATUS_COLOR[state] || THEME.text
  const stateShort = STATUS_SHORT[state] || state.substring(0, 5)
  const isFocused = selected && !isDimmed
  const tint = (base) => (isDimmed ? 'gray' : (isFocused ? 'whiteBright' : base))

  const msElapsed = Date.now() - new Date(agent.lastUpdated || agent.createdAt || 0).getTime()
  const minsElapsed = msElapsed / 60000
  let recencyColor = THEME.subtleText
  if (minsElapsed < 10) recencyColor = 'greenBright'
  else if (minsElapsed < 60) recencyColor = THEME.accentSoft
  else if (minsElapsed < 1440) recencyColor = THEME.accentMuted

  const shortId = (agent.id || '').slice(0, 6)
  const subAgents = agent.subAgents || []
  const orch = isOrch(agent)
  const arrow = orch ? (expanded ? 'v ' : '> ') : '  '
  const badge = orch && !expanded ? ` [+${subAgents.length}]` : ''
  const rawTitle = agent.title || 'agent'
  const titleWithChrome = `${arrow}${rawTitle}${badge}`
  const titleStr = trimCell(titleWithChrome, layout.title)
  const repoStr = extractRepoName(agent.repoDisplay || agent.repo || '')
  const ageStr = ago(agent.lastUpdated || agent.createdAt)

  return React.createElement(Box, {
    paddingX: 0,
    width: '100%',
    height: 1,
    overflow: 'hidden',
    backgroundColor: isFocused ? THEME.focusBg : undefined,
    flexDirection: 'row',
    minWidth: 0,
  },
  React.createElement(Cell, { width: 1 },
    React.createElement(Text, { color: tint(THEME.accent), bold: !isDimmed }, isFocused ? '>' : ' ')
  ),
  React.createElement(Cell, { width: layout.id },
    React.createElement(Text, { color: tint(THEME.accentMuted), bold: !isDimmed, wrap: 'truncate' }, shortId)
  ),
  React.createElement(Cell, { width: layout.title },
    React.createElement(Text, {
      color: orch ? tint(THEME.accentSoft) : tint(recencyColor),
      bold: !isDimmed,
      underline: orch && !isDimmed,
      wrap: 'truncate',
    }, titleStr)
  ),
  React.createElement(Gap),
  React.createElement(Cell, { grow: true, minWidth: layout.repoMin },
    React.createElement(Text, { color: tint(THEME.text), wrap: 'truncate', dimColor: isDimmed }, repoStr)
  ),
  React.createElement(Gap),
  React.createElement(Cell, { width: layout.status },
    React.createElement(Text, { color: tint(stateColor), bold: !isDimmed, wrap: 'truncate' }, stateShort)
  ),
  React.createElement(Gap),
  React.createElement(Cell, { width: layout.progress },
    React.createElement(FillBar, { tick, width: profile === 'tight' ? 4 : 6, isDimmed, state })
  ),
  layout.time > 0 && React.createElement(Cell, { width: layout.time },
    React.createElement(Text, { color: tint(THEME.subtleText), dimColor: true, wrap: 'truncate' }, ageStr)
  ))
}

export function SubAgentRow({ agent, tick, isLast }) {
  const profile = getLayoutProfile()
  const layout = COLUMN_LAYOUT[profile]
  const state = agent.state || 'UNKNOWN'
  const stateColor = STATUS_COLOR[state] || THEME.text
  const stateShort = STATUS_SHORT[state] || state.substring(0, 5)

  const shortId = (agent.id || '').slice(0, 4)
  const title = trimCell(agent.title || agent.role || 'agent', layout.title - 3)
  const repoStr = extractRepoName(agent.repoDisplay || agent.repo || '')
  const connector = isLast ? '`- ' : '|- '

  return React.createElement(Box, {
    paddingX: 0,
    width: '100%',
    height: 1,
    overflow: 'hidden',
    flexDirection: 'row',
    minWidth: 0,
  },
  React.createElement(Cell, { width: 1 },
    React.createElement(Text, null, ' ')
  ),
  React.createElement(Cell, { width: layout.id },
    React.createElement(Text, { color: 'gray' }, connector),
    React.createElement(Text, { color: THEME.accentMuted, wrap: 'truncate' }, shortId)
  ),
  React.createElement(Cell, { width: layout.title },
    React.createElement(Text, { color: THEME.text, wrap: 'truncate' }, `  ${title}`)
  ),
  React.createElement(Gap),
  React.createElement(Cell, { grow: true, minWidth: layout.repoMin },
    React.createElement(Text, { color: THEME.subtleText, wrap: 'truncate', dimColor: true }, repoStr)
  ),
  React.createElement(Gap),
  React.createElement(Cell, { width: layout.status },
    React.createElement(Text, { color: stateColor, wrap: 'truncate' }, stateShort)
  ),
  React.createElement(Gap),
  React.createElement(Cell, { width: layout.progress },
    React.createElement(FillBar, { tick, width: profile === 'tight' ? 4 : 6, isDimmed: false, state })
  ),
  layout.time > 0 && React.createElement(Cell, { width: layout.time },
    React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, ago(agent.lastUpdated || agent.createdAt))
  ))
}

export function EmptySubAgentsRow() {
  return React.createElement(Box, {
    paddingX: 1,
    width: '100%',
    height: 1,
    flexDirection: 'row',
    minWidth: 0,
  },
  React.createElement(Text, { color: 'gray' }, '       `- '),
  React.createElement(Text, { color: 'gray', dimColor: true }, 'none yet'))
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
