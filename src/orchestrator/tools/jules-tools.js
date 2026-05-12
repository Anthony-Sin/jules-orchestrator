import * as julesApi from '../../state/jules-api.js'

export const jules_api_control = {
  name: 'jules_api_control',
  description: 'Manage Jules sessions: create, sendMessage, approvePlan, listActivities.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'sendMessage', 'approvePlan', 'listActivities'] },
      session_id: { type: 'string' },
      prompt: { type: 'string' },
      source: { type: 'string' },
      title: { type: 'string' },
      requirePlanApproval: { type: 'boolean' }
    },
    required: ['action']
  },
  execute: async (args) => {
    try {
      switch (args.action) {
        case 'create':
          if (!args.source || !args.prompt) throw new Error('source and prompt required')
          return await julesApi.createSession({
            source: args.source,
            prompt: args.prompt,
            title: args.title,
            requirePlanApproval: args.requirePlanApproval
          })
        case 'sendMessage':
          if (!args.session_id || !args.prompt) throw new Error('session_id and prompt required')
          await julesApi.sendMessage(args.session_id, args.prompt)
          return `Message sent to session ${args.session_id}`
        case 'approvePlan':
          if (!args.session_id) throw new Error('session_id required')
          await julesApi.approvePlan(args.session_id)
          return `Plan approved for session ${args.session_id}`
        case 'listActivities':
          if (!args.session_id) throw new Error('session_id required')
          return await julesApi.getSessionActivities(args.session_id)
        default:
          throw new Error('Unknown action')
      }
    } catch (e) {
      return `Error in jules_api_control: ${e.message}`
    }
  }
}
