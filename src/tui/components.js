// ── components.js ────────────────────────────────────────────────
// All stateless/shared UI components for the Jules Colony TUI:
//   FillBar, AgentRow, MiniGraph, ChatPanel, HelpScreen, PlannedGraphViewer
// Also exports: STATUS_COLOR, STATUS_SHORT, ago, useTerminalSize

import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import TextInput from 'ink-text-input'
import { parseSourceDisplay } from '../state/jules-api.js'
import { wrapText, buildMarkdownLines } from './markdown.js'

// ── Status maps ───────────────────────────────────────────────────
export const STATUS_COLOR = {
  IN_PROGRESS: 'magenta', COMPLETED: 'green', AWAITING_PLAN_APPROVAL: 'yellowBright',
  AWAITING_USER_FEEDBACK: 'yellowBright', FAILED: 'redBright', QUEUED: 'cyan', PLANNING: 'blueBright',
  PAUSED: 'yellow', KILLED: 'red'
}

export const STATUS_SHORT = {
  IN_PROGRESS: 'ACTIVE', COMPLETED: 'DONE', AWAITING_PLAN_APPROVAL: 'WAIT',
  AWAITING_USER_FEEDBACK: 'WAIT', FAILED: 'FAIL', QUEUED: 'QUEUE', PLANNING: 'PLAN',
  PAUSED: 'PAUSE', KILLED: 'DEAD'
}

