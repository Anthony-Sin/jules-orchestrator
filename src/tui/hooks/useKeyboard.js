import { useInput } from 'ink'
import { useRef } from 'react'
import { deleteSession } from '../../state/jules-api.js'
import { removeSession } from '../../state/store.js'
import { GRAPH_NODE_W } from '../components/graph.js'

export function useKeyboard(p) {
  const isApplyingDiff = useRef(false)

  const {
    exit,
    mode, setMode,
    lastLeftMode,
    showHelp, setShowHelp,
    repoInputMode, setRepoInputMode,
    repoInput, setRepoInput,
    sourcesList,
    sourceSel, setSourceSel,
    handleRepoSubmit,
    sel, setSel,
    AGENTS,
    expandedIds, setExpandedIds,
    toggleExpand,
    VISIBLE_AGENTS,
    showGraph, setShowGraph,
    graphSel, setGraphSel,
    graphNodes,
    graphViewMode,
    planNodeSel, setPlanNodeSel,
    savedDiagrams,
    openAgentChat,
    columns,
    rows,
    leftPanelWidth,
    diffFocus, setDiffFocus,
    diffFileSel, setDiffFileSel,
    diffFileCount,
    diffScrollOffset, setDiffScrollOffset,
    chatInput, setChatInput,
    chatTab, setChatTab,
    chatMenuOpen, setChatMenuOpen,
    chatMenuSel, setChatMenuSel,
    setChatTargetMode,
    startDialogOpen, setStartDialogOpen,
    startDialogMode, setStartDialogMode,
    setMessages,
    setScrollOffset,
    handleSend,
    selectedSessionId,
    queuedMessages,
    queuedCycleIdx, setQueuedCycleIdx,
    notes,
    setPromptPreview,
    setTick,
    flash,
    saveToDrive,
  } = p

  useInput(async (input, key) => {
    if (repoInputMode) {
      if (key.escape) {
        setRepoInputMode(false)
        return
      }
      if (repoInput.startsWith('/')) {
        const filtered = sourcesList.filter(s =>
          ('/' + (s.displayName || s.name)).toLowerCase().includes(repoInput.toLowerCase())
        )
        if (key.upArrow) { setSourceSel(i => Math.max(0, i - 1)); return }
        if (key.downArrow) { setSourceSel(i => Math.min(Math.max(0, filtered.length - 1), i + 1)); return }
        if (key.return && filtered.length > 0 && filtered[sourceSel]) {
          handleRepoSubmit(filtered[sourceSel].name)
          return
        }
      }
      return
    }

    if (key.ctrl && input === 'c') { exit(); return }
    if (key.meta && input === '?') { setShowHelp(v => !v); return }
    if (showHelp && (key.escape || (key.meta && input === '?'))) { setShowHelp(false); return }
    if (showHelp) return

    if (key.meta && input === 'd' && mode === 'table') {
      const agent = AGENTS[sel]
      if (agent) {
        flash(`Deleting session ${agent.id.substring(0, 6)}...`)
        deleteSession(agent.id)
          .then(() => {
            removeSession(agent.id)
            flash(`Deleted session ${agent.id.substring(0, 6)}`)
          })
          .catch(err => flash(`Delete failed: ${err.message}`))
      }
      return
    }

    if (key.meta && input === 'q') {
      const entries = Object.entries(queuedMessages)
      if (entries.length > 0) {
        let nextIdx = queuedCycleIdx + 1
        if (nextIdx >= entries.length) nextIdx = 0
        setQueuedCycleIdx(nextIdx)
        const [, msg] = entries[nextIdx]
        setChatInput(msg)
      }
      return
    }

    if (key.meta && input && input >= '1' && input <= '9') {
      const promptNum = input
      const notesLines = (notes || '').split('\n')
      let foundPrompt = false
      let promptText = ''

      for (const line of notesLines) {
        if (line.trim().startsWith(`${promptNum}.`)) {
          foundPrompt = true
          promptText += line.replace(new RegExp(`^\\s*${promptNum}\\.\\s*`), '') + '\n'
        } else if (foundPrompt) {
          if (/^\s*\d+\./.test(line)) break
          promptText += line + '\n'
        }
      }

      if (foundPrompt && promptText.trim()) {
        const finalPrompt = promptText.trim()
        setChatInput(finalPrompt)
        setPromptPreview(`Prompt ${promptNum}: ${finalPrompt.split('\n')[0].substring(0, 50)}...`)
        setTimeout(() => setPromptPreview(null), 3000)
      } else {
        flash(`Prompt ${promptNum} not found in notes.`)
      }
      return
    }

    if (key.meta && input === 't') { setMode('table'); return }

    if (key.meta && input === 'g') {
      if (columns < 90 || rows < 14) {
        flash('Terminal too small for Diff View (need 90x14)')
        return
      }
      setMode(m => m !== 'diff' ? 'diff' : 'table')
      return
    }

    if (key.meta && input === 'a' && mode === 'diff' && selectedSessionId) {
      if (isApplyingDiff.current) {
        flash('Diff application already in progress')
        return
      }
      isApplyingDiff.current = true
      flash('Applying diff...')

      const id = selectedSessionId
      import('../components/gitdiff.js')
        .then(({ applyDiff }) => import('../../state/jules-api.js').then(({ getAllActivities }) => ({ applyDiff, getAllActivities })))
        .then(async ({ applyDiff, getAllActivities }) => {
          const res = await getAllActivities(id)
          const acts = res.activities || res || []
          const sorted = [...acts].sort((a, b) => new Date(a.createTime || 0) - new Date(b.createTime || 0))
          let diffStr = null

          for (let i = sorted.length - 1; i >= 0; i--) {
            const act = sorted[i]
            if (act.artifacts?.length > 0) {
              for (const art of act.artifacts) {
                if (art.changeSet?.gitPatch?.unidiffPatch) {
                  diffStr = art.changeSet.gitPatch.unidiffPatch
                  break
                }
              }
            }
            if (diffStr) break
          }

          if (!diffStr) {
            flash('No diff found to apply')
            return
          }

          await applyDiff(diffStr)
          flash('Diff applied successfully')
        })
        .catch(err => flash(`Failed to apply diff: ${err.message}`))
        .finally(() => { isApplyingDiff.current = false })

      return
    }

    if (key.meta && input === 'e') { setMode('chat'); return }
    if (key.meta && input === 'n') { setMode('chat'); setChatTab(t => t === 'chat' ? 'notes' : 'chat'); return }
    if (key.meta && input === 'h') { setShowGraph(v => !v); return }
    if (key.meta && input === 'm') { setRepoInputMode(true); setRepoInput('/'); setSourceSel(0); return }
    if (key.meta && input === 'r') { setTick(t => t + 1); return }
    if (key.meta && input === 's') {
      const saved = await saveToDrive(notes)
      flash(saved ? 'Saved to Drive' : 'Drive sync not available in CLI')
      return
    }

    if (key.f4) { setRepoInputMode(true); setRepoInput('/'); setSourceSel(0); return }
    if (key.f1) { setMode('table'); return }
    if (key.f2) {
      if (columns < 95 || rows < 14) {
        flash('Terminal too small for Graph View')
        return
      }
      setShowGraph(true)
      setMode('graph')
      return
    }
    if (key.f3) { setMode('chat'); return }

    if (key.escape) {
      if (startDialogOpen) {
        setStartDialogOpen(false)
        setChatTargetMode(selectedSessionId ? 'TALK_TO_SELECTED_AGENT' : 'CREATE_ORCHESTRATOR')
        return
      }
      setMode('table')
      setChatMenuOpen(false)
      return
    }

    if (key.tab) {
      if (mode === 'diff') {
        if (diffFocus === 'files') setDiffFocus('content')
        else { setDiffFocus('files'); setMode('chat') }
      } else if (mode === 'chat' && lastLeftMode === 'diff') {
        setMode('diff')
        setDiffFocus('files')
      } else {
        setMode(m => {
          if (m === 'table') return showGraph ? 'graph' : 'chat'
          if (m === 'graph') return 'chat'
          if (m === 'chat') return lastLeftMode
          return 'table'
        })
      }
      return
    }

    if (mode === 'chat') {
      if (chatMenuOpen) {
        if (key.escape) { setChatMenuOpen(false); setChatInput(''); return }
        if (key.upArrow) { setChatMenuSel(i => Math.max(0, i - 1)); return }
        if (key.downArrow) { setChatMenuSel(i => Math.min(2, i + 1)); return }
        if (key.return) {
          if (chatMenuSel === 2) {
            setChatMenuOpen(false)
            setChatInput('')
            handleSend('/approve')
            return
          }

          const modeOption = chatMenuSel === 0 ? 'CREATE_TASK' : 'CREATE_ORCHESTRATOR'
          setChatTargetMode(modeOption)
          setStartDialogMode(modeOption)
          setStartDialogOpen(true)
          setChatMenuOpen(false)
          setChatInput('')
          return
        }
        return
      }


      if (key.shift && (key.leftArrow || key.rightArrow)) { setChatTab(t => t === 'chat' ? 'notes' : 'chat'); return }
      if (key.pageUp) { setScrollOffset(o => o + 5); return }
      if (key.pageDown) { setScrollOffset(o => Math.max(0, o - 5)); return }
      return
    }

    // --- FIX IS HERE: WE LET GITDIFF.JS HANDLE CONTENT SCROLLING ---
    if (mode === 'diff') {
      if (diffFocus === 'files') {
        if (key.leftArrow) { setDiffFileSel(i => Math.max(0, i - 1)); return }
        if (key.rightArrow) {
          setDiffFileSel(i => {
            const maxIdx = Math.max(0, (diffFileCount || 1) - 1)
            return Math.min(maxIdx, i + 1)
          })
          return
        }
        if (key.return) { setDiffFocus('content'); return }
      }
      // Content scrolling (Up/Down) is now intercepted directly inside gitdiff.js
      return 
    }
    // ---------------------------------------------------------------

    if (mode === 'graph') {
      if (graphViewMode === 'plan') {
        handlePlanGraphNav({ key, savedDiagrams, planNodeSel, setPlanNodeSel })
        return
      }
      handleLiveGraphNav({ key, graphSel, setGraphSel, graphNodes, openAgentChat, leftPanelWidth })
      return
    }

    if (mode === 'table') {
      if (key.upArrow) { setSel(i => Math.max(0, i - 1)); return }
      if (key.downArrow) { setSel(i => Math.min(Math.max(0, AGENTS.length - 1), i + 1)); return }
      if (key.rightArrow) {
        const agent = AGENTS[sel]
        if (agent && (Array.isArray(agent.subAgents) || agent.isOrchestrator || agent.type === 'orchestrator')) {
          toggleExpand(agent.id)
        }
        return
      }
      if (key.leftArrow) {
        const agent = AGENTS[sel]
        if (agent) {
          setExpandedIds(prev => {
            const next = new Set(prev)
            next.delete(agent.id)
            return next
          })
        }
        return
      }
      if (key.return) {
        const agent = AGENTS[sel]
        if (agent) openAgentChat(agent)
      }
    }
  })
}

