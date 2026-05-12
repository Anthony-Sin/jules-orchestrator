import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import { getGovernorConfig, store } from '../../state/store.js'

export function OrchestratorDashboard() {
  const [config, setLocalConfig] = useState(() => getGovernorConfig())
  const [state, setLocalState] = useState(() => store.get('orchestratorTuiState', {}))

  useEffect(() => {
    const t = setInterval(() => {
      setLocalConfig(getGovernorConfig())
      setLocalState(store.get('orchestratorTuiState', {}))
    }, 1000)
    return () => clearInterval(t)
  }, [])

  return React.createElement(Box, { flexDirection: 'column', padding: 1 },
    React.createElement(Text, { color: 'green', bold: true }, '=== MANAGER ORCHESTRATOR ==='),
    React.createElement(Box, { height: 1 }),
    React.createElement(Text, { color: config.overnightMode ? 'magentaBright' : 'gray' }, `OVERNIGHT MODE: [${config.overnightMode ? 'ON' : 'OFF'}]`),
    React.createElement(Box, { height: 1 }),
    React.createElement(Text, { color: 'cyan' }, `API Calls (last hour): ${config.callsCount} / ${config.maxCalls}`),
    React.createElement(Box, { height: 1 }),
    React.createElement(Text, { dimColor: true }, `Status: ${state.status || 'IDLE'} - ${state.progressMessage || 'Waiting for commands.'}`)
  )
}
