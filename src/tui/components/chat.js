import React, { useMemo, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'
import { wrapText, buildMarkdownLines } from '../markdown.js'
import { Notepad } from './notepad.js'
import { ScrollInput } from './scroll-input.js'
import { THEME } from '../theme.js'

const COLLAPSE_THRESHOLD = 4
const PREVIEW_LINES = 2

export function ChatPanel({
  messages = [],
  input,
  onChange,
  onSubmit,
  focused,
  scrollOffset = 0,
  width,
  tab,
  notes,
  setNotes,
  isRepoInputMode,
  repoName,
  agentTitle,
  agentId,
  chatTargetMode,
  visibleAgentsCount,
  chatMenuOpen,
  chatMenuSel,
  chatVisibleRows = 10,
  latestProgress,
  promptPreview,
  expandedMessages,
  toggleMessageExpand,
  chatCursorLine,
  setChatCursorLine,
  setScrollOffset,
  startDialogOpen,
  startDialogMode,
  showApproveHint,
}) {
  const numWidth = typeof width === 'number' && !Number.isNaN(width) ? width : 40
  const wrapLimit = Math.max(10, numWidth - 4)
  const inputVisibleRows = Math.min(
    4,
    Math.max(
      1,
      (input || '')
        .split('\n')
        .reduce((count, line) => {
          const safeLen = Math.max(1, line.length)
          return count + Math.max(1, Math.ceil(safeLen / Math.max(1, wrapLimit)))
        }, 0)
    )
  )

  const _expanded = expandedMessages instanceof Set ? expandedMessages : new Set()

  const latestPlanIdx = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.isPlan) return i
    }
    return -1
  }, [messages])

  const { lines: allLines, collapsedCount: computedCollapsedCount } = useMemo(() => {
    const lines = []
    let collapsedCount = 0

    if (tab === 'chat') {
      if (repoName === 'NOT SET') {
        lines.push({ type: 'label', text: '[SYSTEM]', color: THEME.subtleText, msgIdx: -1 })
        for (const l of wrapText('Select a repository (Alt+M) to start.', wrapLimit)) {
          lines.push({ type: 'text', text: l, color: THEME.warning, msgIdx: -1 })
        }
        lines.push({ type: 'gap', msgIdx: -1 })
        return { lines, collapsedCount }
      }

      for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
        const m = messages[msgIdx]

        if (m.role === 'agent') {
          const mdLines = buildMarkdownLines(m.text, wrapLimit, focused)
          const isLong = mdLines.length > COLLAPSE_THRESHOLD
          const isLatestPlan = msgIdx === latestPlanIdx
          const isOpen = !isLong || _expanded.has(msgIdx) || isLatestPlan

          if (isLong && !isOpen) collapsedCount++

          lines.push({
            type: 'dropdown-header',
            msgIdx,
            isOpen,
            isLong,
            chevron: isOpen ? 'v' : '>',
            countSuffix: isLong ? ` ${mdLines.length}L` : '',
            color: focused ? THEME.accentSoft : THEME.subtleText,
            isAutoExpanded: isLatestPlan,
          })

          if (isOpen) {
            for (const ml of mdLines) lines.push({ ...ml, msgIdx })
          } else {
            const previewLines = mdLines.filter(l => l.type !== 'gap').slice(0, PREVIEW_LINES)
            for (const pl of previewLines) lines.push({ ...pl, _isPreview: true, msgIdx })
            const hidden = mdLines.length - previewLines.length
            if (hidden > 0) {
              lines.push({ type: 'more-hint', hidden, msgIdx, focused })
            }
          }

          lines.push({ type: 'gap', msgIdx })
          continue
        }

        if (m.role === 'system') {
          lines.push({ type: 'label', text: '[SYS]', color: THEME.subtleText, msgIdx })
          for (const l of wrapText(m.text, wrapLimit)) lines.push({ type: 'text', text: l, color: THEME.subtleText, msgIdx })
          lines.push({ type: 'gap', msgIdx })
          continue
        }

        lines.push({ type: 'label', text: 'you', color: focused ? THEME.userLabel : THEME.subtleText, msgIdx })
        for (const l of wrapText(m.text, wrapLimit)) {
          lines.push({ type: 'text', text: l, color: focused ? THEME.userText : THEME.subtleText, msgIdx })
        }
        lines.push({ type: 'gap', msgIdx })
      }
    }

    return { lines, collapsedCount }
  }, [messages, wrapLimit, tab, repoName, focused, _expanded, latestPlanIdx])

  const MESSAGE_ROWS = Math.max(2, chatVisibleRows)
  const total = allLines.length
  const targetLineIndex = Math.max(0, total - 1 - (chatCursorLine || 0))

  useEffect(() => {
    if (!focused || tab !== 'chat' || total <= 0 || !setScrollOffset) return

    const minVisibleIndex = total - MESSAGE_ROWS - scrollOffset
    const maxVisibleIndex = total - 1 - scrollOffset

    if (targetLineIndex < minVisibleIndex) {
      setScrollOffset(total - MESSAGE_ROWS - targetLineIndex)
    } else if (targetLineIndex > maxVisibleIndex) {
      setScrollOffset(total - 1 - targetLineIndex)
    }
  }, [chatCursorLine, targetLineIndex, total, MESSAGE_ROWS, focused, tab, setScrollOffset, scrollOffset])

  const start = Math.max(0, total - MESSAGE_ROWS - scrollOffset)
  const visible = allLines.slice(start, start + MESSAGE_ROWS)

  useInput((inputKey, key) => {
    if (!focused || tab !== 'chat') return

    if (key.upArrow) {
      setChatCursorLine?.(c => Math.min(total - 1, (c || 0) + 1))
      return
    }
    if (key.downArrow) {
      setChatCursorLine?.(c => Math.max(0, (c || 0) - 1))
      return
    }
    if (key.meta && inputKey === 'a') {
      const selectedLine = allLines[targetLineIndex]
      if (selectedLine && selectedLine.msgIdx >= 0) toggleMessageExpand(selectedLine.msgIdx)
    }
  })

  const isNewSession = chatTargetMode === 'CREATE_ORCHESTRATOR' || (!chatTargetMode && agentId === 'NEW TASK')
  const hasMessages = messages && messages.length > 0

  const maxTitleLen = 16
  const shortTitle = isNewSession
    ? 'new session'
    : agentTitle && agentTitle.length > maxTitleLen
      ? agentTitle.substring(0, maxTitleLen) + '...'
      : (agentTitle || 'orchestrator')

  const collapsedCount = computedCollapsedCount

  return React.createElement(Box, {
    flexDirection: 'column',
    width,
    paddingLeft: 1,
    flexShrink: 0,
    minHeight: 0,
    overflow: 'hidden',
  },
    React.createElement(Box, {
      flexShrink: 0,
      height: 1,
      minWidth: 0,
      overflow: 'hidden',
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
      React.createElement(Box, { flexDirection: 'row', minWidth: 0, overflow: 'hidden', flexShrink: 1 },
        isNewSession
          ? (tab === 'chat'
              ? React.createElement(React.Fragment, null,
                  React.createElement(Text, { color: THEME.accent, bold: true, wrap: 'truncate' }, 'NEW SESSION | '),
                  React.createElement(Text, { color: THEME.subtleText, bold: true, wrap: 'truncate' }, 'NOTES')
                )
              : React.createElement(React.Fragment, null,
                  React.createElement(Text, { color: THEME.accent, bold: true, wrap: 'truncate' }, 'NEW SESSION | '),
                  React.createElement(Text, { color: THEME.subtleText, bold: true, wrap: 'truncate' }, 'CHAT')
                ))
          : (tab === 'chat'
              ? React.createElement(React.Fragment, null,
                  React.createElement(Text, { color: focused ? THEME.accent : THEME.subtleText, bold: true, wrap: 'truncate' }, `CHAT: ${shortTitle} | `),
                  React.createElement(Text, { color: THEME.subtleText, bold: true, wrap: 'truncate' }, 'NOTES')
                )
              : React.createElement(React.Fragment, null,
                  React.createElement(Text, { color: focused ? THEME.accent : THEME.subtleText, bold: true, wrap: 'truncate' }, `NOTES: ${shortTitle} | `),
                  React.createElement(Text, { color: THEME.subtleText, bold: true, wrap: 'truncate' }, 'CHAT')
                ))
      ),
      React.createElement(Box, { flexDirection: 'row', flexShrink: 0, minWidth: 0 },
        collapsedCount > 0 && focused && tab === 'chat' &&
          React.createElement(Text, { color: THEME.subtleText, dimColor: true, wrap: 'truncate' }, ` ${collapsedCount} collapsed `),
        scrollOffset > 0 &&
          React.createElement(Text, { color: THEME.subtleText, dimColor: true, wrap: 'truncate' }, ` up:${scrollOffset} `)
      )
    ),

    React.createElement(Box, { overflow: 'hidden', flexShrink: 0, height: 1, minWidth: 0 },
      React.createElement(Text, {
        color: isNewSession ? THEME.accentMuted : THEME.subtleText,
        dimColor: !isNewSession,
        wrap: 'truncate',
      }, '-'.repeat(100))
    ),

    React.createElement(Box, {
      flexDirection: 'column',
      height: MESSAGE_ROWS,
      flexShrink: 0,
      minHeight: 0,
      overflow: 'hidden',
      justifyContent: (isNewSession && !hasMessages) ? 'center' : 'flex-end',
    },
      (isNewSession && !hasMessages && tab === 'chat')
        ? React.createElement(Box, {
            flexDirection: 'column',
            alignItems: 'center',
            paddingX: 2,
            paddingY: 1,
          },
            React.createElement(Box, {
              borderStyle: 'round',
              borderColor: focused ? THEME.accent : THEME.subtleText,
              paddingX: 3,
              paddingY: 1,
              flexDirection: 'column',
              alignItems: 'center',
            },
              React.createElement(Text, { color: focused ? THEME.accent : THEME.subtleText, bold: true }, 'NEW SESSION'),
              React.createElement(Box, { height: 1 }),
              React.createElement(Text, { color: focused ? THEME.text : THEME.subtleText, dimColor: !focused }, 'Your message will spawn a'),
              React.createElement(Text, { color: focused ? THEME.text : THEME.subtleText, dimColor: !focused }, 'fresh orchestrator agent.'),
              React.createElement(Box, { height: 1 }),
              React.createElement(Text, { color: focused ? THEME.accentSoft : THEME.subtleText, dimColor: !focused },
                repoName === 'NOT SET' ? 'no repo selected - press Alt+M' : `repo: ${repoName}`)
            )
          )
        : tab === 'notes'
          ? React.createElement(Notepad, {
              value: notes || '',
              onChange: setNotes,
              focused: focused && !isRepoInputMode,
              height: MESSAGE_ROWS,
              width: wrapLimit,
            })
          : visible.map((l, i) => {
              const absoluteIdx = start + i
              const isFoc = absoluteIdx === targetLineIndex && focused && tab === 'chat'
              const prefixElt = React.createElement(Text, { color: THEME.accentSoft }, (isFoc && !chatMenuOpen) ? '> ' : '  ')

              if (l.type === 'dropdown-header') {
                return React.createElement(Box, {
                  key: `dh_${i}`,
                  height: 1,
                  flexDirection: 'row',
                  minWidth: 0,
                  overflow: 'hidden',
                },
                  prefixElt,
                  React.createElement(Text, { color: l.color, bold: true, dimColor: !focused, wrap: 'truncate' }, `AGENT ${l.chevron}`),
                  l.countSuffix && React.createElement(Text, { color: THEME.subtleText, dimColor: true, wrap: 'truncate' }, l.countSuffix),
                  l.isAutoExpanded && React.createElement(Text, { color: THEME.subtleText, dimColor: true, wrap: 'truncate' }, ' auto'),
                  l.isLong && isFoc && React.createElement(Text, { color: THEME.subtleText, dimColor: true, wrap: 'truncate' }, ' [alt+a]')
                )
              }

              if (l.type === 'more-hint') {
                return React.createElement(Box, {
                  key: `mh_${i}`,
                  height: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  flexDirection: 'row',
                },
                  prefixElt,
                  React.createElement(Text, { color: focused ? THEME.accentSoft : THEME.subtleText, dimColor: !focused, wrap: 'truncate' },
                    `${l.hidden} more line${l.hidden !== 1 ? 's' : ''} hidden - press `),
                  React.createElement(Text, { color: focused ? THEME.text : THEME.subtleText, bold: true, dimColor: !focused, wrap: 'truncate' }, '[alt+a]'),
                  React.createElement(Text, { color: focused ? THEME.accentSoft : THEME.subtleText, dimColor: !focused, wrap: 'truncate' }, ' to expand')
                )
              }

              if (l.type === 'jsx') {
                return React.createElement(Box, {
                  key: i,
                  height: 1,
                  overflow: 'hidden',
                  minWidth: 0,
                  opacity: l._isPreview ? 0.6 : 1,
                }, prefixElt, l.element)
              }

              if (l.type === 'toolcall-diagram') {
                return React.createElement(Box, {
                  key: i,
                  height: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  flexDirection: 'row',
                  opacity: l._isPreview ? 0.6 : 1,
                },
                  prefixElt,
                  React.createElement(Text, {
                    color: l.focused ? THEME.accentSoft : THEME.subtleText,
                    bold: l.focused,
                    dimColor: !l.focused,
                    wrap: 'truncate',
                  }, 'Diagram updated -> [ ARCHITECTURE GRAPH ]')
                )
              }

              if (l.type === 'plan-header') {
                return React.createElement(Box, {
                  key: i,
                  height: 1,
                  flexDirection: 'row',
                  minWidth: 0,
                  opacity: l._isPreview ? 0.6 : 1,
                },
                  prefixElt,
                  React.createElement(Text, { color: l.focused ? THEME.accentSoft : THEME.subtleText, bold: true }, 'PLAN '),
                  React.createElement(Text, { color: THEME.subtleText, dimColor: true }, `${l.totalSteps} step${l.totalSteps !== 1 ? 's' : ''}`)
                )
              }

              if (l.type === 'plan-divider') {
                return React.createElement(Box, {
                  key: i,
                  height: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  opacity: l._isPreview ? 0.6 : 1,
                },
                  prefixElt,
                  React.createElement(Text, { color: THEME.subtleText, dimColor: true, wrap: 'truncate' }, '-'.repeat(l.width))
                )
              }

              if (l.type === 'plan-step-title') {
                return React.createElement(Box, {
                  key: i,
                  height: 1,
                  flexDirection: 'row',
                  minWidth: 0,
                  opacity: l._isPreview ? 0.6 : 1,
                },
                  prefixElt,
                  l.isFirst
                    ? React.createElement(Text, { color: l.focused ? THEME.accentSoft : THEME.subtleText, bold: true, dimColor: !l.focused }, `${l.stepNum}. `)
                    : React.createElement(Text, { color: THEME.subtleText, dimColor: true }, '    '),
                  React.createElement(Text, { color: l.focused ? THEME.text : THEME.subtleText, bold: true, dimColor: !l.focused }, l.text)
                )
              }

              if (l.type === 'plan-step-desc') {
                return React.createElement(Box, {
                  key: i,
                  height: 1,
                  flexDirection: 'row',
                  minWidth: 0,
                  opacity: l._isPreview ? 0.6 : 1,
                },
                  prefixElt,
                  React.createElement(Text, { color: THEME.subtleText, dimColor: true }, '    | '),
                  React.createElement(Text, { color: l.focused ? THEME.accentSoft : THEME.subtleText, dimColor: !l.focused }, l.text)
                )
              }

              if (l.type === 'plan-step-sep') {
                return React.createElement(Box, { key: i, height: 1, minWidth: 0, opacity: l._isPreview ? 0.6 : 1 },
                  prefixElt,
                  React.createElement(Text, { color: THEME.subtleText, dimColor: true }, '    |')
                )
              }

              if (l.type === 'codeblock-header' || l.type === 'codeblock-line' || l.type === 'codeblock-footer') {
                const isLine = l.type === 'codeblock-line'
                return React.createElement(Box, {
                  key: i,
                  height: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  flexDirection: 'row',
                  opacity: l._isPreview ? 0.6 : 1,
                },
                  prefixElt,
                  isLine && React.createElement(Text, { color: focused ? THEME.accentMuted : THEME.subtleText, dimColor: !focused }, '| '),
                  React.createElement(Text, { color: focused ? THEME.text : THEME.subtleText, dimColor: !focused, wrap: 'truncate' }, l.text)
                )
              }

              if (l.type === 'hr-line') {
                return React.createElement(Box, {
                  key: i,
                  height: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  opacity: l._isPreview ? 0.6 : 1,
                },
                  prefixElt,
                  React.createElement(Text, { color: THEME.subtleText, dimColor: true, wrap: 'truncate' }, '.'.repeat(l.width))
                )
              }

              if (l.type === 'h1-underline') {
                return React.createElement(Box, {
                  key: i,
                  height: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  opacity: l._isPreview ? 0.6 : 1,
                },
                  prefixElt,
                  React.createElement(Text, { color: l.focused ? THEME.accentSoft : THEME.subtleText, dimColor: !l.focused, wrap: 'truncate' }, l.text)
                )
              }

              if (l.type === 'standard-line') {
                return React.createElement(Box, {
                  key: i,
                  height: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  flexDirection: 'row',
                  opacity: l._isPreview ? 0.6 : 1,
                },
                  prefixElt,
                  l.linePrefix ? React.createElement(Text, {
                    color: l.linePrefixColor,
                    dimColor: !l.focused,
                    bold: l.bold,
                  }, l.linePrefix) : null,
                  React.createElement(Box, { flexGrow: 1, minWidth: 0, overflow: 'hidden', flexDirection: 'row' },
                    ...(l.inlineTokens || []).map(t => React.createElement(Text, {
                      key: t.key,
                      color: t.color,
                      bold: t.bold,
                      italic: t.italic,
                      dimColor: t.dimColor,
                    }, t.text))
                  )
                )
              }

              if (l.type === 'gap') {
                return React.createElement(Box, { key: i, height: 1, minWidth: 0 }, prefixElt)
              }

              if (l.type === 'label') {
                return React.createElement(Box, { key: i, height: 1, overflow: 'hidden', minWidth: 0 },
                  prefixElt,
                  React.createElement(Text, {
                    color: l.color,
                    bold: true,
                    dimColor: (l.color === THEME.subtleText || !focused),
                    wrap: 'truncate',
                  }, l.text)
                )
              }

              return React.createElement(Box, { key: i, height: 1, overflow: 'hidden', minWidth: 0 },
                prefixElt,
                React.createElement(Text, { color: l.color, dimColor: !focused, wrap: 'truncate' }, l.text)
              )
            })
    ),

    chatMenuOpen && tab === 'chat' && React.createElement(Box, {
      flexDirection: 'column',
      height: 5,
      borderStyle: 'round',
      borderColor: THEME.panelFocusBorder,
      paddingX: 1,
      flexShrink: 0,
      minWidth: 0,
      overflow: 'hidden',
    },
      ['Start New Task', 'Start New Orchestrator', 'Approve Plan'].map((opt, idx) =>
        React.createElement(Text, {
          key: idx,
          color: chatMenuSel === idx ? THEME.accent : THEME.subtleText,
          wrap: 'truncate',
        }, chatMenuSel === idx ? `> ${opt}` : `  ${opt}`)
      )
    ),

    startDialogOpen && tab === 'chat' && React.createElement(Box, {
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor: THEME.panelFocusBorder,
      paddingX: 1,
      flexShrink: 0,
      minWidth: 0,
      overflow: 'hidden',
    },
      React.createElement(Text, { color: THEME.accent, bold: true, wrap: 'truncate' }, 'START'),
      React.createElement(Text, { color: THEME.text, wrap: 'truncate' }, `Mode: ${startDialogMode === 'CREATE_TASK' ? 'Task' : 'Orchestrator'} (up/down to toggle)`),
      React.createElement(Text, { color: THEME.subtleText, wrap: 'truncate' }, 'Type prompt and press Enter. /task /orchestrator /cancel also work.')
    ),

    showApproveHint && tab === 'chat' && React.createElement(Box, {
      flexDirection: 'row',
      borderStyle: 'round',
      borderColor: THEME.panelBorder,
      paddingX: 1,
      flexShrink: 0,
      minWidth: 0,
      overflow: 'hidden',
    },
      React.createElement(Text, { color: THEME.warning, wrap: 'truncate' }, 'type /approve to confirm')
    ),

    tab === 'chat' && React.createElement(Box, { overflow: 'hidden', flexShrink: 0, height: 1, minWidth: 0 },
      React.createElement(Text, { color: THEME.separator, dimColor: true, wrap: 'truncate' }, '-'.repeat(100))
    ),

    (latestProgress || promptPreview) && tab === 'chat' && React.createElement(Box, {
      flexDirection: 'row',
      borderStyle: 'round',
      borderColor: THEME.panelBorder,
      paddingX: 1,
      flexShrink: 0,
      minWidth: 0,
      overflow: 'hidden',
    },
      React.createElement(Text, { color: promptPreview ? THEME.accentSoft : THEME.accent, wrap: 'truncate' }, promptPreview || latestProgress)
    ),

    tab === 'chat' && React.createElement(Box, {
      flexShrink: 0,
      flexDirection: 'row',
      minWidth: 0,
      overflow: 'hidden',
      height: inputVisibleRows,
      alignItems: 'flex-start',
    },
      React.createElement(Box, { flexShrink: 0, minWidth: 0 },
        React.createElement(Text, { color: focused ? THEME.accent : THEME.subtleText, bold: focused, wrap: 'truncate' },
          (focused && !chatMenuOpen) ? '> ' : '- ')
      ),
      React.createElement(Box, { flexGrow: 1, flexShrink: 1, minWidth: 0, overflow: 'hidden' },
        React.createElement(ScrollInput, {
          value: input,
          onChange,
          onSubmit: !chatMenuOpen ? onSubmit : () => {},
          placeholder: focused ? '/ for menu | up/down nav msgs | alt+a expand' : 'Alt+E',
          focus: focused && !isRepoInputMode,
          visibleWidth: Math.max(10, wrapLimit),
          maxRows: inputVisibleRows,
        })
      )
    )
  )
}