function handlePlanGraphNav({ key, savedDiagrams, planNodeSel, setPlanNodeSel }) {
  const currentDiagram = savedDiagrams[0]
  if (!currentDiagram) return
  const nodes = currentDiagram.nodes || []
  if (nodes.length === 0) return

  const conns = currentDiagram.connections || []
  const adj = {}
  const inDeg = {}
  const incoming = {}

  nodes.forEach(n => {
    adj[n] = []
    inDeg[n] = 0
    incoming[n] = []
  })

  conns.forEach(c => {
    const [u, v] = c.split('->').map(s => s.trim())
    if (adj[u] && inDeg[v] !== undefined) {
      adj[u].push(v)
      inDeg[v]++
      incoming[v].push(u)
    }
  })

  const baseTiers = []
  let cur = nodes.filter(n => inDeg[n] === 0)
  if (cur.length === 0) cur = [nodes[0]]
  const vis = new Set(cur)

  while (cur.length > 0) {
    baseTiers.push(cur)
    const nxt = []
    cur.forEach(u => {
      adj[u].forEach(v => {
        if (!vis.has(v)) {
          vis.add(v)
          nxt.push(v)
        }
      })
    })
    cur = nxt
  }

  const uncon = nodes.filter(n => !vis.has(n))
  if (uncon.length > 0) baseTiers.push(uncon)

  const selNodeLabel = nodes[planNodeSel] || nodes[0]
  const activePath = new Set([selNodeLabel])
  let curr = selNodeLabel

  while (curr) {
    const parents = incoming[curr] || []
    if (parents.length === 0) break
    curr = parents[0]
    activePath.add(curr)
  }

  const tiers = []
  for (let t = 0; t < baseTiers.length; t++) {
    if (t === 0) {
      tiers.push(baseTiers[0])
      continue
    }
    const prevActive = tiers[t - 1].filter(n => activePath.has(n))
    const allowed = new Set()
    prevActive.forEach(parent => (adj[parent] || []).forEach(child => allowed.add(child)))
    const visibleTier = baseTiers[t].filter(n => allowed.has(n))
    if (visibleTier.length > 0) tiers.push(visibleTier)
  }

  let selTier = 0
  let selCol = 0
  outer: for (let t = 0; t < tiers.length; t++) {
    for (let c = 0; c < tiers[t].length; c++) {
      if (nodes.indexOf(tiers[t][c]) === planNodeSel) {
        selTier = t
        selCol = c
        break outer
      }
    }
  }

  if (key.leftArrow && selCol > 0) {
    setPlanNodeSel(nodes.indexOf(tiers[selTier][selCol - 1]))
    return
  }
  if (key.rightArrow && selCol < tiers[selTier].length - 1) {
    setPlanNodeSel(nodes.indexOf(tiers[selTier][selCol + 1]))
    return
  }
  if (key.upArrow && selTier > 0) {
    const parents = incoming[selNodeLabel] || []
    if (parents.length > 0) setPlanNodeSel(nodes.indexOf(parents[0]))
    else setPlanNodeSel(nodes.indexOf(tiers[selTier - 1][Math.min(selCol, tiers[selTier - 1].length - 1)]))
    return
  }
  if (key.downArrow && selTier < tiers.length - 1) {
    setPlanNodeSel(nodes.indexOf(tiers[selTier + 1][0]))
  }
}

