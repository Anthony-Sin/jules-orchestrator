// ── components/graph.js ──────────────────────────────────────────
// MiniGraph, GraphNode, PlannedGraphViewer, PlannedNode
//
// ️  HIDDEN FOR NOW — graph UI is intentionally not rendered.
// All components are defined and exported so imports in renderer.js
// stay valid, but every public component returns null.
// Un-hide by replacing the null returns with the real JSX below.

import React from 'react'
import { Box, Text } from 'ink'
import { parseSourceDisplay } from '../../state/jules-api.js'
import { ago, STATUS_COLOR, STATUS_SHORT } from './table.js'

export const GRAPH_NODE_W = 24
const GRAPH_NODE_H = 5

// ─────────────────────────────────────────────────────────────────
// STUBBED — swap `return null` for the real body when you're ready
// ─────────────────────────────────────────────────────────────────

function GraphNode({ agent, isSelected, tick, isDimmed }) {
  return null
  /* ── REAL BODY (preserved, not running) ──────────────────────────
  const sc      = STATUS_COLOR[agent.state || 'UNKNOWN'] || 'white'
  const ss      = STATUS_SHORT[agent.state || 'UNKNOWN'] || '???'
  const hi      = isSelected && !isDimmed

  const msElapsed   = Date.now() - new Date(agent.lastUpdated || agent.createdAt || 0).getTime()
  const minsElapsed = msElapsed / 60000

  let rBorder = 'blue'; let rTitle = 'blueBright'
  if      (minsElapsed < 10)   { rBorder = 'magenta'; rTitle = 'magentaBright' }
  else if (minsElapsed < 60)   { rBorder = 'yellow';  rTitle = 'yellowBright'  }
  else if (minsElapsed < 1440) { rBorder = 'cyan';    rTitle = 'cyanBright'    }

  const borderColor = isDimmed ? 'gray' : hi ? 'white' : rBorder
  const titleColor  = isDimmed ? 'gray' : hi ? 'white' : rTitle
  const IW = GRAPH_NODE_W - 4

  const parsed    = parseSourceDisplay(agent.repoDisplay || agent.repo || '')
  const repoShort = (parsed.includes('/') ? parsed.split('/')[1] : parsed).substring(0, IW)
  const titleStr  = (agent.title || 'agent').toUpperCase().substring(0, IW)
  const shortId   = (agent.id || '').substring(0, 6)
  const agoStr    = ago(agent.lastUpdated || agent.createdAt)

  const isWaitState = ['PAUSED','AWAITING_PLAN_APPROVAL','AWAITING_USER_FEEDBACK'].includes(agent.state)
  const isFailState = ['FAILED','KILLED'].includes(agent.state)
  const timeColor   = isDimmed ? 'gray' : isFailState ? 'red' : isWaitState ? 'yellow' : 'green'

  const idStatusSpace = IW - agoStr.length - ss.length - shortId.length - 1
  const paddingStr = ' '.repeat(Math.max(0, idStatusSpace))

  let barFilled
  if      (agent.state === 'IN_PROGRESS' || agent.state === 'PLANNING')
    barFilled = Math.floor(IW * (0.5 + 0.5 * Math.sin(tick / 5)))
  else if (agent.state === 'COMPLETED') barFilled = IW
  else                                  barFilled = 0
  barFilled = Math.max(0, Math.min(IW, barFilled))

  const barColor = isDimmed ? 'gray'
    : agent.state === 'COMPLETED'   ? 'green'
    : agent.state === 'IN_PROGRESS' ? 'magenta'
    : agent.state === 'PLANNING'    ? 'cyan'
    : agent.state === 'FAILED'      ? 'red'
    : 'yellow'

  return React.createElement(Box, {
    borderStyle: hi ? 'double' : 'round', borderColor,
    width: GRAPH_NODE_W, height: GRAPH_NODE_H,
    flexShrink: 0, flexDirection: 'column', paddingX: 1, overflow: 'hidden'
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
      React.createElement(Text, { color: sc,      bold: !isDimmed, dimColor: isDimmed }, `${ss} `),
      React.createElement(Text, { color: 'white', dimColor: isDimmed }, `${shortId}${paddingStr}`),
      React.createElement(Text, { color: timeColor, bold: !isDimmed, dimColor: isDimmed }, agoStr)
    )
  )
  ── END REAL BODY ── */
}

