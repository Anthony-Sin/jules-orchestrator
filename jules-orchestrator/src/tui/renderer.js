import chalk from 'chalk'
import Table from 'cli-table3'
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
  const s = Math.floor((Date.now() - ms) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

function truncate(str, n) {
  if (!str) return ''
  return str.length > n ? str.slice(0, n - 1) + '…' : str
}

export function renderDashboard() {
  console.clear()

  // Header
  console.log(chalk.bold.white('\n  JULES ORCHESTRATOR'))
  console.log(chalk.dim('  ─────────────────────────────────────────────\n'))

  // Quota bar
  const used = getQuotaUsed()
  const remaining = quotaRemaining()
  const pct = Math.floor((used / DEFAULTS.DAILY_QUOTA) * 20)
  const bar = chalk.green('█'.repeat(pct)) + chalk.gray('░'.repeat(20 - pct))
  const quotaColor = remaining <= 10 ? chalk.red : remaining <= 20 ? chalk.yellow : chalk.white
  console.log(`  Quota  [${bar}]  ${quotaColor(`${used}/${DEFAULTS.DAILY_QUOTA}`)} used  ${chalk.dim(`(${remaining} remaining)`)}`)

  // Pool summary
  const sessions = getSessions()
  const active = sessions.filter(s => !['COMPLETED', 'FAILED', 'KILLED'].includes(s.state))
  const fe = active.filter(s => s.poolType === 'frontend').length
  const be = active.filter(s => s.poolType === 'backend').length
  console.log(`  Pools  ${chalk.greenBright(`FE ${fe}/${DEFAULTS.POOL_SIZE_FRONTEND}`)}  ${chalk.blueBright(`BE ${be}/${DEFAULTS.POOL_SIZE_BACKEND}`)}`)

  const queue = getQueue()
  if (queue.length > 0) {
    console.log(`  Queue  ${chalk.yellow(`${queue.length} task${queue.length > 1 ? 's' : ''} waiting`)}`)
  }

  console.log()

  // Session table
  const table = new Table({
    head: [
      chalk.dim('type'),
      chalk.dim('title'),
      chalk.dim('state'),
      chalk.dim('last active'),
      chalk.dim('id'),
    ],
    colWidths: [6, 36, 28, 14, 18],
    style: { border: ['dim'], head: [] },
    chars: {
      top: '─', 'top-mid': '┬', 'top-left': '┌', 'top-right': '┐',
      bottom: '─', 'bottom-mid': '┴', 'bottom-left': '└', 'bottom-right': '┘',
      left: '│', 'left-mid': '├', mid: '─', 'mid-mid': '┼',
      right: '│', 'right-mid': '┤', middle: '│',
    },
  })

  const displayed = sessions.slice(-20).reverse()
  for (const s of displayed) {
    table.push([
      typeLabel(s.type || s.poolType),
      truncate(s.title, 34),
      colorState(s.state || 'UNKNOWN'),
      chalk.dim(ago(s.lastUpdated || s.createdAt)),
      chalk.dim(truncate(s.id, 16)),
    ])
  }

  if (sessions.length === 0) {
    console.log(chalk.dim('  No sessions yet. Use: jorch run "your task here"\n'))
  } else {
    console.log(table.toString())
  }

  console.log()
  console.log(chalk.dim('  Commands: jorch run "<task>"  │  jorch status  │  jorch kill <id>  │  jorch queue'))
  console.log()
}
