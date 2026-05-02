// ── components/help.js ───────────────────────────────────────────
// HelpScreen — full-screen key-binding reference overlay.

import React from 'react'
import { Box, Text } from 'ink'

export function HelpScreen() {
  const row = (keys, desc, kc = 'cyan') =>
    React.createElement(Box, { flexDirection: 'row', marginBottom: 1, width: 58, minWidth: 0 },
      React.createElement(Box, { width: 22, justifyContent: 'flex-end', paddingRight: 2, minWidth: 0 },
        React.createElement(Text, { color: kc, bold: true, wrap: 'truncate' }, keys)
      ),
      React.createElement(Box, { flexGrow: 1, minWidth: 0 },
        React.createElement(Text, { color: 'white', wrap: 'truncate' }, desc)
      )
    )

  return React.createElement(Box, {
    flexGrow: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    borderStyle: 'round', borderColor: 'cyan',
    marginX: 2, marginY: 1, overflow: 'hidden', minWidth: 0
  },
    React.createElement(Box, { marginBottom: 2, minWidth: 0 },
      React.createElement(Text, { color: 'whiteBright', bold: true, wrap: 'truncate' },
        '── JULES COLONY: QUICK REFERENCE ──')
    ),
    row('Alt + T',     'Focus Table Mode'),
    row('Alt + G',     'Focus Graph  (↑↓←→ nav  ↵ open chat)'),
    row('Alt + E',     'Focus Chat Panel'),
    row('Alt + M',     'Change working repository'),
    row('Alt + N',     'Toggle Notes / Chat tab'),
    row('Alt + H',     'Hide / Show Architecture Graph'),
    row('↑ / ↓',       'Navigate rows or graph cards'),
    row('← / →',       'Navigate graph cards left / right'),
    row('Enter',       'Open agent chat'),
    row('/ (in chat)', 'Open action menu'),
    row('Alt + ?',     'Toggle this help screen', 'cyanBright')
  )
}