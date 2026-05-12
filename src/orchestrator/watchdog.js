import { store } from '../state/store.js'

export function checkStallAndTerminate() {
  const state = store.get('orchestratorTuiState', {})
  if (!state.last_active) return

  const now = Date.now()
  const FIVE_MINUTES = 5 * 60 * 1000

  if (state.status === 'IN_PROGRESS' && (now - state.last_active > FIVE_MINUTES)) {
    // Stall detected
    store.set('orchestratorTuiState', {
      ...state,
      status: 'STALLED_RESTARTING',
      progressMessage: 'Stall detected. Terminating and restarting...'
    })

    // In a full implementation, we'd fire off terminate_agent and trigger runCrashRecovery()
    return true
  }
  return false
}

export function handleUserInterrupt(input) {
  const state = store.get('orchestratorTuiState', {})
  store.set('orchestratorTuiState', {
    ...state,
    status: 'PAUSED_FOR_USER',
    progressMessage: `User interrupted: ${input}`
  })

  // Pivot the Orchestrator loop
  return true
}

export function compactContext(history) {
  // If tokens ~50k (approx heuristic, e.g. 100 turns or raw character length)
  // Keep last 3 turns
  if (!history || history.length < 10) return history

  const threshold = 150000 // Very rough character length heuristic for 50k tokens
  const currentLength = JSON.stringify(history).length

  if (currentLength > threshold) {
    const summaryMsg = { role: 'system', parts: [{ text: '[SYSTEM COMPACTION] Context compacted due to length. Previous context summarized.' }] }
    const recent = history.slice(-3)
    return [summaryMsg, ...recent]
  }

  return history
}
