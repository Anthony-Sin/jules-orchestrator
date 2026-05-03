import { test, describe, mock, after, before } from 'node:test'
import assert from 'node:assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let originalWrite;
let originalIsTTY;
let originalSetRawMode;

before(() => {
  // Set up globals to prevent Ink from crashing or hanging
  originalIsTTY = process.stdin.isTTY
  originalSetRawMode = process.stdin.setRawMode
  process.stdin.isTTY = true
  process.stdin.setRawMode = () => {}

  // Completely silence Ink output from tests
  originalWrite = process.stdout.write
  process.stdout.write = () => true
})

test('renderer.js exports version matching package.json', async () => {
  const { version } = await import('./renderer.js')
  const pkgPath = path.join(__dirname, '..', '..', 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))

  assert.strictEqual(version, pkg.version, 'Exported version should match package.json version')
})

describe('renderDashboard', () => {
  test('calls console.clear on first call and rerenders on subsequent calls', async () => {
    // We mock console.clear to verify it gets called only once
    const clearMock = mock.method(console, 'clear', () => {})

    // We also need to mock process.exit to prevent the app from randomly exiting during tests
    const exitMock = mock.method(process, 'exit', () => {})

    const renderer = await import('./renderer.js')

    // First call should initialize and call clear
    renderer.renderDashboard('first-call')

    // Allow React effects to settle
    await new Promise(resolve => setTimeout(resolve, 50))

    assert.strictEqual(clearMock.mock.calls.length, 1, 'console.clear should be called once on initialization')

    // Second call should rerender, not re-initialize (console.clear count remains 1)
    renderer.renderDashboard('second-call')

    // Allow React effects to settle
    await new Promise(resolve => setTimeout(resolve, 50))

    assert.strictEqual(clearMock.mock.calls.length, 1, 'console.clear should NOT be called again on rerender')

    // Cleanup mocks
    clearMock.mock.restore()
    exitMock.mock.restore()
  })
})

// Restore stdout and force process exit after all tests run to prevent hanging from Ink/React loops
after(() => {
  if (originalWrite) process.stdout.write = originalWrite
  if (originalIsTTY !== undefined) process.stdin.isTTY = originalIsTTY
  if (originalSetRawMode !== undefined) process.stdin.setRawMode = originalSetRawMode
  setTimeout(() => process.exit(0), 100)
})