// ── Helpers ───────────────────────────────────────────────────────
export function ago(ms) {
  if (!ms) return '--'
  const s = Math.floor((Date.now() - new Date(ms).getTime()) / 1000)
  if (s < 60)    return `${s}s`
  if (s < 3600)  return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

// ── Hook: Debounced Terminal Resize ───────────────────────────────
export function useTerminalSize() {
  const [size, setSize] = useState({
    columns: process.stdout.columns || 80,
    rows:    process.stdout.rows    || 24
  })
  useEffect(() => {
    let t
    const onResize = () => {
      clearTimeout(t)
      t = setTimeout(() => setSize({
        columns: process.stdout.columns,
        rows:    process.stdout.rows
      }), 30)
    }
    process.stdout.on('resize', onResize)
    return () => { process.stdout.off('resize', onResize); clearTimeout(t) }
  }, [])
  return size
}

// ── FillBar ───────────────────────────────────────────────────────
export function FillBar({ value, tick, width = 7, isDimmed, state }) {
  let filled
  if      (state === 'IN_PROGRESS' || state === 'PLANNING') filled = Math.floor(width * (0.5 + 0.5 * Math.sin(tick / 5)))
  else if (state === 'COMPLETED')  filled = width
  else                             filled = 0
  filled = Math.min(width, Math.max(0, filled))

  const color = isDimmed ? 'gray'
    : state === 'COMPLETED'   ? 'green'
    : state === 'IN_PROGRESS' ? 'magenta'
    : state === 'PLANNING'    ? 'cyan'
    : state === 'FAILED'      ? 'red'
    : 'yellow'
  const pct = state === 'COMPLETED' ? '100%' : state === 'IN_PROGRESS' ? ' .. ' : state === 'PLANNING' ? 'PLAN' : '  0%'

  return React.createElement(Text, null,
    React.createElement(Text, { color, dimColor: isDimmed }, '█'.repeat(filled)),
    React.createElement(Text, { color: 'gray', dimColor: true }, '░'.repeat(width - filled)),
    React.createElement(Text, { color: isDimmed ? 'gray' : 'white', dimColor: isDimmed }, ' ' + pct)
  )
}

// ── AgentRow ──────────────────────────────────────────────────────
export function AgentRow({ agent, selected, tick, isDimmed }) {
  const sc   = STATUS_COLOR[agent.state || 'UNKNOWN'] || 'white'
  const ss   = STATUS_SHORT[agent.state || 'UNKNOWN'] || (agent.state || '???').substring(0, 5)
  const hi   = selected && !isDimmed
  const tc   = (base) => isDimmed ? 'gray' : (hi ? 'black' : base)

  const isOrch     = agent.type === 'orchestrator' || (agent.title || '').toLowerCase().includes('orchestrator')
  const tColor     = isOrch ? 'yellowBright' : 'green'
  const shortId    = (agent.id    || '').substring(0, 6)
  const shortTitle = (agent.title || '').substring(0, 12)
  const parsed     = parseSourceDisplay(agent.repoDisplay || agent.repo || '')
  const repoStr    = parsed.includes('/') ? parsed.split('/')[1] : parsed

  return React.createElement(Box, {
    paddingX: 1, width: '100%', height: 1, overflow: 'hidden',
    backgroundColor: hi ? 'magenta' : undefined,
    flexDirection: 'row', minWidth: 0
  },
    React.createElement(Box, { width: 2, flexShrink: 0 },
      React.createElement(Text, { color: tc('magenta'), bold: true, dimColor: isDimmed }, hi ? '▶ ' : '  ')
    ),
    React.createElement(Box, { width: 7, flexShrink: 0, overflow: 'hidden' },
      React.createElement(Text, { color: tc('yellow'), bold: true, wrap: 'truncate', dimColor: isDimmed }, shortId)
    ),
    React.createElement(Box, { width: 14, flexShrink: 1, minWidth: 5, overflow: 'hidden' },
      React.createElement(Text, { color: tc(tColor), bold: true, wrap: 'truncate', dimColor: isDimmed }, shortTitle)
    ),
    React.createElement(Box, { flexGrow: 1, flexShrink: 1, minWidth: 5, overflow: 'hidden' },
      React.createElement(Text, { color: tc('white'), wrap: 'truncate', dimColor: isDimmed }, repoStr)
    ),
    React.createElement(Box, { width: 7, flexShrink: 0, overflow: 'hidden' },
      React.createElement(Text, { color: tc(sc), bold: true, wrap: 'truncate', dimColor: isDimmed }, ss)
    ),
    React.createElement(Box, { width: 14, flexShrink: 1, minWidth: 5, overflow: 'hidden' },
      React.createElement(FillBar, { value: 0, tick, width: 6, isDimmed, state: agent.state })
    ),
    React.createElement(Box, { width: 4, flexShrink: 0, overflow: 'hidden' },
      React.createElement(Text, { color: tc('gray'), dimColor: true, wrap: 'truncate' },
        ago(agent.lastUpdated || agent.createdAt)
      )
    )
  )
}

// ── GraphNode ─────────────────────────────────────────────────────
const GRAPH_NODE_W = 24
const GRAPH_NODE_H = 5

function GraphNode({ agent, isSelected, tick, isDimmed }) {
  const isOrch  = agent.type === 'orchestrator' || (agent.title || '').toLowerCase().includes('orchestrator')
  const sc      = STATUS_COLOR[agent.state || 'UNKNOWN'] || 'white'
  const ss      = STATUS_SHORT[agent.state || 'UNKNOWN'] || '???'
  const hi      = isSelected && !isDimmed

  const borderColor = isDimmed ? 'gray' : hi ? 'white' : isOrch ? 'yellow' : 'cyan'
  const titleColor  = isDimmed ? 'gray' : hi ? 'white' : isOrch ? 'yellowBright' : 'cyanBright'
  const statusColor = isDimmed ? 'gray' : sc

  const IW = GRAPH_NODE_W - 4

  const parsed    = parseSourceDisplay(agent.repoDisplay || agent.repo || '')
  const repoShort = (parsed.includes('/') ? parsed.split('/')[1] : parsed).substring(0, IW)
  const titleStr  = (agent.title || 'agent').toUpperCase().substring(0, IW)
  const shortId   = (agent.id || '').substring(0, 6)
  const agoStr    = ago(agent.lastUpdated || agent.createdAt)
  
  // Apply distinct coloring for time depending on failure or pause
  const isWaitState = ['PAUSED', 'AWAITING_PLAN_APPROVAL', 'AWAITING_USER_FEEDBACK'].includes(agent.state)
  const isFailState = ['FAILED', 'KILLED'].includes(agent.state)
  const timeColor   = isDimmed ? 'gray' : (isFailState ? 'red' : (isWaitState ? 'yellow' : 'green'))

  // Layout the bottom string keeping spacing intact
  const idStatusSpace = IW - agoStr.length - ss.length - shortId.length - 1
  const paddingStr = ' '.repeat(Math.max(0, idStatusSpace))

  let barFilled
  if      (agent.state === 'IN_PROGRESS' || agent.state === 'PLANNING') barFilled = Math.floor(IW * (0.5 + 0.5 * Math.sin(tick / 5)))
  else if (agent.state === 'COMPLETED')  barFilled = IW
  else                                   barFilled = 0
  barFilled = Math.max(0, Math.min(IW, barFilled))

  const barColor = isDimmed ? 'gray'
    : agent.state === 'COMPLETED'   ? 'green'
    : agent.state === 'IN_PROGRESS' ? 'magenta'
    : agent.state === 'PLANNING'    ? 'cyan'
    : agent.state === 'FAILED'      ? 'red'
    : 'yellow'

  return React.createElement(Box, {
    borderStyle: hi ? 'double' : 'round',
    borderColor,
    width:  GRAPH_NODE_W,
    height: GRAPH_NODE_H,
    flexShrink: 0,
    flexDirection: 'column',
    paddingX: 1,
    overflow: 'hidden'
  },
    React.createElement(Box, { height: 1, width: IW, overflow: 'hidden' },
      React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, repoShort)
    ),
    React.createElement(Box, { height: 1, width: IW, overflow: 'hidden' },
      React.createElement(Text, { color: titleColor, bold: !isDimmed, wrap: 'truncate', dimColor: isDimmed }, titleStr)
    ),
    React.createElement(Box, { height: 1, width: IW, overflow: 'hidden' },
      React.createElement(Text, { wrap: 'truncate' },
        React.createElement(Text, { color: barColor, dimColor: isDimmed }, '█'.repeat(barFilled)),
        React.createElement(Text, { color: 'gray',   dimColor: true     }, '░'.repeat(IW - barFilled))
      )
    ),
    React.createElement(Box, { height: 1, width: IW, overflow: 'hidden', flexDirection: 'row' },
      React.createElement(Text, { color: statusColor, bold: !isDimmed, dimColor: isDimmed }, `${ss} `),
      React.createElement(Text, { color: 'white', dimColor: isDimmed }, `${shortId}${paddingStr}`),
      React.createElement(Text, { color: timeColor, bold: !isDimmed, dimColor: isDimmed }, agoStr)
    )
  )
}

