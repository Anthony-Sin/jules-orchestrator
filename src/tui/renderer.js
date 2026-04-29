import React from 'react'
import { render, Box, Text } from 'ink'
import chalk from 'chalk'
import { getSessions, getQueue, getQuotaUsed, quotaRemaining } from '../state/store.js'
import { DEFAULTS } from '../../config/defaults.js'

const STATE_COLOR = {
  QUEUED:                  s => chalk.gray(s),
  PLANNING:                s => chalk.cyan(s),
  AWAITING_PLAN_APPROVAL:  s => chalk.yellow(s),
  AWAITING_USER_FEEDBACK:  s => chalk.magentaBright(s),
  IN_PROGRESS:             s => chalk.blue(s),
  COMPLETED:               s => chalk.green(s),
  FAILED:                  s => chalk.red(s),
  KILLED:                  s => chalk.red.dim(s),
  PAUSED:                  s => chalk.yellow.dim(s),
}

function colorState(state) {
  const fn = STATE_COLOR[state] || (s => chalk.white(s))
  return fn(state)
}

function typeLabel(type) {
  if (type === 'frontend') return chalk.greenBright('FE')
  if (type === 'backend') return chalk.blueBright('BE')
  if (type === 'conflict') return chalk.redBright('CR')
  return chalk.gray(type)
}

function ago(ms) {
  if (!ms) return ''
  const s = Math.floor((Date.now() - new Date(ms).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

function truncate(str, n) {
  if (!str) return ''
  return str.length > n ? str.slice(0, n - 1) + '…' : str
}

export function Dashboard({ searchTerm = '' }) {
  const used = getQuotaUsed()
  const remaining = quotaRemaining()
  const pct = Math.floor((used / DEFAULTS.DAILY_QUOTA) * 20)
  const bar = chalk.green('█'.repeat(pct)) + chalk.gray('░'.repeat(Math.max(0, 20 - pct)))
  const quotaColor = remaining <= 10 ? chalk.red : remaining <= 20 ? chalk.yellow : chalk.white

  const sessions = getSessions()
  const active = sessions.filter(s => !['COMPLETED', 'FAILED', 'KILLED'].includes(s.state))
  const fe = active.filter(s => s.poolType === 'frontend').length
  const be = active.filter(s => s.poolType === 'backend').length

  const queue = getQueue()

  let filteredSessions = sessions
  if (searchTerm && !searchTerm.startsWith('/')) {
    const term = searchTerm.toLowerCase()
    filteredSessions = sessions.filter(s =>
      (s.title && s.title.toLowerCase().includes(term)) ||
      (s.id && s.id.toLowerCase().includes(term)) ||
      (s.state && s.state.toLowerCase().includes(term))
    )
  }

  const displayed = filteredSessions.slice(-20).reverse()

  return React.createElement(Box, { flexDirection: 'column' },
    React.createElement(Box, { flexDirection: 'column', marginBottom: 1 },
      React.createElement(Text, { bold: true, color: 'white' }, '\n  JULES ORCHESTRATOR'),
      React.createElement(Text, { dimColor: true }, '  ─────────────────────────────────────────────\n')
    ),
    React.createElement(Box, { marginBottom: 1, flexDirection: 'column' },
      React.createElement(Text, {}, `  Quota  [${bar}]  ${quotaColor(`${used}/${DEFAULTS.DAILY_QUOTA}`)} used  ${chalk.dim(`(${remaining} remaining)`)}`),
      React.createElement(Text, {}, `  Pools  ${chalk.greenBright(`FE ${fe}/${DEFAULTS.POOL_SIZE_FRONTEND}`)}  ${chalk.blueBright(`BE ${be}/${DEFAULTS.POOL_SIZE_BACKEND}`)}`),
      queue.length > 0 && React.createElement(Text, {}, `  Queue  ${chalk.yellow(`${queue.length} task${queue.length > 1 ? 's' : ''} waiting`)}`)
    ),
    sessions.length === 0 ? (
      React.createElement(Box, { marginLeft: 2 },
        React.createElement(Text, { dimColor: true }, 'No sessions yet. Use: jorch run "your task here"\n')
      )
    ) : (
      React.createElement(Box, { flexDirection: 'column' },
        React.createElement(Box, { borderStyle: 'single', borderColor: 'gray', flexDirection: 'column', paddingX: 1 },
          React.createElement(Box, {},
            React.createElement(Box, { width: 8 }, React.createElement(Text, { dimColor: true }, 'type')),
            React.createElement(Box, { width: 38 }, React.createElement(Text, { dimColor: true }, 'title')),
            React.createElement(Box, { width: 26 }, React.createElement(Text, { dimColor: true }, 'state')),
            React.createElement(Box, { width: 14 }, React.createElement(Text, { dimColor: true }, 'last active')),
            React.createElement(Box, { width: 25 }, React.createElement(Text, { dimColor: true }, 'repo')),
            React.createElement(Box, { width: 20 }, React.createElement(Text, { dimColor: true }, 'id')),
            React.createElement(Box, { width: 35 }, React.createElement(Text, { dimColor: true }, 'pull request'))
          ),
          displayed.map(s => (
            React.createElement(Box, { key: s.id },
              React.createElement(Box, { width: 8 }, React.createElement(Text, {}, typeLabel(s.type || s.poolType))),
              React.createElement(Box, { width: 38 }, React.createElement(Text, {}, truncate(s.title, 36))),
              React.createElement(Box, { width: 26 }, React.createElement(Text, {}, colorState(s.state || 'UNKNOWN'))),
              React.createElement(Box, { width: 14 }, React.createElement(Text, { dimColor: true }, ago(s.lastUpdated || s.createdAt))),
              React.createElement(Box, { width: 25 }, React.createElement(Text, {}, truncate(s.repo || '-', 23))),
              React.createElement(Box, { width: 20 }, React.createElement(Text, { dimColor: true }, truncate(s.id, 18))),
              React.createElement(Box, { width: 35 }, React.createElement(Text, { color: 'blueBright' }, s.state === 'COMPLETED' ? truncate(s.pullRequestUrl || '-', 33) : ''))
            )
          ))
        )
      )
    )
  )
}

let inkInstance = null;

export function renderDashboard(searchTerm = '') {
  if (!inkInstance) {
    console.clear()
    inkInstance = render(React.createElement(Dashboard, { searchTerm }));
  } else {
    inkInstance.rerender(React.createElement(Dashboard, { searchTerm }));
  }
}