// ── MiniGraph (HIDDEN) ────────────────────────────────────────────
export function MiniGraph({ tick, isDimmed, height, width, sessions, graphSel, onGraphNav, onGraphSelect }) {
  return null
  /* ── REAL BODY ────────────────────────────────────────────────────
  const sorted = (sessions || []).slice().sort((a, b) =>
    new Date(b.lastUpdated || b.createdAt || 0) - new Date(a.lastUpdated || a.createdAt || 0)
  )
  const total    = sorted.length
  const safeIdx  = Math.min(Math.max(0, graphSel), Math.max(0, total - 1))
  const selAgent = sorted[safeIdx] || null

  const safeWidth   = width || 80
  const usableWidth = Math.max(20, safeWidth - 4)
  const CPR         = Math.max(1, Math.floor(usableWidth / (GRAPH_NODE_W + 1)))
  const cardRows    = Math.max(1, Math.floor((height - 6) / GRAPH_NODE_H))
  const visibleTotal = CPR * cardRows

  const selRow   = Math.floor(safeIdx / CPR)
  const maxStart = Math.max(0, Math.ceil(total / CPR) - cardRows)
  const startRow = Math.min(maxStart, Math.max(0, selRow - Math.floor(cardRows / 2)))
  const startIdx = startRow * CPR
  const visible  = sorted.slice(startIdx, startIdx + visibleTotal)

  const rows = []
  for (let r = 0; r < cardRows; r++) {
    const chunk = visible.slice(r * CPR, r * CPR + CPR)
    if (chunk.length > 0) rows.push(chunk)
  }

  const canScrollUp   = startRow > 0
  const canScrollDown = startRow < maxStart

  return React.createElement(Box, {
    flexDirection: 'column', width: '100%', height, flexShrink: 0,
    borderStyle: 'round', borderColor: isDimmed ? 'gray' : 'cyan',
    paddingX: 1, overflow: 'hidden'
  },
    React.createElement(Box, { flexDirection: 'column', flexShrink: 0, minWidth: 0 },
      React.createElement(Box, { height: 1, justifyContent: 'center' },
        React.createElement(Text, { color: isDimmed ? 'gray' : 'cyan', bold: !isDimmed, dimColor: isDimmed, wrap: 'truncate' },
          total > 0 ? `│   LIVE AGENTS GRID  [${safeIdx + 1}/${total}]   │` : `│   LIVE AGENTS GRID   │`
        )
      ),
      React.createElement(Box, { height: 1, overflow: 'hidden' },
        React.createElement(Text, { color: isDimmed ? 'gray' : 'cyan', dimColor: true }, '─'.repeat(100))
      )
    ),
    canScrollUp && React.createElement(Box, { height: 1, justifyContent: 'center', flexShrink: 0 },
      React.createElement(Text, { color: 'cyan', bold: true }, '▲ MORE ABOVE ▲')
    ),
    total === 0
      ? React.createElement(Box, { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
          React.createElement(Text, { color: 'gray', dimColor: true }, 'No agents yet — send a task to dispatch an orchestrator')
        )
      : React.createElement(Box, { flexDirection: 'column', flexGrow: 1, overflow: 'hidden', alignItems: 'center' },
          rows.map((row, ri) =>
            React.createElement(React.Fragment, { key: ri },
              React.createElement(Box, {
                flexDirection: 'row', flexShrink: 0, height: GRAPH_NODE_H,
                overflow: 'hidden', justifyContent: 'center', gap: 1
              },
                row.map(agent => {
                  const absIdx = sorted.indexOf(agent)
                  return React.createElement(GraphNode, {
                    key: agent.id, agent,
                    isSelected: absIdx === safeIdx,
                    tick, isDimmed
                  })
                })
              )
            )
          )
        ),
    canScrollDown && React.createElement(Box, { height: 1, justifyContent: 'center', flexShrink: 0 },
      React.createElement(Text, { color: 'cyan', bold: true }, '▼ MORE BELOW ▼')
    ),
    React.createElement(Box, { height: 1, flexShrink: 0, justifyContent: 'center', minWidth: 0 },
      React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' },
        selAgent
          ? ` ↑↓←→ navigate  ↵ open chat  ·  ${(selAgent.title || selAgent.id || '').substring(0, 20)}`
          : ' ↑↓←→ navigate  ↵ open chat'
      )
    )
  )
  ── END REAL BODY ── */
}

