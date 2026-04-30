import { parseSourceDisplay, getActivities, sendMessage } from '../state/jules-api.js'
import React, { useState, useEffect, useRef } from 'react'
import { render, Box, Text, useInput, useApp } from 'ink'
import TextInput from 'ink-text-input'
import { getSessions, getQueue, getQuotaUsed, quotaRemaining, getQuotaLimit, getConfig, getArchitectureDiagram, setConfig } from '../state/store.js'
import { DEFAULTS } from '../../config/defaults.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'
import { dispatchLeadOrchestrator } from '../jules_lead_orchestrator/julesorchestrator.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkgPath = path.join(__dirname, '..', '..', 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
export const version = pkg.version

let cachedGitRepo = null;
let cachedGitBranch = null;

function getGitInfo() {
  if (cachedGitRepo && cachedGitBranch) return { repo: cachedGitRepo, branch: cachedGitBranch }
  try {
    const originUrl = execSync('git config --get remote.origin.url', { stdio: 'pipe' }).toString().trim()
    let repoName = originUrl.split(':').pop().replace('.git', '')
    if (repoName.includes('/')) {
      const parts = repoName.split('/')
      repoName = `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
    }
    cachedGitRepo = repoName

    const branch = execSync('git rev-parse --abbrev-ref HEAD', { stdio: 'pipe' }).toString().trim()
    cachedGitBranch = branch
  } catch (err) {
    cachedGitRepo = 'unknown/unknown'
    cachedGitBranch = 'unknown'
  }
  return { repo: cachedGitRepo, branch: cachedGitBranch }
}

const STATUS_COLOR = {
  IN_PROGRESS: 'magenta', COMPLETED: 'green', AWAITING_PLAN_APPROVAL: 'yellow',
  AWAITING_USER_FEEDBACK: 'yellow', FAILED: 'red', QUEUED: 'cyan', PLANNING: 'cyan',
  PAUSED: 'gray', KILLED: 'red'
}
const STATUS_SHORT = {
  IN_PROGRESS: 'IN_PRG', COMPLETED: 'DONE', AWAITING_PLAN_APPROVAL: 'WAIT',
  AWAITING_USER_FEEDBACK: 'WAIT', FAILED: 'FAIL', QUEUED: 'QUEUED', PLANNING: 'PLAN',
  PAUSED: 'PAUSED', KILLED: 'KILLED'
}

function ago(ms) {
  if (!ms) return ''
  const s = Math.floor((Date.now() - new Date(ms).getTime()) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

// ── Custom Hook: Debounced Terminal Resize ────────────────────────
function useTerminalSize() {
  const [size, setSize] = useState({
    columns: process.stdout.columns || 80,
    rows: process.stdout.rows || 24
  })

  useEffect(() => {
    let timeoutId
    const onResize = () => {
      clearTimeout(timeoutId)
      timeoutId = setTimeout(() => {
        setSize({
          columns: process.stdout.columns,
          rows: process.stdout.rows
        })
      }, 30)
    }

    process.stdout.on('resize', onResize)
    return () => {
      process.stdout.off('resize', onResize)
      clearTimeout(timeoutId)
    }
  }, [])

  return size
}

// ── Shared UI Components ──────────────────────────────────────────
function FillBar({ value, tick, width = 7, isDimmed, state }) {
  let target = Math.round((value / 100) * width)

  if (state === 'IN_PROGRESS' || state === 'PLANNING') {
      target = Math.floor(width * (0.5 + 0.5 * Math.sin(tick / 5)));
  } else if (state === 'COMPLETED') {
      target = width;
  } else if (state === 'QUEUED' || state === 'PAUSED' || state === 'FAILED' || state === 'KILLED') {
      target = 0;
  }

  const shown  = Math.min(width, Math.max(0, target))
  const empty  = width - shown
  const color  = isDimmed ? 'gray' : (state === 'COMPLETED' ? 'green' : (state === 'IN_PROGRESS' ? 'magenta' : 'yellow'))
  const pct    = state === 'COMPLETED' ? '100%' : (state === 'IN_PROGRESS' ? '... ' : '  0%')

  return React.createElement(Text, null,
    React.createElement(Text, { color: color, dimColor: isDimmed }, '█'.repeat(Math.max(0, shown))),
    React.createElement(Text, { color: 'gray', dimColor: true }, '░'.repeat(Math.max(0, empty))),
    React.createElement(Text, { color: isDimmed ? 'gray' : 'white', dimColor: isDimmed }, ' ' + pct)
  )
}

const CIRC = ['○', '◔', '◑', '◕', '●']
function FillCircle({ tick, isDimmed }) {
  const frame = Math.min(CIRC.length - 1, Math.floor(tick / 3))
  const c = isDimmed ? 'gray' : (frame === CIRC.length - 1 ? (tick % 4 < 2 ? 'green' : 'cyan') : 'gray')
  return React.createElement(Text, { color: c, bold: true }, CIRC[frame])
}

// ── Agent Table Row ───────────────────────────────────────────────
function AgentRow({ agent, selected, tick, isDimmed }) {
  const sc = STATUS_COLOR[agent.state || 'UNKNOWN'] || 'white'
  const ss = STATUS_SHORT[agent.state || 'UNKNOWN'] || (agent.state || 'UNKNOWN')
  const hi = selected && !isDimmed
  const tColor = (base, activeBase = 'black') => isDimmed ? 'gray' : (hi ? activeBase : base)

  const displayId = (agent.id || '').substring(0, 6).padEnd(6)
  const displayTitle = (agent.title || '').substring(0, 12).padEnd(12)
  const displayRepo = parseSourceDisplay(agent.repoDisplay || agent.repo || '').substring(0, 20).padEnd(20)

  return React.createElement(Box, { paddingX: 1, width: "100%", height: 1, overflow: "hidden", backgroundColor: hi ? 'magenta' : undefined, flexDirection: "row" },
      React.createElement(Box, { width: 2, flexShrink: 0 }, React.createElement(Text, { color: tColor('magenta'), bold: true, dimColor: isDimmed }, hi ? '> ' : '  ')),
      React.createElement(Box, { width: 8, flexShrink: 0 }, React.createElement(Text, { color: tColor('yellow'), bold: true, wrap: "truncate", dimColor: isDimmed }, displayId)),
      React.createElement(Box, { width: 14, flexShrink: 0 }, React.createElement(Text, { color: tColor('green'), bold: true, wrap: "truncate", dimColor: isDimmed }, displayTitle)),
      React.createElement(Box, { flexGrow: 1, flexShrink: 1 }, React.createElement(Text, { color: tColor('white'), wrap: "truncate", dimColor: isDimmed }, displayRepo)),
      React.createElement(Box, { width: 8, flexShrink: 0 }, React.createElement(Text, { color: tColor(sc), bold: true, dimColor: isDimmed }, ss)),
      React.createElement(Box, { width: 16, flexShrink: 0 }, React.createElement(FillBar, { value: 0, tick: tick, width: 7, isDimmed: isDimmed, state: agent.state })),
      React.createElement(Box, { width: 4, flexShrink: 0 }, React.createElement(Text, { color: tColor('gray'), dimColor: true }, ago(agent.lastUpdated || agent.createdAt)))
  )
}

// ── Tree Graph Layout ─────────────────────────────────────────────
function MiniGraph({ tick, isDimmed }) {
  const diagram = getArchitectureDiagram() || "Ask the Orchestrator to create a graph of projects"
  const spin = ['|', '/', '-', '\\']
  const s = spin[tick % spin.length]

  return React.createElement(Box, { flexDirection: "column", width: "100%", alignItems: "center", marginBottom: 1, flexShrink: 0, borderStyle: "round", borderColor: isDimmed ? "gray" : "cyan", padding: 1 },
      React.createElement(Text, { color: isDimmed ? 'gray' : 'cyan', bold: !isDimmed, dimColor: isDimmed }, `${s} ARCHITECTURE GRAPH ${s}`),
      React.createElement(Box, { marginTop: 1, alignItems: "center" },
        React.createElement(Text, { color: isDimmed ? 'gray' : 'white', dimColor: isDimmed }, diagram)
      )
  )
}

// ── Chat Panel ────────────────────────────────────────────────────
function wrapText(text, width) {
  const words = text.split(' ')
  const lines = []
  let line = ''
  for (const word of words) {
    const candidate = line ? line + ' ' + word : word
    if (candidate.length > width) { if (line) lines.push(line); line = word }
    else line = candidate
  }
  if (line) lines.push(line)
  return lines
}

function ChatPanel({ messages, input, onChange, onSubmit, focused, scrollOffset, width, height }) {
  const inner = Math.max(10, width - 4)

  const allLines = []
  for (const m of messages) {
    if (m.role === 'agent') {
      allLines.push({ type: 'label', text: '▸ AGENT', color: focused ? 'magenta' : 'gray' })
    } else if (m.role === 'system') {
      allLines.push({ type: 'label', text: '  [SYSTEM]', color: 'gray' })
    } else {
      allLines.push({ type: 'label', text: '  you', color: 'gray' })
    }
    const wrapped = wrapText(m.text, inner - 2)
    for (const l of wrapped)
      allLines.push({ type: 'text', text: l, color: m.role === 'agent' ? (focused ? 'white' : 'gray') : (focused ? 'cyan' : 'gray') })
    allLines.push({ type: 'gap' })
  }

  const VISIBLE = Math.max(10, height - 8)
  const total   = allLines.length
  const start   = Math.max(0, total - VISIBLE - scrollOffset)
  const visible = allLines.slice(start, start + VISIBLE)

  return React.createElement(Box, { flexDirection: "column", borderStyle: "single", borderColor: focused ? 'cyan' : 'gray', width: width, height: "100%", paddingX: 1 },
      React.createElement(Box, { flexShrink: 0, height: 1 },
          React.createElement(Text, { color: focused ? 'magenta' : 'gray', bold: true, wrap: "truncate" }, '▌ AGENT CHAT'),
          scrollOffset > 0 && React.createElement(Text, { color: "gray", dimColor: true }, '  ↑' + scrollOffset)
      ),
      React.createElement(Box, { overflow: "hidden", flexShrink: 0, height: 1 },
          React.createElement(Text, { color: "gray", dimColor: true, wrap: "truncate" }, '─'.repeat(200))
      ),
      React.createElement(Box, { flexDirection: "column", height: VISIBLE, flexGrow: 1, overflow: "hidden" },
          visible.map((l, i) => {
            if (l.type === 'gap') return React.createElement(Box, { key: i, height: 1 }, React.createElement(Text, null, ' '));
            if (l.type === 'label') return React.createElement(Box, { key: i, height: 1, overflow: "hidden" },
                React.createElement(Text, { color: l.color, bold: true, dimColor: l.color === 'gray' || !focused, wrap: "truncate" }, l.text)
            );
            return React.createElement(Box, { key: i, paddingLeft: 2, height: 1, overflow: "hidden" },
                React.createElement(Text, { color: l.color, dimColor: !focused, wrap: "truncate" }, l.text)
            );
          })
      ),
      React.createElement(Box, { overflow: "hidden", flexShrink: 0, height: 1 },
          React.createElement(Text, { color: "gray", dimColor: true, wrap: "truncate" }, '─'.repeat(200))
      ),
      React.createElement(Box, { borderStyle: focused ? 'single' : undefined, borderColor: "cyan", paddingX: focused ? 1 : 0, flexShrink: 0 },
          React.createElement(Text, { color: focused ? 'green' : 'gray' }, '> '),
          React.createElement(TextInput, { value: input, onChange: onChange, onSubmit: onSubmit, placeholder: focused ? 'type message…' : 'ctrl+e to focus', focus: focused })
      )
  )
}

// ── Safe Full-Body Help Screen ────────────────────────────────────
function HelpScreen() {
  return React.createElement(Box, { flexGrow: 1, flexDirection: "column", alignItems: "center", justifyContent: "center", borderStyle: "double", borderColor: "yellow", marginX: 2, marginY: 1 },
      React.createElement(Box, { marginBottom: 2 },
          React.createElement(Text, { color: "yellow", bold: true }, '── JULES COLONY: QUICK REFERENCE ──')
      ),
      React.createElement(Box, { flexDirection: "row", marginBottom: 1, width: 50 },
          React.createElement(Box, { width: 20, justifyContent: "flex-end", paddingRight: 2 }, React.createElement(Text, { color: "cyan", bold: true }, 'Ctrl + T')),
          React.createElement(Box, { flexGrow: 1 }, React.createElement(Text, { color: "white" }, 'Switch focus to Table Mode'))
      ),
      React.createElement(Box, { flexDirection: "row", marginBottom: 1, width: 50 },
          React.createElement(Box, { width: 20, justifyContent: "flex-end", paddingRight: 2 }, React.createElement(Text, { color: "cyan", bold: true }, 'Ctrl + G')),
          React.createElement(Box, { flexGrow: 1 }, React.createElement(Text, { color: "white" }, 'Switch focus to Graph Mode'))
      ),
      React.createElement(Box, { flexDirection: "row", marginBottom: 1, width: 50 },
          React.createElement(Box, { width: 20, justifyContent: "flex-end", paddingRight: 2 }, React.createElement(Text, { color: "cyan", bold: true }, 'Ctrl + E')),
          React.createElement(Box, { flexGrow: 1 }, React.createElement(Text, { color: "white" }, 'Switch focus to Chat Panel'))
      ),
      React.createElement(Box, { flexDirection: "row", marginBottom: 1, width: 50 },
          React.createElement(Box, { width: 20, justifyContent: "flex-end", paddingRight: 2 }, React.createElement(Text, { color: "cyan", bold: true }, 'Ctrl + M')),
          React.createElement(Box, { flexGrow: 1 }, React.createElement(Text, { color: "white" }, 'Change working repository'))
      ),
      React.createElement(Box, { flexDirection: "row", marginBottom: 1, width: 50 },
          React.createElement(Box, { width: 20, justifyContent: "flex-end", paddingRight: 2 }, React.createElement(Text, { color: "magenta", bold: true }, '?')),
          React.createElement(Box, { flexGrow: 1 }, React.createElement(Text, { color: "white" }, 'Toggle this Help Screen'))
      )
  )
}

// ── Main App ──────────────────────────────────────────────────────
export function Dashboard({ inputBuffer = '', searchTerm = '', onSelect = () => {}, onRowChange = () => {}, selectedIndex = 0, statusMsg = '', lastUpdate }) {
  const { exit } = useApp()
  const { columns, rows }               = useTerminalSize()
  const [tick, setTick]                 = useState(0)
  const [sel, setSel]                   = useState(0)
  const [mode, setMode]                 = useState('table')
  const [chatInput, setChatInput]       = useState('')
  const [messages, setMessages]         = useState([])
  const [scrollOffset, setScrollOffset] = useState(0)
  const [tableOffset, setTableOffset]   = useState(0)
  const [showHelp, setShowHelp]         = useState(false)
  const [repoInputMode, setRepoInputMode] = useState(false)
  const [repoInput, setRepoInput]       = useState('')
  const [lastActivityIds, setLastActivityIds] = useState({})
  const [selectedSessionId, setSelectedSessionId] = useState(null)

  const VISIBLE_AGENTS = Math.max(2, rows - 21)

  const sessions = getSessions() || []
  const reversedFiltered = sessions.slice().reverse()
  const AGENTS = reversedFiltered

  useEffect(() => {
    const t = setInterval(() => {
        setTick(n => n + 1)
    }, 200)
    return () => clearInterval(t)
  }, [])

  // Polling for activities for the selected session
  useEffect(() => {
      let active = true;
      const poll = async () => {
          if (!active || mode !== 'chat' || !selectedSessionId) return;
          try {
              const res = await getActivities(selectedSessionId);
              const acts = res.activities || res || [];
              if (Array.isArray(acts) && acts.length > 0) {
                  const newMessages = [];
                  const lastId = lastActivityIds[selectedSessionId];
                  let foundNew = false;

                  const sorted = acts.sort((a,b) => new Date(a.createTime || 0) - new Date(b.createTime || 0));

                  for (const act of sorted) {
                      if (!lastId || foundNew || (!foundNew && act.name > lastId)) {
                          foundNew = true;
                          if (act.originator === 'agent' || act.originator === 'system') {
                              let text = act.description || '';
                              if (act.planGenerated) text += '\nPlan Generated:\n' + JSON.stringify(act.planGenerated);
                              if (act.artifacts && act.artifacts.length > 0) {
                                text += '\nArtifacts generated.';
                              }
                              newMessages.push({ role: act.originator, text: text });
                          }
                      }
                  }

                  if (newMessages.length > 0) {
                      setMessages(m => [...m, ...newMessages]);
                      setLastActivityIds(prev => ({...prev, [selectedSessionId]: sorted[sorted.length-1].name}));
                  } else if (!lastId && sorted.length > 0) {
                      setLastActivityIds(prev => ({...prev, [selectedSessionId]: sorted[sorted.length-1].name}));
                  }
              }
          } catch(e) {}
      };

      const p = setInterval(poll, 3000);
      poll();
      return () => { active = false; clearInterval(p); }
  }, [mode, selectedSessionId, lastActivityIds]);

  useEffect(() => {
    if (sel < tableOffset) {
      setTableOffset(sel)
    } else if (sel >= tableOffset + VISIBLE_AGENTS) {
      setTableOffset(sel - VISIBLE_AGENTS + 1)
    }
  }, [sel, VISIBLE_AGENTS, tableOffset])

  useEffect(() => {
      if (AGENTS[sel]) {
          setSelectedSessionId(AGENTS[sel].id);
      }
  }, [sel, AGENTS]);

  useInput(async (input, key) => {
    if (repoInputMode) {
        if (key.escape) setRepoInputMode(false);
        return; // Let TextInput handle the rest
    }

    if (key.ctrl && input === 'c') exit()

    if (input === '?') { setShowHelp(true); return }
    if (showHelp && (key.escape || input === '?')) { setShowHelp(false); return }
    if (showHelp) return

    if (key.ctrl && input === 'r') {
        // Force re-render/reload state
        setTick(t => t+1);
        return;
    }

    if (key.ctrl && input === 'm') { setRepoInputMode(true); setRepoInput(''); return }
    if (key.ctrl && input === 't') { setMode('table'); return }
    if (key.ctrl && input === 'g') { setMode('graph'); return }
    if (key.ctrl && input === 'e') { setMode('chat'); setScrollOffset(0); return }
    if (key.escape) { setMode('table'); return }

    if (key.tab) {
      setMode(m => m === 'table' ? 'graph' : m === 'graph' ? 'chat' : 'table')
      setScrollOffset(0)
      return
    }

    if (mode === 'chat') {
      if (key.upArrow)   setScrollOffset(o => o + 1)
      if (key.downArrow) setScrollOffset(o => Math.max(0, o - 1))
      if (key.pageUp)    setScrollOffset(o => o + 5)
      if (key.pageDown)  setScrollOffset(o => Math.max(0, o - 5))
      return
    }

    if (mode === 'table') {
      if (key.upArrow)   setSel(i => Math.max(0, i - 1))
      if (key.downArrow) setSel(i => Math.min(Math.max(0, AGENTS.length - 1), i + 1))

      if (key.return) {
        const agent = AGENTS[sel]
        if (agent) {
            setMessages(m => [
              ...m,
              { role: 'system', text: `[SYSTEM] Context switched to ${agent.id}. Node is currently ${agent.state}. Standing by.` },
            ])
            setSelectedSessionId(agent.id);
            setMode('chat')
            setScrollOffset(0)
        }
      }
    }
  })

  async function handleSend(val) {
    if (!val.trim()) return
    const agent = AGENTS[sel]

    if (!agent) {
        // No session selected, create a new one via orchestrator
        setMessages(m => [...m,
          { role: 'user',  text: val.trim() },
          { role: 'system', text: 'Initializing Orchestrator to handle request...' },
        ])
        setChatInput('')
        setScrollOffset(0)
        try {
            const { sessionId } = await dispatchLeadOrchestrator(val.trim(), 1, val.trim().substring(0, 30));
            setMessages(m => [...m, { role: 'system', text: `Dispatched Orchestrator Session: ${sessionId}`}]);
            setSelectedSessionId(sessionId);
        } catch(e) {
            setMessages(m => [...m, { role: 'system', text: `Error: ${e.message}`}]);
        }
        return;
    }

    // Existing session
    setMessages(m => [...m,
      { role: 'user',  text: val.trim() },
      { role: 'system', text: 'Sending to node ' + agent.id + '...' },
    ])
    setChatInput('')
    setScrollOffset(0)

    try {
        await sendMessage(agent.id, val.trim());
    } catch(e) {
        setMessages(m => [...m, { role: 'system', text: `Error: ${e.message}`}]);
    }
  }

  function handleRepoSubmit(val) {
      if (val.trim()) {
          setConfig('source', val.trim());
      }
      setRepoInputMode(false);
  }

  const MIN_COLS = 55
  const MIN_ROWS = 24
  if (columns < MIN_COLS || rows < MIN_ROWS) {
    return React.createElement(Box, { padding: 1, flexDirection: "column", borderStyle: "round", borderColor: "red" },
        React.createElement(Text, { color: "red", bold: true }, '⚠ TERMINAL TOO SMALL'),
        React.createElement(Text, { color: "gray" }, `Expand to > ${MIN_COLS}x${MIN_ROWS}`)
    )
  }

  const WIDE_BREAKPOINT = 115
  const isWide = columns >= WIDE_BREAKPOINT
  const showLeftPanel = isWide || mode !== 'chat'
  const showRightPanel = isWide || mode === 'chat'
  const chatWidth = isWide ? 38 : columns - 2
  const visibleAgents = AGENTS.slice(tableOffset, tableOffset + VISIBLE_AGENTS)
  const leftDimmed = mode === 'chat'
  const tColor = (color) => leftDimmed ? 'gray' : color

  const currentRepoDisplay = parseSourceDisplay(getConfig().source || getGitInfo().repo) || "unknown"

  return React.createElement(Box, { flexDirection: "column", paddingX: 1, width: "100%", height: rows },
      React.createElement(Box, { flexDirection: "row", width: "100%", height: 1, overflow: "hidden", flexShrink: 0 },
          React.createElement(Box, { flexShrink: 0 },
              React.createElement(Text, { color: "yellow", bold: true, wrap: "truncate" }, '━━ J U L E S  C O L O N Y '),
              React.createElement(Text, { color: "gray", dimColor: true, wrap: "truncate" }, '│ '),
              React.createElement(Text, { color: "cyan", dimColor: true, wrap: "truncate" }, `~ ${currentRepoDisplay} `),
              React.createElement(Text, { color: "gray", dimColor: true, wrap: "truncate" }, '│ '),
              React.createElement(Text, { color: "magenta", dimColor: true, wrap: "truncate" }, 'powered by jules ')
          ),
          React.createElement(Box, { flexGrow: 1, overflow: "hidden" },
              React.createElement(Text, { color: "gray", dimColor: true, wrap: "truncate" }, '━'.repeat(200))
          )
      ),

      repoInputMode && React.createElement(Box, { flexDirection: "row", paddingX: 2, paddingY: 1, borderStyle: "round", borderColor: "cyan", flexShrink: 0 },
          React.createElement(Text, { color: "cyan" }, 'Enter new repository source (e.g. sources/github-owner-repo): '),
          React.createElement(TextInput, { value: repoInput, onChange: setRepoInput, onSubmit: handleRepoSubmit })
      ),

      showHelp ? React.createElement(HelpScreen) : React.createElement(Box, { flexDirection: "row", flexGrow: 1, marginTop: 1, overflow: "hidden" },
          showLeftPanel && React.createElement(Box, { flexDirection: "column", flexGrow: 1, flexShrink: 1, marginRight: isWide ? 1 : 0, overflow: "hidden" },
              React.createElement(MiniGraph, { tick: tick, isDimmed: mode !== 'graph' }),
              React.createElement(Box, { paddingX: 1, flexDirection: "row", height: 1, flexShrink: 0 },
                  React.createElement(Box, { width: 2, flexShrink: 0 }, React.createElement(Text, null, ' ')),
                  React.createElement(Box, { width: 8, flexShrink: 0 }, React.createElement(Text, { color: tColor('gray'), bold: true, dimColor: leftDimmed, wrap: "truncate" }, 'ID')),
                  React.createElement(Box, { width: 14, flexShrink: 0 }, React.createElement(Text, { color: tColor('gray'), bold: true, dimColor: leftDimmed, wrap: "truncate" }, 'TITLE')),
                  React.createElement(Box, { flexGrow: 1, flexShrink: 1 }, React.createElement(Text, { color: tColor('gray'), bold: true, dimColor: leftDimmed, wrap: "truncate" }, 'REPO')),
                  React.createElement(Box, { width: 8, flexShrink: 0 }, React.createElement(Text, { color: tColor('gray'), bold: true, dimColor: leftDimmed, wrap: "truncate" }, 'STATUS')),
                  React.createElement(Box, { width: 16, flexShrink: 0 }, React.createElement(Text, { color: tColor('gray'), bold: true, dimColor: leftDimmed, wrap: "truncate" }, 'LOAD')),
                  React.createElement(Box, { width: 4, flexShrink: 0 }, React.createElement(Text, { color: tColor('gray'), bold: true, dimColor: leftDimmed, wrap: "truncate" }, 'AGO'))
              ),
              React.createElement(Box, { paddingX: 1, width: "100%", height: 1, flexDirection: "row", overflow: "hidden", flexShrink: 0 },
                  React.createElement(Box, { flexGrow: 1, overflow: "hidden" },
                      React.createElement(Text, { color: "gray", dimColor: true, wrap: "truncate" }, '─'.repeat(200))
                  ),
                  tableOffset > 0 && React.createElement(Box, { flexShrink: 0 }, React.createElement(Text, { color: tColor('cyan'), bold: true, dimColor: leftDimmed }, ' ↑ MORE ↑ '))
              ),
              React.createElement(Box, { flexDirection: "column", height: VISIBLE_AGENTS, flexShrink: 0 },
                  visibleAgents.map((agent, i) => {
                    const actualIndex = tableOffset + i;
                    return React.createElement(AgentRow, { key: agent.id, agent: agent, selected: mode === 'table' && actualIndex === sel, tick: tick, isDimmed: leftDimmed })
                  })
              ),
              React.createElement(Box, { paddingX: 1, width: "100%", height: 1, flexDirection: "row", overflow: "hidden", flexShrink: 0 },
                  React.createElement(Box, { flexGrow: 1, overflow: "hidden" },
                      React.createElement(Text, { color: "gray", dimColor: true, wrap: "truncate" }, '─'.repeat(200))
                  ),
                  tableOffset + VISIBLE_AGENTS < AGENTS.length && React.createElement(Box, { flexShrink: 0 }, React.createElement(Text, { color: tColor('cyan'), bold: true, dimColor: leftDimmed }, ' ↓ MORE ↓ '))
              )
          ),
          showRightPanel && React.createElement(Box, { flexDirection: "column", width: chatWidth, flexShrink: 0 },
              React.createElement(ChatPanel, { messages: messages, input: chatInput, onChange: setChatInput, onSubmit: handleSend, focused: mode === 'chat', scrollOffset: scrollOffset, width: chatWidth, height: rows - (repoInputMode ? 4 : 0) })
          )
      ),
      React.createElement(Box, { width: "100%", height: 1, overflow: "hidden", flexShrink: 0 },
          React.createElement(Text, { color: "gray", dimColor: true, wrap: "truncate" }, '━'.repeat(200))
      ),
      React.createElement(Box, { width: "100%", height: 1, flexDirection: "row", overflow: "hidden", flexShrink: 0 },
          !showHelp ? React.createElement(React.Fragment, null,
              React.createElement(Box, { flexShrink: 0 },
                  React.createElement(Text, { color: "cyan", bold: true, wrap: "truncate" }, ' ctrl+t'), React.createElement(Text, { color: "gray", dimColor: true, wrap: "truncate" }, ':table '),
                  React.createElement(Text, { color: "cyan", bold: true, wrap: "truncate" }, ' ctrl+g'), React.createElement(Text, { color: "gray", dimColor: true, wrap: "truncate" }, ':graph '),
                  React.createElement(Text, { color: "cyan", bold: true, wrap: "truncate" }, ' ctrl+e'), React.createElement(Text, { color: "gray", dimColor: true, wrap: "truncate" }, ':chat '),
                  React.createElement(Text, { color: "cyan", bold: true, wrap: "truncate" }, ' ctrl+m'), React.createElement(Text, { color: "gray", dimColor: true, wrap: "truncate" }, ':repo │')
              ),
              React.createElement(Box, { flexShrink: 0 },
                  React.createElement(Text, { color: mode === 'table' ? 'magenta' : 'gray', bold: mode === 'table', dimColor: mode !== 'table', wrap: "truncate" }, ' [TABLE]'),
                  React.createElement(Text, { color: mode === 'graph' ? 'magenta' : 'gray', bold: mode === 'graph', dimColor: mode !== 'graph', wrap: "truncate" }, ' [GRAPH]'),
                  React.createElement(Text, { color: mode === 'chat'  ? 'magenta' : 'gray', bold: mode === 'chat',  dimColor: mode !== 'chat', wrap: "truncate" }, ' [CHAT]')
              ),
              React.createElement(Box, { flexGrow: 1, flexShrink: 1, overflow: "hidden" },
                  React.createElement(Text, { color: "gray", dimColor: true, wrap: "truncate" }, `  │ ↑↓/←→:nav  enter:action  ?:help  │ sess ${AGENTS[sel]?.id || 'NONE'}`)
              )
          ) : React.createElement(Box, { flexGrow: 1, flexShrink: 1, overflow: "hidden" },
              React.createElement(Text, { color: "yellow", bold: true, wrap: "truncate" }, '  [HELP MODE ACTIVE] '),
              React.createElement(Text, { color: "gray", dimColor: true, wrap: "truncate" }, 'Press [ESC] or [?] to return to dashboard')
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
