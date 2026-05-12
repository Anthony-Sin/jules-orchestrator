import { spawn } from 'child_process'

export const shell_executor = {
  name: 'shell_executor',
  description: 'Execute shell commands like npm install, npm test, or build.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to run (e.g., npm test)' }
    },
    required: ['command']
  },
  execute: async (args) => {
    return new Promise((resolve) => {
      // Very basic allow-listing could go here
      const proc = spawn(args.command, { shell: true })
      let output = ''
      proc.stdout.on('data', data => output += data.toString())
      proc.stderr.on('data', data => output += data.toString())
      proc.on('close', code => {
        resolve({ output: output.trim(), exitCode: code })
      })
    })
  }
}
