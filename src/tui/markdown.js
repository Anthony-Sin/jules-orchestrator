// ── markdown.js ───────────────────────────────────────────────────
// Terminal markdown parser and renderer for Ink (React).
// Exports: parseMarkdown, buildMarkdownLines, wrapText

import React from 'react'
import { Box, Text } from 'ink'
import { store } from '../state/store.js'

// ── Text wrapping ─────────────────────────────────────────────────
export function wrapText(text, width) {
  if (text == null) return []
  const lines = []
  const paragraphs = String(text).split('\n')

  for (const p of paragraphs) {
    if (p.trim() === '') { lines.push(''); continue }
    const words = p.split(/\s+/)
    let line = ''

    for (const word of words) {
      if (!word) continue
      if (line.length + word.length + (line ? 1 : 0) > width) {
        if (line) lines.push(line)
        if (word.length > width) {
          let temp = word
          while (temp.length > width) {
            lines.push(temp.substring(0, width))
            temp = temp.substring(width)
          }
          line = temp
        } else {
          line = word
        }
      } else {
        line = line ? line + ' ' + word : word
      }
    }
    if (line) lines.push(line)
  }
  return lines.length > 0 ? lines : ['']
}

// ── Block-level markdown parser ───────────────────────────────────
export function parseMarkdown(text) {
  if (!text) return [{ type: 'text', text: '' }]

  // 1. Scan for any JSON blob in the text
  const firstBrace = String(text).indexOf('{')
  const lastBrace  = String(text).lastIndexOf('}')

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const possibleJson = String(text).slice(firstBrace, lastBrace + 1)

    try {
      const parsed = JSON.parse(possibleJson)

      // 1a. Tool call blob: { type: "function", function: { name, arguments } }
      if (parsed && parsed.type === 'function' && parsed.function && parsed.function.name) {
        const segments = []

        const beforeText = String(text).slice(0, firstBrace).trim()
        if (beforeText) segments.push(...parseCoreMarkdown(beforeText))

        let args = {}
        try { args = JSON.parse(parsed.function.arguments || '{}') } catch (_) {}

        segments.push({ type: 'toolcall', toolName: parsed.function.name, args })

        const afterText = String(text).slice(lastBrace + 1).trim()
        if (afterText) segments.push(...parseCoreMarkdown(afterText))

        return segments
      }

      // 1b. Execution plan blob: { plan: { steps: [...] } }
      if (parsed && parsed.plan && Array.isArray(parsed.plan.steps)) {
        const segments = []

        const beforeText = String(text).slice(0, firstBrace).trim()
        if (beforeText) segments.push(...parseCoreMarkdown(beforeText))

        segments.push({ type: 'plan', plan: parsed.plan })

        const afterText = String(text).slice(lastBrace + 1).trim()
        if (afterText) segments.push(...parseCoreMarkdown(afterText))

        return segments
      }
    } catch (_) {
      // Not valid JSON — fall through to standard parsing
    }
  }

  // 2. Standard Markdown Parsing
  return parseCoreMarkdown(text)
}

