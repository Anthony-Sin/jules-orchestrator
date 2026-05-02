// ── components/chat.js ───────────────────────────────────────────
// ChatPanel — the right-side chat + notes panel.
// Agent messages are collapsible dropdowns. Press Space (in chat mode,
// while hovering a message with ↑/↓) to toggle expand/collapse.

import React, { useMemo, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { wrapText, buildMarkdownLines } from '../markdown.js'
import { Notepad } from './notepad.js'

// How many lines an agent message must exceed before it gets collapsed by default
const COLLAPSE_THRESHOLD = 4
// Max preview lines shown when collapsed
const PREVIEW_LINES = 2

export function ChatPanel({
  messages = [], input, onChange, onSubmit,
  focused, scrollOffset = 0, width, tab,
  notes, setNotes, isRepoInputMode,
  repoName, agentTitle, agentId,
  chatTargetMode,
  visibleAgentsCount, chatMenuOpen, chatMenuSel, chatVisibleRows = 10, latestProgress, promptPreview,
  // Dropdown props from dashboard-controller
  expandedMessages, toggleMessageExpand,
  chatCursorLine, setChatCursorLine, setScrollOffset,
}) {
  const numWidth  = typeof width === 'number' && !isNaN(width) ? width : 40
  const wrapLimit = Math.max(10, numWidth - 4)

  const isOverflowing = tab === 'chat' && (input || '').length > wrapLimit * 4

  // ── SAFEGUARD ──────────────────────────────────────────────────────
  // Prevent "Cannot read properties of undefined (reading 'has')"
  const _expanded = expandedMessages instanceof Set ? expandedMessages : new Set();

  // ── Build flat line list with dropdown awareness ──────────────────
  const allLines = useMemo(() => {
    const lines = []

    if (tab === 'chat') {
      if (repoName === 'NOT SET') {
        lines.push({ type: 'label', text: '[SYSTEM]', color: 'gray', msgIdx: -1 })
        for (const l of wrapText('Select a repository (Alt+M) to start.', wrapLimit))
          lines.push({ type: 'text', text: l, color: 'yellow', msgIdx: -1 })
        lines.push({ type: 'gap', msgIdx: -1 })
        return lines
      }

      for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
        const m = messages[msgIdx]

        if (m.role === 'agent') {
          // Build full markdown lines for this message
          const mdLines = buildMarkdownLines(m.text, wrapLimit, focused)
          const isLong  = mdLines.length > COLLAPSE_THRESHOLD
          const isOpen  = !isLong || _expanded.has(msgIdx)

          // ── Dropdown header row ──
          // Shows: ▸ AGENT  [▼ expanded | ▶ collapsed]  (N lines)
          const chevron     = isOpen ? '▼' : '▶'
          const lineCount   = mdLines.length
          const countSuffix = isLong ? ` ${lineCount}L` : ''

          lines.push({
            type:     'dropdown-header',
            msgIdx,
            isOpen,
            isLong,
            chevron,
            countSuffix,
            color:    focused ? 'magenta' : 'gray'
          })

          if (isOpen) {
            for (const ml of mdLines) lines.push({ ...ml, msgIdx })
          } else {
            // Show a brief preview (first PREVIEW_LINES of plain text)
            const previewLines = mdLines
              .filter(l => l.type === 'text' || (l.type === 'jsx'))
              .slice(0, PREVIEW_LINES)
            for (const pl of previewLines) {
              lines.push({ ...pl, _isPreview: true, msgIdx })
            }
            // "… N more lines" hint
            const hidden = lineCount - previewLines.length
            if (hidden > 0) {
              lines.push({
                type: 'more-hint',
                hidden,
                msgIdx,
                focused
              })
            }
          }

          lines.push({ type: 'gap', msgIdx })

        } else if (m.role === 'system') {
          lines.push({ type: 'label', text: '[SYS]', color: 'gray', msgIdx })
          for (const l of wrapText(m.text, wrapLimit))
            lines.push({ type: 'text', text: l, color: 'gray', msgIdx })
          lines.push({ type: 'gap', msgIdx })

        } else {
          // user
          lines.push({
            type:  'label',
            text:  'you',
            color: focused ? 'cyan' : 'gray',
            msgIdx
          })
          for (const l of wrapText(m.text, wrapLimit))
            lines.push({ type: 'text', text: l, color: focused ? 'cyan' : 'gray', msgIdx })
          lines.push({ type: 'gap', msgIdx })
        }
      }
    }

    return lines
  }, [messages, wrapLimit, tab, repoName, focused, _expanded])

  const MESSAGE_ROWS = Math.max(2, chatVisibleRows)
  const total   = allLines.length

  // Calculate scrolling to keep cursor in view
  const targetLineIndex = Math.max(0, total - 1 - (chatCursorLine || 0))

  useEffect(() => {
    if (focused && tab === 'chat' && total > 0 && setScrollOffset) {
      // Try to keep the targetLineIndex near the center of the visible window
      const idealStart = Math.max(0, targetLineIndex - Math.floor(MESSAGE_ROWS / 2))
      const maxStart = Math.max(0, total - MESSAGE_ROWS)
      const clampedStart = Math.min(idealStart, maxStart)

      const idealOffset = Math.max(0, total - MESSAGE_ROWS - clampedStart)
      setScrollOffset(idealOffset)
    }
  }, [chatCursorLine, total, MESSAGE_ROWS, focused, tab, setScrollOffset])

  const start   = Math.max(0, total - MESSAGE_ROWS - scrollOffset)
  const visible = allLines.slice(start, start + MESSAGE_ROWS)

  // ── Scroll + expand hook ─────────────────────────
  useInput((input, key) => {
    if (!focused || tab !== 'chat') return

    if (key.upArrow) {
      if (setChatCursorLine) {
         setChatCursorLine(c => Math.min(total - 1, (c || 0) + 1))
      }
      return
    }
    if (key.downArrow) {
      if (setChatCursorLine) {
         setChatCursorLine(c => Math.max(0, (c || 0) - 1))
      }
      return
    }
    if (key.meta && input === 'a') {
      const selectedLine = allLines[targetLineIndex]
      if (selectedLine && selectedLine.msgIdx >= 0) {
        toggleMessageExpand(selectedLine.msgIdx)
      }
      return
    }
  })

  // Scroll position is intentionally NOT reset on tab switch — user keeps their place

  const isNewSession = chatTargetMode === 'CREATE_ORCHESTRATOR' ||
    (!chatTargetMode && agentId === 'NEW TASK')
  const hasMessages  = messages && messages.length > 0

  const maxTitleLen = 15
  const shortTitle  = isNewSession
    ? 'new session'
    : agentTitle && agentTitle.length > maxTitleLen
      ? agentTitle.substring(0, maxTitleLen) + '…'
      : (agentTitle || 'orchestrator')

  // Count expandable messages for the hint in header
  const agentMsgCount = messages.filter(m => m.role === 'agent').length
  const collapsedCount = messages.filter((m, i) =>
    m.role === 'agent' &&
    buildMarkdownLines(m.text, wrapLimit, focused).length > COLLAPSE_THRESHOLD &&
    !_expanded.has(i)
  ).length

  return React.createElement(Box, {
    flexDirection: 'column', width,
    paddingLeft: 1, flexShrink: 0, minHeight: 0, overflow: 'hidden'
  },
    // ── Header ──────────────────────────────────────────────────────
    React.createElement(Box, {
      flexShrink: 0, height: 1, minWidth: 0,
      overflow: 'hidden', flexDirection: 'row', justifyContent: 'space-between'
    },
      React.createElement(Box, { flexDirection: 'row', minWidth: 0, overflow: 'hidden', flexShrink: 1 },
        isNewSession ? (
          tab === 'chat'
            ? React.createElement(React.Fragment, null,
                React.createElement(Text, { color: 'greenBright', bold: true, wrap: 'truncate' }, '✦ NEW SESSION  |  '),
                React.createElement(Text, { color: 'gray', bold: true, dimColor: true, wrap: 'truncate' }, 'NOTES')
              )
            : React.createElement(React.Fragment, null,
                React.createElement(Text, { color: 'greenBright', bold: true, wrap: 'truncate' }, '✦ NEW SESSION  |  '),
                React.createElement(Text, { color: 'gray', bold: true, dimColor: true, wrap: 'truncate' }, 'CHAT')
              )
        ) : (
          tab === 'chat'
            ? React.createElement(React.Fragment, null,
                React.createElement(Text, { color: focused ? 'cyanBright' : 'gray', bold: true, wrap: 'truncate' }, `▌ CHAT: ${shortTitle}  |  `),
                React.createElement(Text, { color: 'gray', bold: true, dimColor: true, wrap: 'truncate' }, 'NOTES')
              )
            : React.createElement(React.Fragment, null,
                React.createElement(Text, { color: focused ? 'cyanBright' : 'gray', bold: true, wrap: 'truncate' }, `▌ NOTES: ${shortTitle}  |  `),
                React.createElement(Text, { color: 'gray', bold: true, dimColor: true, wrap: 'truncate' }, 'CHAT')
              )
        )
      ),
      // Collapsed count badge + scroll hint
      React.createElement(Box, { flexDirection: 'row', flexShrink: 0, minWidth: 0 },
        collapsedCount > 0 && focused && tab === 'chat' &&
          React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' },
            ` ${collapsedCount} collapsed  `),
        scrollOffset > 0 &&
          React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' },
            `↑${scrollOffset} `)
      )
    ),

    // ── Header separator ──
    React.createElement(Box, { overflow: 'hidden', flexShrink: 0, height: 1, minWidth: 0 },
      React.createElement(Text, {
        color: isNewSession ? 'green' : 'gray',
        dimColor: !isNewSession,
        wrap: 'truncate'
      }, '─'.repeat(100))
    ),

    // ── Message area ─────────────────────────────────────────────────
    React.createElement(Box, {
      flexDirection: 'column', height: MESSAGE_ROWS,
      flexShrink: 0, minHeight: 0, overflow: 'hidden',
      justifyContent: (isNewSession && !hasMessages) ? 'center' : 'flex-end'
    },
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
              React.createElement(Text, { color: focused ? 'greenBright' : 'gray', bold: true }, '✦  NEW SESSION'),
              React.createElement(Box, { height: 1 }),
              React.createElement(Text, { color: focused ? 'white' : 'gray', dimColor: !focused }, 'Your message will spawn a'),
              React.createElement(Text, { color: focused ? 'white' : 'gray', dimColor: !focused }, 'fresh orchestrator agent.'),
              React.createElement(Box, { height: 1 }),
              React.createElement(Text, { color: focused ? 'cyan' : 'gray', dimColor: !focused },
                repoName === 'NOT SET'
                  ? '⚠  no repo — press Alt+M'
                  : `repo: ${repoName}`)
            )
          )
        : tab === 'notes'
          ? React.createElement(Notepad, {
              value: notes || '',
              onChange: setNotes,
              focused: focused && !isRepoInputMode,
              height: MESSAGE_ROWS,
              width: wrapLimit
            })
          : visible.map((l, i) => {
            const absoluteIdx = start + i
            const isFoc  = absoluteIdx === targetLineIndex && focused && tab === 'chat';
            const prefixElt = React.createElement(Text, { color: 'cyanBright' }, (isFoc && !chatMenuOpen) ? '▶ ' : '  ');

            // ── Dropdown header ──
            if (l.type === 'dropdown-header') {
              return React.createElement(Box, {
                key: `dh_${i}`, height: 1, flexDirection: 'row',
                minWidth: 0, overflow: 'hidden'
              },
                prefixElt,
                React.createElement(Text, {
                  color: l.color, bold: true, dimColor: !focused, wrap: 'truncate'
                }, `▸ AGENT `),
                React.createElement(Text, {
                  color: l.isOpen ? (focused ? '#7EC8A4' : 'gray') : (focused ? '#FFB347' : 'gray'),
                  dimColor: !focused, wrap: 'truncate'
                }, l.chevron),
                l.countSuffix && React.createElement(Text, {
                  color: 'gray', dimColor: true, wrap: 'truncate'
                }, l.countSuffix),
                // Key hint for focused message
                l.isLong && isFoc && React.createElement(Text, {
                  color: 'gray', dimColor: true, wrap: 'truncate'
                }, '  [alt+a]')
              )
            }

            // ── "…N more" hint ──
            if (l.type === 'more-hint') {
              return React.createElement(Box, {
                key: `mh_${i}`, height: 1,
                minWidth: 0, overflow: 'hidden', flexDirection: 'row'
              },
                prefixElt,
                React.createElement(Text, {
                  color: focused ? '#FFB347' : 'gray',
                  dimColor: !focused, wrap: 'truncate'
                }, `┄ ${l.hidden} more line${l.hidden !== 1 ? 's' : ''} hidden — press `),
                React.createElement(Text, {
                  color: focused ? 'white' : 'gray',
                  bold: true, dimColor: !focused, wrap: 'truncate'
                }, '[alt+a]'),
                React.createElement(Text, {
                  color: focused ? '#FFB347' : 'gray',
                  dimColor: !focused, wrap: 'truncate'
                }, ' to expand')
              )
            }

            // ── Standard line types ──
            if (l.type === 'jsx') {
              return React.createElement(Box, {
                key: i, height: 1, overflow: 'hidden', minWidth: 0,
                opacity: l._isPreview ? 0.6 : 1
              }, 
                prefixElt, 
                l.element
              )
            }
            if (l.type === 'gap') {
              return React.createElement(Box, { key: i, height: 1, minWidth: 0 },
                prefixElt
              )
            }
            if (l.type === 'label') {
              return React.createElement(Box, { key: i, height: 1, overflow: 'hidden', minWidth: 0 },
                prefixElt,
                React.createElement(Text, {
                  color: l.color, bold: true,
                  dimColor: (l.color === 'gray' || !focused), wrap: 'truncate'
                }, l.text)
              )
            }
            
            // Standard Text Line
            return React.createElement(Box, {
              key: i, height: 1, overflow: 'hidden', minWidth: 0
            },
              prefixElt,
              React.createElement(Text, {
                color: l.color, dimColor: !focused, wrap: 'truncate'
              }, l.text)
            )
          })
    ),

    // ── Slash-command menu ──────────────────────────────────────────
    chatMenuOpen && tab === 'chat' && React.createElement(Box, {
      flexDirection: 'column', height: 5,
      borderStyle: 'round', borderColor: 'cyan',
      paddingX: 1, flexShrink: 0, minWidth: 0, overflow: 'hidden'
    },
      ['Start New Task', 'Start New Orchestrator', 'Approve Plan'].map((opt, idx) =>
        React.createElement(Text, { key: idx, color: chatMenuSel === idx ? 'cyanBright' : 'gray', wrap: 'truncate' },
          chatMenuSel === idx ? `▶ ${opt}` : `  ${opt}`)
      )
    ),

    // ── Bottom separator ────────────────────────────────────────────
    tab === 'chat' && React.createElement(Box, { overflow: 'hidden', flexShrink: 0, height: 1, minWidth: 0 },
      isOverflowing
        ? React.createElement(Text, { color: 'red', bold: true, wrap: 'truncate' },
            '─[ ◀ ▶ TEXT HIDDEN: Use Left/Right arrows to move cursor ]' + '─'.repeat(60))
        : React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, '─'.repeat(100))
    ),

    (latestProgress || promptPreview) && tab === 'chat' && React.createElement(Box, {
      flexDirection: 'row',
      borderStyle: 'round',
      borderColor: 'magenta',
      paddingX: 1,
      flexShrink: 0,
      minWidth: 0,
      overflow: 'hidden'
    },
      React.createElement(Text, { color: promptPreview ? 'cyanBright' : 'magenta', wrap: 'truncate' }, promptPreview || latestProgress)
    ),
    // ── Input box ───────────────────────────────────────────────────
    tab === 'chat' && React.createElement(Box, {
      height: Math.min(4, Math.max(1, Math.ceil((input || '').length / wrapLimit))),
      flexShrink: 0, flexDirection: 'column', minWidth: 0, overflow: 'hidden'
    },
      React.createElement(Box, {
        marginTop: Math.ceil((input || '').length / wrapLimit) > 4
          ? -(Math.ceil((input || '').length / wrapLimit) - 4) : 0,
        flexDirection: 'row', minWidth: 0
      },
        React.createElement(Box, { flexShrink: 0, minWidth: 0 },
          React.createElement(Text, {
            color: focused ? 'green' : 'gray', bold: focused, wrap: 'truncate'
          // ── FIX: suppress ▶ while slash menu is open to avoid duplicate arrows ──
          }, (focused && !chatMenuOpen) ? '▶ ' : '▷ ')
        ),
        React.createElement(Box, { flexGrow: 1, flexShrink: 1, minWidth: 0 },
          React.createElement(Box, { width: Math.max(10, numWidth - 4) },
            React.createElement(TextInput, {
              value:       input,
              onChange:    onChange,
              onSubmit:    !chatMenuOpen ? onSubmit : () => {},
              placeholder: focused
                ? '/ for menu · ↑↓ nav msgs · alt+a expand'
                : 'Alt+E',
              focus:       focused && !isRepoInputMode
            })
          )
        )
      )
    )
  )
}