import { store } from '../../state/store.js'
import { sanitizeLog } from '../sanitizer.js'

export const update_tui_state = {
  name: 'update_tui_state',
  description: 'Send live progress updates to the TUI (status markers).',
  parameters: {
    type: 'object',
    properties: {
      status: { type: 'string', description: 'Current orchestrator status (e.g., PLANNING, IN_PROGRESS, AWAITING_USER_FEEDBACK)' },
      progressMessage: { type: 'string', description: 'A brief description of current progress' },
      child_agent_ids: { type: 'array', items: { type: 'string' }, description: 'Active worker session IDs' }
    },
    required: ['status']
  },
  execute: async (args) => {
    try {
      const state = store.get('orchestratorTuiState', {})
      const nextState = {
        ...state,
        status: args.status,
        progressMessage: sanitizeLog(args.progressMessage || state.progressMessage),
        child_agent_ids: args.child_agent_ids || state.child_agent_ids || [],
        last_active: Date.now()
      }
      store.set('orchestratorTuiState', nextState)
      return 'TUI state updated successfully.'
    } catch (e) {
      return `Error in update_tui_state: ${e.message}`
    }
  }
}
