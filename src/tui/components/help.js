import React from 'react'
import { Box, Text } from 'ink'
import { THEME } from '../theme.js'

export function HelpScreen() {
  const row = (keys, desc, kc = THEME.accentSoft) =>
    React.createElement(Box, { flexDirection: 'row', marginBottom: 1, width: 58, minWidth: 0 },
      React.createElement(Box, { width: 22, justifyContent: 'flex-end', paddingRight: 2, minWidth: 0 },
        React.createElement(Text, { color: kc, bold: true, wrap: 'truncate' }, keys)
      ),
      React.createElement(Box, { flexGrow: 1, minWidth: 0 },
        React.createElement(Text, { color: THEME.text, wrap: 'truncate' }, desc)
      )
    )

  return React.createElement(Box, {
    flexGrow: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    borderStyle: 'round',
    borderColor: THEME.panelFocusBorder,
    marginX: 2,
    marginY: 1,
    overflow: 'hidden',
    minWidth: 0,
  },
    React.createElement(Box, { marginBottom: 2, minWidth: 0 },
      React.createElement(Text, { color: THEME.text, bold: true, wrap: 'truncate' },
        'JULES COLONY: QUICK REFERENCE')
    ),
    row('Alt + T', 'Focus Table Mode'),
    row('Alt + G', 'Focus Diff View (arrows nav, Enter open)'),
    row('Alt + E', 'Focus Chat Panel'),
    row('Alt + M', 'Change repository'),
    row('Alt + N', 'Toggle Notes / Chat tab'),
    row('Alt + H', 'Show / hide graph panel'),
    row('Up / Down', 'Navigate rows or graph cards'),
    row('Left / Right', 'Navigate graph cards / diff files'),
    row('Enter', 'Open agent chat or focus diff content'),
    row('/ in chat', 'Open action menu'),
    row('Alt + ?', 'Toggle this help screen', THEME.accent)
  )
}