// ── MiniGraph ─────────────────────────────────────────────────────
export function MiniGraph({ tick, isDimmed, height, width, sessions, graphSel, onGraphNav, onGraphSelect }) {

  const spin = ['|', '/', '-', '\\']
  const s    = spin[tick % spin.length]

  const sorted = (sessions || []).slice().sort((a, b) => {
    const aO = a.type === 'orchestrator' || (a.title || '').toLowerCase().includes('orchestrator')
    const bO = b.type === 'orchestrator' || (b.title || '').toLowerCase().includes('orchestrator')
    if (aO !== bO) return aO ? -1 : 1
    return new Date(b.lastUpdated || b.createdAt || 0) - new Date(a.lastUpdated || a.createdAt || 0)
  })

  const total    = sorted.length
  const safeIdx  = Math.min(Math.max(0, graphSel), Math.max(0, total - 1))
  const selAgent = sorted[safeIdx] || null

  // Dynamic layout processing based on available width
  const safeWidth = width || 80
  const usableWidth = Math.max(20, safeWidth - 4)
  const CPR = Math.max(1, Math.floor(usableWidth / (GRAPH_NODE_W + 1)))

  // Overhead allocation: borders(2) + header(1) + footer(1) + scroll arrows max(2) = 6
  const cardRows     = Math.max(1, Math.floor((height - 6) / GRAPH_NODE_H))
  const visibleTotal = CPR * cardRows

  const selRow   = Math.floor(safeIdx / CPR)
  const maxStart = Math.max(0, Math.ceil(total / CPR) - cardRows)
  const startRow = Math.min(maxStart, Math.max(0, selRow - Math.floor(cardRows / 2)))
  const startIdx = startRow * CPR

  const visible = sorted.slice(startIdx, startIdx + visibleTotal)

  const rows = []
  for (let r = 0; r < cardRows; r++) {
    const chunk = visible.slice(r * CPR, r * CPR + CPR)
    if (chunk.length > 0) rows.push(chunk)
  }

  const orchCount = sorted.filter(a => a.type === 'orchestrator' || (a.title || '').toLowerCase().includes('orchestrator')).length
  const showConnectors = orchCount > 0 && total > orchCount

  const canScrollUp = startRow > 0;
  const canScrollDown = startRow < maxStart;

  return React.createElement(Box, {
    flexDirection: 'column',
    width: '100%',
    height,
    flexShrink: 0,
    borderStyle: 'round',
    borderColor: isDimmed ? 'gray' : 'cyan',
    paddingX: 1,
    overflow: 'hidden'
  },
    // ── Header ──
    React.createElement(Box, { flexDirection: 'column', flexShrink: 0, minWidth: 0 },
      React.createElement(Box, { height: 1, justifyContent: 'center' },
        React.createElement(Text, {
          color: isDimmed ? 'gray' : 'cyan',
          bold: !isDimmed, dimColor: isDimmed, wrap: 'truncate'
        },
          total > 0
            ? `│   LIVE AGENTS GRID  [${safeIdx + 1}/${total}]   │`
            : `│   LIVE AGENTS GRID   │`
        )
      ),
      React.createElement(Box, { height: 1, overflow: 'hidden' },
        React.createElement(Text, { color: isDimmed ? 'gray' : 'cyan', dimColor: true }, '─'.repeat(100))
      )
    ),
    // ── Top scroll indicator ──
    canScrollUp && React.createElement(Box, { height: 1, justifyContent: 'center', flexShrink: 0 },
      React.createElement(Text, { color: 'cyan', bold: true }, '▲ MORE ABOVE ▲')
    ),

    // ── Cards area ──
    total === 0
      ? React.createElement(Box, { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
          React.createElement(Text, { color: 'gray', dimColor: true },
            'No agents yet — send a task to dispatch an orchestrator'
          )
        )
      : React.createElement(Box, { flexDirection: 'column', flexGrow: 1, overflow: 'hidden', alignItems: 'center' },
          rows.map((row, ri) => {
            const firstInRow = sorted.indexOf(row[0])
            const isFirstSubRow = firstInRow === orchCount && orchCount > 0
            return React.createElement(React.Fragment, { key: ri },
              isFirstSubRow && React.createElement(Box, {
                flexShrink: 0, height: 1, paddingLeft: 1, overflow: 'hidden', minWidth: 0
              },
                React.createElement(Text, { color: isDimmed ? 'gray' : 'gray', dimColor: true, wrap: 'truncate' },
                  row.length === 1 ? '          │'
                  : row.length === 2 ? '        ╱   ╲'
                  : '      ╱     │     ╲'
                )
              ),
              React.createElement(Box, {
                flexDirection: 'row',
                flexShrink: 0,
                height: GRAPH_NODE_H,
                overflow: 'hidden',
                justifyContent: 'center',
                gap: 1
              },
                row.map((agent) => {
                  const absIdx = sorted.indexOf(agent)
                  return React.createElement(GraphNode, {
                    key:        agent.id,
                    agent,
                    isSelected: absIdx === safeIdx,
                    tick,
                    isDimmed
                  })
                })
              )
            )
          })
        ),

    // ── Bottom scroll indicator ──
    canScrollDown && React.createElement(Box, { height: 1, justifyContent: 'center', flexShrink: 0 },
      React.createElement(Text, { color: 'cyan', bold: true }, '▼ MORE BELOW ▼')
    ),

    // ── Footer ──
    React.createElement(Box, { height: 1, flexShrink: 0, justifyContent: 'center', minWidth: 0 },
      React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' },
        selAgent
          ? ` ↑↓←→ navigate  ↵ open chat  ·  ${(selAgent.title || selAgent.id || '').substring(0, 20)}`
          : ' ↑↓←→ navigate  ↵ open chat'
      )
    )
  )
}

