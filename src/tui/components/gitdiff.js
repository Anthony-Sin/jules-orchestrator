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

  const selectedFile = parsedDiff[fileSel] || parsedDiff[0]

  // Ensure files are shown at top instead of left
  const filesPanelHeight = 4 // Title row + 1 active file name row + 2 border rows
  const diffPanelHeight = height - filesPanelHeight

  // Formatted file list row (just show one active with < > arrows to denote selection)
  const fileListText = parsedDiff.map((file, idx) => {
      let fileName = file.newFileName || file.oldFileName
      if (fileName.startsWith('b/')) fileName = fileName.substring(2)
      else if (fileName.startsWith('a/')) fileName = fileName.substring(2)

      const parts = fileName.split('/')
      if (parts.length > 3) {
          fileName = parts[0][0] + '/' + parts[1][0] + '/' + parts.slice(-2).join('/')
      }

      return idx === fileSel ? `[${fileName}]` : fileName
  }).join('  ·  ')

  const filesPanel = React.createElement(Box, {
    flexDirection: 'column',
    width: width,
    height: filesPanelHeight,
    paddingX: 1,
    borderStyle: 'single',
    borderColor: isDimmed ? 'gray' : 'green'
  },
    React.createElement(Text, { color: 'whiteBright', bold: true, wrap: 'truncate' }, `Files Changed [${fileSel + 1}/${parsedDiff.length}] (Up/Down to switch)`),
    React.createElement(Text, { color: isDimmed ? 'gray' : 'cyan', wrap: 'truncate' }, fileListText)
  )

  // Render diff below
  // Split the screen in half for side-by-side
  const halfWidth = Math.floor((width - 3) / 2); // subtract borders/spacing

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

  const VISIBLE_DIFF_ROWS = diffPanelHeight
  const diffStart = Math.min(scrollOffset, Math.max(0, allLines.length - VISIBLE_DIFF_ROWS))
  const visibleDiffLines = allLines.slice(diffStart, diffStart + VISIBLE_DIFF_ROWS)

  const diffPanel = React.createElement(Box, {
    flexDirection: 'column',
    width: width,
    height: diffPanelHeight,
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
              wrap: 'wrap' // wrap text horizontally
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
              wrap: 'wrap' // wrap text horizontally
            }, l.rightText)
          )
        )
      }
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
