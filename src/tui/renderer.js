import { parseSourceDisplay, getActivities, sendMessage, listSources } from '../state/jules-api.js'
import React, { useState, useEffect, useRef } from 'react'
import { render, Box, Text, useInput, useApp } from 'ink'
import TextInput from 'ink-text-input'
import { getSessions, getQueue, getQuotaUsed, quotaRemaining, getQuotaLimit, getConfig, getArchitectureDiagram, setConfig, store } from '../state/store.js'
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

  const isOrchestrator = agent.type === 'orchestrator' || (agent.title && agent.title.toLowerCase().includes('orchestrator'));
  const titleColor = isOrchestrator ? 'yellowBright' : 'green';

  const displayId = (agent.id || '').substring(0, 6).padEnd(6)
  const displayTitle = (agent.title || '').substring(0, 12).padEnd(12)
  const parsedRepo = parseSourceDisplay(agent.repoDisplay || agent.repo || '')
  const repoNameOnly = parsedRepo.includes('/') ? parsedRepo.split('/')[1] : parsedRepo
  const displayRepo = repoNameOnly.substring(0, 20).padEnd(20)

  return React.createElement(Box, { paddingX: 1, width: "100%", height: 1, overflow: "hidden", backgroundColor: hi ? 'magenta' : undefined, flexDirection: "row", minWidth: 0 },
      React.createElement(Box, { width: 2, flexShrink: 0 }, React.createElement(Text, { color: tColor('magenta'), bold: true, dimColor: isDimmed }, hi ? '> ' : '  ')),
      React.createElement(Box, { width: 8, flexShrink: 1, overflow: "hidden" }, React.createElement(Text, { color: tColor('yellow'), bold: true, wrap: "truncate", dimColor: isDimmed }, displayId)),
      React.createElement(Box, { width: 14, flexShrink: 1, overflow: "hidden" }, React.createElement(Text, { color: tColor(titleColor), bold: true, wrap: "truncate", dimColor: isDimmed }, displayTitle)),
      React.createElement(Box, { flexGrow: 1, flexShrink: 1, overflow: "hidden" }, React.createElement(Text, { color: tColor('white'), wrap: "truncate", dimColor: isDimmed }, displayRepo)),
      React.createElement(Box, { width: 8, flexShrink: 1, overflow: "hidden" }, React.createElement(Text, { color: tColor(sc), bold: true, wrap: "truncate", dimColor: isDimmed }, ss)),
      React.createElement(Box, { width: 16, flexShrink: 1, overflow: "hidden" }, React.createElement(FillBar, { value: 0, tick: tick, width: 7, isDimmed: isDimmed, state: agent.state })),
      React.createElement(Box, { width: 4, flexShrink: 1, overflow: "hidden" }, React.createElement(Text, { color: tColor('gray'), dimColor: true, wrap: "truncate" }, ago(agent.lastUpdated || agent.createdAt)))
  )
}

// ── Tree Graph Layout ─────────────────────────────────────────────
function MiniGraph({ tick, isDimmed, height }) {
  const diagram = getArchitectureDiagram() || "Ask the Orchestrator to create a graph of projects"
  const spin = ['|', '/', '-', '\\']
  const s = spin[tick % spin.length]

  // Removed vertical padding (padding: 1 to paddingX: 1) so minimum heights of 5 don't overflow internally
  return React.createElement(Box, { flexDirection: "column", width: "100%", height: height, alignItems: "center", justifyContent: "center", marginBottom: 1, flexShrink: 0, borderStyle: "round", borderColor: isDimmed ? "gray" : "cyan", paddingX: 1, overflow: "hidden" },
      React.createElement(Box, { flexShrink: 0 }, 
          React.createElement(Text, { color: isDimmed ? 'gray' : 'cyan', bold: !isDimmed, dimColor: isDimmed, wrap: "truncate" }, `${s} ARCHITECTURE GRAPH ${s}`)
      ),
      React.createElement(Box, { marginTop: 1, alignItems: "center", justifyContent: "center", overflow: "hidden", flexGrow: 1 },
          React.createElement(Text, { color: isDimmed ? 'gray' : 'white', dimColor: isDimmed, wrap: "truncate" }, diagram)
      )
  )
}

