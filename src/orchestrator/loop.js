import { getGovernorConfig, setConfig } from '../state/store.js'
import { invokeGovernor } from './governor.js'
import { GOVERNOR_SYSTEM_PROMPT } from './system-prompt.js'
import * as tools from './tools/index.js'
import { checkStallAndTerminate, compactContext } from './watchdog.js'

// Convert tools export object into array for Gemini config
const toolDeclarations = Object.values(tools).filter(t => typeof t === 'object' && t.name)

export async function runOrchestratorLoop(initialPrompt) {
  const config = getGovernorConfig()
  let isOvernight = config.overnightMode

  // Update TUI state to indicate loop started
  tools.update_tui_state.execute({ status: 'PLANNING', progressMessage: 'Orchestrator starting...' })

  let loopHistory = []

  try {
    let currentPrompt = initialPrompt
    let iteration = 0

    while (iteration < 10) {
      iteration++

      if (checkStallAndTerminate()) {
        return 'Stalled and terminated.'
      }

      if (config.overnightMode) {
         tools.update_tui_state.execute({ status: 'IN_PROGRESS', progressMessage: `Overnight loop running. Iteration ${iteration}` })
      } else {
         tools.update_tui_state.execute({ status: 'IN_PROGRESS', progressMessage: `Fix-in-place loop. Iteration ${iteration}` })
      }

      loopHistory.push({ role: 'user', parts: [{ text: currentPrompt }] })
      loopHistory = compactContext(loopHistory)

      const response = await invokeGovernor(GOVERNOR_SYSTEM_PROMPT, currentPrompt, toolDeclarations)
      loopHistory.push({ role: 'agent', parts: [{ text: response.text }] })

      // Handle tool calls if any
      if (response.functionCalls && response.functionCalls.length > 0) {
        for (const call of response.functionCalls) {
          const tool = tools[call.name]
          if (tool) {
            const result = await tool.execute(call.args)
            currentPrompt = `Tool ${call.name} returned: ${result}`
          }
        }
      } else {
         tools.update_tui_state.execute({ status: 'COMPLETED', progressMessage: 'Orchestrator cycle finished.' })
         return response.text
      }
    }

    tools.update_tui_state.execute({ status: 'PAUSED', progressMessage: 'Loop limit reached.' })
    return 'Max iterations reached.'

  } catch (err) {
    if (err.message.includes('RATE_LIMIT_EXCEEDED')) {
      // Hibernate logic: Set next wake time + 30 mins
      setConfig('governorNextWakeTime', Date.now() + 30 * 60 * 1000)
      tools.update_tui_state.execute({ status: 'PAUSED', progressMessage: 'Rate limit hit. Hibernating 30m.' })
    } else {
      tools.update_tui_state.execute({ status: 'FAILED', progressMessage: `Error: ${err.message}` })
    }
    throw err
  }
}