// Extracted core parsing loop so the interceptor can call it recursively
function parseCoreMarkdown(text) {
  const lines = String(text).split('\n')
  const segments = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block
    if (line.trimStart().startsWith('```')) {
      const lang = line.trimStart().slice(3).trim()
      const codeLines = []
      i++
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      segments.push({ type: 'codeblock', text: codeLines.join('\n'), lang })
      i++
      continue
    }

    // Horizontal rule
    if (/^[\s]*[-*_]{3,}[\s]*$/.test(line)) {
      segments.push({ type: 'hr' })
      i++
      continue
    }

    // Headings (check h3 before h2 before h1 to avoid prefix collisions)
    const h3 = line.match(/^###\s+(.*)/)
    if (h3) { segments.push({ type: 'h3', text: h3[1].trim() }); i++; continue }
    const h2 = line.match(/^##\s+(.*)/)
    if (h2) { segments.push({ type: 'h2', text: h2[1].trim() }); i++; continue }
    const h1 = line.match(/^#\s+(.*)/)
    if (h1) { segments.push({ type: 'h1', text: h1[1].trim() }); i++; continue }

    // Blockquote
    const bq = line.match(/^>\s?(.*)/)
    if (bq) { segments.push({ type: 'blockquote', text: bq[1] }); i++; continue }

    // Unordered list
    const ul = line.match(/^(\s*)[-*+]\s+(.*)/)
    if (ul) {
      const indent = Math.floor(ul[1].length / 2)
      segments.push({ type: 'bullet', text: ul[2], indent })
      i++
      continue
    }

    // Ordered list
    const ol = line.match(/^(\s*)(\d+)\.\s+(.*)/)
    if (ol) {
      const indent = Math.floor(ol[1].length / 2)
      segments.push({ type: 'ordered', text: ol[3], indent, index: ol[2] })
      i++
      continue
    }

    // Blank line
    if (line.trim() === '') {
      segments.push({ type: 'blank' })
      i++
      continue
    }

    // Regular text (may contain inline markdown)
    segments.push({ type: 'text', text: line })
    i++
  }

  return segments
}

// ── Inline tokenizer ──────────────────────────────────────────────
function buildInlineTokens(text, baseColor, focused, forceBold, forceItalic) {
  if (!text) return [React.createElement(Text, { key: 'empty' }, '')]
  const tokens = []
  let remaining = String(text)
  let ti = 0

  while (remaining.length > 0) {
    // Bold: **text** or __text__
    const boldMatch = remaining.match(/^(\*\*|__)(.+?)\1/)
    if (boldMatch) {
      tokens.push(React.createElement(Text, { key: `it_${ti++}`, color: focused ? 'white' : 'gray', bold: true, dimColor: !focused }, boldMatch[2]))
      remaining = remaining.slice(boldMatch[0].length)
      continue
    }
    // Italic: *text* or _text_
    const italicMatch = remaining.match(/^(\*|_)(.+?)\1/)
    if (italicMatch) {
      tokens.push(React.createElement(Text, { key: `it_${ti++}`, color: focused ? 'cyan' : 'gray', italic: true, dimColor: !focused }, italicMatch[2]))
      remaining = remaining.slice(italicMatch[0].length)
      continue
    }
    // Inline code: `text`
    const codeMatch = remaining.match(/^`([^`]+)`/)
    if (codeMatch) {
      tokens.push(React.createElement(Text, { key: `it_${ti++}`, color: focused ? 'yellow' : 'gray', dimColor: !focused }, '`' + codeMatch[1] + '`'))
      remaining = remaining.slice(codeMatch[0].length)
      continue
    }
    // Strikethrough: ~~text~~
    const strikeMatch = remaining.match(/^~~(.+?)~~/)
    if (strikeMatch) {
      tokens.push(React.createElement(Text, { key: `it_${ti++}`, color: 'gray', dimColor: true }, strikeMatch[1]))
      remaining = remaining.slice(strikeMatch[0].length)
      continue
    }

    let plain = ''
    let advanced = false
    while (remaining.length > 0 && (!remaining.match(/^(\*\*|__|~~|\*|_|`)/) || !advanced)) {
      plain += remaining[0]
      remaining = remaining.slice(1)
      advanced = true
    }
    if (plain) {
      tokens.push(React.createElement(Text, { key: `it_${ti++}`, color: baseColor, bold: forceBold, italic: forceItalic, dimColor: !focused }, plain))
    }
  }

  return tokens.length > 0 ? tokens : [React.createElement(Text, { key: 'fallback', color: baseColor, dimColor: !focused }, text)]
}

// ── Tool call renderers ───────────────────────────────────────────

// Generic tool call argument renderer — shows key: value pairs
function renderGenericToolArgs(args, segIdx, focused) {
  const rows = []
  const entries = Object.entries(args)
  if (entries.length === 0) {
    rows.push({ type: 'jsx', element: React.createElement(Box, { key: `tc_noargs_${segIdx}`, paddingLeft: 2 },
      React.createElement(Text, { color: 'gray', dimColor: true }, '(no arguments)')
    )})
    return rows
  }
  for (let ei = 0; ei < entries.length; ei++) {
    const [k, v] = entries[ei]
    const valStr = typeof v === 'string' ? v : JSON.stringify(v)
    const display = valStr.length > 60 ? valStr.slice(0, 57) + '…' : valStr
    rows.push({ type: 'jsx', element: React.createElement(Box, { key: `tc_arg_${segIdx}_${ei}`, paddingLeft: 2, flexDirection: 'row', minWidth: 0, overflow: 'hidden' },
      React.createElement(Text, { color: focused ? 'cyan' : 'gray', bold: true, dimColor: !focused, wrap: 'truncate' }, `${k}: `),
      React.createElement(Text, { color: focused ? 'white' : 'gray', dimColor: !focused, wrap: 'truncate' }, display)
    )})
  }
  return rows
}

