import React, { useState, useEffect, useMemo } from 'react'
import { Box, Text } from 'ink'
import { getAllActivities } from '../../state/jules-api.js'
import { parsePatch } from 'diff'

function shortenFileName(raw) {
  let name = raw || ''
  if (name.startsWith('b/')) name = name.substring(2)
  else if (name.startsWith('a/')) name = name.substring(2)
  const parts = name.split('/')
  // Keep last 2 segments only — never truncate the name with '…'
  if (parts.length > 2) name = parts.slice(-2).join('/')
  return name
}

// Greedy window: anchor on selIdx, expand left then right alternately,
// fitting as many COMPLETE names as possible within `budget` characters.
// Selected tab renders as [name], others as  name  (space-padded).
function calcWindow(names, selIdx, budget) {
  const SEP = 3  // ' · '
  let used = names[selIdx].length + 2  // [name] = name + 2 brackets
  let lo = selIdx
  let hi = selIdx

  while (true) {
    let grew = false
    if (lo > 0) {
      const cost = SEP + names[lo - 1].length + 2
      if (used + cost <= budget) { lo--; used += cost; grew = true }
    }
    if (hi < names.length - 1) {
      const cost = SEP + names[hi + 1].length + 2
      if (used + cost <= budget) { hi++; used += cost; grew = true }
    }
    if (!grew) break
  }
  return { lo, hi }
}

