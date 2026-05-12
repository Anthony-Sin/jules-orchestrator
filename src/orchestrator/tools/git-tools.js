import { spawn } from 'child_process'
import util from 'util'

export async function runGit(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { shell: true })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', data => stdout += data.toString())
    proc.stderr.on('data', data => stderr += data.toString())
    proc.on('close', code => {
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(`Git error: ${stderr.trim()}`))
    })
  })
}

export const github_branch_manager = {
  name: 'github_branch_manager',
  description: 'Manage git branches for isolated worker testing.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'delete', 'squash_merge', 'list', 'current'] },
      branch_name: { type: 'string', description: 'Name of the branch (e.g., tmp/jules-[uuid])' },
      target_branch: { type: 'string', description: 'Target branch to merge into (e.g., main)' }
    },
    required: ['action']
  },
  execute: async (args) => {
    try {
      switch (args.action) {
        case 'create':
          await runGit(['checkout', '-b', args.branch_name])
          return `Created and switched to branch ${args.branch_name}`
        case 'delete':
          await runGit(['branch', '-D', args.branch_name])
          return `Deleted branch ${args.branch_name}`
        case 'squash_merge':
          await runGit(['checkout', args.target_branch || 'main'])
          await runGit(['merge', '--squash', args.branch_name])
          await runGit(['commit', '-m', `Merge ${args.branch_name} into ${args.target_branch || 'main'}`])
          await runGit(['branch', '-D', args.branch_name])
          return `Squash-merged ${args.branch_name} into ${args.target_branch || 'main'} and deleted branch.`
        case 'list':
          return await runGit(['branch', '-a'])
        case 'current':
          return await runGit(['branch', '--show-current'])
        default:
          throw new Error('Unknown action')
      }
    } catch (e) {
      return `Error in branch_manager: ${e.message}`
    }
  }
}
