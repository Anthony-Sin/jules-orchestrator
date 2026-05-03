const markdownCache = new Map()

// ── markdown.js ───────────────────────────────────────────────────
// Terminal markdown parser and renderer for Ink (React).
// Exports: parseMarkdown, buildMarkdownLines, wrapText

import { store } from '../state/store.js'

// ── Palette ───────────────────────────────────────────────────────
// A cohesive professional dark-terminal palette:
//   Primary text:  white (focused) / #666 dim (unfocused)
//   Headings:      #FFB347 amber (h1), #94C8E8 steel-blue (h2), #7EC8A4 sage (h3)
//   Code:          #6EAFD6 cool-blue
//   Accent/bullet: #A78BFA soft-violet
//   Tool hints:    #4ADE80 green
//   Blockquote:    gray italic
//   Plan steps:    #FFB347 amber numbers, white titles
//   Dim/border:    gray dimColor

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

  const firstBrace = String(text).indexOf('{')
  const lastBrace  = String(text).lastIndexOf('}')

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const possibleJson = String(text).slice(firstBrace, lastBrace + 1)

    try {
      const parsed = JSON.parse(possibleJson)

      if (parsed && parsed.type === 'function' && parsed.function && parsed.function.name) {
        const segments = []

        const beforeText = String(text).slice(0, firstBrace).trim()
        if (beforeText) segments.push(...parseCoreMarkdown(beforeText))

        let args = {}
        try {
          const rawArgs = parsed.function.arguments || parsed.arguments;
          if (typeof rawArgs === 'object' && rawArgs !== null) {
            args = rawArgs;
          } else if (typeof rawArgs === 'string') {
            args = JSON.parse(rawArgs);
          }
        } catch (_) {}

        segments.push({ type: 'toolcall', toolName: parsed.function.name, args })

        const afterText = String(text).slice(lastBrace + 1).trim()
        if (afterText) segments.push(...parseCoreMarkdown(afterText))

        return segments
      }

      if (parsed && parsed.plan && Array.isArray(parsed.plan.steps)) {
        const segments = []

        const beforeText = String(text).slice(0, firstBrace).trim()
        if (beforeText) segments.push(...parseCoreMarkdown(beforeText))

        segments.push({ type: 'plan', plan: parsed.plan })

        const afterText = String(text).slice(lastBrace + 1).trim()
        if (afterText) segments.push(...parseCoreMarkdown(afterText))

        return segments
      }
    } catch (_) {}
  }

  return parseCoreMarkdown(text)
}

