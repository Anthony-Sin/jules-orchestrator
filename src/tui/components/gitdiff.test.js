import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { render } from 'ink-testing-library'
import { EventEmitter } from 'events'

// Mock the API dependency
const mockGetAllActivities = mock.fn()
mock.module('../../state/jules-api.js', {
  namedExports: {
    getAllActivities: mockGetAllActivities,
  },
})

// Mock child_process
const mockSpawn = mock.fn()
mock.module('child_process', {
  namedExports: {
    spawn: mockSpawn
  }
})

const { GitDiffViewer, applyDiff } = await import('./gitdiff.js')

test('applyDiff tests', async (t) => {
  await t.test('successful apply --cached', async () => {
    mockSpawn.mock.resetCalls()
    const fakeChild = new EventEmitter()
    fakeChild.stderr = new EventEmitter()
    fakeChild.stdin = { write: mock.fn(), end: mock.fn() }

    mockSpawn.mock.mockImplementation(() => fakeChild)

    const diffPromise = applyDiff('some diff string')

    // wait a bit for dynamic import to resolve and spawn to be called
    await new Promise(r => setTimeout(r, 10))

    assert.equal(mockSpawn.mock.callCount(), 1)
    assert.deepEqual(mockSpawn.mock.calls[0].arguments, ['git', ['apply', '--cached']])
    assert.equal(fakeChild.stdin.write.mock.callCount(), 1)
    assert.equal(fakeChild.stdin.write.mock.calls[0].arguments[0], 'some diff string')
    assert.equal(fakeChild.stdin.end.mock.callCount(), 1)

    // Simulate success
    fakeChild.emit('close', 0)

    const res = await diffPromise
    assert.equal(res, true)
  })

  await t.test('fallback apply on error', async () => {
    mockSpawn.mock.resetCalls()

    const fakeChild1 = new EventEmitter()
    fakeChild1.stderr = new EventEmitter()
    fakeChild1.stdin = { write: mock.fn(), end: mock.fn() }

    const fakeChild2 = new EventEmitter()
    fakeChild2.stderr = new EventEmitter()
    fakeChild2.stdin = { write: mock.fn(), end: mock.fn() }

    let calls = 0
    mockSpawn.mock.mockImplementation(() => {
        calls++
        if (calls === 1) return fakeChild1
        return fakeChild2
    })

    const diffPromise = applyDiff('diff string 2')

    await new Promise(r => setTimeout(r, 10))

    assert.equal(mockSpawn.mock.callCount(), 1)
    assert.deepEqual(mockSpawn.mock.calls[0].arguments, ['git', ['apply', '--cached']])

    // Simulate failure on first try
    fakeChild1.emit('close', 1)

    // The fallback spawn is triggered in the close handler of the first process
    await new Promise(r => setTimeout(r, 10))

    assert.equal(mockSpawn.mock.callCount(), 2)
    assert.deepEqual(mockSpawn.mock.calls[1].arguments, ['git', ['apply']])

    assert.equal(fakeChild2.stdin.write.mock.callCount(), 1)
    assert.equal(fakeChild2.stdin.write.mock.calls[0].arguments[0], 'diff string 2')
    assert.equal(fakeChild2.stdin.end.mock.callCount(), 1)

    // Simulate success on second try
    fakeChild2.emit('close', 0)

    const res = await diffPromise
    assert.equal(res, true)
  })

  await t.test('failure on both attempts', async () => {
    mockSpawn.mock.resetCalls()

    const fakeChild1 = new EventEmitter()
    fakeChild1.stderr = new EventEmitter()
    fakeChild1.stdin = { write: mock.fn(), end: mock.fn() }

    const fakeChild2 = new EventEmitter()
    fakeChild2.stderr = new EventEmitter()
    fakeChild2.stdin = { write: mock.fn(), end: mock.fn() }

    let calls = 0
    mockSpawn.mock.mockImplementation(() => {
        calls++
        if (calls === 1) return fakeChild1
        return fakeChild2
    })

    const diffPromise = applyDiff('diff string 3')

    await new Promise(r => setTimeout(r, 10))

    // Simulate error output for first process
    fakeChild1.stderr.emit('data', Buffer.from('Error 1 '))
    fakeChild1.emit('close', 1)

    await new Promise(r => setTimeout(r, 10))

    // Simulate error output for second process
    fakeChild2.stderr.emit('data', Buffer.from('Error 2'))
    fakeChild2.emit('close', 1)

    try {
      await diffPromise
      assert.fail('Should have thrown an error')
    } catch (err) {
      assert.equal(err.message, 'Error 2') // uses fallErr if available
    }
  })
})

