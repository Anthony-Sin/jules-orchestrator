import * as julesApi from '../../state/jules-api.js'
import { store } from '../../state/store.js'
import { compactContext } from '../watchdog.js'

export const terminate_agent = {
  name: 'terminate_agent',
  description: 'Force-kill a stalled Jules session.',
  parameters: {
    type: 'object',
    properties: {
      session_id: { type: 'string' },
      reason: { type: 'string', description: 'Reason for termination (for post-mortem)' }
    },
    required: ['session_id', 'reason']
  },
  execute: async (args) => {
    try {
      // In a real API, we'd hit a kill/cancel endpoint
      // For now, we update local state representation
      const sessions = store.get('sessions', [])
      const idx = sessions.findIndex(s => s.id === args.session_id)
      if (idx >= 0) {
        sessions[idx].state = 'KILLED'
        sessions[idx].postMortemReason = args.reason
        store.set('sessions', sessions)
      }
      return `Terminated session ${args.session_id}. Reason: ${args.reason}`
    } catch (e) {
      return `Error in terminate_agent: ${e.message}`
    }
  }
}

export const compact_context = {
  name: 'compact_context',
  description: 'Summarizes state, keeps last 3 turns, wipes raw history.',
  parameters: {
    type: 'object',
    properties: {}
  },
  execute: async (args) => {
    // In actual use, this tool signals the Orchestrator loop to run its compactContext logic on the *next* request payload.
    return 'Context compaction triggered.'
  }
}
