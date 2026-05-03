// ── hooks/useKeyboard.js ──────────────────────────────────────────
// All keyboard handling for the Dashboard, extracted from renderer.js.
// Receives state + setters via a single props object and wires up
// the Ink useInput hook.

import { useInput } from 'ink'
import { useRef } from 'react'
import { deleteSession } from '../../state/jules-api.js'
import { removeSession } from '../../state/store.js'
import { GRAPH_NODE_W } from '../components/graph.js'

/**
 * @param {object} p  — everything the keyboard handler needs to read or write
 */
export function useKeyboard(p) {
  const isApplyingDiff = useRef(false)
  const {
    // app
    exit,
    // mode
    mode, setMode,
    lastLeftMode,
    showHelp, setShowHelp,
    // repo input
    repoInputMode, setRepoInputMode,
    repoInput, setRepoInput,
    sourcesList,
    sourceSel, setSourceSel,
    handleRepoSubmit,
    // table
    sel, setSel,
    AGENTS,
    expandedIds, setExpandedIds,
    toggleExpand,
    VISIBLE_AGENTS,
    // graph
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
    // diff
    diffFocus, setDiffFocus,
    diffFileSel, setDiffFileSel,
    diffScrollOffset, setDiffScrollOffset,
    // chat
    chatInput, setChatInput,
    chatTab, setChatTab,
    chatMenuOpen, setChatMenuOpen,
    chatMenuSel, setChatMenuSel,
    setChatTargetMode,
    setMessages,
    setScrollOffset,
    handleSend,
    selectedSessionId,
    // queued messages
    queuedMessages,
    queuedCycleIdx, setQueuedCycleIdx,
    // notes / prompts
    notes,
    setPromptPreview,
    // animations
    setTick,
    // status flash
    flash,
    // drive
    saveToDrive,
  } = p

  useInput(async (input, key) => {
    // ── Repo picker intercepts all input ───────────────────────────
    if (repoInputMode) {
      if (key.escape) { setRepoInputMode(false); return }
      if (repoInput.startsWith('/')) {
        const filtered = sourcesList.filter(s =>
          ('/' + (s.displayName || s.name)).toLowerCase().includes(repoInput.toLowerCase()))
        if (key.upArrow)   { setSourceSel(i => Math.max(0, i - 1)); return }
        if (key.downArrow) { setSourceSel(i => Math.min(Math.max(0, filtered.length - 1), i + 1)); return }
        if (key.return && filtered.length > 0 && filtered[sourceSel]) {
          handleRepoSubmit(filtered[sourceSel].name); return
        }
      }
      return
    }

    // ── Global ─────────────────────────────────────────────────────
    if (key.ctrl && input === 'c') { exit(); return }
    if (key.meta && input === '?') { setShowHelp(v => !v); return }
    if (showHelp && (key.escape || (key.meta && input === '?'))) { setShowHelp(false); return }
    if (showHelp) return

    // ── Delete session ─────────────────────────────────────────────
    if (key.meta && input === 'd' && mode === 'table') {
      const agent = AGENTS[sel]
      if (agent) {
        flash(`Deleting session ${agent.id.substring(0, 6)}...`)
        deleteSession(agent.id)
          .then(() => { removeSession(agent.id); flash(`✓ Deleted session ${agent.id.substring(0, 6)}`) })
          .catch(err => flash(`Delete failed: ${err.message}`))
      }
      return
    }

    // ── Queued message cycling ─────────────────────────────────────
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

    // ── Notes quick-prompts Alt+1..9 ──────────────────────────────
    if (key.meta && input && input >= '1' && input <= '9') {
      const promptNum   = input
      const notesLines  = (notes || '').split('\n')
      let foundPrompt   = false
      let promptText    = ''

      for (const line of notesLines) {
        if (line.trim().startsWith(`${promptNum}.`)) {
          foundPrompt = true
          promptText += line.replace(new RegExp(`^\\s*${promptNum}\\.\\s*`), '') + '\n'
        } else if (foundPrompt) {
          if (/^\s*\d+\./.test(line)) break
          else promptText += line + '\n'
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

    // ── Mode switching ─────────────────────────────────────────────
    if (key.meta && input === 't') { setMode('table'); return }

    if (key.meta && input === 'g') {
      if (columns < 100 || rows < 15) { flash('Terminal too small for Diff View (need 100x15)'); return }
      setMode(m => m !== 'diff' ? 'diff' : 'table')
      return
    }

    if (key.meta && input === 'a' && mode === 'diff' && selectedSessionId) {
      if (isApplyingDiff.current) {
        flash('Diff application already in progress...')
        return
      }
      isApplyingDiff.current = true
      flash('Applying diff...')
      const id = selectedSessionId
      import('../components/gitdiff.js').then(({ applyDiff }) => {
        import('../../state/jules-api.js').then(({ getAllActivities }) => {
          getAllActivities(id).then(res => {
            const acts   = res.activities || res || []
            const sorted = [...acts].sort((a, b) => new Date(a.createTime || 0) - new Date(b.createTime || 0))
            let diffStr  = null
            for (let i = sorted.length - 1; i >= 0; i--) {
              const act = sorted[i]
              if (act.artifacts?.length > 0) {
                for (const art of act.artifacts) {
                  if (art.changeSet?.gitPatch?.unidiffPatch) { diffStr = art.changeSet.gitPatch.unidiffPatch; break }
                }
              }
              if (diffStr) break
            }
            if (diffStr) {
              applyDiff(diffStr)
                .then(() => flash('✓ Diff applied successfully'))
                .catch(err => flash(`✗ Failed to apply diff: ${err.message}`))
                .finally(() => { isApplyingDiff.current = false })
            } else {
              flash('✗ No diff found to apply')
              isApplyingDiff.current = false
            }
          }).catch(err => {
            flash(`✗ Failed to get activities: ${err.message}`)
            isApplyingDiff.current = false
          })
        }).catch(err => {
          flash(`✗ Failed to load module: ${err.message}`)
          isApplyingDiff.current = false
        })
      }).catch(err => {
        flash(`✗ Failed to load diff module: ${err.message}`)
        isApplyingDiff.current = false
      })
      return
    }

    if (key.meta && input === 'e') { setMode('chat'); return }
    if (key.meta && input === 'n') { setMode('chat'); setChatTab(t => t === 'chat' ? 'notes' : 'chat'); return }
    if (key.meta && input === 'h') { setShowGraph(v => !v); return }
    if (key.meta && input === 'm') { setRepoInputMode(true); setRepoInput('/'); setSourceSel(0); return }
    if (key.meta && input === 'r') { setTick(t => t + 1); return }
    if (key.meta && input === 's') {
      const saved = await saveToDrive(notes)
      flash(saved ? '✓ Saved to Drive' : '~ Drive sync not available in CLI')
      return
    }

    // ── Function keys ──────────────────────────────────────────────
    if (key.f4) { setRepoInputMode(true); setRepoInput('/'); setSourceSel(0); return }
    if (key.f1) { setMode('table'); return }
    if (key.f2) {
      if (columns < 100 || rows < 15) { flash('Terminal too small for Graph View'); return }
      setShowGraph(true); setMode('graph'); return
    }
    if (key.f3) { setMode('chat'); return }

    if (key.escape) { setMode('table'); setChatMenuOpen(false); return }

    // ── Tab cycling ────────────────────────────────────────────────
    if (key.tab) {
      if (mode === 'diff') {
        if (diffFocus === 'files') { setDiffFocus('content') }
        else { setDiffFocus('files'); setMode('chat') }
      } else if (mode === 'chat' && lastLeftMode === 'diff') {
        setMode('diff'); setDiffFocus('files')
      } else {
        setMode(m => {
          if (m === 'table') return showGraph ? 'graph' : 'chat'
          if (m === 'graph') return 'chat'
          if (m === 'chat')  return lastLeftMode
          return 'table'
        })
      }
      return
    }

    // ── Chat mode ─────────────────────────────────────────────────
    if (mode === 'chat') {
      if (chatMenuOpen) {
        if (key.escape)    { setChatMenuOpen(false); setChatInput(''); return }
        if (key.upArrow)   { setChatMenuSel(i => Math.max(0, i - 1)); return }
        if (key.downArrow) { setChatMenuSel(i => Math.min(2, i + 1)); return }
        if (key.return) {
          if (chatMenuSel === 2) { setChatMenuOpen(false); setChatInput(''); handleSend('/approve'); return }
          const opts = ['CREATE_TASK', 'CREATE_ORCHESTRATOR']
          setChatTargetMode(opts[chatMenuSel])
          setChatMenuOpen(false)
          setChatInput('')
          if (chatMenuSel === 0) setMessages([{ role: 'system', text: '[SYSTEM] Warning: This will create a new session/task.' }])
          else if (chatMenuSel === 1) setMessages([{ role: 'system', text: '[SYSTEM] Warning: This will create a brand new Orchestrator.' }])
          return
        }
        return
      }
      if (key.shift && (key.leftArrow || key.rightArrow)) { setChatTab(t => t === 'chat' ? 'notes' : 'chat'); return }
      if (key.pageUp)   { setScrollOffset(o => o + 5); return }
      if (key.pageDown) { setScrollOffset(o => Math.max(0, o - 5)); return }
      return
    }

    // ── Diff mode ─────────────────────────────────────────────────
    if (mode === 'diff') {
      if (diffFocus === 'files') {
        if (key.leftArrow)  { setDiffFileSel(i => Math.max(0, i - 1)); return }
        if (key.rightArrow) { setDiffFileSel(i => i + 1); return }
        if (key.return)     { setDiffFocus('content'); return }
      } else {
        if (key.upArrow)    { setDiffScrollOffset(o => Math.max(0, o - 1)); return }
        if (key.downArrow)  { setDiffScrollOffset(o => o + 1); return }
        if (key.pageUp)     { setDiffScrollOffset(o => Math.max(0, o - 10)); return }
        if (key.pageDown)   { setDiffScrollOffset(o => o + 10); return }
      }
      return
    }

    // ── Graph mode ────────────────────────────────────────────────
    if (mode === 'graph') {
      if (graphViewMode === 'plan') {
        _handlePlanGraphNav({ key, savedDiagrams, planNodeSel, setPlanNodeSel })
        return
      }
      _handleLiveGraphNav({ key, graphSel, setGraphSel, graphNodes, openAgentChat, leftPanelWidth })
      return
    }

    // ── Table mode ────────────────────────────────────────────────
    if (mode === 'table') {
      if (key.upArrow)   { setSel(i => Math.max(0, i - 1)); return }
      if (key.downArrow) { setSel(i => Math.min(Math.max(0, AGENTS.length - 1), i + 1)); return }
      if (key.rightArrow) {
        const agent = AGENTS[sel]
        if (agent && (Array.isArray(agent.subAgents) || agent.isOrchestrator || agent.type === 'orchestrator'))
          toggleExpand(agent.id)
        return
      }
      if (key.leftArrow) {
        const agent = AGENTS[sel]
        if (agent) setExpandedIds(prev => { const next = new Set(prev); next.delete(agent.id); return next })
        return
      }
      if (key.return) { const agent = AGENTS[sel]; if (agent) openAgentChat(agent) }
    }
  })
}

// ── Plan graph navigation (extracted for readability) ─────────────
function _handlePlanGraphNav({ key, savedDiagrams, planNodeSel, setPlanNodeSel }) {
  const currentDiagram = savedDiagrams[0]
  if (!currentDiagram) return
  const nodes = currentDiagram.nodes || []
  if (nodes.length === 0) return

  const conns    = currentDiagram.connections || []
  const adj      = {}
  const inDeg    = {}
  const incoming = {}

  nodes.forEach(n => { adj[n] = []; inDeg[n] = 0; incoming[n] = [] })
  conns.forEach(c => {
    const [u, v] = c.split('->').map(s => s.trim())
    if (adj[u] && inDeg[v] !== undefined) { adj[u].push(v); inDeg[v]++; incoming[v].push(u) }
  })

  const baseTiers = []
  let cur = nodes.filter(n => inDeg[n] === 0)
  if (cur.length === 0) cur = [nodes[0]]
  const vis = new Set(cur)
  while (cur.length > 0) {
    baseTiers.push(cur)
    const nxt = []
    cur.forEach(u => adj[u].forEach(v => { if (!vis.has(v)) { vis.add(v); nxt.push(v) } }))
    cur = nxt
  }
  const uncon = nodes.filter(n => !vis.has(n))
  if (uncon.length > 0) baseTiers.push(uncon)

  const selNodeLabel = nodes[planNodeSel] || nodes[0]
  const activePath   = new Set([selNodeLabel])
  let curr = selNodeLabel
  while (curr) {
    const parents = incoming[curr] || []
    if (parents.length === 0) break
    curr = parents[0]; activePath.add(curr)
  }

  const tiers = []
  for (let t = 0; t < baseTiers.length; t++) {
    if (t === 0) { tiers.push(baseTiers[0]); continue }
    const prevActive = tiers[t - 1].filter(n => activePath.has(n))
    const allowed    = new Set()
    prevActive.forEach(p => (adj[p] || []).forEach(c => allowed.add(c)))
    const vis2 = baseTiers[t].filter(n => allowed.has(n))
    if (vis2.length > 0) tiers.push(vis2)
  }

  let selTier = 0; let selCol = 0
  outer: for (let t = 0; t < tiers.length; t++) {
    for (let c = 0; c < tiers[t].length; c++) {
      if (nodes.indexOf(tiers[t][c]) === planNodeSel) { selTier = t; selCol = c; break outer }
    }
  }

  if (key.leftArrow  && selCol > 0) { setPlanNodeSel(nodes.indexOf(tiers[selTier][selCol - 1])); return }
  if (key.rightArrow && selCol < tiers[selTier].length - 1) { setPlanNodeSel(nodes.indexOf(tiers[selTier][selCol + 1])); return }
  if (key.upArrow && selTier > 0) {
    const parents2 = incoming[selNodeLabel] || []
    if (parents2.length > 0) setPlanNodeSel(nodes.indexOf(parents2[0]))
    else setPlanNodeSel(nodes.indexOf(tiers[selTier - 1][Math.min(selCol, tiers[selTier - 1].length - 1)]))
    return
  }
  if (key.downArrow && selTier < tiers.length - 1) {
    setPlanNodeSel(nodes.indexOf(tiers[selTier + 1][0]))
  }
}

// ── Live graph navigation ─────────────────────────────────────────
function _handleLiveGraphNav({ key, graphSel, setGraphSel, graphNodes, openAgentChat, leftPanelWidth }) {
  const total       = graphNodes.length
  if (total === 0) return
  const usableWidth = Math.max(20, (leftPanelWidth || 80) - 4)
  const CPR         = Math.max(1, Math.floor(usableWidth / (GRAPH_NODE_W + 1)))
  const totalRows   = Math.ceil(total / CPR)
  const currentRow  = Math.floor(graphSel / CPR)
  const currentCol  = graphSel % CPR

  if (key.leftArrow && currentCol > 0) { setGraphSel(currentRow * CPR + currentCol - 1); return }
  if (key.rightArrow) {
    const rowEnd = Math.min(CPR - 1, total - 1 - currentRow * CPR)
    if (currentCol < rowEnd) setGraphSel(currentRow * CPR + currentCol + 1)
    return
  }
  if (key.upArrow   && currentRow > 0)            { setGraphSel(Math.min((currentRow - 1) * CPR + currentCol, total - 1)); return }
  if (key.downArrow && currentRow < totalRows - 1) { setGraphSel(Math.min((currentRow + 1) * CPR + currentCol, total - 1)); return }
  if (key.return) { const agent = graphNodes[graphSel]; if (agent) openAgentChat(agent) }
}