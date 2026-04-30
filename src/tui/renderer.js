import React from 'react'
import { render, Box, Text } from 'ink'
import chalk from 'chalk'
import { getSessions, getQueue, getQuotaUsed, quotaRemaining, getQuotaLimit, getConfig } from '../state/store.js'
import { DEFAULTS } from '../../config/defaults.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkgPath = path.join(__dirname, '..', '..', 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
export const version = pkg.version

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

export function Dashboard({ inputBuffer = '', searchTerm = '', onSelect = () => {}, onRowChange = () => {}, selectedIndex = 0, statusMsg = '' }) {
  const used = getQuotaUsed()
  const remaining = quotaRemaining()
  const limit = getQuotaLimit()
  const hasLimit = limit !== null
  const pct = hasLimit ? Math.floor((used / limit) * 20) : 0
  const bar = chalk.green('█'.repeat(pct)) + chalk.gray('░'.repeat(Math.max(0, 20 - pct)))
  const quotaColor = !hasLimit ? chalk.yellow.dim : remaining <= 10 ? chalk.red : remaining <= 20 ? chalk.yellow : chalk.white

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

  const logo = `
   ██╗██╗   ██╗██╗     ███████╗███████╗
   ██║██║   ██║██║     ██╔════╝██╔════╝
   ██║██║   ██║██║     █████╗  ███████╗
   ██║██║   ██║██║     ██╔══╝  ╚════██║
   ██║╚██████╔╝███████╗███████╗███████║
   ╚═╝ ╚═════╝ ╚══════╝╚══════╝╚══════╝
`

  return React.createElement(Box, { flexDirection: 'column' },
    React.createElement(Box, { flexDirection: 'column', marginBottom: 1 },
      React.createElement(Text, { color: 'red', bold: true }, logo),
      React.createElement(Text, { color: 'magentaBright', bold: true }, '   powered by jules\n'),
      React.createElement(Text, { color: 'greenBright', bold: true }, '   Welcome to Jules CLI!'),
      React.createElement(Text, { color: 'white' }, `   v${version}`),
      React.createElement(Text, { color: 'white', dimColor: true }, '   What would you like to build today?\n')
    ),
    React.createElement(Box, { marginBottom: 1, paddingLeft: 3 },
      React.createElement(Text, { color: 'yellow' }, '> '),
      React.createElement(Text, { dimColor: inputBuffer.length === 0 }, inputBuffer.length > 0 ? inputBuffer + '█' : 'Search sessions or type / to use commands█')
    ),
    sessions.length === 0 ? (
      React.createElement(Box, { marginLeft: 2, marginBottom: 1 },
        React.createElement(Text, { dimColor: true }, 'No sessions yet. Use: jorch run "your task here"\n')
      )
    ) : (
      React.createElement(Box, { flexDirection: 'column', marginBottom: 1 },
        React.createElement(Box, { borderStyle: 'round', borderColor: 'gray', flexDirection: 'column', paddingX: 1 },
          React.createElement(Box, { marginBottom: 0 },
            React.createElement(Box, { width: 8, borderStyle: 'round', borderColor: 'gray', justifyContent: 'center' }, React.createElement(Text, { dimColor: true, bold: true }, 'ID')),
            React.createElement(Box, { width: 45, borderStyle: 'round', borderColor: 'gray', justifyContent: 'center' }, React.createElement(Text, { dimColor: true, bold: true }, 'Description')),
            React.createElement(Box, { width: 25, borderStyle: 'round', borderColor: 'gray', justifyContent: 'center' }, React.createElement(Text, { dimColor: true, bold: true }, 'Repo')),
            React.createElement(Box, { width: 18, borderStyle: 'round', borderColor: 'gray', justifyContent: 'center' }, React.createElement(Text, { dimColor: true, bold: true }, 'Last active')),
            React.createElement(Box, { width: 20, borderStyle: 'round', borderColor: 'gray', justifyContent: 'center' }, React.createElement(Text, { dimColor: true, bold: true }, 'Status'))
          ),
          displayed.map((s, idx) => {
            const isSelected = idx === selectedIndex
            const repoDisplay = s.repoDisplay || (s.repo ? s.repo.replace(/^sources\/github-/, '').replace('-', '/') : '-')

            // To get full row highlight while preserving box columns:
            // Inverse colors in the entire text blocks using Chalk if selected, or Ink Text backgrounds.
            const bgProps = isSelected ? { backgroundColor: 'blue', color: 'white' } : {}

            return React.createElement(Box, { key: s.id, width: 118, paddingLeft: 1 },
              React.createElement(Box, { width: 8 }, React.createElement(Text, { ...bgProps, wrap: 'truncate' }, truncate(s.id, 6).padEnd(8))),
              React.createElement(Box, { width: 45 }, React.createElement(Text, { ...bgProps, wrap: 'truncate' }, truncate(s.title, 43).padEnd(45))),
              React.createElement(Box, { width: 25 }, React.createElement(Text, { ...bgProps, wrap: 'truncate' }, truncate(repoDisplay, 23).padEnd(25))),
              React.createElement(Box, { width: 18 }, React.createElement(Text, { ...bgProps, wrap: 'truncate' }, ago(s.lastUpdated || s.createdAt).padEnd(18))),
              React.createElement(Box, { width: 20 }, React.createElement(Text, { ...bgProps, wrap: 'truncate' },
                colorState(s.state || 'UNKNOWN') + ' '.repeat(Math.max(0, 20 - (s.state || 'UNKNOWN').length))
              ))
            )
          })
        )
      )
    ),
    React.createElement(Box, { marginBottom: 1, flexDirection: 'column' },
      hasLimit
        ? React.createElement(Text, {}, `  Quota  [${bar}]  ${quotaColor(`${used}/${limit}`)} used  ${chalk.dim(`(${remaining} remaining)`)}`)
        : React.createElement(Text, {}, `  Quota limit unknown — set it with: ${chalk.yellow.dim('jorch config set-quota <n>')}`)
    ),
    React.createElement(Box, { flexDirection: 'column', marginTop: 1 },
      statusMsg ? React.createElement(Text, { color: 'greenBright' }, `  ${statusMsg}`) : null,
      React.createElement(Text, {}, 'enter: select session  |  ctrl+r: refresh  |  ctrl+d: delete  |  ctrl+c: quit'),
      React.createElement(Text, { dimColor: true }, `Working in: ~  ${(getConfig().source || 'unknown/unknown').replace(/^sources\/github-/, '').replace('-', '/')} (${getConfig().branch || 'main'})`)
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