test('GitDiffViewer Component tests', async (t) => {
  await t.test('renders loading state initially', () => {
    mockGetAllActivities.mock.resetCalls()
    // create a promise that doesn't resolve to keep it in loading state
    mockGetAllActivities.mock.mockImplementation(() => new Promise(() => {}))

    const { lastFrame } = render(React.createElement(GitDiffViewer, { sessionId: 'test-session', width: 80, height: 24 }))

    assert.match(lastFrame(), /Loading diff\.\.\./)
  })

  await t.test('renders error state', async () => {
    mockGetAllActivities.mock.resetCalls()
    mockGetAllActivities.mock.mockImplementation(() => Promise.reject(new Error('Network failure')))

    const { lastFrame } = render(React.createElement(GitDiffViewer, { sessionId: 'test-session', width: 80, height: 24 }))

    // wait for promise rejection
    await new Promise(r => setTimeout(r, 10))

    assert.match(lastFrame(), /Error: Network failure/)
  })

  await t.test('renders empty state if no activities found', async () => {
    mockGetAllActivities.mock.resetCalls()
    mockGetAllActivities.mock.mockImplementation(() => Promise.resolve({ activities: [] }))

    const { lastFrame } = render(React.createElement(GitDiffViewer, { sessionId: 'test-session', width: 80, height: 24 }))

    // wait for promise resolution
    await new Promise(r => setTimeout(r, 10))

    assert.match(lastFrame(), /No code changes found in this session\./)
  })

  await t.test('renders empty state if no diff patches found', async () => {
    mockGetAllActivities.mock.resetCalls()
    mockGetAllActivities.mock.mockImplementation(() => Promise.resolve({ activities: [ { createTime: new Date().toISOString() } ] }))

    const { lastFrame } = render(React.createElement(GitDiffViewer, { sessionId: 'test-session', width: 80, height: 24 }))

    await new Promise(r => setTimeout(r, 10))

    assert.match(lastFrame(), /No code changes found in this session\./)
  })

  await t.test('renders parsed diff state properly', async () => {
    mockGetAllActivities.mock.resetCalls()

    const mockDiffString = `Index: src/test.js
===================================================================
--- src/test.js
+++ src/test.js
@@ -1,2 +1,2 @@
 console.log("hello")
-console.log("old")
+console.log("world")`

    const mockActivity = {
      createTime: new Date().toISOString(),
      artifacts: [
        {
          changeSet: {
            gitPatch: {
              unidiffPatch: mockDiffString
            }
          }
        }
      ]
    }

    mockGetAllActivities.mock.mockImplementation(() => Promise.resolve({ activities: [ mockActivity ] }))

    const setDiffFileSelMock = mock.fn()

    const { lastFrame } = render(React.createElement(GitDiffViewer, {
      sessionId: 'test-session',
      width: 100, // Make width larger so no '...' truncation happens on the tab name
      height: 24,
      fileSel: 0,
      diffFocus: 'files',
      setDiffFileSel: setDiffFileSelMock
    }))

    // wait for promise resolution and rendering
    await new Promise(r => setTimeout(r, 20))

    const frame = lastFrame()

    // Check that we render the file tab
    assert.match(frame, /\[src\/test\.js\]/)

    // Check that we render hunk header and diff lines
    assert.match(frame, /src\/test\.js → src\/test\.js/)
    assert.match(frame, /\+console\.log\("world"\)/)
    assert.match(frame, /\-console\.log\("old"\)/)
    assert.match(frame, /console\.log\("hello"\)/)
  })
})
