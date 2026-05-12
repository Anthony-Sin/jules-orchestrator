import { getGovernorConfig, setConfig } from '../state/store.js'
import { invokeGovernor } from './governor.js'
import { GOVERNOR_SYSTEM_PROMPT } from './system-prompt.js'
import * as tools from './tools/index.js'
import { checkStallAndTerminate, compactContext } from './watchdog.js'

// Convert tools export object into array for Gemini config
const toolDeclarations = Object.values(tools).filter(t => typeof t === 'object' && t.name)

import { upsertSession, appendLocalActivity } from '../state/store.js'

export async function runOrchestratorLoop(initialPrompt, sessionId) {
  const config = getGovernorConfig()
  let isOvernight = config.overnightMode

  upsertSession({ id: sessionId, state: 'PLANNING' })

  let loopHistory = []

  try {
    let currentPrompt = initialPrompt
    let iteration = 0

    while (iteration < 10) {
      iteration++

      if (checkStallAndTerminate(sessionId)) {
        return 'Stalled and terminated.'
      }

      upsertSession({ id: sessionId, state: 'IN_PROGRESS' })

      loopHistory.push({ role: 'user', parts: [{ text: currentPrompt }] })
      loopHistory = compactContext(loopHistory)

      // Store a local activity message
      appendLocalActivity(sessionId, {
        originator: 'agent',
        agentMessaged: { agentMessage: `[Orchestrator Loop] Iteration ${iteration}` },
        planGenerated: false
      })

      const response = await invokeGovernor(GOVERNOR_SYSTEM_PROMPT, currentPrompt, toolDeclarations)
      loopHistory.push({ role: 'agent', parts: [{ text: response.text }] })

      appendLocalActivity(sessionId, {
        originator: 'agent',
        agentMessaged: { agentMessage: response.text },
        planGenerated: false
      })

      // Handle tool calls if any
      if (response.functionCalls && response.functionCalls.length > 0) {
        for (const call of response.functionCalls) {
          const tool = tools[call.name]
          if (tool) {
            // pass sessionId into args so jules_api_control can use it as parentId if it creates tasks
            const result = await tool.execute({ ...call.args, _orchestratorSessionId: sessionId })
            currentPrompt = `Tool ${call.name} returned: ${result}`
          }
        }
      } else {
         upsertSession({ id: sessionId, state: 'COMPLETED' })
         return response.text
      }
    }

    upsertSession({ id: sessionId, state: 'PAUSED' })
    return 'Max iterations reached.'

  } catch (err) {
    if (err.message.includes('RATE_LIMIT_EXCEEDED')) {
      // Hibernate logic: Set next wake time + 30 mins
      setConfig('governorNextWakeTime', Date.now() + 30 * 60 * 1000)
      upsertSession({ id: sessionId, state: 'PAUSED' })
    } else {
      upsertSession({ id: sessionId, state: 'FAILED' })
    }
    throw err
  }
}
