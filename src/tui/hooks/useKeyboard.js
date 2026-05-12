import { useInput } from 'ink'
import { useRef } from 'react'
import { deleteSession } from '../../state/jules-api.js'
import { removeSession } from '../../state/store.js'

export function useKeyboard(p) {
  const isApplyingDiff = useRef(false)

  const {
    exit,
    mode, setMode,
    lastLeftMode,
    showHelp, setShowHelp,
    repoInputMode, setRepoInputMode,
    repoInput, setRepoInput,
    sourceSel, setSourceSel,       // <-- Added
    filteredSources,               // <-- Added
    sourcesList,
    handleRepoSubmit,
    sel, setSel,
    AGENTS,
    VISIBLE_AGENTS,
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
  } = p

  useInput(async (input, key) => {
    // ── NATIVE DROPDOWN FOCUS ──
    if (repoInputMode) {
      if (key.escape) {
        setRepoInputMode(false)
        return
      }

      if (repoInput.startsWith('/')) {
        if (key.upArrow) {
          if (setSourceSel) setSourceSel(prev => Math.max(0, prev - 1))
          return
        }
        if (key.downArrow) {
          const maxIdx = Math.max(0, (filteredSources?.length || 1) - 1)
          if (setSourceSel) setSourceSel(prev => Math.min(maxIdx, prev + 1))
          return
        }
      }
      
      return
    }

    if (key.ctrl && input === 'c') { exit(); return }
    if (key.meta && input === '?') { setShowHelp(v => !v); return }
    if (showHelp && (key.escape || (key.meta && input === '?'))) { setShowHelp(false); return }
    if (showHelp) return

    // ── OPTIMISTIC GHOST DELETION ──
    if (key.meta && input === 'd' && mode === 'table') {
      const agent = AGENTS[sel]
      if (agent) {
        flash(`Deleting session ${agent.id.substring(0, 6)}...`)
        
        // 1. Instantly wipe it locally so it disappears from UI
        removeSession(agent.id)
        setSel(s => Math.max(0, Math.min(s, AGENTS.length - 2))) // Eagerly move cursor up if at the bottom

        // 2. Try the network deletion in the background
        deleteSession(agent.id)
          .then(() => {
            flash(`Deleted session ${agent.id.substring(0, 6)}`)
          })
          .catch(err => {
            if (String(err).includes('404')) {
              flash(`Cleared local ghost session ${agent.id.substring(0, 6)}`)
            } else {
              flash(`Cleared locally, remote err: ${err.message}`)
            }
          })
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
        const textToRestore = Array.isArray(msg) ? (msg[0] || '') : (msg || '')
        setChatInput(textToRestore)
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
    if (key.meta && input === 'm') { setRepoInputMode(true); setRepoInput('/'); setSourceSel(0); return }
    if (key.meta && input === 'r') { setTick(t => t + 1); return }

    if (key.f4) { setRepoInputMode(true); setRepoInput('/'); setSourceSel(0); return }
    if (key.f1) { setMode('table'); return }
    if (key.f3) { setMode('chat'); return }

    if (key.escape) {
      if (startDialogOpen) {
        setStartDialogOpen(false)
        setChatTargetMode(selectedSessionId ? 'TALK_TO_SELECTED_AGENT' : 'CREATE_TASK')
        return
      }
      setMode('table')
      setChatMenuOpen(false)
      return
    }

    // ── PROPER TAB SWITCHING ──
    if (key.tab) {
      if (mode === 'diff') {
        if (diffFocus === 'files') setDiffFocus('content')
        else { setDiffFocus('files'); setMode('chat') }
      } else if (mode === 'chat' && lastLeftMode === 'diff') {
        setMode('diff')
        setDiffFocus('files')
      } else {
        setMode(m => {
          if (m === 'table') return 'chat'
          if (m === 'chat') return lastLeftMode
          return 'table'
        })
      }
      return
    }

    // ── CHAT LOGIC ──
    if (mode === 'chat') {
      if (chatMenuOpen) {
        if (key.escape) { setChatMenuOpen(false); setChatInput(''); return }
        if (key.upArrow) { setChatMenuSel(i => Math.max(0, i - 1)); return }
        if (key.downArrow) { setChatMenuSel(i => Math.min(2, i + 1)); return }
        if (key.return) {
          if (chatMenuSel === 2) {
            setMode('orchestrator')
            setChatMenuOpen(false)
            setChatInput('')
            return
          }
          if (chatMenuSel === 1) {
            setChatMenuOpen(false)
            setChatInput('')
            handleSend('/approve')
            return
          }

          const modeOption = 'CREATE_TASK'
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

    // ── PROPER DIFF NAVIGATION LOGIC ──
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
        if (key.return || key.downArrow) { setDiffFocus('content'); return }
      }
      return 
    }

    // ── TABLE LOGIC ──
    if (mode === 'table') {
      if (key.upArrow) { setSel(i => Math.max(0, i - 1)); return }
      if (key.downArrow) { setSel(i => Math.min(Math.max(0, p.allRows ? p.allRows.length - 1 : AGENTS.length - 1), i + 1)); return }
      if (key.rightArrow || key.leftArrow) {
        const row = p.allRows && p.allRows[sel]
        if (row && row.data && p.toggleNodeExpansion && row.hasChildren) {
          p.toggleNodeExpansion(row.data.id)
        }
        return
      }
      if (key.return) {
        const row = p.allRows && p.allRows[sel]
        const agent = row ? row.data : AGENTS[sel]
        if (agent) openAgentChat(agent)
      }
    }
  })
}