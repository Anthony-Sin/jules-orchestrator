#!/usr/bin/env node
import { Command } from 'commander'
import chalk from 'chalk'
import { splitPrompt, groupByType } from '../src/decomposer/decomposer.js'
import { dispatchTask, dispatchConflictResolver, killSession, pollAndUpdate, poolSlotsFree } from '../src/pools/pool-manager.js'
import { renderDashboard } from '../src/tui/renderer.js'
import { getSessions, getQueue, getConfig, setConfig, quotaRemaining, getActiveSessions } from '../src/state/store.js'

const program = new Command()

program
  .name('jorch')
  .description('Jules multi-agent orchestrator')
  .version('0.1.0')

// ── jorch run "<prompt>" ──────────────────────────────────────────────────────
program
  .command('run <prompt>')
  .description('Decompose and dispatch a task (or multiple tasks) to the agent pools')
  .action(async (rawPrompt) => {
    console.log(chalk.dim('\n  Decomposing prompt…'))

    const tasks = splitPrompt(rawPrompt)
    const grouped = groupByType(tasks)

    console.log(chalk.white(`\n  Found ${tasks.length} task(s):`))
    for (const t of tasks) {
      const typeLabel = t.type === 'frontend' ? chalk.greenBright('FE') : t.type === 'backend' ? chalk.blueBright('BE') : chalk.redBright('CR')
      console.log(`  ${typeLabel}  ${chalk.dim('priority ' + t.priority)}  ${t.title}`)
    }
    console.log()

    if (quotaRemaining() <= 5) {
      console.log(chalk.yellow(`  Warning: only ${quotaRemaining()} sessions remaining today.\n`))
    }

    let dispatched = 0
    let queued = 0
    const errors = []

    for (const task of tasks) {
      try {
        const result = await dispatchTask(task)
        if (result.queued) {
          queued++
          console.log(chalk.yellow(`  ↷ Queued    ${task.title.slice(0, 50)} (${result.reason})`))
        } else {
          dispatched++
          console.log(chalk.green(`  ✓ Launched  ${task.title.slice(0, 50)} → ${result.sessionId}`))
        }
      } catch (err) {
        errors.push({ task, err })
        console.log(chalk.red(`  ✗ Failed    ${task.title.slice(0, 50)}: ${err.message}`))
      }
    }

    console.log()
    console.log(chalk.dim(`  ${dispatched} launched  ${queued} queued  ${errors.length} failed`))
    console.log(chalk.dim('  Run: jorch status  to watch progress\n'))
  })

// ── jorch status ──────────────────────────────────────────────────────────────
program
  .command('status')
  .description('Show live dashboard (polls every 5s, Ctrl+C to exit)')
  .option('-w, --watch', 'Keep polling every 5s')
  .action(async (opts) => {
    renderDashboard()

    if (opts.watch) {
      const { DEFAULTS } = await import('../config/defaults.js')
      console.log(chalk.dim('  Watching… Ctrl+C to stop\n'))
      const interval = setInterval(async () => {
        await pollAndUpdate()
        renderDashboard()
      }, DEFAULTS.POLL_INTERVAL_MS)

      process.on('SIGINT', () => { clearInterval(interval); process.exit(0) })
    } else {
      console.log(chalk.dim('  Tip: use --watch to keep polling\n'))
    }
  })

// ── jorch poll ────────────────────────────────────────────────────────────────
program
  .command('poll')
  .description('Poll all active sessions once and update state')
  .action(async () => {
    console.log(chalk.dim('\n  Polling active sessions…'))
    const updates = await pollAndUpdate()
    for (const u of updates) {
      console.log(`  ${u.id.slice(0, 14)}  ${u.title?.slice(0, 40)}  →  ${u.state}`)
    }
    if (updates.length === 0) console.log(chalk.dim('  No active sessions.'))
    console.log()
  })

// ── jorch kill <id> ───────────────────────────────────────────────────────────
program
  .command('kill <sessionId>')
  .description('Kill a session and free its pool slot')
  .action(async (sessionId) => {
    console.log(chalk.dim(`\n  Killing session ${sessionId}…`))
    await killSession(sessionId)
    console.log(chalk.green(`  ✓ Session ${sessionId} killed and slot freed.\n`))
  })

// ── jorch queue ───────────────────────────────────────────────────────────────
program
  .command('queue')
  .description('Show pending tasks waiting for a pool slot')
  .action(() => {
    const queue = getQueue()
    if (queue.length === 0) {
      console.log(chalk.dim('\n  Queue is empty.\n'))
      return
    }
    console.log(chalk.white(`\n  ${queue.length} task(s) in queue:\n`))
    for (const t of queue) {
      const typeLabel = t.type === 'frontend' ? chalk.greenBright('FE') : chalk.blueBright('BE')
      console.log(`  ${typeLabel}  pri:${t.priority}  ${t.title}`)
    }
    console.log()
  })

// ── jorch resolve ─────────────────────────────────────────────────────────────
program
  .command('resolve <description> <branchA> <branchB>')
  .description('Spawn a conflict-resolver session for two branches')
  .action(async (description, branchA, branchB) => {
    console.log(chalk.dim(`\n  Spawning conflict resolver for ${branchA} + ${branchB}…`))
    const sessionId = await dispatchConflictResolver(description, branchA, branchB)
    console.log(chalk.green(`  ✓ Resolver session started: ${sessionId}\n`))
  })

// ── jorch sessions ────────────────────────────────────────────────────────────
program
  .command('sessions')
  .description('List all tracked sessions')
  .option('--active', 'Show only active sessions')
  .action((opts) => {
    const sessions = opts.active ? getActiveSessions() : getSessions()
    if (sessions.length === 0) {
      console.log(chalk.dim('\n  No sessions found.\n'))
      return
    }
    renderDashboard()
  })

// ── jorch config ──────────────────────────────────────────────────────────────
const configCmd = program.command('config').description('Manage orchestrator config')

configCmd
  .command('set-key <apiKey>')
  .description('Set your Jules API key')
  .action((apiKey) => {
    setConfig('apiKey', apiKey)
    console.log(chalk.green('\n  ✓ API key saved.\n'))
  })

configCmd
  .command('set-source <source>')
  .description('Set the Jules source (e.g. sources/github-owner-repo)')
  .action((source) => {
    setConfig('source', source)
    console.log(chalk.green(`\n  ✓ Source set to: ${source}\n`))
  })

configCmd
  .command('set-branch <branch>')
  .description('Set the default branch (default: main)')
  .action((branch) => {
    setConfig('branch', branch)
    console.log(chalk.green(`\n  ✓ Branch set to: ${branch}\n`))
  })

configCmd
  .command('show')
  .description('Show current config')
  .action(() => {
    const cfg = getConfig()
    console.log(chalk.white('\n  Current config:'))
    console.log(`  API key : ${cfg.apiKey ? chalk.green('set') : chalk.red('not set')}`)
    console.log(`  Source  : ${cfg.source || chalk.dim('not set')}`)
    console.log(`  Branch  : ${cfg.branch || chalk.dim('main (default)')}`)
    console.log()
  })

program.parse()
