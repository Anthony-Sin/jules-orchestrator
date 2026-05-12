import { GoogleGenAI } from '@google/genai'
import { updateGovernorApiCalls, getGovernorConfig, setConfig } from '../state/store.js'
import { getAgentState, writeAgentState } from './agent.js'
import { sanitizeLog } from './sanitizer.js'
import { getSessions } from '../state/store.js' // for resume/TUI checks if needed

let aiClient = null
function getClient() {
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  }
  return aiClient
}

export async function invokeGovernor(systemInstruction, userPrompt, tools = []) {
  if (!updateGovernorApiCalls()) {
    throw new Error('RATE_LIMIT_EXCEEDED: Governor API call limit reached (max 20/hour). Hibernating.')
  }

  const ai = getClient()
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: [
        { role: 'user', parts: [{ text: userPrompt }] }
      ],
      config: {
        systemInstruction,
        tools: tools.length > 0 ? [{ functionDeclarations: tools }] : undefined
      }
    })

    return response
  } catch (err) {
    if (err.status === 429) {
       throw new Error('RATE_LIMIT_EXCEEDED: 429 received from Gemini API. Hibernating.')
    }
    throw err
  }
}

export async function runCrashRecovery() {
  const agentMd = getAgentState()
  const sessions = getSessions()

  if (agentMd) {
    return 'Resuming previous orchestration session from agent.md...'
  }
  return 'Starting new orchestration session.'
}