// ── ChatPanel ─────────────────────────────────────────────────────
export function ChatPanel({
  messages, input, onChange, onSubmit,
  focused, scrollOffset, width, tab,
  notes, setNotes, isRepoInputMode,
  repoName, agentTitle, agentId,
  visibleAgentsCount, chatMenuOpen, chatMenuSel, chatVisibleRows
}) {
  const numWidth  = typeof width === 'number' && !isNaN(width) ? width : 40
  const wrapLimit = Math.max(10, numWidth - 4)

  const allLines = []

  if (tab === 'chat') {
    if (repoName === 'NOT SET') {
      allLines.push({ type: 'label', text: '  [SYSTEM]', color: 'gray' })
      for (const l of wrapText('Select a repository (Alt+M) to start.', wrapLimit))
        allLines.push({ type: 'text', text: l, color: 'yellow' })
      allLines.push({ type: 'gap' })
    } else {
      for (const m of messages) {
        if (m.role === 'agent') {
          allLines.push({ type: 'label', text: '▸ AGENT', color: focused ? 'magenta' : 'gray' })
          for (const ml of buildMarkdownLines(m.text, wrapLimit, focused)) allLines.push(ml)
          allLines.push({ type: 'gap' })
        } else if (m.role === 'system') {
          allLines.push({ type: 'label', text: '  [SYS]', color: 'gray' })
          for (const l of wrapText(m.text, wrapLimit))
            allLines.push({ type: 'text', text: l, color: 'gray' })
          allLines.push({ type: 'gap' })
        } else {
          allLines.push({ type: 'label', text: '  you', color: 'cyan' })
          for (const l of wrapText(m.text, wrapLimit))
            allLines.push({ type: 'text', text: l, color: focused ? 'cyan' : 'gray' })
          allLines.push({ type: 'gap' })
        }
      }
    }
  } else {
    for (const l of wrapText(notes || 'Type your notes here...', wrapLimit))
      allLines.push({ type: 'text', text: l, color: focused ? 'white' : 'gray' })
  }

  const MESSAGE_ROWS = Math.max(2, chatVisibleRows)
  const total   = allLines.length
  const start   = Math.max(0, total - MESSAGE_ROWS - scrollOffset)
  const visible = allLines.slice(start, start + MESSAGE_ROWS)

  const maxTitleLen = 15
  const shortTitle  = agentTitle && agentTitle.length > maxTitleLen
    ? agentTitle.substring(0, maxTitleLen) + '…'
    : (agentTitle || 'orchestrator')

  return React.createElement(Box, {
    flexDirection: 'column', width,
    paddingLeft: 1, flexShrink: 0, minHeight: 0, overflow: 'hidden'
  },
    React.createElement(Box, { flexShrink: 0, height: 1, minWidth: 0, overflow: 'hidden' },
      React.createElement(Text, { color: focused ? 'magenta' : 'gray', bold: true, wrap: 'truncate' },
        tab === 'chat' ? `▌ CHAT: ${shortTitle}` : `▌ NOTES: ${shortTitle}`
      ),
      scrollOffset > 0 && React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, ` ↑${scrollOffset}`)
    ),

    React.createElement(Box, { overflow: 'hidden', flexShrink: 0, height: 1, minWidth: 0 },
      React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, '─'.repeat(100))
    ),

    React.createElement(Box, {
      flexDirection: 'column', height: MESSAGE_ROWS,
      flexShrink: 0, minHeight: 0, overflow: 'hidden', justifyContent: 'flex-end'
    },
      visible.map((l, i) => {
        if (l.type === 'jsx')
          return React.createElement(Box, { key: i, height: 1, overflow: 'hidden', minWidth: 0, paddingLeft: 2 }, l.element)
        if (l.type === 'gap')
          return React.createElement(Box, { key: i, height: 1, minWidth: 0 },
            React.createElement(Text, null, ' ')
          )
        if (l.type === 'label')
          return React.createElement(Box, { key: i, height: 1, overflow: 'hidden', minWidth: 0 },
            React.createElement(Text, { color: l.color, bold: true, dimColor: l.color === 'gray' || !focused, wrap: 'truncate' }, l.text)
          )
        return React.createElement(Box, { key: i, paddingLeft: 2, height: 1, overflow: 'hidden', minWidth: 0 },
          React.createElement(Text, { color: l.color, dimColor: !focused, wrap: 'truncate' }, l.text)
        )
      })
    ),

    chatMenuOpen && tab === 'chat' && React.createElement(Box, {
      flexDirection: 'column', height: 3,
      borderStyle: 'round', borderColor: 'cyan',
      paddingX: 1, flexShrink: 0, minWidth: 0, overflow: 'hidden'
    },
      ['New Task', 'Talk Agent', 'Talk Lead'].map((opt, i) =>
        React.createElement(Text, { key: i, color: chatMenuSel === i ? 'magenta' : 'gray', wrap: 'truncate' },
          chatMenuSel === i ? `▶${opt}` : ` ${opt}`
        )
      )
    ),

    React.createElement(Box, { overflow: 'hidden', flexShrink: 0, height: 1, minWidth: 0 },
      React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, '─'.repeat(100))
    ),

    React.createElement(Box, { height: 1, flexShrink: 0, flexDirection: 'row', overflow: 'hidden', minWidth: 0 },
      React.createElement(Box, { flexShrink: 0, minWidth: 0 },
        React.createElement(Text, { color: focused ? 'green' : 'gray', bold: focused, wrap: 'truncate' }, focused ? '▶ ' : '▷ ')
      ),
      React.createElement(Box, { flexGrow: 1, flexShrink: 1, overflow: 'hidden', minWidth: 0 },
        React.createElement(TextInput, {
          value:       tab === 'chat' ? input : (notes || ''),
          onChange:    tab === 'chat' ? onChange : (val) => setNotes(val),
          onSubmit:    tab === 'chat' && !chatMenuOpen ? onSubmit : () => {},
          placeholder: focused ? (tab === 'chat' ? '/ for menu' : 'notes...') : 'Alt+E',
          focus:       focused && !isRepoInputMode
        })
      )
    )
  )
}

