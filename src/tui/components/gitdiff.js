import React, { useState, useEffect, useMemo } from 'react'
import { Box, Text } from 'ink'
import { getAllActivities } from '../../state/jules-api.js'
import { parsePatch } from 'diff'

export function GitDiffViewer({ sessionId, width, height, isDimmed, fileSel = 0, scrollOffset = 0 }) {
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!sessionId) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    getAllActivities(sessionId)
      .then(res => {
        const acts = res.activities || res || []
        setActivities(acts)
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [sessionId])

  const diffStr = useMemo(() => {
    if (!activities || activities.length === 0) return null

    // Sort by createTime to find the latest
    const sorted = [...activities].sort((a, b) => new Date(a.createTime || 0) - new Date(b.createTime || 0))

    for (let i = sorted.length - 1; i >= 0; i--) {
      const act = sorted[i]
      if (act.artifacts && act.artifacts.length > 0) {
        for (const art of act.artifacts) {
          if (art.changeSet?.gitPatch?.unidiffPatch) {
            return art.changeSet.gitPatch.unidiffPatch
          }
        }
      }
    }
    return null
  }, [activities])

  const parsedDiff = useMemo(() => {
    if (!diffStr) return []
    try {
      return parsePatch(diffStr)
    } catch (e) {
      return []
    }
  }, [diffStr])

  if (loading) {
    return React.createElement(Box, { width, height, justifyContent: 'center', alignItems: 'center' },
      React.createElement(Text, { color: 'cyan' }, 'Loading diff...')
    )
  }

  if (error) {
    return React.createElement(Box, { width, height, justifyContent: 'center', alignItems: 'center' },
      React.createElement(Text, { color: 'red' }, `Error: ${error}`)
    )
  }

  if (!diffStr || parsedDiff.length === 0) {
    return React.createElement(Box, { width, height, justifyContent: 'center', alignItems: 'center' },
      React.createElement(Text, { color: 'gray' }, 'No code changes found in this session.')
    )
  }

  const leftPanelWidth = Math.max(20, Math.floor(width * 0.2))
  const rightPanelWidth = width - leftPanelWidth - 1 // -1 for border

  const selectedFile = parsedDiff[fileSel] || parsedDiff[0]

  // Render left panel (files changed)
  const filesPanel = React.createElement(Box, {
    flexDirection: 'column',
    width: leftPanelWidth,
    height: '100%',
    borderStyle: 'single',
    borderColor: isDimmed ? 'gray' : 'green',
    paddingX: 1
  },
    React.createElement(Text, { color: 'gray', bold: true }, 'Files Changed'),
    ...parsedDiff.map((file, idx) => {
      let fileName = file.newFileName || file.oldFileName
      if (fileName.startsWith('b/')) fileName = fileName.substring(2)
      else if (fileName.startsWith('a/')) fileName = fileName.substring(2)

      const isSelected = idx === fileSel
      return React.createElement(Text, {
        key: idx,
        color: isDimmed ? 'gray' : (isSelected ? 'whiteBright' : 'white'),
        backgroundColor: isSelected && !isDimmed ? 'blue' : undefined,
        wrap: 'truncate'
      }, fileName)
    })
  )

  // Render right panel (diff)
  // The user requested a 2-pane side-by-side view (split the screen in half).
  const halfWidth = Math.floor((rightPanelWidth - 3) / 2); // subtract borders/spacing

  const allLines = []
  if (selectedFile && selectedFile.hunks) {
    allLines.push({ text: `📄 ${selectedFile.oldFileName || ''} → ${selectedFile.newFileName || ''}`, color: 'gray', isHunk: true })
    allLines.push({ text: '', color: 'white', isHunk: true })
    for (let hIdx = 0; hIdx < selectedFile.hunks.length; hIdx++) {
      const hunk = selectedFile.hunks[hIdx]
      allLines.push({ text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@ ${hunk.hunkHeader || ''}`, color: 'cyan', isHunk: true })

      for (let lIdx = 0; lIdx < hunk.lines.length; lIdx++) {
        const line = hunk.lines[lIdx]
        // Split side by side logic
        let leftText = ' '
        let leftColor = 'white'
        let leftDim = false
        let leftBg = undefined

        let rightText = ' '
        let rightColor = 'white'
        let rightDim = false
        let rightBg = undefined

        if (line.startsWith('+')) {
          rightText = line
          rightColor = 'green'
          rightBg = '#1c281e' // faint green bg
        } else if (line.startsWith('-')) {
          leftText = line
          leftColor = 'red'
          leftDim = true
          leftBg = '#331a1a' // faint red bg
        } else {
          leftText = line
          rightText = line
          leftColor = 'gray'
          rightColor = 'gray'
        }

        allLines.push({
          leftText, leftColor, leftDim, leftBg,
          rightText, rightColor, rightDim, rightBg,
          isHunk: false
        })
      }
    }
  }

  const VISIBLE_DIFF_ROWS = height - 2 // approx
  const diffStart = Math.min(scrollOffset, Math.max(0, allLines.length - VISIBLE_DIFF_ROWS))
  const visibleDiffLines = allLines.slice(diffStart, diffStart + VISIBLE_DIFF_ROWS)

  const diffPanel = React.createElement(Box, {
    flexDirection: 'column',
    width: rightPanelWidth,
    height: '100%',
    paddingX: 1,
    overflow: 'hidden'
  },
    visibleDiffLines.map((l, i) => {
      if (l.isHunk || l.leftText === undefined) {
        return React.createElement(Box, { key: i, height: 1, overflow: 'hidden' },
          React.createElement(Text, { color: isDimmed ? 'gray' : (l.color || 'white'), wrap: 'truncate' }, l.text)
        )
      } else {
        // side by side row
        return React.createElement(Box, { key: i, height: 1, flexDirection: 'row', overflow: 'hidden' },
          // left side
          React.createElement(Box, { width: halfWidth, overflow: 'hidden', paddingRight: 1 },
            React.createElement(Text, {
              color: isDimmed ? 'gray' : l.leftColor,
              dimColor: l.leftDim,
              backgroundColor: isDimmed ? undefined : l.leftBg,
              wrap: 'truncate'
            }, l.leftText)
          ),
          // separator
          React.createElement(Box, { width: 1, flexShrink: 0 }, React.createElement(Text, { color: 'gray' }, '│')),
          // right side
          React.createElement(Box, { width: halfWidth, overflow: 'hidden', paddingLeft: 1 },
            React.createElement(Text, {
              color: isDimmed ? 'gray' : l.rightColor,
              dimColor: l.rightDim,
              backgroundColor: isDimmed ? undefined : l.rightBg,
              wrap: 'truncate'
            }, l.rightText)
          )
        )
      }
    })
  )

  return React.createElement(Box, { flexDirection: 'row', width, height, overflow: 'hidden' },
    filesPanel,
    React.createElement(Box, { width: 1, height: '100%' }, React.createElement(Text, null, ' ')), // spacer
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
