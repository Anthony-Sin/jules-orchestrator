import React, { useState, useEffect, useMemo } from 'react'
import { Box, Text } from 'ink'
import { parsePatch } from 'diff'
import { getAllActivities } from '../../state/jules-api.js'
import { THEME } from '../theme.js'

const sessionDiffCache = new Map()

function normalizeFileName(raw) {
  let name = raw || ''
  if (name.startsWith('b/')) name = name.slice(2)
  else if (name.startsWith('a/')) name = name.slice(2)
  return name
}

function shortenFileName(raw, maxLen = 32) {
  const normalized = normalizeFileName(raw)
  const parts = normalized.split('/')
  const name = parts.length > 2 ? parts.slice(-2).join('/') : normalized
  if (name.length <= maxLen) return name
  return `${name.slice(0, Math.max(8, maxLen - 3))}...`
}

function wrapForWidth(text, width) {
  const safeWidth = Math.max(1, width)
  const src = String(text ?? '')
  if (src.length === 0) return ['']

  const lines = []
  let idx = 0
  while (idx < src.length) {
    lines.push(src.slice(idx, idx + safeWidth))
    idx += safeWidth
  }
  return lines
}

function buildActivitySignature(activities) {
  if (!Array.isArray(activities) || activities.length === 0) return ''
  const sorted = [...activities].sort((a, b) => new Date(a.createTime || 0) - new Date(b.createTime || 0))
  const last = sorted[sorted.length - 1]
  return `${sorted.length}:${last?.name || ''}:${last?.updateTime || last?.createTime || ''}`
}

function collectPatchString(activities) {
  const sorted = [...activities].sort((a, b) => new Date(a.createTime || 0) - new Date(b.createTime || 0))
  const patches = []

  for (const act of sorted) {
    if (!Array.isArray(act.artifacts)) continue
    for (const art of act.artifacts) {
      const patch = art.changeSet?.gitPatch?.unidiffPatch
      if (patch) patches.push(patch)
    }
  }

  return patches.length > 0 ? patches.join('\n') : null
}

function dedupeParsedDiff(parsedDiff) {
  const byFile = new Map()

  for (const file of parsedDiff) {
    const key = normalizeFileName(file.newFileName || file.oldFileName)
    if (!byFile.has(key)) {
      byFile.set(key, {
        oldFileName: file.oldFileName,
        newFileName: file.newFileName,
        hunks: [],
        _hunkSignatures: new Set(),
      })
    }

    const target = byFile.get(key)
    for (const hunk of file.hunks || []) {
      const sig = [
        hunk.oldStart,
        hunk.oldLines,
        hunk.newStart,
        hunk.newLines,
        hunk.hunkHeader || '',
        (hunk.lines || []).join('\n'),
      ].join('|')

      if (!target._hunkSignatures.has(sig)) {
        target._hunkSignatures.add(sig)
        target.hunks.push(hunk)
      }
    }
  }

  return [...byFile.values()].map(f => {
    delete f._hunkSignatures
    return f
  })
}

function calcWindow(names, selIdx, budget) {
  if (!Array.isArray(names) || names.length === 0) return { lo: 0, hi: -1 }
  const safeSel = Math.max(0, Math.min(selIdx, names.length - 1))
  const sep = 3

  let used = names[safeSel].length + 2
  let lo = safeSel
  let hi = safeSel

  while (true) {
    let grew = false

    if (lo > 0) {
      const cost = sep + names[lo - 1].length + 2
      if (used + cost <= budget) {
        lo--
        used += cost
        grew = true
      }
    }

    if (hi < names.length - 1) {
      const cost = sep + names[hi + 1].length + 2
      if (used + cost <= budget) {
        hi++
        used += cost
        grew = true
      }
    }

    if (!grew) break
  }

  return { lo, hi }
}