// ── HelpScreen ────────────────────────────────────────────────────
export function HelpScreen() {
  const row = (keys, desc, kc = 'cyan') =>
    React.createElement(Box, { flexDirection: 'row', marginBottom: 1, width: 58, minWidth: 0 },
      React.createElement(Box, { width: 22, justifyContent: 'flex-end', paddingRight: 2, minWidth: 0 },
        React.createElement(Text, { color: kc, bold: true, wrap: 'truncate' }, keys)
      ),
      React.createElement(Box, { flexGrow: 1, minWidth: 0 },
        React.createElement(Text, { color: 'white', wrap: 'truncate' }, desc)
      )
    )

  return React.createElement(Box, {
    flexGrow: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    borderStyle: 'double', borderColor: 'yellow',
    marginX: 2, marginY: 1, overflow: 'hidden', minWidth: 0
  },
    React.createElement(Box, { marginBottom: 2, minWidth: 0 },
      React.createElement(Text, { color: 'yellow', bold: true, wrap: 'truncate' }, '── JULES COLONY: QUICK REFERENCE ──')
    ),
    row('Alt + T',     'Focus Table Mode'),
    row('Alt + G',     'Focus Graph  (↑↓←→ nav  ↵ open chat)'),
    row('Alt + E',     'Focus Chat Panel'),
    row('Alt + M',     'Change working repository'),
    row('Alt + N',     'Toggle Notes / Chat tab'),
    row('Alt + H',     'Hide / Show Architecture Graph'),
    row('↑ / ↓',       'Navigate rows or graph cards'),
    row('← / →',       'Navigate graph cards left / right'),
    row('Enter',       'Open agent chat'),
    row('/ (in chat)', 'Open action menu'),
    row('?',           'Toggle this help screen', 'magenta')
  )
}