// ── PlannedNode (HIDDEN) ──────────────────────────────────────────
function PlannedNode({ label, isDimmed, isSelected }) {
  return null
  /* ── REAL BODY ────────────────────────────────────────────────────
  const bStyle = isSelected && !isDimmed ? 'double' : 'round'
  const bColor = isSelected && !isDimmed ? 'white' : (isDimmed ? 'gray' : 'magenta')
  const tColor = isSelected && !isDimmed ? 'cyanBright' : (isDimmed ? 'gray' : 'white')
  const fill   = isSelected && !isDimmed ? '▓▓▓▓▓▓▓▓▓▓' : '░░░░░░░░░░'
  const displayLabel = label && label.length > 16 ? label.substring(0, 14) + '..' : (label || 'Unknown')

  return React.createElement(Box, {
    borderStyle: bStyle, borderColor: bColor,
    width: 18, height: 4, flexShrink: 0, flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    marginX: 1, marginBottom: 1
  },
    React.createElement(Text, { color: tColor, bold: true }, displayLabel),
    React.createElement(Text, { color: isSelected && !isDimmed ? 'cyan' : 'gray', dimColor: !isSelected }, fill)
  )
  ── END REAL BODY ── */
}

// ── PlannedGraphViewer (HIDDEN) ───────────────────────────────────
export function PlannedGraphViewer({ diagram, selectedNodeIdx, height, isDimmed }) {
  return null
  /* ── REAL BODY ────────────────────────────────────────────────────
  if (!diagram) {
    return React.createElement(Box, {
      flexDirection: 'column', width: '100%', height,
      borderStyle: 'round', borderColor: isDimmed ? 'gray' : 'cyan',
      paddingX: 1, alignItems: 'center', justifyContent: 'center'
    }, React.createElement(Text, { color: 'gray', dimColor: true }, 'No architecture diagrams generated yet.'))
  }

  const nodes   = diagram.nodes || []
  const conns   = diagram.connections || []
  const adj     = {}; const inDegree = {}; const parentMap = {}

  nodes.forEach(n => { adj[n] = []; inDegree[n] = 0; parentMap[n] = [] })
  conns.forEach(c => {
    const [u, v] = c.split('->').map(s => s.trim())
    if (inDegree[v] !== undefined && adj[u] !== undefined) {
      adj[u].push(v); inDegree[v]++; parentMap[v].push(u)
    }
  })

  const baseTiers = []
  let cur = nodes.filter(n => inDegree[n] === 0)
  if (cur.length === 0 && nodes.length > 0) cur = [nodes[0]]
  const vis = new Set(cur)
  while (cur.length > 0) {
    baseTiers.push(cur)
    const nxt = []
    cur.forEach(u => adj[u].forEach(v => { if (!vis.has(v)) { vis.add(v); nxt.push(v) } }))
    cur = nxt
  }
  const uncon = nodes.filter(n => !vis.has(n))
  if (uncon.length > 0) baseTiers.push(uncon)

  const selNodeLabel = nodes[selectedNodeIdx] || 'Unknown'
  const activePath = new Set([selNodeLabel])
  let curr = selNodeLabel
  while (curr) {
    const parents = parentMap[curr] || []
    if (parents.length === 0) break
    curr = parents[0]; activePath.add(curr)
  }

  const tiers = []
  for (let t = 0; t < baseTiers.length; t++) {
    if (t === 0) { tiers.push(baseTiers[0]); continue }
    const prevActive  = tiers[t-1].filter(n => activePath.has(n))
    const allowed     = new Set()
    prevActive.forEach(p => (adj[p] || []).forEach(c => allowed.add(c)))
    const visInTier   = baseTiers[t].filter(n => allowed.has(n))
    if (visInTier.length > 0) tiers.push(visInTier)
  }

  let selTierIdx = 0
  for (let t = 0; t < tiers.length; t++) {
    if (tiers[t].includes(selNodeLabel)) { selTierIdx = t; break }
  }

  const usableHeight = Math.max(8, height - 8)
  const visibleCount = Math.max(1, Math.floor(usableHeight / 9))
  let startTier = Math.max(0, selTierIdx - Math.floor(visibleCount / 2))
  if (startTier + visibleCount > tiers.length) startTier = Math.max(0, tiers.length - visibleCount)

  const visibleTiers  = tiers.slice(startTier, startTier + visibleCount)
  const canScrollUp   = startTier > 0
  const canScrollDown = startTier + visibleCount < tiers.length

  const incoming = []; const outgoing = []
  conns.forEach(c => {
    const [u, v] = c.split('->').map(s => s.trim())
    if (v === selNodeLabel) incoming.push(u)
    if (u === selNodeLabel) outgoing.push(v)
  })

  return React.createElement(Box, {
    flexDirection: 'column', width: '100%', height,
    borderStyle: 'round', borderColor: isDimmed ? 'gray' : 'cyan',
    paddingX: 1, overflow: 'hidden'
  },
    React.createElement(Box, { height: 1, justifyContent: 'center', flexShrink: 0 },
      React.createElement(Text, { color: isDimmed ? 'gray' : 'cyan', bold: !isDimmed }, '│   PLANNED ARCHITECTURE   │')
    ),
    React.createElement(Box, { height: 1, overflow: 'hidden', flexShrink: 0 },
      React.createElement(Text, { color: isDimmed ? 'gray' : 'cyan', dimColor: true }, '─'.repeat(100))
    ),
    React.createElement(Box, { marginY: 1, flexShrink: 0, justifyContent: 'center' },
      React.createElement(Text, { color: 'yellowBright', bold: true }, diagram.title || 'System Architecture')
    ),
    canScrollUp && React.createElement(Box, { height: 1, justifyContent: 'center', flexShrink: 0 },
      React.createElement(Text, { color: 'cyan', bold: true }, '▲ MORE ABOVE ▲')
    ),
    React.createElement(Box, { flexGrow: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start' },
      visibleTiers.map((tier, localIdx) => {
        const isLast = localIdx === visibleTiers.length - 1
        return React.createElement(Box, { key: `tier_${localIdx}`, flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: '100%' },
          React.createElement(Box, { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', width: '100%', flexShrink: 0 },
            tier.map(nodeLabel =>
              React.createElement(PlannedNode, {
                key: nodeLabel, label: nodeLabel, isDimmed,
                isSelected: nodes.indexOf(nodeLabel) === selectedNodeIdx
              })
            )
          ),
          !isLast && React.createElement(Box, { flexDirection: 'column', alignItems: 'center', flexShrink: 0, marginY: 1 },
            React.createElement(Text, { color: isDimmed ? 'gray' : 'cyan', dimColor: true }, '│'),
            React.createElement(Text, { color: isDimmed ? 'gray' : 'cyan', dimColor: true }, '▼')
          )
        )
      })
    ),
    canScrollDown && React.createElement(Box, { height: 1, justifyContent: 'center', flexShrink: 0 },
      React.createElement(Text, { color: 'cyan', bold: true }, '▼ MORE BELOW ▼')
    ),
    React.createElement(Box, { height: 1, overflow: 'hidden', flexShrink: 0, marginTop: 1 },
      React.createElement(Text, { color: isDimmed ? 'gray' : 'cyan', dimColor: true }, '─'.repeat(100))
    ),
    React.createElement(Box, { height: 1, justifyContent: 'center', flexShrink: 0 },
      React.createElement(Text, { color: isDimmed ? 'gray' : 'cyan', dimColor: true },
        incoming.length ? incoming.join(', ') + ' → ' : '(Root) → '
      ),
      React.createElement(Text, { color: isDimmed ? 'gray' : 'white', bold: !isDimmed }, selNodeLabel),
      React.createElement(Text, { color: isDimmed ? 'gray' : 'cyan', dimColor: true },
        outgoing.length ? ' → ' + outgoing.join(', ') : ' → (Leaf)'
      )
    )
  )
  ── END REAL BODY ── */
}
