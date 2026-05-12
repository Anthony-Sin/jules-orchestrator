import fs from 'fs'
import path from 'path'
import { sanitizeLog } from './sanitizer.js'

export function getAgentState() {
  const rootDir = process.cwd()
  const agentPath = path.join(rootDir, 'agent.md')
  if (fs.existsSync(agentPath)) {
    return fs.readFileSync(agentPath, 'utf8')
  }
  return null
}

export function writeAgentState(state) {
  const rootDir = process.cwd()
  const agentPath = path.join(rootDir, 'agent.md')
  fs.writeFileSync(agentPath, sanitizeLog(state), 'utf8')
}