// ── PlannedGraphViewer ────────────────────────────────────────────
export function PlannedGraphViewer({ diagram, index, total, height, isDimmed }) {
  if (!diagram) {
    return React.createElement(Box, {
      flexDirection: 'column', width: '100%', height, borderStyle: 'round', borderColor: isDimmed ? 'gray' : 'cyan', paddingX: 1, alignItems: 'center', justifyContent: 'center'
    }, React.createElement(Text, { color: 'gray', dimColor: true }, 'No architecture diagrams generated yet.'));
  }

  return React.createElement(Box, {
    flexDirection: 'column', width: '100%', height, borderStyle: 'round', borderColor: isDimmed ? 'gray' : 'cyan', paddingX: 1, overflow: 'hidden'
  },
    React.createElement(Box, { height: 1, justifyContent: 'center' },
      React.createElement(Text, { color: isDimmed ? 'gray' : 'cyan', bold: !isDimmed },
        total > 1 ? `│ ◀ PLANNED ARCHITECTURE [${index + 1}/${total}] ▶ │` : `│   PLANNED ARCHITECTURE   │`
      )
    ),
    React.createElement(Box, { height: 1, overflow: 'hidden' },
      React.createElement(Text, { color: isDimmed ? 'gray' : 'cyan', dimColor: true }, '─'.repeat(100))
    ),
    React.createElement(Box, { flexGrow: 1, flexDirection: 'column', paddingTop: 1, paddingX: 2 },
      React.createElement(Text, { color: 'yellowBright', bold: true }, diagram.title || 'System Architecture'),
      React.createElement(Box, { marginY: 1, flexDirection: 'column' },
        React.createElement(Text, { color: 'cyan', bold: true }, 'Nodes (Agents/Modules):'),
        (diagram.nodes || []).map((n, i) => React.createElement(Text, { key: i, color: 'white' }, ` • ${n}`))
      ),
      React.createElement(Box, { flexDirection: 'column' },
        React.createElement(Text, { color: 'magenta', bold: true }, 'Connections (Flow):'),
        (diagram.connections || []).map((c, i) => React.createElement(Text, { key: i, color: 'gray' }, `   ↳ ${c}`))
      )
    )
  );
}