function handleLiveGraphNav({ key, graphSel, setGraphSel, graphNodes, openAgentChat, leftPanelWidth }) {
  const total = graphNodes.length
  if (total === 0) return

  const usableWidth = Math.max(20, (leftPanelWidth || 80) - 4)
  const cardsPerRow = Math.max(1, Math.floor(usableWidth / (GRAPH_NODE_W + 1)))
  const totalRows = Math.ceil(total / cardsPerRow)
  const currentRow = Math.floor(graphSel / cardsPerRow)
  const currentCol = graphSel % cardsPerRow

  if (key.leftArrow && currentCol > 0) {
    setGraphSel(currentRow * cardsPerRow + currentCol - 1)
    return
  }

  if (key.rightArrow) {
    const rowEnd = Math.min(cardsPerRow - 1, total - 1 - currentRow * cardsPerRow)
    if (currentCol < rowEnd) setGraphSel(currentRow * cardsPerRow + currentCol + 1)
    return
  }

  if (key.upArrow && currentRow > 0) {
    setGraphSel(Math.min((currentRow - 1) * cardsPerRow + currentCol, total - 1))
    return
  }

  if (key.downArrow && currentRow < totalRows - 1) {
    setGraphSel(Math.min((currentRow + 1) * cardsPerRow + currentCol, total - 1))
    return
  }

  if (key.return) {
    const agent = graphNodes[graphSel]
    if (agent) openAgentChat(agent)
  }
}