import React from 'react'
import { Text } from 'ink'

const FRAMES = ['.', 'o', 'O', 'o']

export function InkSpinner({ tick = 0, color = 'redBright', dimColor = false }) {
  const frame = FRAMES[Math.abs(tick) % FRAMES.length]
  return React.createElement(Text, { color, dimColor }, frame)
}