// ── Block renderer ────────────────────────────────────────────────
export function buildMarkdownLines(text, wrapLimit, focused) {
  const segments = parseMarkdown(text)
  const lines = []

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]

    // ── blank ─────────────────────────────────────────────────────
    if (seg.type === 'blank') {
      lines.push({ type: 'gap' })
      continue
    }

    // ── tool call ─────────────────────────────────────────────────
    if (seg.type === 'toolcall') {
      const { toolName, args } = seg
      // ── generate_ink_terminal_diagram: silent in chat, lives in graph panel
      if (toolName === 'generate_ink_terminal_diagram') {
        // Agent may print the tool call as text instead of executing it — push
        // architecture_description into the store so MiniGraph updates immediately.
        if (args.architecture_description) {
          try { store.set('architectureDiagram', args.architecture_description) } catch (_) {}
        }
        lines.push({ type: 'gap' })
        lines.push({ type: 'jsx', element: React.createElement(Box, { key: `tc_diag_hint_${i}`, minWidth: 0, overflow: 'hidden', flexDirection: 'row' },
          React.createElement(Text, { color: focused ? 'magentaBright' : 'gray', bold: focused, dimColor: !focused, wrap: 'truncate' },
            '🗺  Diagram updated → see '),
          React.createElement(Text, { color: focused ? 'cyanBright' : 'gray', bold: true, dimColor: !focused, wrap: 'truncate' },
            '[ ARCHITECTURE GRAPH ]')
        )})
        lines.push({ type: 'gap' })
        continue
      }

      // ── Generic tool call: header + border + fn + args + border
      lines.push({ type: 'gap' })
      lines.push({ type: 'jsx', element: React.createElement(Box, { key: `tc_hdr_${i}`, minWidth: 0, overflow: 'hidden', flexDirection: 'row' },
        React.createElement(Text, { color: focused ? 'yellowBright' : 'yellow', bold: true, dimColor: !focused, wrap: 'truncate' }, `⚙  TOOL CALL: ${toolName}`)
      )})
      lines.push({ type: 'jsx', element: React.createElement(Box, { key: `tc_top_${i}`, minWidth: 0, overflow: 'hidden' },
        React.createElement(Text, { color: focused ? 'cyan' : 'gray', dimColor: !focused, wrap: 'truncate' },
          '┌' + '─'.repeat(Math.min(wrapLimit - 1, 60))
        )
      )})
      lines.push({ type: 'jsx', element: React.createElement(Box, { key: `tc_fn_${i}`, paddingLeft: 2, minWidth: 0, overflow: 'hidden', flexDirection: 'row' },
        React.createElement(Text, { color: focused ? 'yellow' : 'gray', dimColor: !focused, wrap: 'truncate' }, 'fn: '),
        React.createElement(Text, { color: focused ? 'white' : 'gray', bold: true, dimColor: !focused, wrap: 'truncate' }, toolName)
      )})
      const argRows = renderGenericToolArgs(args, i, focused)
      for (const r of argRows) lines.push(r)
      lines.push({ type: 'jsx', element: React.createElement(Box, { key: `tc_bot_${i}`, minWidth: 0, overflow: 'hidden' },
        React.createElement(Text, { color: focused ? 'cyan' : 'gray', dimColor: !focused, wrap: 'truncate' },
          '└' + '─'.repeat(Math.min(wrapLimit - 1, 60))
        )
      )})
      lines.push({ type: 'gap' })
      continue
    }

    // ── execution plan json block ─────────────────────────────────
    if (seg.type === 'plan') {
      lines.push({ type: 'gap' })
      lines.push({ type: 'jsx', element: React.createElement(Box, { key: `plan_hdr_${i}`, minWidth: 0, paddingBottom: 1 },
        React.createElement(Text, { color: focused ? 'magentaBright' : 'magenta', bold: true }, '📋 EXECUTION PLAN')
      )})

      const steps = seg.plan.steps || []
      for (let sIdx = 0; sIdx < steps.length; sIdx++) {
        const step = steps[sIdx]
        const stepNum = sIdx + 1

        // Render Title
        const titleWrapped = wrapText(step.title || 'Step', Math.max(5, wrapLimit - 4))
        for (let wi = 0; wi < titleWrapped.length; wi++) {
          const prefix = wi === 0 ? `${stepNum}. ` : '   '
          const prefixPad = stepNum < 10 && wi > 0 ? ' ' : ''

          lines.push({ type: 'jsx', element: React.createElement(Box, { key: `p_${i}_s${sIdx}_t${wi}`, flexDirection: 'row' },
            React.createElement(Text, { color: focused ? 'magentaBright' : 'magenta', bold: true }, prefixPad + prefix),
            React.createElement(Text, { color: focused ? 'white' : 'gray', bold: true }, titleWrapped[wi])
          )})
        }

        // Render Description
        if (step.description) {
          const descWrapped = wrapText(step.description, Math.max(5, wrapLimit - 6))
          for (let wi = 0; wi < descWrapped.length; wi++) {
            lines.push({ type: 'jsx', element: React.createElement(Box, { key: `p_${i}_s${sIdx}_d${wi}`, flexDirection: 'row' },
              React.createElement(Text, null, '      '),
              React.createElement(Text, { color: focused ? 'cyan' : 'gray', dimColor: !focused }, descWrapped[wi])
            )})
          }
        }

        if (sIdx < steps.length - 1) {
          lines.push({ type: 'gap' })
        }
      }
      lines.push({ type: 'gap' })
      continue
    }

    // ── fenced code block ─────────────────────────────────────────
    if (seg.type === 'codeblock') {
      const lang = seg.lang || 'code'
      const codeLines = (seg.text || '').split('\n')

      lines.push({ type: 'jsx', element: React.createElement(Box, { key: `cb_hdr_${i}`, minWidth: 0, overflow: 'hidden' },
        React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, `┌─[${lang}]`)
      )})

      for (let ci = 0; ci < codeLines.length; ci++) {
        const wrapped = wrapText(codeLines[ci] || ' ', wrapLimit - 2)
        for (const wl of wrapped) {
          lines.push({ type: 'jsx', element: React.createElement(Box, { key: `cb_${i}_${ci}`, minWidth: 0, overflow: 'hidden' },
            React.createElement(Text, { color: focused ? 'yellow' : 'gray', dimColor: !focused, wrap: 'truncate' }, '│ ' + wl)
          )})
        }
      }

      lines.push({ type: 'jsx', element: React.createElement(Box, { key: `cb_ftr_${i}`, minWidth: 0, overflow: 'hidden' },
        React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, '└' + '─'.repeat(Math.min(wrapLimit - 1, 20)))
      )})
      continue
    }

    // ── hr ────────────────────────────────────────────────────────
    if (seg.type === 'hr') {
      lines.push({ type: 'jsx', element: React.createElement(Box, { key: `hr_${i}`, minWidth: 0, overflow: 'hidden' },
        React.createElement(Text, { color: 'gray', dimColor: true, wrap: 'truncate' }, '─'.repeat(wrapLimit))
      )})
      continue
    }

    // ── all other block types ─────────────────────────────────────
    let prefix = ''
    let prefixColor = 'gray'
    let textContent = seg.text || ''
    let textColor = focused ? 'white' : 'gray'
    let bold = false
    let italic = false

    switch (seg.type) {
      case 'h1':
        prefix = '═ '
        textContent = (seg.text || '').toUpperCase()
        textColor = focused ? 'yellowBright' : 'gray'
        bold = true
        break
      case 'h2':
        prefix = '── '
        textColor = focused ? 'cyanBright' : 'gray'
        bold = true
        break
      case 'h3':
        prefix = '▸ '
        textColor = focused ? 'cyan' : 'gray'
        bold = true
        break
      case 'blockquote':
        prefix = '▎ '
        prefixColor = 'gray'
        textColor = 'gray'
        italic = true
        break
      case 'bullet': {
        const ind = '  '.repeat(seg.indent || 0)
        const bul = (seg.indent || 0) > 0 ? '◦' : '•'
        prefix = ind + bul + ' '
        prefixColor = focused ? 'magenta' : 'gray'
        textColor = focused ? 'white' : 'gray'
        break
      }
      case 'ordered': {
        const ind = '  '.repeat(seg.indent || 0)
        prefix = ind + seg.index + '. '
        prefixColor = focused ? 'magenta' : 'gray'
        textColor = focused ? 'white' : 'gray'
        break
      }
      default:
        textColor = focused ? 'white' : 'gray'
        break
    }

    const effectiveWidth = Math.max(5, wrapLimit - prefix.length)
    const wrappedLines = wrapText(textContent, effectiveWidth)

    for (let wi = 0; wi < wrappedLines.length; wi++) {
      const wl = wrappedLines[wi]
      const linePrefix = wi === 0 ? prefix : ' '.repeat(prefix.length)
      const linePrefixColor = wi === 0 ? prefixColor : 'gray'
      const inlineTokens = buildInlineTokens(wl, textColor, focused, bold, italic)

      lines.push({ type: 'jsx', element: React.createElement(Box, { key: `seg_${i}_w${wi}`, minWidth: 0, overflow: 'hidden', flexDirection: 'row' },
        linePrefix
          ? React.createElement(Text, { color: linePrefixColor, dimColor: !focused, bold: wi === 0 && bold }, linePrefix)
          : null,
        React.createElement(Box, { flexGrow: 1, minWidth: 0, overflow: 'hidden', flexDirection: 'row' },
          ...inlineTokens
        )
      )})

      if (seg.type === 'h1' && wi === wrappedLines.length - 1) {
        lines.push({ type: 'jsx', element: React.createElement(Box, { key: `h1ul_${i}`, minWidth: 0, overflow: 'hidden' },
          React.createElement(Text, { color: focused ? 'yellow' : 'gray', dimColor: true, wrap: 'truncate' },
            '═'.repeat(Math.min(wrapLimit, (textContent.length || 10) + 2))
          )
        )})
      }
    }
  }

  return lines
}