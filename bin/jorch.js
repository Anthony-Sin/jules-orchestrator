#!/usr/bin/env node
import { Command } from 'commander'
import chalk from 'chalk'
import inquirer from 'inquirer'
import React, { useState, useEffect } from 'react'
import { render, useInput } from 'ink'

import { deleteSession, listSessions, getSession, parseSourceDisplay, sendMessage, createSession } from '../src/state/jules-api.js'
import { upsertSession, getSessions, getActiveSessions, store, unlockFiles, getQueue, setConfig, getConfig } from '../src/state/store.js'
import { runCrashRecovery } from '../src/orchestrator/governor.js'

const TERMINAL_STATES = ['COMPLETED', 'FAILED', 'KILLED']

export async function killSession(sessionId) {
  try {
    await deleteSession(sessionId)
  } catch (_) {}
  unlockFiles(sessionId)
  upsertSession({ id: sessionId, state: 'KILLED', lastUpdated: Date.now() })
}

export async function pollAndUpdate() {
  const active = getActiveSessions()

  const results = await Promise.all(active.map(async (session) => {
    try {
      const fresh = await getSession(session.id)
      return { session, fresh }
    } catch (err) {
      return { session, error: err }
    }
  }))

  const updated = []

  for (const { session, fresh, error } of results) {
    if (error || !fresh) continue

    try {
      const newState = fresh.state || session.state
      const updates = { id: session.id, state: newState, lastUpdated: Date.now() }
      if (fresh.title) updates.title = fresh.title
      if (fresh.createdAt) updates.createdAt = fresh.createdAt
      if (fresh.julesUrl) updates.julesUrl = fresh.julesUrl
      if (fresh.sourceContext?.source) updates.repoDisplay = parseSourceDisplay(fresh.sourceContext.source)
      else if (fresh.repoDisplay) updates.repoDisplay = fresh.repoDisplay

      const oldState = session.state;
      upsertSession(updates)

      if (oldState !== newState && (newState === 'COMPLETED' || newState === 'FAILED')) {
        if (newState === 'COMPLETED') {
           const allSessions = getSessions();
           for (const dep of allSessions) {
             if (dep.state === 'PAUSED' && dep.waitingOn === session.id) {
               upsertSession({ id: dep.id, state: 'QUEUED', waitingOn: null });
               await sendMessage(dep.id, `[RESUMED] Agent ${session.id} has completed. You may proceed.`);
             }
           }
        }
      }

      if (TERMINAL_STATES.includes(newState)) unlockFiles(session.id)
      updated.push({ id: session.id, state: newState, title: updates.title || session.title })
    } catch (_) {}
  }
  return updated
}

export async function syncSessions() {
  try {
    const data = await listSessions()
    const sessions = Array.isArray(data) ? data : (data.sessions || [])
    for (const remote of sessions) {
      const sessionData = {
        id: remote.id || (remote.name ? remote.name.split('/').pop() : ''),
        title: remote.title || 'Unknown task',
        state: remote.state || 'UNKNOWN',
        createdAt: remote.createTime || Date.now(),
        lastUpdated: remote.updateTime || Date.now(),
        repo: remote.sourceContext?.source || 'unknown',
        repoDisplay: parseSourceDisplay(remote.sourceContext?.source),
        julesUrl: remote.url
      }
      if (sessionData.id) upsertSession(sessionData)
    }
  } catch (_) {}
}

import { renderDashboard, Dashboard } from '../src/tui/renderer.js'
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
  .description('Jules multi-agent task manager')
  .version(version)

// ── jorch run "<prompt>" ──────────────────────────────────────────────────────
program
  .command('run <prompt>')
  .description('Create and dispatch a task session to Jules')
  .action(async (rawPrompt) => {
    console.log(chalk.dim('\n  Creating new task session…'))

    try {
      const source = getConfig().source
      if (!source || source === 'NOT SET') {
         console.log(chalk.red(`  ✗ Failed to launch: No repo selected. Please configure a source first (e.g. jorch config set-source github-owner-repo).`))
         return
      }

      const julesSession = await createSession({ prompt: rawPrompt, source })
      const sessionId = julesSession.name.split('/').pop()

      upsertSession({
        id: sessionId,
        title: rawPrompt.substring(0, 30),
        type: 'task',
        state: julesSession.state || 'QUEUED',
        createdAt: Date.now(),
        lastUpdated: Date.now(),
        repo: source,
      })

      console.log(chalk.green(`  ✓ Launched Task → ${sessionId}`))
    } catch (err) {
      console.log(chalk.red(`  ✗ Failed to launch: ${err.message}`))
    }

    console.log()
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
      setSelectedIndex(Math.min(filteredSessions.length - 1, selectedIndex + 1))
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
    console.log(chalk.dim(`\n  Conflict resolver not available without pool manager…`))
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
    // Start background Orchestrator loop initialization when TUI opens
    runCrashRecovery().catch(err => {
      // Ignore background initialization errors
    })
    program.commands.find(cmd => cmd.name() === 'status')._actionHandler([]);
  }
})

program.parse()