import chalk from 'chalk'
import { setConfig, getConfig } from '../state/store.js'

export function setupConfigCommands(program) {
  const configCmd = program.command('config').description('Manage orchestrator config')

  configCmd
    .command('set-key <apiKey>')
    .description('Set your Jules API key')
    .action((apiKey) => {
      setConfig('apiKey', apiKey)
      console.log(chalk.green('\n  ✓ API key saved.\n'))
    })

  configCmd
    .command('set-source <source>')
    .description('Set the Jules source (e.g. sources/github-owner-repo)')
    .action((source) => {
      setConfig('source', source)
      console.log(chalk.green(`\n  ✓ Source set to: ${source}\n`))
    })

  configCmd
    .command('set-branch <branch>')
    .description('Set the default branch (default: main)')
    .action((branch) => {
      setConfig('branch', branch)
      console.log(chalk.green(`\n  ✓ Branch set to: ${branch}\n`))
    })

  configCmd
    .command('set-auto-pr <value>')
    .description('Set auto-PR mode (true or false)')
    .action((value) => {
      const isAuto = value === 'true'
      setConfig('autoPr', isAuto)
      console.log(chalk.green(`\n  ✓ autoPr set to: ${isAuto}\n`))
    })

  configCmd
    .command('show')
    .description('Show current config')
    .action(() => {
      const cfg = getConfig()
      console.log(chalk.white('\n  Current config:'))
      const maskedKey = cfg.apiKey ? chalk.green('set') : chalk.red('not set');
      console.log(`  API key : ${maskedKey}`)
      console.log(`  Source  : ${cfg.source || chalk.dim('not set')}`)
      console.log(`  Branch  : ${cfg.branch || chalk.dim('main (default)')}`)
      console.log(`  Auto-PR : ${cfg.autoPr !== undefined ? (cfg.autoPr ? chalk.green('true') : chalk.red('false')) : chalk.dim('true (default)')}`)
      console.log()
    })
}
