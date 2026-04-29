import chalk from 'chalk'
import Table from 'cli-table3'
import { getSessions } from '../state/store.js'

export function renderDashboard(searchTerm = '') {
  console.clear()

  // ASCII art header closely matching the provided image
  const julesHeader = `
     ██╗██╗   ██╗██╗     ███████╗███████╗
     ██║██║   ██║██║     ██╔════╝██╔════╝
     ██║██║   ██║██║     █████╗  ███████╗
██   ██║██║   ██║██║     ██╔══╝  ╚════██║
╚█████╔╝╚██████╔╝███████╗███████╗███████║
 ╚════╝  ╚═════╝ ╚══════╝╚══════╝╚══════╝`

  console.log(chalk.magentaBright(julesHeader) + '\n')
  console.log(chalk.magentaBright('Welcome to Jules CLI!'))
  console.log('v0.1.42')
  console.log('What would you like to build today?\n')

  // Highlight the first character "S" to match the image prompt highlight
  console.log(chalk.bold.white('> ') + chalk.bgYellow.black('S') + chalk.dim('earch sessions or type / to use commands') + '\n')

  const table = new Table({
    head: [
      chalk.white.bold('ID'),
      chalk.white.bold('Description'),
      chalk.white.bold('Repo'),
      chalk.white.bold('Last active'),
      chalk.white.bold('Status'),
    ],
    colWidths: [8, 80, 40, 20, 20],
    style: { border: ['dim'], head: [] }, // Remove implicit colors
    chars: {
      top: '─', 'top-mid': '┬', 'top-left': '┌', 'top-right': '┐',
      bottom: '─', 'bottom-mid': '┴', 'bottom-left': '└', 'bottom-right': '┘',
      left: '│', 'left-mid': '├', mid: '─', 'mid-mid': '┼',
      right: '│', 'right-mid': '┤', middle: '│',
    },
  })

  let filteredSessions = sessions

  if (searchTerm && !searchTerm.startsWith('/')) {
    const term = searchTerm.toLowerCase()
    filteredSessions = sessions.filter(s =>
      (s.title && s.title.toLowerCase().includes(term)) ||
      (s.id && s.id.toLowerCase().includes(term)) ||
      (s.state && s.state.toLowerCase().includes(term))
    )
  }

  const displayed = filteredSessions.slice(-20).reverse()
  for (const s of displayed) {
    table.push([
      typeLabel(s.type || s.poolType),
      truncate(s.title, 34),
      colorState(s.state || 'UNKNOWN'),
      chalk.dim(ago(s.lastUpdated || s.createdAt)),
      chalk.dim(truncate(s.id, 16)),
    ])
  }

  function truncate(str, n) {
    if (!str) return ''
    return str.length > n ? str.slice(0, n - 3) + '...' : str
  }

  const sessions = getSessions()
  // The first item should be the most recently active.
  // The active session is at index 0
  const displayed = sessions.slice(-20).reverse()

  displayed.forEach((s, i) => {
    let id = truncate(s.id, 7)
    let desc = truncate(s.title, 78)
    let repo = truncate(s.repo, 38)
    let lastActive = ago(s.lastUpdated || s.createdAt)
    let stateRaw = s.state || 'UNKNOWN'
    let status = stateRaw.charAt(0).toUpperCase() + stateRaw.slice(1).toLowerCase()

    if (i === 0) {
      // Pad strings so the background color fills the cell.
      // -2 accounts for cli-table3's default left and right padding of 1 each.
      const pad = (str, width) => {
          str = str || ''
          return str + ' '.repeat(Math.max(0, width - str.length - 2))
      }
      id = chalk.bgMagenta.white(pad(id, 8))
      desc = chalk.bgMagenta.white(pad(desc, 80))
      repo = chalk.bgMagenta.white(pad(repo, 40))
      lastActive = chalk.bgMagenta.white(pad(lastActive, 20))
      status = chalk.bgMagenta.white(pad(status, 20))

      table.push([id, desc, repo, lastActive, status])
    } else {
      table.push([
        chalk.white(id),
        chalk.white(desc),
        chalk.white(repo),
        chalk.white(lastActive),
        chalk.white(status)
      ])
    }
  })

  console.log(table.toString())
}
