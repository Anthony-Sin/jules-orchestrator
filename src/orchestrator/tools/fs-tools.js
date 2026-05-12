import fs from 'fs'
import path from 'path'

export const explore_codebase = {
  name: 'explore_codebase',
  description: 'List directory structures or read up to 5 files at a time.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'read'] },
      path: { type: 'string', description: 'Directory path to list' },
      files: { type: 'array', items: { type: 'string' }, description: 'Paths of files to read (max 5)' }
    },
    required: ['action']
  },
  execute: async (args) => {
    try {
      const root = process.cwd()
      if (args.action === 'list') {
        const target = path.resolve(root, args.path || '.')
        if (!target.startsWith(root)) throw new Error('Path traversal detected')
        const items = fs.readdirSync(target, { withFileTypes: true })
        return items.map(i => `${i.isDirectory() ? '[DIR] ' : '[FILE]'} ${i.name}`).join('\n')
      }

      if (args.action === 'read') {
        const filePaths = args.files || []
        if (filePaths.length > 5) throw new Error('Cannot read more than 5 files at once.')

        let output = ''
        for (const file of filePaths) {
          const target = path.resolve(root, file)
          if (!target.startsWith(root)) throw new Error(`Path traversal detected: ${file}`)
          const content = fs.readFileSync(target, 'utf8')
          output += `--- ${file} ---\n${content}\n\n`
        }
        return output
      }
    } catch (e) {
      return `Error in explore_codebase: ${e.message}`
    }
  }
}
