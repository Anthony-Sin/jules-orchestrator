#!/usr/bin/env node
import { Command } from 'commander'
import chalk from 'chalk'
import inquirer from 'inquirer'
import React, { useState, useEffect } from 'react'
import { render, useInput } from 'ink'
import { splitPrompt, groupByType } from '../src/decomposer/decomposer.js'
import { dispatchTask, dispatchConflictResolver, killSession, pollAndUpdate, poolSlotsFree, syncSessions } from '../src/pools/pool-manager.js'
import { renderDashboard, Dashboard } from '../src/tui/renderer.js'
import { getSessions, getQueue, getConfig, setConfig, quotaRemaining, getActiveSessions, syncQuota, setQuotaLimit } from '../src/state/store.js'
import { DEFAULTS } from '../config/defaults.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkgPath = path.join(__dirname, '..', 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
const version = pkg.version

const program = new Command()

program
  .name('jorch')
  .description('Jules multi-agent orchestrator')
  .version(version)

// ── jorch run "<prompt>" ──────────────────────────────────────────────────────
program
  .command('run <prompt>')
  .description('Decompose and dispatch a task (or multiple tasks) to the agent pools')
  .action(async (rawPrompt) => {
    console.log(chalk.dim('\n  Decomposing prompt…'))

    const tasks = await splitPrompt(rawPrompt)
    const grouped = groupByType(tasks)

    console.log(chalk.white(`\n  Found ${tasks.length} task(s):`))
    for (const t of tasks) {
      const typeLabel = t.type === 'frontend' ? chalk.greenBright('FE') : t.type === 'backend' ? chalk.blueBright('BE') : chalk.redBright('CR')
      console.log(`  ${typeLabel}  ${chalk.dim('priority ' + t.priority)}  ${t.title}`)
    }
    console.log()

    await syncQuota()
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

function StatusApp() {
  const [inputBuffer, setInputBuffer] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [statusMsg, setStatusMsg] = useState('')
  const [selectedSession, setSelectedSession] = useState(null)
  const [lastUpdate, setLastUpdate] = useState(Date.now())

  useEffect(() => {
    syncQuota()
    syncSessions().then(() => setLastUpdate(Date.now()))
    const interval = setInterval(async () => {
      await pollAndUpdate()
      setLastUpdate(Date.now())
    }, DEFAULTS.POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [])

  useInput(async (input, key) => {
    if (key.ctrl && input === 'c') {
      process.exit(0)
    }

    const sessions = getSessions()
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

    if (key.ctrl && input === 'r') {
      await pollAndUpdate()
      setLastUpdate(Date.now())
      setStatusMsg('Refreshed')
      setTimeout(() => setStatusMsg(''), 2000)
      return
    }

    if (key.ctrl && input === 'd') {
      if (displayed[selectedIndex]) {
        await killSession(displayed[selectedIndex].id)
        await pollAndUpdate()
        setLastUpdate(Date.now())
        setStatusMsg('Deleted')
        setTimeout(() => setStatusMsg(''), 2000)
        setSelectedIndex(0)
      }
      return
    }

    if (key.upArrow) {
      setSelectedIndex(Math.max(0, selectedIndex - 1))
      return
    }

    if (key.downArrow) {
      setSelectedIndex(Math.min(displayed.length - 1, selectedIndex + 1))
      return
    }

    if (key.return) {
      if (inputBuffer.startsWith('/')) {
        // command parsing logic if needed
        if (inputBuffer === '/quit' || inputBuffer === '/exit') {
          process.exit(0)
        } else if (inputBuffer.startsWith('/kill ')) {
          const id = inputBuffer.split(' ')[1]
          if (id) {
            await killSession(id)
            await pollAndUpdate()
            setLastUpdate(Date.now())
          }
        } else if (inputBuffer.startsWith('/repo ')) {
          const repo = inputBuffer.split(' ')[1]
          if (repo) {
            setConfig('source', repo)
          }
        } else if (inputBuffer.startsWith('/branch ')) {
          const branch = inputBuffer.split(' ')[1]
          if (branch) {
            setConfig('branch', branch)
          }
        }
        setInputBuffer('')
        setSearchTerm('')
      } else if (inputBuffer.length > 0 && searchTerm !== inputBuffer) {
        setSearchTerm(inputBuffer)
        setSelectedIndex(0)
        setInputBuffer('')
      } else {
        if (displayed[selectedIndex]) {
          setSelectedSession(displayed[selectedIndex].id)
        }
      }
      return
    }

    if (key.escape) {
      setInputBuffer('')
      setSearchTerm('')
      return
    }

    if (key.delete || key.backspace) {
      setInputBuffer(prev => prev.slice(0, -1))
      return
    }

    if (input && !key.ctrl && !key.meta) {
      setInputBuffer(prev => prev + input)
    }
  })

  return React.createElement(Dashboard, {
    inputBuffer,
    searchTerm,
    selectedIndex,
    statusMsg,
    lastUpdate,
    onSelect: (id) => setSelectedSession(id),
    onRowChange: (index) => setSelectedIndex(index)
  })
}

program
  .command('status')
  .description('Show live dashboard with interactive TUI (polls every 5s)')
  .action(async () => {
    console.clear()
    render(React.createElement(StatusApp))
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
  .command('set-quota <number>')
  .description('Set the daily quota limit')
  .action((number) => {
    const num = parseInt(number, 10)
    if (isNaN(num) || num <= 0) {
      console.log(chalk.red('\n  ✗ Quota limit must be a positive integer.\n'))
      return
    }
    setQuotaLimit(num)
    console.log(chalk.green(`\n  ✓ Quota limit set to: ${num}\n`))
  })

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
  .command('set-auto-pr <value>')
  .description('Set whether Jules creates PRs automatically (true or false)')
  .action((value) => {
    setConfig('autoPr', value === 'true')
    console.log(chalk.green(`\n  ✓ Auto-PR set to: ${value === 'true'}\n`))
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
    console.log(`  Auto-PR : ${cfg.autoPr !== undefined ? chalk.cyan(cfg.autoPr) : chalk.dim('true (default)')}`)
    console.log()
  })

program.action(() => {
  if (process.argv.length === 2) {
    program.commands.find(cmd => cmd.name() === 'status')._actionHandler([]);
  }
})

program.parse()