export function GitDiffViewer({
  sessionId,
  width,
  height,
  isDimmed,
  fileSel = 0,
  scrollOffset = 0,
  diffFocus,
  setDiffFileSel,
  refreshToken = 0,
  setDiffFileCount,
}) {
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!sessionId) {
      setLoading(false)
      setActivities([])
      return
    }

    let active = true
    setLoading(true)
    setError(null)

    getAllActivities(sessionId)
      .then(res => {
        if (!active) return
        const nextActivities = res.activities || res || []
        const signature = buildActivitySignature(nextActivities)

        const cached = sessionDiffCache.get(sessionId)
        if (cached?.signature === signature) {
          setActivities(cached.activities)
        } else {
          sessionDiffCache.set(sessionId, { signature, activities: nextActivities })
          setActivities(nextActivities)
        }
        setLoading(false)
      })
      .catch(err => {
        if (!active) return
        setError(err.message)
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [sessionId, refreshToken])

  const diffStr = useMemo(() => {
    if (!activities || activities.length === 0) return null
    return collectPatchString(activities)
  }, [activities])

  const parsedDiff = useMemo(() => {
    if (!diffStr) return []
    try {
      return dedupeParsedDiff(parsePatch(diffStr))
    } catch (_) {
      return []
    }
  }, [diffStr])

  useEffect(() => {
    const total = parsedDiff.length
    setDiffFileCount?.(total)

    if (total > 0 && setDiffFileSel && fileSel >= total) {
      setDiffFileSel(total - 1)
    }
  }, [fileSel, parsedDiff, setDiffFileSel, setDiffFileCount])

  if (loading) {
    return React.createElement(Box, { width, height, justifyContent: 'center', alignItems: 'center' },
      React.createElement(Text, { color: THEME.accentSoft }, 'Loading diff...'))
  }

  if (error) {
    return React.createElement(Box, { width, height, justifyContent: 'center', alignItems: 'center' },
      React.createElement(Text, { color: THEME.error }, `Error: ${error}`))
  }

  if (!diffStr || parsedDiff.length === 0) {
    return React.createElement(Box, { width, height, justifyContent: 'center', alignItems: 'center' },
      React.createElement(Text, { color: THEME.subtleText }, 'No code changes found in this session.'))
  }

  const total = parsedDiff.length
  const safeSelIdx = Math.max(0, Math.min(fileSel, total - 1))
  const selectedFile = parsedDiff[safeSelIdx]
  const isFilesFocused = diffFocus === 'files'
  const filesPanelH = Math.min(4, Math.max(3, height - 4))
  const diffPanelH = Math.max(1, height - filesPanelH)

  const budget = Math.max(8, width - 8)
  const names = parsedDiff.map(f => shortenFileName(
    f.newFileName || f.oldFileName,
    Math.max(16, Math.floor(width / 3))
  ))
  const { lo: winLo, hi: winHi } = calcWindow(names, safeSelIdx, budget)
  const showLeft = winLo > 0
  const showRight = winHi < total - 1

  const tabElements = []
  for (let idx = winLo; idx <= winHi; idx++) {
    if (idx > winLo) tabElements.push(React.createElement(Text, { key: `sep-${idx}`, color: THEME.subtleText }, ' | '))
    const isSel = idx === safeSelIdx
    const label = isSel ? `[${names[idx]}]` : ` ${names[idx]} `
    tabElements.push(React.createElement(Text, {
      key: `tab-${idx}`,
      color: isDimmed
        ? THEME.subtleText
        : isSel
          ? (isFilesFocused ? THEME.text : THEME.accentSoft)
          : THEME.subtleText,
      backgroundColor: isSel && isFilesFocused && !isDimmed ? THEME.accentBg : undefined,
    }, label))
  }

  const filesPanel = React.createElement(Box, {
    flexDirection: 'column',
    width,
    height: filesPanelH,
    paddingX: 1,
    borderStyle: 'single',
    borderColor: isDimmed ? THEME.subtleText : (isFilesFocused ? THEME.panelFocusBorder : THEME.panelBorder),
  },
  React.createElement(Text, {
    color: isDimmed ? THEME.subtleText : (isFilesFocused ? THEME.text : THEME.subtleText),
    bold: true,
    wrap: 'truncate',
  }, `Files [${safeSelIdx + 1}/${total}] (left/right switch | enter view diff | tab chat)`),
  React.createElement(Box, { flexDirection: 'row', overflow: 'hidden', flexShrink: 0 },
    React.createElement(Text, { color: THEME.subtleText }, showLeft ? '< ' : '  '),
    ...tabElements,
    showRight ? React.createElement(Text, { color: THEME.subtleText }, ' >') : null))

  const useSplitView = width >= 120
  const panelWidth = Math.max(16, width - 2)
  const sidePad = 1
  const innerWidth = Math.max(10, panelWidth - (sidePad * 2))
  const leftColWidth = useSplitView ? Math.max(8, Math.floor((innerWidth - 1) / 2)) : innerWidth
  const rightColWidth = useSplitView ? Math.max(8, innerWidth - leftColWidth - 1) : innerWidth
  const hunkWidth = innerWidth

  const allLines = []
  const pushHunkWrapped = (text, color) => {
    for (const line of wrapForWidth(text, hunkWidth)) {
      allLines.push({ type: 'hunk', text: line, color })
    }
  }

  if (selectedFile?.hunks) {
    pushHunkWrapped(
      `FILE ${normalizeFileName(selectedFile.oldFileName || '')} -> ${normalizeFileName(selectedFile.newFileName || '')}`,
      THEME.subtleText
    )
    allLines.push({ type: 'hunk', text: '', color: THEME.subtleText })

    for (const hunk of selectedFile.hunks) {
      pushHunkWrapped(
        `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@ ${hunk.hunkHeader || ''}`,
        THEME.accentSoft
      )

      for (const rawLine of hunk.lines || []) {
        const marker = rawLine[0] || ' '
        const body = rawLine.slice(1)

        if (!useSplitView) {
          let prefix = ' '
          let color = THEME.subtleText
          let bg

          if (marker === '+') {
            prefix = '+'
            color = 'green'
            bg = '#1d2c1d'
          } else if (marker === '-') {
            prefix = '-'
            color = THEME.accentSoft
            bg = '#3b1414'
          }

          const wrapped = wrapForWidth(body, Math.max(4, innerWidth - 2))
          wrapped.forEach((chunk, idx) => {
            allLines.push({
              type: 'single',
              prefix: idx === 0 ? prefix : ' ',
              text: chunk,
              color,
              bg,
              dim: marker === ' ',
            })
          })
          continue
        }

        let leftText = ''
        let rightText = ''
        let leftColor = THEME.subtleText
        let rightColor = THEME.subtleText
        let leftBg
        let rightBg

        if (marker === '+') {
          rightText = body
          rightColor = 'green'
          rightBg = '#1d2c1d'
        } else if (marker === '-') {
          leftText = body
          leftColor = THEME.accentSoft
          leftBg = '#3b1414'
        } else {
          leftText = body
          rightText = body
        }

        const leftWrapped = wrapForWidth(leftText, leftColWidth)
        const rightWrapped = wrapForWidth(rightText, rightColWidth)
        const rows = Math.max(leftWrapped.length, rightWrapped.length)

        for (let i = 0; i < rows; i++) {
          allLines.push({
            type: 'pair',
            leftText: leftWrapped[i] || '',
            rightText: rightWrapped[i] || '',
            leftColor,
            rightColor,
            leftBg,
            rightBg,
            leftDim: marker === ' ',
            rightDim: marker === ' ',
          })
        }
      }
    }
  }

  const maxStart = Math.max(0, allLines.length - diffPanelH)
  const safeScroll = Number.isFinite(scrollOffset) ? scrollOffset : 0
  const diffStart = Math.max(0, Math.min(safeScroll, maxStart))
  const visibleDiffLines = allLines.slice(diffStart, diffStart + diffPanelH)

  const diffPanel = React.createElement(Box, {
    flexDirection: 'column',
    width,
    height: diffPanelH,
    paddingX: 1,
    overflow: 'hidden',
    borderStyle: 'single',
    borderColor: isDimmed ? THEME.subtleText : (diffFocus === 'content' ? THEME.panelFocusBorder : THEME.subtleText),
  },
  visibleDiffLines.map((line, idx) => {
    const absoluteIdx = diffStart + idx

    if (line.type === 'hunk') {
      return React.createElement(Box, { key: `h_${absoluteIdx}`, height: 1, overflow: 'hidden' },
        React.createElement(Text, {
          color: isDimmed ? THEME.subtleText : (line.color || THEME.text),
          wrap: 'truncate',
        }, line.text))
    }

    if (line.type === 'single') {
      return React.createElement(Box, {
        key: `u_${absoluteIdx}`,
        height: 1,
        overflow: 'hidden',
        backgroundColor: isDimmed ? undefined : line.bg,
        flexDirection: 'row',
      },
      React.createElement(Text, {
        color: isDimmed ? THEME.subtleText : line.color,
        dimColor: line.dim,
      }, `${line.prefix} `),
      React.createElement(Text, {
        color: isDimmed ? THEME.subtleText : line.color,
        dimColor: line.dim,
        wrap: 'truncate',
      }, line.text))
    }

    return React.createElement(Box, { key: `p_${absoluteIdx}`, height: 1, flexDirection: 'row', overflow: 'hidden' },
      React.createElement(Box, {
        width: leftColWidth,
        overflow: 'hidden',
        backgroundColor: isDimmed ? undefined : line.leftBg,
      },
      React.createElement(Text, {
        color: isDimmed ? THEME.subtleText : line.leftColor,
        dimColor: line.leftDim,
        wrap: 'truncate',
      }, line.leftText.padEnd(leftColWidth))),
      React.createElement(Box, { width: 1, flexShrink: 0 },
        React.createElement(Text, { color: THEME.subtleText }, '|')),
      React.createElement(Box, {
        width: rightColWidth,
        overflow: 'hidden',
        backgroundColor: isDimmed ? undefined : line.rightBg,
      },
      React.createElement(Text, {
        color: isDimmed ? THEME.subtleText : line.rightColor,
        dimColor: line.rightDim,
        wrap: 'truncate',
      }, line.rightText.padEnd(rightColWidth))))
  }))

  return React.createElement(Box, { flexDirection: 'column', width, height, overflow: 'hidden' }, filesPanel, diffPanel)
}

export function applyDiff(diffStr) {
  return new Promise((resolve, reject) => {
    import('child_process')
      .then(({ spawn }) => {
        const runApply = (args) => new Promise((res, rej) => {
          const child = spawn('git', args)
          let errorOut = ''
          child.stderr.on('data', data => { errorOut += data.toString() })

          if (typeof child.stdin.on === 'function') {
            child.stdin.on('error', err => rej(new Error(`stdin error: ${err.message}`)))
          }

          child.on('close', code => {
            if (code === 0) res(true)
            else rej(new Error(errorOut || 'Git apply failed'))
          })

          const canWrite = child.stdin.write(diffStr)
          if (!canWrite && typeof child.stdin.once === 'function') {
            child.stdin.once('drain', () => child.stdin.end())
          } else {
            child.stdin.end()
          }
        })

        runApply(['apply', '--cached']).then(resolve).catch(err1 => {
          runApply(['apply']).then(resolve).catch(err2 => {
            reject(new Error(err2.message || err1.message || 'Git apply failed'))
          })
        })
      })
      .catch(reject)
  })
}