function parseCoreMarkdown(text) {
  const lines = String(text).split('\n')
  const segments = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

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

    if (/^[\s]*[-*_]{3,}[\s]*$/.test(line)) {
      segments.push({ type: 'hr' })
      i++
      continue
    }

    const h3 = line.match(/^###\s+(.*)/)
    if (h3) { segments.push({ type: 'h3', text: h3[1].trim() }); i++; continue }
    const h2 = line.match(/^##\s+(.*)/)
    if (h2) { segments.push({ type: 'h2', text: h2[1].trim() }); i++; continue }
    const h1 = line.match(/^#\s+(.*)/)
    if (h1) { segments.push({ type: 'h1', text: h1[1].trim() }); i++; continue }

    const bq = line.match(/^>\s?(.*)/)
    if (bq) { segments.push({ type: 'blockquote', text: bq[1] }); i++; continue }

    const ul = line.match(/^(\s*)[-*+]\s+(.*)/)
    if (ul) {
      const indent = Math.floor(ul[1].length / 2)
      segments.push({ type: 'bullet', text: ul[2], indent })
      i++
      continue
    }

    const ol = line.match(/^(\s*)(\d+)\.\s+(.*)/)
    if (ol) {
      const indent = Math.floor(ol[1].length / 2)
      segments.push({ type: 'ordered', text: ol[3], indent, index: ol[2] })
      i++
      continue
    }

    if (line.trim() === '') {
      segments.push({ type: 'blank' })
      i++
      continue
    }

    segments.push({ type: 'text', text: line })
    i++
  }

  return segments
}

// ── Inline tokenizer ──────────────────────────────────────────────
function buildInlineTokens(text, baseColor, focused, forceBold, forceItalic) {
  if (!text) return [{ type: 'inline', text: '', key: 'empty' }]
  const tokens = []
  let remaining = String(text)
  let ti = 0

  while (remaining.length > 0) {
    // Bold: **text** or __text__
    const boldMatch = remaining.match(/^(\*\*|__)(.+?)\1/)
    if (boldMatch) {
      tokens.push({
        type: 'inline',
        key: `it_${ti++}`,
        color: focused ? 'white' : 'gray',
        bold: true,
        dimColor: !focused,
        text: boldMatch[2]
      })
      remaining = remaining.slice(boldMatch[0].length)
      continue
    }

    // Italic: *text* or _text_ — warm amber instead of clashing cyan
    const italicMatch = remaining.match(/^(\*|_)(.+?)\1/)
    if (italicMatch) {
      tokens.push({
        type: 'inline',
        key: `it_${ti++}`,
        color: focused ? '#FFB347' : 'gray',
        italic: true,
        dimColor: !focused,
        text: italicMatch[2]
      })
      remaining = remaining.slice(italicMatch[0].length)
      continue
    }

    // Inline code: `text` — steel blue, clean bracket style
    const codeMatch = remaining.match(/^`([^`]+)`/)
    if (codeMatch) {
      tokens.push({
        type: 'inline',
        key: `it_${ti++}`,
        color: focused ? '#6EAFD6' : 'gray',
        dimColor: !focused,
        text: '`' + codeMatch[1] + '`'
      })
      remaining = remaining.slice(codeMatch[0].length)
      continue
    }

    // Strikethrough: ~~text~~
    const strikeMatch = remaining.match(/^~~(.+?)~~/)
    if (strikeMatch) {
      tokens.push({
        type: 'inline',
        key: `it_${ti++}`,
        color: 'gray',
        dimColor: true,
        text: strikeMatch[1]
      })
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
      tokens.push({
        type: 'inline',
        key: `it_${ti++}`,
        color: baseColor,
        bold: forceBold,
        italic: forceItalic,
        dimColor: !focused,
        text: plain
      })
    }
  }

  return tokens.length > 0 ? tokens : [{ type: 'inline', key: 'fallback', color: baseColor, dimColor: !focused, text }]
}

// ── Block renderer ────────────────────────────────────────────────

function buildToolCallLines(seg, i, focused) {
  const lines = []
  const { toolName, args } = seg

  if (toolName === 'generate_ink_terminal_diagram') {
    try {
      const currentDiagrams = store.get('architectureDiagrams') || [];
      const newDiagStr = JSON.stringify(args);
      const alreadyExists = currentDiagrams.some(d => JSON.stringify(d) === newDiagStr);

      if (!alreadyExists && args && args.title) {
        currentDiagrams.unshift(args);
        store.set('architectureDiagrams', currentDiagrams.slice(0, 10));
        store.set('diagramLastUpdated', Date.now());
      }
    } catch (_) {}

    lines.push({ type: 'gap' })
    lines.push({ type: 'toolcall-diagram', key: `tc_diag_hint_${i}`, focused })
    lines.push({ type: 'gap' })
  }

  return lines
}

function buildPlanLines(seg, i, focused, wrapLimit) {
  const lines = []
  const steps = seg.plan.steps || []
  const totalSteps = steps.length

  // Header
  lines.push({ type: 'gap' })
  lines.push({ type: 'plan-header', key: `plan_hdr_${i}`, totalSteps, focused })

  // Divider under header
  lines.push({ type: 'plan-divider', key: `plan_div_${i}`, width: Math.min(wrapLimit, 40) })

  for (let sIdx = 0; sIdx < steps.length; sIdx++) {
    const step = steps[sIdx]
    const stepNum = String(sIdx + 1).padStart(2, ' ')
    const isLast = sIdx === steps.length - 1

    // Step title row
    const titleWrapped = wrapText(step.title || 'Step', Math.max(5, wrapLimit - 7))
    for (let wi = 0; wi < titleWrapped.length; wi++) {
      if (wi === 0) {
        lines.push({
          type: 'plan-step-title',
          key: `p_${i}_s${sIdx}_t${wi}`,
          stepNum,
          text: titleWrapped[wi],
          focused,
          isFirst: true
        })
      } else {
        lines.push({
          type: 'plan-step-title',
          key: `p_${i}_s${sIdx}_t${wi}`,
          text: titleWrapped[wi],
          focused,
          isFirst: false
        })
      }
    }

    // Step description — indented with gutter bar
    if (step.description) {
      const descWrapped = wrapText(step.description, Math.max(5, wrapLimit - 7))
      for (let wi = 0; wi < descWrapped.length; wi++) {
        lines.push({
          type: 'plan-step-desc',
          key: `p_${i}_s${sIdx}_d${wi}`,
          text: descWrapped[wi],
          focused
        })
      }
    }

    // Separator between steps (not after last)
    if (!isLast) {
      lines.push({
        type: 'plan-step-sep',
        key: `p_${i}_s${sIdx}_sep`
      })
    }
  }

  // Footer divider
  lines.push({ type: 'plan-divider', key: `plan_ftr_${i}`, width: Math.min(wrapLimit, 40) })
  lines.push({ type: 'gap' })

  return lines
}

function buildCodeblockLines(seg, i, focused, wrapLimit) {
  const lines = []
  const lang = seg.lang || ''
  const codeLines = (seg.text || '').split('\n')
  const langTag = lang ? ` ${lang} ` : ''

  // Header bar: ╭── lang ──────────
  const headerFill = '─'.repeat(Math.max(0, Math.min(wrapLimit - langTag.length - 4, 20)))
  lines.push({
    type: 'codeblock-header',
    key: `cb_hdr_${i}`,
    text: `╭──${langTag}${headerFill}`,
    focused
  })

  for (let ci = 0; ci < codeLines.length; ci++) {
    // Skip trailing empty line at end of block
    if (ci === codeLines.length - 1 && codeLines[ci].trim() === '') continue
    const wrapped = wrapText(codeLines[ci] || ' ', Math.max(5, wrapLimit - 4))
    for (const wl of wrapped) {
      lines.push({
        type: 'codeblock-line',
        key: `cb_${i}_${ci}`,
        text: wl,
        focused
      })
    }
  }

  lines.push({
    type: 'codeblock-footer',
    key: `cb_ftr_${i}`,
    text: '╰' + '─'.repeat(Math.min(wrapLimit - 1, 24)),
    focused
  })

  return lines
}

function buildHrLines(i, wrapLimit) {
  return [{ type: 'hr-line', key: `hr_${i}`, width: wrapLimit }]
}

function buildStandardLines(seg, i, focused, wrapLimit) {
  const lines = []
  let prefix = ''
  let prefixColor = 'gray'
  let textContent = seg.text || ''
  let textColor = focused ? 'white' : 'gray'
  let bold = false
  let italic = false

  switch (seg.type) {
    case 'h1':
      prefix = '  '
      textContent = (seg.text || '').toUpperCase()
      textColor = focused ? '#FFB347' : 'gray'   // warm amber
      bold = true
      break
    case 'h2':
      prefix = '── '
      textColor = focused ? '#94C8E8' : 'gray'   // steel blue
      bold = true
      break
    case 'h3':
      prefix = '  ▸ '
      textColor = focused ? '#7EC8A4' : 'gray'   // sage green
      bold = true
      break
    case 'blockquote':
      prefix = '  ▎ '
      prefixColor = 'gray'
      textColor = 'gray'
      italic = true
      break
    case 'bullet': {
      const ind = '  '.repeat(seg.indent || 0)
      const bul = (seg.indent || 0) > 0 ? '◦' : '·'
      prefix = ind + bul + ' '
      prefixColor = focused ? '#A78BFA' : 'gray'  // soft violet
      textColor = focused ? 'white' : 'gray'
      break
    }
    case 'ordered': {
      const ind = '  '.repeat(seg.indent || 0)
      prefix = ind + seg.index + '. '
      prefixColor = focused ? '#A78BFA' : 'gray'  // soft violet
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

    lines.push({
      type: 'standard-line',
      key: `seg_${i}_w${wi}`,
      linePrefix,
      linePrefixColor,
      focused,
      bold: wi === 0 && bold,
      inlineTokens
    })

    // H1 underline — amber rule
    if (seg.type === 'h1' && wi === wrappedLines.length - 1) {
      lines.push({
        type: 'h1-underline',
        key: `h1ul_${i}`,
        text: '═'.repeat(Math.min(wrapLimit, (textContent.length || 10) + 2)),
        focused
      })
    }
  }

  return lines
}

export function buildMarkdownLines(text, wrapLimit, focused) {
  const cacheKey = `${text}|${wrapLimit}|${focused}`;
  if (markdownCache.has(cacheKey)) {
    return markdownCache.get(cacheKey);
  }

  const segments = parseMarkdown(text)
  const lines = []

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]

    // ── blank ─────────────────────────────────────────────────────
    // Suppress consecutive blanks — only emit one gap at a time
    if (seg.type === 'blank') {
      const last = lines[lines.length - 1]
      if (!last || last.type !== 'gap') {
        lines.push({ type: 'gap' })
      }
      continue
    }

    if (seg.type === 'toolcall') {
      lines.push(...buildToolCallLines(seg, i, focused))
      continue
    }

    if (seg.type === 'plan') {
      lines.push(...buildPlanLines(seg, i, focused, wrapLimit))
      continue
    }

    if (seg.type === 'codeblock') {
      lines.push(...buildCodeblockLines(seg, i, focused, wrapLimit))
      continue
    }

    if (seg.type === 'hr') {
      lines.push(...buildHrLines(i, wrapLimit))
      continue
    }

    // ── all other block types ─────────────────────────────────────
    lines.push(...buildStandardLines(seg, i, focused, wrapLimit))
  }

  if (markdownCache.size > 1000) {
    // Evict oldest 10% (100 items) to avoid O(N) deletion penalty per insertion
    let count = 0;
    for (const key of markdownCache.keys()) {
      markdownCache.delete(key);
      if (++count >= 100) break;
    }
  }
  markdownCache.set(cacheKey, lines);
  return lines
}