// ── Chat Panel ────────────────────────────────────────────────────
function wrapText(text, width) {
  const wordsOrNewlines = text.split(/(\n|[ \t]+)/).filter(w => w !== '' && !/^[ \t]+$/.test(w));
  const lines = []
  let line = ''
  for (const word of wordsOrNewlines) {
    if (word === '\n') {
      if (line) lines.push(line);
      else lines.push('');
      line = '';
      continue;
    }

    // Check if word itself is longer than width
    if (word.length > width) {
       if (line) lines.push(line);
       // Split the long word into chunks of size `width`
       for (let i = 0; i < word.length; i += width) {
           lines.push(word.substring(i, i + width));
       }
       line = '';
       continue;
    }

    const candidate = line ? line + ' ' + word : word;
    if (candidate.length > width) {
       if (line) lines.push(line);
       line = word;
    } else {
       line = candidate;
    }
  }
  if (line) lines.push(line)
  return lines
}

function ChatPanel({ messages, input, onChange, onSubmit, focused, scrollOffset, width, tab, notes, setNotes, isRepoInputMode, repoName, agentTitle, agentId, visibleAgentsCount, chatMenuOpen, chatMenuSel, chatVisibleRows }) {
  const inner = Math.max(10, width - 2);

  const allLines = []
  if (tab === 'chat') {
      if (repoName === 'NOT SET') {
          allLines.push({ type: 'label', text: '  [SYSTEM]', color: 'gray' });
          const wrapped = wrapText("A repository must be selected before starting tasks or sending messages. Press Alt+M to search and select your target repository.", inner - 2);
          for (const l of wrapped) allLines.push({ type: 'text', text: l, color: 'yellow' });
          allLines.push({ type: 'gap' });
      } else {
          for (const m of messages) {
            if (m.role === 'agent') {
              allLines.push({ type: 'label', text: '▸ AGENT', color: focused ? 'magenta' : 'gray' })
            } else if (m.role === 'system') {
              allLines.push({ type: 'label', text: '  [SYSTEM]', color: 'gray' })
            } else {
              allLines.push({ type: 'label', text: '  you', color: 'cyan' })
            }
            const wrapped = wrapText(m.text, inner - 2)
            for (const l of wrapped)
              allLines.push({ type: 'text', text: l, color: m.role === 'agent' ? (focused ? 'white' : 'gray') : (focused ? 'cyan' : 'gray') })
            allLines.push({ type: 'gap' })
          }
      }
  } else {
      const wrapped = [];
      const lines = (notes || 'Type your notes here. They are saved automatically.').split('\n');
      for (const line of lines) {
         wrapped.push(...wrapText(line, inner - 2));
      }
      for (const l of wrapped) allLines.push({ type: 'text', text: l, color: focused ? 'white' : 'gray' })
  }

  const MESSAGE_ROWS = Math.max(2, chatVisibleRows || visibleAgentsCount);
  const total   = allLines.length;
  const start   = Math.max(0, total - MESSAGE_ROWS - scrollOffset);
  const visible = allLines.slice(start, start + MESSAGE_ROWS);

  let displayRepo = repoName;
  if (displayRepo !== 'NOT SET' && displayRepo && displayRepo.includes('/')) {
      displayRepo = displayRepo.split('/')[1];
  }
  const maxTitleLen = 20;
  const shortTitle = agentTitle && agentTitle.length > maxTitleLen ? agentTitle.substring(0, maxTitleLen) + '…' : (agentTitle || 'jules-orchestrator');
  const chatTitleText = displayRepo === 'NOT SET' ? 'PLEASE CHOOSE REPO' : `${agentId === 'NEW TASK' ? 'NEW' : agentId} @ ${shortTitle}`;
  const chatHeader = `▌ CHAT: ${chatTitleText}  [*Chat* | Notes >]`;
  const notesHeader = `▌ NOTES: ${shortTitle}  [< Chat | *Notes*]`;

  return React.createElement(Box, { flexDirection: "column", width: width, paddingLeft: 1, flexGrow: 1, minHeight: 0, overflow: "hidden" },
      React.createElement(Box, { flexShrink: 0, height: 1, overflow: "hidden" },
          React.createElement(Text, { color: focused ? 'magenta' : 'gray', bold: true, wrap: "truncate" }, tab === 'chat' ? chatHeader : notesHeader),
          scrollOffset > 0 && React.createElement(Text, { color: "gray", dimColor: true }, '  ↑' + scrollOffset)
      ),
      React.createElement(Box, { overflow: "hidden", flexShrink: 0, height: 1 },
          React.createElement(Text, { color: "gray", dimColor: true, wrap: "truncate" }, '─'.repeat(200))
      ),
      React.createElement(Box, { flexDirection: "column", flexGrow: 1, flexShrink: 1, minHeight: 0, overflow: "hidden", justifyContent: "flex-end" },
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
      chatMenuOpen && tab === 'chat' && React.createElement(Box, { flexDirection: "column", borderStyle: "round", borderColor: "cyan", paddingX: 1, flexShrink: 0, marginBottom: 0 },
          ['Create a julesorchestrator', 'Talk to an agent', 'Switch back to julesorchestrator'].map((opt, i) =>
              React.createElement(Text, { key: i, color: chatMenuSel === i ? 'magenta' : 'gray' }, chatMenuSel === i ? `> ${opt}` : `  ${opt}`)
          )
      ),
      React.createElement(Box, { overflow: "hidden", flexShrink: 0, height: 1 },
          React.createElement(Text, { color: "gray", dimColor: true, wrap: "truncate" }, '─'.repeat(200))
      ),
      React.createElement(Box, { height: 1, flexShrink: 0, flexDirection: "row", overflow: "hidden" },
          React.createElement(Box, { flexShrink: 0 }, React.createElement(Text, { color: focused ? 'green' : 'gray', bold: focused }, focused ? '▶ ' : '▷ ')),
          React.createElement(Box, { flexGrow: 1, flexShrink: 1, overflow: "hidden" },
              React.createElement(TextInput, { value: tab === 'chat' ? input : (notes || ''), onChange: tab === 'chat' ? onChange : (val) => setNotes(val), onSubmit: tab === 'chat' && !chatMenuOpen ? onSubmit : () => {}, placeholder: focused ? (tab === 'chat' ? 'press / to see menu' : 'type notes...') : 'Alt+E to focus', focus: focused && !isRepoInputMode })
          )
      )
  )
}

// ── Safe Full-Body Help Screen ────────────────────────────────────
function HelpScreen() {
  return React.createElement(Box, { flexGrow: 1, flexDirection: "column", alignItems: "center", justifyContent: "center", borderStyle: "double", borderColor: "yellow", marginX: 2, marginY: 1, overflow: "hidden" },
      React.createElement(Box, { marginBottom: 2 }, React.createElement(Text, { color: "yellow", bold: true }, '── JULES COLONY: QUICK REFERENCE ──')),
      React.createElement(Box, { flexDirection: "row", marginBottom: 1, width: 50 },
          React.createElement(Box, { width: 20, justifyContent: "flex-end", paddingRight: 2 }, React.createElement(Text, { color: "cyan", bold: true }, 'Alt + T')),
          React.createElement(Box, { flexGrow: 1 }, React.createElement(Text, { color: "white" }, 'Switch focus to Table Mode'))
      ),
      React.createElement(Box, { flexDirection: "row", marginBottom: 1, width: 50 },
          React.createElement(Box, { width: 20, justifyContent: "flex-end", paddingRight: 2 }, React.createElement(Text, { color: "cyan", bold: true }, 'Alt + G')),
          React.createElement(Box, { flexGrow: 1 }, React.createElement(Text, { color: "white" }, 'Switch focus to Graph Mode'))
      ),
      React.createElement(Box, { flexDirection: "row", marginBottom: 1, width: 50 },
          React.createElement(Box, { width: 20, justifyContent: "flex-end", paddingRight: 2 }, React.createElement(Text, { color: "cyan", bold: true }, 'Alt + E')),
          React.createElement(Box, { flexGrow: 1 }, React.createElement(Text, { color: "white" }, 'Switch focus to Chat Panel'))
      ),
      React.createElement(Box, { flexDirection: "row", marginBottom: 1, width: 50 },
          React.createElement(Box, { width: 20, justifyContent: "flex-end", paddingRight: 2 }, React.createElement(Text, { color: "cyan", bold: true }, 'Alt + M')),
          React.createElement(Box, { flexGrow: 1 }, React.createElement(Text, { color: "white" }, 'Change working repository'))
      ),
      React.createElement(Box, { flexDirection: "row", marginBottom: 1, width: 50 },
          React.createElement(Box, { width: 20, justifyContent: "flex-end", paddingRight: 2 }, React.createElement(Text, { color: "cyan", bold: true }, 'Alt + N')),
          React.createElement(Box, { flexGrow: 1 }, React.createElement(Text, { color: "white" }, 'Toggle Notes/Chat tabs'))
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
  const [chatTab, setChatTab] = useState('chat') // 'chat' or 'notes'
  const [notes, setNotes] = useState(() => store.get('tuiNotes', ''))
  const [queuedMessages, setQueuedMessages] = useState({})
  const [sourcesList, setSourcesList] = useState([])
  const [sourceSel, setSourceSel] = useState(0)

  const [chatMenuOpen, setChatMenuOpen] = useState(false)
  const [chatMenuSel, setChatMenuSel]   = useState(0)
  const [chatTargetMode, setChatTargetMode] = useState('CREATE_ORCHESTRATOR') // 'CREATE_ORCHESTRATOR', 'TALK_TO_SELECTED_AGENT', 'TALK_TO_LATEST_ORCHESTRATOR'

  // Breakpoints
  const MIN_COLS = 35;
  const MIN_ROWS = 10;
  const WIDE_BREAKPOINT = 100;
  const GRAPH_MIN_WIDTH = 120;
  
  const isWide = columns >= WIDE_BREAKPOINT
  const showLeftPanel = isWide || mode !== 'chat'
  const showRightPanel = isWide || mode === 'chat'
  const chatWidth = isWide ? 38 : columns - 2

  // Lowered threshold to rows >= 16 so graph stays alive in shorter terminal windows.
  const showGraph = columns >= GRAPH_MIN_WIDTH && rows >= 16

  // Dynamically calculate the Graph height: 1/3 of terminal rows, min 5 rows.
  const graphHeight = showGraph ? Math.max(5, Math.floor(rows / 3)) : 0;

  // Deduct fixed elements (Headers, footers, margins) + dynamic components
  // Base 8 fixed layout rows (Headers, lines, bottom spacer, shortcuts)
  let baseDeductions = 8; 
  // Add graph height + 1 for its marginBottom
  if (showGraph) baseDeductions += graphHeight + 1;
  if (repoInputMode) baseDeductions += 8;

  const VISIBLE_AGENTS = Math.max(2, rows - baseDeductions)
  const CHAT_VISIBLE_ROWS = VISIBLE_AGENTS + (showGraph ? graphHeight + 1 : 0) - (chatMenuOpen && chatTab === 'chat' ? 3 : 0);

  const sessions = getSessions() || []
  const reversedFiltered = sessions.slice().reverse()
  const AGENTS = reversedFiltered

  useEffect(() => {
    listSources().then(res => setSourcesList(res || [])).catch(() => {})
  }, [])
  useEffect(() => {
    const t = setInterval(() => { setTick(n => n + 1) }, 200)
    return () => clearInterval(t)
  }, [])

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
                          if (act.userMessaged) {
                              if (act.userMessaged.userMessage && act.userMessaged.userMessage.trim() !== '') {
                                  newMessages.push({ role: 'user', text: act.userMessaged.userMessage });
                              }
                          } else if (act.agentMessaged) {
                              if (act.agentMessaged.agentMessage && act.agentMessaged.agentMessage.trim() !== '') {
                                  newMessages.push({ role: 'agent', text: act.agentMessaged.agentMessage });
                              }
                          } else if (act.originator === 'agent' || act.originator === 'system') {
                              let text = act.description || '';
                              if (act.planGenerated) text += '\nPlan Generated:\n' + JSON.stringify(act.planGenerated);
                              if (act.artifacts && act.artifacts.length > 0) text += '\nArtifacts generated.';
                              if (text.trim() !== '') {
                                  newMessages.push({ role: act.originator, text: text });
                              }
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

      const p = setInterval(poll, 5000);
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

  useEffect(() => { store.set('tuiNotes', notes) }, [notes])
  useEffect(() => {
      for (const [id, msg] of Object.entries(queuedMessages)) {
          const agent = AGENTS.find(a => a.id === id);
          if (agent && agent.state === 'COMPLETED') {
              sendMessage(id, msg).catch(() => {});
              setMessages(m => [...m, { role: 'system', text: `[SYSTEM] Sent queued message to ${id}` }]);
              setQueuedMessages(prev => {
                  const newQ = {...prev}; delete newQ[id]; return newQ;
              });
          }
      }
  }, [tick, queuedMessages, AGENTS])

  useInput(async (input, key) => {
    if (repoInputMode) {
        if (key.escape) { setRepoInputMode(false); return; }
        if (repoInput.startsWith('/')) {
            const filtered = sourcesList.filter(s => ('/' + (s.displayName || s.name)).toLowerCase().includes(repoInput.toLowerCase()));
            if (key.upArrow) { setSourceSel(i => Math.max(0, i - 1)); return; }
            if (key.downArrow) { setSourceSel(i => Math.min(Math.max(0, filtered.length - 1), i + 1)); return; }
            if (key.return && filtered.length > 0 && filtered[sourceSel]) {
                handleRepoSubmit(filtered[sourceSel].name);
                return;
            }
        }
        return; 
    }

    if (key.ctrl && input === 'c') exit()

    if (input === '?') { setShowHelp(true); return }
    if (showHelp && (key.escape || input === '?')) { setShowHelp(false); return }
    if (showHelp) return

    if (key.meta && input === 'r') { setTick(t => t+1); return; }
    if (key.meta && input === 'm') { setRepoInputMode(true); setRepoInput('/'); setSourceSel(0); return }
    if (key.meta && input === 't') { setMode('table'); return }
    if (key.meta && input === 'g') { setMode('graph'); return }
    if (key.meta && input === 'e') { setMode('chat'); setScrollOffset(0); return }
    if (key.meta && input === 'n') { setMode('chat'); setChatTab(t => t === 'chat' ? 'notes' : 'chat'); return }
    
    if (key.f4) { setRepoInputMode(true); setRepoInput('/'); setSourceSel(0); return }
    if (key.f1) { setMode('table'); return } 
    if (key.f2) { setMode('graph'); return } 
    if (key.f3) { setMode('chat'); setScrollOffset(0); return } 

    if (key.escape) { setMode('table'); return }

    if (key.tab) {
      setMode(m => m === 'table' ? 'graph' : m === 'graph' ? 'chat' : 'table')
      setScrollOffset(0)
      return
    }

    if (mode === 'chat') {
      if (chatMenuOpen) {
          if (key.escape) { setChatMenuOpen(false); setChatInput(''); return; }
          if (key.upArrow) { setChatMenuSel(i => Math.max(0, i - 1)); return; }
          if (key.downArrow) { setChatMenuSel(i => Math.min(2, i + 1)); return; }
          if (key.return) {
              const opts = ['CREATE_ORCHESTRATOR', 'TALK_TO_SELECTED_AGENT', 'TALK_TO_LATEST_ORCHESTRATOR'];
              setChatTargetMode(opts[chatMenuSel]);
              setChatMenuOpen(false);
              setChatInput('');
              if (chatMenuSel === 0) {
                  setMessages(m => [...m, { role: 'system', text: 'creating a new agnet aut to warn the user ' }]);
              }
              return;
          }
          return;
      }
      if (input === '/' && chatInput === '') {
          setChatMenuOpen(true);
          setChatMenuSel(0);
          return;
      }
      if (key.shift && (key.leftArrow || key.rightArrow)) { setChatTab(t => t === 'chat' ? 'notes' : 'chat'); return }
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
        const agent = AGENTS[sel];
        if (agent) {
            setSelectedSessionId(agent.id);
            setMode('chat')
            setScrollOffset(0)

            getActivities(agent.id).then(res => {
                const acts = res.activities || res || [];
                const history = [];
                if (Array.isArray(acts)) {
                    const sorted = acts.sort((a,b) => new Date(a.createTime || 0) - new Date(b.createTime || 0));
                    for (const act of sorted) {
                        if (act.userMessaged) {
                            if (act.userMessaged.userMessage && act.userMessaged.userMessage.trim() !== '') {
                                history.push({ role: 'user', text: act.userMessaged.userMessage });
                            }
                        }
                        else if (act.agentMessaged) {
                            if (act.agentMessaged.agentMessage && act.agentMessaged.agentMessage.trim() !== '') {
                                history.push({ role: 'agent', text: act.agentMessaged.agentMessage });
                            }
                        }
                        else if (act.originator === 'agent' || act.originator === 'system') {
                            let text = act.description || '';
                            if (act.planGenerated) text += '\nPlan Generated:\n' + JSON.stringify(act.planGenerated);
                            if (act.artifacts && act.artifacts.length > 0) text += '\nArtifacts generated.';
                            if (text.trim() !== '') history.push({ role: act.originator, text: text });
                        }
                    }
                }
                history.push({ role: 'system', text: `[SYSTEM] Context switched to ${agent.id}. Node is currently ${agent.state}. Standing by.` });
                setMessages(history);
            }).catch(e => {
                setMessages([{ role: 'system', text: `[SYSTEM] Context switched to ${agent.id}. Error loading history: ${e.message}` }]);
            });
        }
      }
    }
  })

  async function handleSend(val) {
    if (!val.trim()) return

    const source = getConfig().source;
    if (!source || source === 'NOT SET') {
        setMessages(m => [...m,
            { role: 'user', text: val.trim() },
            { role: 'system', text: 'Error: Unable to send message. No repository is selected. Please select a repository using Alt+M first.' }
        ]);
        setChatInput(''); setScrollOffset(0); return;
    }

    if (chatTargetMode === 'CREATE_ORCHESTRATOR' || !AGENTS || AGENTS.length === 0) {
        setChatInput(''); setScrollOffset(0);
        try {
            const { sessionId } = await dispatchLeadOrchestrator(val.trim(), 1, val.trim().substring(0, 30));
            setMessages(m => [...m, { role: 'user', text: val.trim() }, { role: 'system', text: `Dispatched Orchestrator Session: ${sessionId}`}]);
            setSelectedSessionId(sessionId);
        } catch(e) {
            setMessages(m => [...m, { role: 'user', text: val.trim() }, { role: 'system', text: `Error: ${e.message}`}]);
        }
        return;
    }

    let targetAgent = null;
    if (chatTargetMode === 'TALK_TO_LATEST_ORCHESTRATOR') {
        targetAgent = AGENTS.find(a => a.type === 'orchestrator' || (a.title && a.title.toLowerCase().includes('orchestrator')));
        if (!targetAgent) targetAgent = AGENTS[0];
    } else {
        targetAgent = AGENTS[sel];
    }

    if (!targetAgent) {
        setMessages(m => [...m, { role: 'system', text: 'Error: No agent found to talk to.' }]);
        return;
    }

    if (targetAgent.state === 'IN_PROGRESS') {
        setQueuedMessages(prev => ({...prev, [targetAgent.id]: val.trim()}));
        setMessages(m => [...m, { role: 'user',  text: val.trim() }, { role: 'system', text: `[SYSTEM] Node ${targetAgent.id} is IN_PROGRESS. Message queued.` }]);
        setChatInput(''); setScrollOffset(0); return;
    }

    setMessages(m => [...m, { role: 'user',  text: val.trim() }, { role: 'system', text: 'Sending to node ' + targetAgent.id + '...' }])
    setChatInput(''); setScrollOffset(0);

    try { await sendMessage(targetAgent.id, val.trim()); }
    catch(e) { setMessages(m => [...m, { role: 'system', text: `Error: ${e.message}`}]); }
  }

  function handleRepoSubmit(val) {
      if (val.trim()) setConfig('source', val.trim());
      setRepoInputMode(false);
  }

  if (columns < MIN_COLS || rows < MIN_ROWS) {
    return React.createElement(Box, { padding: 1, flexDirection: "column", borderStyle: "round", borderColor: "red", minWidth: 0, minHeight: 0 },
        React.createElement(Text, { color: "red", bold: true, wrap: "truncate" }, '⚠ TERMINAL TOO SMALL'),
        React.createElement(Text, { color: "gray", wrap: "truncate" }, `Expand to > ${MIN_COLS}x${MIN_ROWS}`)
    )
  }

  const visibleAgents = AGENTS.slice(tableOffset, tableOffset + VISIBLE_AGENTS)
  const leftDimmed = mode === 'chat'
  const tColor = (color) => leftDimmed ? 'gray' : color

  const currentSource = getConfig().source;
  const currentRepoDisplay = currentSource ? parseSourceDisplay(currentSource) : "NOT SET";
  const activeAgentId = selectedSessionId ? selectedSessionId : 'NEW TASK';
  const activeAgent = selectedSessionId ? AGENTS.find(a => a.id === selectedSessionId) : null;
  const activeAgentTitle = activeAgent ? activeAgent.title : 'jules-orchestrator';

  const filteredSources = repoInput.startsWith('/')
      ? sourcesList.filter(s => ('/' + (s.displayName || s.name)).toLowerCase().includes(repoInput.toLowerCase()))
      : [];

  const MAX_VISIBLE_DROPDOWN = 5;
  let dropdownOffset = 0;
  if (sourceSel >= MAX_VISIBLE_DROPDOWN) dropdownOffset = sourceSel - MAX_VISIBLE_DROPDOWN + 1;
  const visibleDropdownSources = filteredSources.slice(dropdownOffset, dropdownOffset + MAX_VISIBLE_DROPDOWN);

  return React.createElement(Box, { flexDirection: "column", paddingX: 1, width: "100%", height: rows, minWidth: 0, overflow: "hidden" },
      React.createElement(Box, { flexDirection: "row", width: "100%", height: 1, overflow: "hidden", flexShrink: 0 },
          React.createElement(Box, { flexShrink: 1, overflow: "hidden" },
              React.createElement(Text, { color: "yellow", bold: true, wrap: "truncate" }, '━━ J U L E S  C O L O N Y '),
              React.createElement(Text, { color: "gray", dimColor: true, wrap: "truncate" }, '│ '),
              React.createElement(Text, { color: currentRepoDisplay === 'NOT SET' ? "red" : "cyan", dimColor: true, wrap: "truncate" }, `~ ${currentRepoDisplay} `),
              React.createElement(Text, { color: "gray", dimColor: true, wrap: "truncate" }, '│ '),
              React.createElement(Text, { color: "magenta", dimColor: true, wrap: "truncate" }, 'powered by jules ')
          ),
          React.createElement(Box, { flexGrow: 1, flexShrink: 1, overflow: "hidden" },
              React.createElement(Text, { color: "gray", dimColor: true, wrap: "truncate" }, '━'.repeat(200))
          )
      ),

      repoInputMode && React.createElement(Box, { flexDirection: "column", paddingX: 2, paddingY: 1, borderStyle: "round", borderColor: "cyan", flexShrink: 0, overflow: "hidden" },
          React.createElement(Box, { flexDirection: "row", overflow: "hidden" },
            React.createElement(Box, { flexShrink: 1, overflow: "hidden" }, React.createElement(Text, { color: "cyan", wrap: "truncate" }, 'Enter repository (type / to search): ')),
            React.createElement(Box, { flexGrow: 1, overflow: "hidden" }, React.createElement(TextInput, { value: repoInput, onChange: (v) => { setRepoInput(v); setSourceSel(0); }, onSubmit: repoInput.startsWith('/') ? () => {} : handleRepoSubmit }))
          ),
          repoInput.startsWith('/') && React.createElement(Box, { flexDirection: "column", marginTop: 1, overflow: "hidden" },
              filteredSources.length === 0 ? React.createElement(Text, { color: "gray", wrap: "truncate" }, '  No repositories found...') :
              visibleDropdownSources.map((s, idx) => {
                  const actualIndex = dropdownOffset + idx;
                  const isSelected = actualIndex === sourceSel;
                  return React.createElement(Text, { key: s.name, color: isSelected ? 'magenta' : 'gray', wrap: "truncate" },
                      isSelected ? '> ' + (s.displayName || s.name) : '  ' + (s.displayName || s.name)
                  );
              })
          )
      ),

      showHelp ? React.createElement(HelpScreen) : React.createElement(Box, { flexDirection: "row", flexGrow: 1, marginTop: 1, overflow: "hidden", minHeight: 0 },
          showLeftPanel && React.createElement(Box, { flexDirection: "column", flexGrow: 1, flexShrink: 1, marginRight: isWide ? 1 : 0, overflow: "hidden", minWidth: 0, minHeight: 0 },
              showGraph && React.createElement(MiniGraph, { tick: tick, isDimmed: mode !== 'graph', height: graphHeight }),
              React.createElement(Box, { paddingX: 1, flexDirection: "row", height: 1, flexShrink: 0, overflow: "hidden" },
                  React.createElement(Box, { width: 2, flexShrink: 0 }, React.createElement(Text, null, ' ')),
                  React.createElement(Box, { width: 8, flexShrink: 1, overflow: "hidden" }, React.createElement(Text, { color: tColor('gray'), bold: true, dimColor: leftDimmed, wrap: "truncate" }, 'ID')),
                  React.createElement(Box, { width: 14, flexShrink: 1, overflow: "hidden" }, React.createElement(Text, { color: tColor('gray'), bold: true, dimColor: leftDimmed, wrap: "truncate" }, 'TITLE')),
                  React.createElement(Box, { flexGrow: 1, flexShrink: 1, overflow: "hidden" }, React.createElement(Text, { color: tColor('gray'), bold: true, dimColor: leftDimmed, wrap: "truncate" }, 'REPO')),
                  React.createElement(Box, { width: 8, flexShrink: 1, overflow: "hidden" }, React.createElement(Text, { color: tColor('gray'), bold: true, dimColor: leftDimmed, wrap: "truncate" }, 'STATUS')),
                  React.createElement(Box, { width: 16, flexShrink: 1, overflow: "hidden" }, React.createElement(Text, { color: tColor('gray'), bold: true, dimColor: leftDimmed, wrap: "truncate" }, 'LOAD')),
                  React.createElement(Box, { width: 4, flexShrink: 1, overflow: "hidden" }, React.createElement(Text, { color: tColor('gray'), bold: true, dimColor: leftDimmed, wrap: "truncate" }, 'AGO'))
              ),
              React.createElement(Box, { paddingX: 1, width: "100%", height: 1, flexDirection: "row", overflow: "hidden", flexShrink: 0 },
                  React.createElement(Box, { flexGrow: 1, overflow: "hidden" },
                      React.createElement(Text, { color: "gray", dimColor: true, wrap: "truncate" }, '─'.repeat(200))
                  ),
                  tableOffset > 0 && React.createElement(Box, { flexShrink: 0 }, React.createElement(Text, { color: tColor('cyan'), bold: true, dimColor: leftDimmed, wrap: "truncate" }, ' ↑ MORE ↑ '))
              ),
              React.createElement(Box, { flexDirection: "column", flexGrow: 1, flexShrink: 1, minHeight: 0, overflow: "hidden" },
                  visibleAgents.map((agent, i) => {
                    const actualIndex = tableOffset + i;
                    return React.createElement(AgentRow, { key: agent.id, agent: agent, selected: mode === 'table' && actualIndex === sel, tick: tick, isDimmed: leftDimmed })
                  })
              ),
              React.createElement(Box, { paddingX: 1, width: "100%", height: 1, flexDirection: "row", overflow: "hidden", flexShrink: 0 },
                  React.createElement(Box, { flexGrow: 1, overflow: "hidden" },
                      React.createElement(Text, { color: "gray", dimColor: true, wrap: "truncate" }, '─'.repeat(200))
                  ),
                  tableOffset + VISIBLE_AGENTS < AGENTS.length && React.createElement(Box, { flexShrink: 0 }, React.createElement(Text, { color: tColor('cyan'), bold: true, dimColor: leftDimmed, wrap: "truncate" }, ' ↓ MORE ↓ '))
              ),
              // Spacer block guarantees Left bottom divider perfectly aligns horizontally with the Right bottom chat input!
              React.createElement(Box, { height: 1, flexShrink: 0 }) 
          ),
          showRightPanel && React.createElement(Box, { flexDirection: "column", width: chatWidth, flexShrink: 1, minWidth: 0, minHeight: 0, overflow: "hidden" },
              React.createElement(ChatPanel, { 
                  messages: messages, input: chatInput, onChange: setChatInput, onSubmit: handleSend, 
                  focused: mode === 'chat', scrollOffset: scrollOffset, width: "100%",
                  tab: chatTab, notes: notes, setNotes: setNotes, isRepoInputMode: repoInputMode,
                  repoName: currentRepoDisplay, agentTitle: activeAgentTitle, agentId: activeAgentId, visibleAgentsCount: VISIBLE_AGENTS,
                  chatMenuOpen: chatMenuOpen, chatMenuSel: chatMenuSel, chatVisibleRows: CHAT_VISIBLE_ROWS
              })
          )
      ),
      React.createElement(Box, { width: "100%", height: 1, overflow: "hidden", flexShrink: 0 },
          React.createElement(Text, { color: "gray", dimColor: true, wrap: "truncate" }, '━'.repeat(200))
      ),
      React.createElement(Box, { width: "100%", height: 1, flexDirection: "row", overflow: "hidden", flexShrink: 0 },
          !showHelp ? React.createElement(React.Fragment, null,
              React.createElement(Box, { flexShrink: 1, overflow: "hidden", flexDirection: "row" },
                  React.createElement(Text, { color: "cyan", bold: true, wrap: "truncate" }, ' alt+t'), React.createElement(Text, { color: "gray", dimColor: true, wrap: "truncate" }, ':table '),
                  React.createElement(Text, { color: "cyan", bold: true, wrap: "truncate" }, ' alt+g'), React.createElement(Text, { color: "gray", dimColor: true, wrap: "truncate" }, ':graph '),
                  React.createElement(Text, { color: "cyan", bold: true, wrap: "truncate" }, ' alt+e'), React.createElement(Text, { color: "gray", dimColor: true, wrap: "truncate" }, ':chat '),
                  React.createElement(Text, { color: "cyan", bold: true, wrap: "truncate" }, ' alt+m'), React.createElement(Text, { color: "gray", dimColor: true, wrap: "truncate" }, ':repo '),
                  React.createElement(Text, { color: "cyan", bold: true, wrap: "truncate" }, ' alt+n'), React.createElement(Text, { color: "gray", dimColor: true, wrap: "truncate" }, ':notes │')
              ),
              React.createElement(Box, { flexShrink: 0, flexDirection: "row" },
                  React.createElement(Text, { color: mode === 'table' ? 'magenta' : 'gray', bold: mode === 'table', dimColor: mode !== 'table', wrap: "truncate" }, ' [TABLE]'),
                  React.createElement(Text, { color: mode === 'graph' ? 'magenta' : 'gray', bold: mode === 'graph', dimColor: mode !== 'graph', wrap: "truncate" }, ' [GRAPH]'),
                  React.createElement(Text, { color: mode === 'chat'  ? 'magenta' : 'gray', bold: mode === 'chat',  dimColor: mode !== 'chat', wrap: "truncate" }, ' [CHAT]')
              ),
              React.createElement(Box, { flexGrow: 1, flexShrink: 1, overflow: "hidden" },
                  React.createElement(Text, { color: "gray", dimColor: true, wrap: "truncate" }, `  │ ↑↓:nav Shift+←→:tabs enter:action ?:help │ sess ${AGENTS[sel]?.id || 'NONE'}`)
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