export function GitDiffViewer({ sessionId, width, height, isDimmed, fileSel = 0, scrollOffset = 0, diffFocus, setDiffFileSel }) {
  const [activities, setActivities] = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)

  useEffect(() => {
    if (!sessionId) { setLoading(false); return }
    setLoading(true)
    setError(null)
    getAllActivities(sessionId)
      .then(res => { setActivities(res.activities || res || []); setLoading(false) })
      .catch(err => { setError(err.message); setLoading(false) })
  }, [sessionId])

  const diffStr = useMemo(() => {
    if (!activities || activities.length === 0) return null
    const sorted = [...activities].sort((a, b) => new Date(a.createTime || 0) - new Date(b.createTime || 0))
    for (let i = sorted.length - 1; i >= 0; i--) {
      const act = sorted[i]
      if (act.artifacts?.length > 0) {
        for (const art of act.artifacts) {
          if (art.changeSet?.gitPatch?.unidiffPatch) return art.changeSet.gitPatch.unidiffPatch
        }
      }
    }
    return null
  }, [activities])

  const parsedDiff = useMemo(() => {
    if (!diffStr) return []
    try { return parsePatch(diffStr) } catch (e) { return [] }
  }, [diffStr])

  // All hooks before early returns
  useEffect(() => {
    if (parsedDiff.length > 0 && setDiffFileSel && fileSel >= parsedDiff.length) {
      setDiffFileSel(parsedDiff.length - 1)
    }
  }, [fileSel, parsedDiff, setDiffFileSel])

  if (loading) return React.createElement(Box, { width, height, justifyContent: 'center', alignItems: 'center' },
    React.createElement(Text, { color: 'cyan' }, 'Loading diff...'))

  if (error) return React.createElement(Box, { width, height, justifyContent: 'center', alignItems: 'center' },
    React.createElement(Text, { color: 'red' }, `Error: ${error}`))

  if (!diffStr || parsedDiff.length === 0) return React.createElement(Box, { width, height, justifyContent: 'center', alignItems: 'center' },
    React.createElement(Text, { color: 'gray' }, 'No code changes found in this session.'))

  // ── Layout ──────────────────────────────────────────────────────────
  const total          = parsedDiff.length
  const safeSelIdx     = Math.min(fileSel, total - 1)
  const selectedFile   = parsedDiff[safeSelIdx]
  const isFilesFocused = diffFocus === 'files'
  const filesPanelH    = 4
  const diffPanelH     = height - filesPanelH

  // ── Greedy file tab window ──────────────────────────────────────────
  // Reserve: 2 border + 2 padding + 2 indicator chars + 1 space = 7
  const budget               = Math.max(8, width - 7)
  const names                = parsedDiff.map(f => shortenFileName(f.newFileName || f.oldFileName))
  const { lo: winLo, hi: winHi } = calcWindow(names, safeSelIdx, budget)
  const showLeft             = winLo > 0
  const showRight            = winHi < total - 1

  // ── Build tab elements ──────────────────────────────────────────────
  const tabElements = []
  for (let idx = winLo; idx <= winHi; idx++) {
    if (idx > winLo) tabElements.push(
      React.createElement(Text, { key: `sep-${idx}`, color: 'gray' }, ' · ')
    )
    const isSel = idx === safeSelIdx
    const label = isSel ? `[${names[idx]}]` : ` ${names[idx]} `
    tabElements.push(
      React.createElement(Text, {
        key: `tab-${idx}`,
        color: isDimmed
          ? 'gray'
          : isSel
            ? (isFilesFocused ? 'whiteBright' : 'cyanBright')
            : 'gray',
        backgroundColor: isSel && isFilesFocused && !isDimmed ? 'blue' : undefined,
      }, label)
    )
  }

  // ── Files panel ─────────────────────────────────────────────────────
  const filesPanel = React.createElement(Box, {
    flexDirection: 'column', width, height: filesPanelH, paddingX: 1,
    borderStyle: 'single',
    borderColor: isDimmed ? 'gray' : (isFilesFocused ? 'greenBright' : 'green'),
  },
    React.createElement(Text, {
      color: isDimmed ? 'gray' : (isFilesFocused ? 'whiteBright' : 'gray'),
      bold: true, wrap: 'truncate',
    }, `Files Changed [${safeSelIdx + 1}/${total}]  (←/→ switch · ↵ view diff · Tab chat)`),

    React.createElement(Box, { flexDirection: 'row', overflow: 'hidden', flexShrink: 0 },
      React.createElement(Text, { color: 'gray' }, showLeft  ? '◂ ' : '  '),
      ...tabElements,
      showRight ? React.createElement(Text, { color: 'gray' }, ' ▸') : null
    )
  )

  // ── Diff panel ──────────────────────────────────────────────────────
  const halfWidth = Math.floor((width - 3) / 2)
  const allLines  = []

  if (selectedFile?.hunks) {
    allLines.push({ text: `📄 ${selectedFile.oldFileName || ''} → ${selectedFile.newFileName || ''}`, color: 'gray', isHunk: true })
    allLines.push({ text: '', color: 'white', isHunk: true })
    for (const hunk of selectedFile.hunks) {
      allLines.push({
        text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@ ${hunk.hunkHeader || ''}`,
        color: 'cyan', isHunk: true,
      })
      for (const line of hunk.lines) {
        let leftText = ' ', leftColor = 'white', leftDim = false, leftBg
        let rightText = ' ', rightColor = 'white', rightDim = false, rightBg

        if (line.startsWith('+')) {
          rightText = line; rightColor = 'green'; rightBg = '#1c281e'
        } else if (line.startsWith('-')) {
          leftText = line; leftColor = 'red'; leftDim = true; leftBg = '#331a1a'
        } else {
          leftText = line; rightText = line; leftColor = 'gray'; rightColor = 'gray'
        }
        allLines.push({ leftText, leftColor, leftDim, leftBg, rightText, rightColor, rightDim, rightBg, isHunk: false })
      }
    }
  }

  const diffStart        = Math.min(scrollOffset, Math.max(0, allLines.length - diffPanelH))
  const visibleDiffLines = allLines.slice(diffStart, diffStart + diffPanelH)

  const diffPanel = React.createElement(Box, {
    flexDirection: 'column', width, height: diffPanelH,
    paddingX: 1, overflow: 'hidden',
    borderStyle: 'single',
    borderColor: isDimmed ? 'gray' : (diffFocus === 'content' ? 'greenBright' : 'gray'),
  },
    visibleDiffLines.map((l, i) => {
      if (l.isHunk || l.leftText === undefined) {
        return React.createElement(Box, { key: i, height: 1, overflow: 'hidden' },
          React.createElement(Text, { color: isDimmed ? 'gray' : (l.color || 'white'), wrap: 'truncate' }, l.text))
      }
      return React.createElement(Box, { key: i, height: 1, flexDirection: 'row', overflow: 'hidden' },
        React.createElement(Box, { width: halfWidth, overflow: 'hidden', paddingRight: 1 },
          React.createElement(Text, {
            color: isDimmed ? 'gray' : l.leftColor,
            dimColor: l.leftDim,
            backgroundColor: isDimmed ? undefined : l.leftBg,
            wrap: 'wrap',
          }, l.leftText)),
        React.createElement(Box, { width: 1, flexShrink: 0 },
          React.createElement(Text, { color: 'gray' }, '│')),
        React.createElement(Box, { width: halfWidth, overflow: 'hidden', paddingLeft: 1 },
          React.createElement(Text, {
            color: isDimmed ? 'gray' : l.rightColor,
            dimColor: l.rightDim,
            backgroundColor: isDimmed ? undefined : l.rightBg,
            wrap: 'wrap',
          }, l.rightText))
      )
    })
  )

  return React.createElement(Box, { flexDirection: 'column', width, height, overflow: 'hidden' },
    filesPanel,
    diffPanel
  )
}

export function applyDiff(diffStr) {
  return new Promise((resolve, reject) => {
    import('child_process').then(({ spawn }) => {
      const child = spawn('git', ['apply', '--cached'])
      let errorOut = ''
      child.stderr.on('data', data => errorOut += data.toString())
      child.on('close', code => {
        if (code === 0) resolve(true)
        else {
          const fallback = spawn('git', ['apply'])
          let fallErr = ''
          fallback.stderr.on('data', data => fallErr += data.toString())
          fallback.on('close', c => {
            if (c === 0) resolve(true)
            else reject(new Error(fallErr || errorOut || 'Git apply failed'))
          })
          fallback.stdin.write(diffStr)
          fallback.stdin.end()
        }
      })
      child.stdin.write(diffStr)
      child.stdin.end()
    })
  })
}