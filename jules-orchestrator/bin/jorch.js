#!/usr/bin/env node
import { Command } from 'commander'
import chalk from 'chalk'
import inquirer from 'inquirer'
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
  .description('Show live dashboard with interactive prompt')
  .action(async () => {
    const { DEFAULTS } = await import('../config/defaults.js')

    let filter = ''
    let isPrompting = false

    // Background polling quietly updates the state
    const interval = setInterval(async () => {
      await pollAndUpdate()
      // Only re-render if we aren't currently waiting for user input,
      // but in an async prompt loop, we are basically always waiting for input.
      // We will let the background updates happen quietly and the UI will reflect
      // changes when the user enters a command or search.
    }, DEFAULTS.POLL_INTERVAL_MS)

    process.on('SIGINT', () => {
      clearInterval(interval)
      process.exit(0)
    })

    while (true) {
      renderDashboard(filter)

      try {
        const { input } = await inquirer.prompt([{
          type: 'input',
          name: 'input',
          message: '> Search sessions or type / to use commands:'
        }])

        const trimmed = input.trim()

        if (trimmed.startsWith('/')) {
          const parts = trimmed.slice(1).split(' ')
          const cmd = parts[0]

          if (cmd === 'kill' && parts[1]) {
            await killSession(parts[1])
          } else if (cmd === 'exit' || cmd === 'quit') {
            clearInterval(interval)
            process.exit(0)
          }
          filter = '' // Reset filter after a command
        } else {
          filter = trimmed
        }
      } catch (err) {
        if (err.name === 'ExitPromptError' || err.message.includes('closed')) {
          clearInterval(interval)
          process.exit(0)
        }
      }
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
