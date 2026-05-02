// ── components/chat.js ───────────────────────────────────────────
// ChatPanel — the right-side chat + notes panel.

import React, { useMemo } from 'react'
import { Box, Text } from 'ink'
import TextInput from 'ink-text-input'
import { wrapText, buildMarkdownLines } from '../markdown.js'

export function ChatPanel({
  messages, input, onChange, onSubmit,
  focused, scrollOffset, width, tab,
  notes, setNotes, isRepoInputMode,
  repoName, agentTitle, agentId,
  chatTargetMode,
  visibleAgentsCount, chatMenuOpen, chatMenuSel, chatVisibleRows
}) {
  const numWidth  = typeof width === 'number' && !isNaN(width) ? width : 40
  const wrapLimit = Math.max(10, numWidth - 4)

  // Warn when input overflows past 4 visible lines
  const isOverflowing = tab === 'chat' && (input || '').length > wrapLimit * 4

  const allLines = useMemo(() => {
    const lines = []

    if (tab === 'chat') {
      if (repoName === 'NOT SET') {
        lines.push({ type: 'label', text: '  [SYSTEM]', color: 'gray' })
        for (const l of wrapText('Select a repository (Alt+M) to start.', wrapLimit))
          lines.push({ type: 'text', text: l, color: 'yellow' })
        lines.push({ type: 'gap' })
      } else {
        for (const m of messages) {
          if (m.role === 'agent') {
            lines.push({ type: 'label', text: '▸ AGENT', color: focused ? 'magenta' : 'gray' })
            for (const ml of buildMarkdownLines(m.text, wrapLimit, focused)) lines.push(ml)
            lines.push({ type: 'gap' })
          } else if (m.role === 'system') {
            lines.push({ type: 'label', text: '  [SYS]', color: 'gray' })
            for (const l of wrapText(m.text, wrapLimit))
              lines.push({ type: 'text', text: l, color: 'gray' })
            lines.push({ type: 'gap' })
          } else {
            lines.push({ type: 'label', text: '  you', color: 'cyan' })
            for (const l of wrapText(m.text, wrapLimit))
              lines.push({ type: 'text', text: l, color: focused ? 'cyan' : 'gray' })
            lines.push({ type: 'gap' })
          }
        }
      }
    } else {
      for (const l of wrapText(notes || 'Type your notes here...', wrapLimit))
        lines.push({ type: 'text', text: l, color: focused ? 'white' : 'gray' })
    }

    return lines
  }, [messages, wrapLimit, tab, repoName, focused, notes])

  const MESSAGE_ROWS = Math.max(2, chatVisibleRows)
  const total   = allLines.length
  const start   = Math.max(0, total - MESSAGE_ROWS - scrollOffset)
  const visible = allLines.slice(start, start + MESSAGE_ROWS)

  const isNewSession = chatTargetMode === 'CREATE_ORCHESTRATOR' ||
    (!chatTargetMode && agentId === 'NEW TASK')
  const hasMessages  = messages && messages.length > 0

  const maxTitleLen = 15
  const shortTitle  = isNewSession
    ? 'new session'
    : agentTitle && agentTitle.length > maxTitleLen
      ? agentTitle.substring(0, maxTitleLen) + '…'
      : (agentTitle || 'orchestrator')

  return React.createElement(Box, {
    flexDirection: 'column', width,
    paddingLeft: 1, flexShrink: 0, minHeight: 0, overflow: 'hidden'
  },
    // ── Header ──
    React.createElement(Box, { flexShrink: 0, height: 1, minWidth: 0, overflow: 'hidden' },
      React.createElement(Text, {
        color: isNewSession ? 'greenBright' : (focused ? 'cyanBright' : 'gray'),
        bold: true, wrap: 'truncate'
      },
        tab === 'chat'
          ? (isNewSession ? `✦ NEW SESSION  |  NOTES` : `▌ CHAT: ${shortTitle}  |  NOTES`)
          : (isNewSession ? `✦ NEW SESSION  |  CHAT`  : `▌ NOTES: ${shortTitle}  |  CHAT`)
      ),
      scrollOffset > 0 && React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' },
        ` ↑${scrollOffset}`)
    ),
    React.createElement(Box, { overflow: 'hidden', flexShrink: 0, height: 1, minWidth: 0 },
      React.createElement(Text, {
        color: isNewSession ? 'green' : 'gray', dimColor: !isNewSession, wrap: 'truncate'
      }, '─'.repeat(100))
    ),

    // ── Message area ──
    React.createElement(Box, {
      flexDirection: 'column', height: MESSAGE_ROWS,
      flexShrink: 0, minHeight: 0, overflow: 'hidden',
      justifyContent: (isNewSession && !hasMessages) ? 'center' : 'flex-end'
    },
      // ── New-session banner (shown when no agent is selected) ──
      (isNewSession && !hasMessages && tab === 'chat')
        ? React.createElement(Box, {
            flexDirection: 'column', alignItems: 'center',
            paddingX: 2, paddingY: 1
          },
            React.createElement(Box, {
              borderStyle: 'round',
              borderColor: focused ? 'greenBright' : 'gray',
              paddingX: 3, paddingY: 1,
              flexDirection: 'column', alignItems: 'center'
            },
              React.createElement(Text, { color: focused ? 'greenBright' : 'gray', bold: true },
                '✦  NEW SESSION'),
              React.createElement(Box, { height: 1 }),
              React.createElement(Text, { color: focused ? 'white' : 'gray', dimColor: !focused },
                'Your message will spawn a'),
              React.createElement(Text, { color: focused ? 'white' : 'gray', dimColor: !focused },
                'fresh orchestrator agent.'),
              React.createElement(Box, { height: 1 }),
              React.createElement(Text, { color: focused ? 'cyan' : 'gray', dimColor: !focused },
                repoName === 'NOT SET'
                  ? '⚠  no repo — press Alt+M'
                  : `repo: ${repoName}`)
            )
          )
        : visible.map((l, i) => {
            if (l.type === 'jsx')
              return React.createElement(Box, { key: i, height: 1, overflow: 'hidden', minWidth: 0, paddingLeft: 2 }, l.element)
            if (l.type === 'gap')
              return React.createElement(Box, { key: i, height: 1, minWidth: 0 },
                React.createElement(Text, null, ' '))
            if (l.type === 'label')
              return React.createElement(Box, { key: i, height: 1, overflow: 'hidden', minWidth: 0 },
                React.createElement(Text, { color: l.color, bold: true, dimColor: l.color === 'gray' || !focused, wrap: 'truncate' }, l.text))
            return React.createElement(Box, { key: i, paddingLeft: 2, height: 1, overflow: 'hidden', minWidth: 0 },
              React.createElement(Text, { color: l.color, dimColor: !focused, wrap: 'truncate' }, l.text))
          })
    ),

    // ── Slash-command menu ──
    chatMenuOpen && tab === 'chat' && React.createElement(Box, {
      flexDirection: 'column', height: 5,
      borderStyle: 'round', borderColor: 'cyan',
      paddingX: 1, flexShrink: 0, minWidth: 0, overflow: 'hidden'
    },
      ['New Task', 'Talk Agent', 'Talk Lead'].map((opt, i) =>
        React.createElement(Text, { key: i, color: chatMenuSel === i ? 'cyanBright' : 'gray', wrap: 'truncate' },
          chatMenuSel === i ? `▶ ${opt}` : `  ${opt}`)
      )
    ),

    // ── Separator (with overflow hint) ──
    React.createElement(Box, { overflow: 'hidden', flexShrink: 0, height: 1, minWidth: 0 },
      isOverflowing
        ? React.createElement(Text, { color: 'red', bold: true, wrap: 'truncate' },
            '─[ ◀ ▶ TEXT HIDDEN: Use Left/Right arrows to move cursor ]' + '─'.repeat(60))
        : React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, '─'.repeat(100))
    ),

    // ── Input box (camera-window trick to cap at 4 lines) ──
    React.createElement(Box, {
      height: Math.min(4, Math.max(1, Math.ceil((input || '').length / wrapLimit))),
      flexShrink: 0, flexDirection: 'column', minWidth: 0, overflow: 'hidden'
    },
      React.createElement(Box, {
        marginTop: Math.ceil((input || '').length / wrapLimit) > 4
          ? -(Math.ceil((input || '').length / wrapLimit) - 4) : 0,
        flexDirection: 'row', minWidth: 0
      },
        React.createElement(Box, { flexShrink: 0, minWidth: 0 },
          React.createElement(Text, { color: focused ? 'green' : 'gray', bold: focused, wrap: 'truncate' },
            focused ? '▶ ' : '▷ ')
        ),
        React.createElement(Box, { flexGrow: 1, flexShrink: 1, minWidth: 0 },
          React.createElement(Box, { width: Math.max(10, numWidth - 4) },
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
    )
  )
}