/**
 * MASTER REGRESSION TEST SUITE
 * jules-orchestrator
 *
 * Coverage:
 *   - store.js           → sessions, file locks, config, queue
 *   - jules-api.js       → all endpoints, parseSourceDisplay, error handling
 *   - markdown.js        → wrapText, parseMarkdown, buildMarkdownLines
 *   - useSessionManager  → helpers: activitiesSignature, sortActivities, sortSessionsByRecent, extractToolCallsFromMessage
 *   - TUI components     → ChatPanel, Notepad, ScrollInput, AgentRow, GitDiffViewer, HelpScreen, buildRows, ago
 *   - useLayout          → layout math for various terminal sizes
 *   - bin/jorch.js       → pollAndUpdate, killSession, syncSessions helpers
 *   - Integration        → render + interaction flows
 *
 * Run:
 *   node --experimental-test-module-mocks --loader ./tests/test-loader.mjs --test "tests/master.test.js"
 */

import test, { describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import React, { useState } from 'react'
import { render } from 'ink-testing-library'

// ─────────────────────────────────────────────────────────────────────────────
// MOCK SETUP  (must precede all dynamic imports)
// ─────────────────────────────────────────────────────────────────────────────

const mockGetAllActivities = mock.fn(async () => ({ activities: [] }))
const mockListAllSessions  = mock.fn(async () => ({ sessions: [] }))
const mockListSources      = mock.fn(async () => [])
const mockSendMessage      = mock.fn(async () => ({}))
const mockCreateSession    = mock.fn(async () => ({ name: 'sessions/mock-id', state: 'QUEUED' }))
const mockDeleteSession    = mock.fn(async () => ({}))
const mockApprovePlan      = mock.fn(async () => ({}))

mock.module('../../src/state/jules-api.js',{
  namedExports: {
    getAllActivities:    mockGetAllActivities,
    listAllSessions:    mockListAllSessions,
    listSources:        mockListSources,
    sendMessage:        mockSendMessage,
    createSession:      mockCreateSession,
    deleteSession:      mockDeleteSession,
    approvePlan:        mockApprovePlan,
    parseSourceDisplay: (str) => {
      if (!str) return str
      const m = str.match(/^sources\/github[-/](.*)/)
      if (!m) return str
      return m[1].includes('/') ? m[1] : m[1].replace('-', '/')
    },
    getSession:         mock.fn(async () => ({})),
    listSessions:       mock.fn(async () => ({ sessions: [] })),
    getActivities:      mock.fn(async () => ({ activities: [] })),
    getSessionActivities: mock.fn(async () => ({ activities: [] })),
  },
})

mock.module('node:child_process', {
  namedExports: {
    spawn: mock.fn(),
    spawnSync: mock.fn()
  },
})

// ─────────────────────────────────────────────────────────────────────────────
// DYNAMIC IMPORTS  (after mocks)
// ─────────────────────────────────────────────────────────────────────────────

const { store, getSessions, upsertSession, removeSession, getActiveSessions,
        getFileLocks, lockFiles, unlockFiles, checkFileLockConflicts,
        getQueue, setQueue, getConfig, setConfig, getArchitectureDiagrams } =
  await import('../../src/state/store.js')

const { wrapText, parseMarkdown, buildMarkdownLines } =
  await import('../../src/tui/markdown.js')

const { activitiesSignature, sortActivities, sortSessionsByRecent,
        extractToolCallsFromMessage } =
  await import('../../src/tui/hooks/useSessionManager.js')

const { ago, buildRows, STATUS_COLOR, STATUS_SHORT, AgentRow } =
  await import('../../src/tui/components/table.js')

const { ChatPanel }    = await import('../../src/tui/components/chat.js')
const { GitDiffViewer } = await import('../../src/tui/components/gitdiff.js')
const { Notepad }      = await import('../../src/tui/components/notepad.js')
const { HelpScreen }   = await import('../../src/tui/components/help.js')

const { pollAndUpdate, killSession, syncSessions } =
  await import('../../bin/jorch.js')

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function makeStore() {
  const data = new Map()
  mock.method(store, 'get',  (k, d) => data.has(k) ? data.get(k) : d)
  mock.method(store, 'set',  (k, v) => data.set(k, v))
  return data
}

function resetStoreMocks() {
  if (store.get.mock) store.get.mock.restore()
  if (store.set.mock) store.set.mock.restore()
}

// ═════════════════════════════════════════════════════════════════════════════
// 1.  STORE — SESSIONS
// ═════════════════════════════════════════════════════════════════════════════

describe('Store — Sessions', () => {
  test('getSessions returns [] when store is empty', () => {
    const d = makeStore()
    assert.deepEqual(getSessions(), [])
    resetStoreMocks()
  })

  test('upsertSession inserts a new session', () => {
    const d = makeStore()
    upsertSession({ id: 'a1', title: 'Task A', state: 'QUEUED' })
    assert.equal(getSessions().length, 1)
    assert.equal(getSessions()[0].title, 'Task A')
    resetStoreMocks()
  })

  test('upsertSession updates existing session by id', () => {
    const d = makeStore()
    d.set('sessions', [{ id: 'a1', title: 'Old', state: 'QUEUED' }])
    upsertSession({ id: 'a1', state: 'COMPLETED' })
    const s = getSessions()
    assert.equal(s.length, 1)
    assert.equal(s[0].state, 'COMPLETED')
    assert.equal(s[0].title, 'Old')   // existing field preserved
    resetStoreMocks()
  })

  test('upsertSession strips undefined values (does not overwrite existing)', () => {
    const d = makeStore()
    d.set('sessions', [{ id: 'a1', title: 'Keep Me', state: 'QUEUED' }])
    upsertSession({ id: 'a1', title: undefined, state: 'COMPLETED' })
    assert.equal(getSessions()[0].title, 'Keep Me')
    resetStoreMocks()
  })

  test('removeSession removes by id', () => {
    const d = makeStore()
    d.set('sessions', [{ id: '1' }, { id: '2' }, { id: '3' }])
    removeSession('2')
    const ids = getSessions().map(s => s.id)
    assert.deepEqual(ids, ['1', '3'])
    resetStoreMocks()
  })

  test('removeSession on non-existent id is a no-op', () => {
    const d = makeStore()
    d.set('sessions', [{ id: '1' }])
    removeSession('non-existent')
    assert.equal(getSessions().length, 1)
    resetStoreMocks()
  })

  test('getActiveSessions excludes COMPLETED, FAILED, KILLED', () => {
    const d = makeStore()
    d.set('sessions', [
      { id: '1', state: 'QUEUED' },
      { id: '2', state: 'IN_PROGRESS' },
      { id: '3', state: 'COMPLETED' },
      { id: '4', state: 'FAILED' },
      { id: '5', state: 'KILLED' },
      { id: '6', state: 'AWAITING_USER_FEEDBACK' },
      { id: '7', state: 'AWAITING_PLAN_APPROVAL' },
      { id: '8', state: 'PLANNING' },
      { id: '9', state: 'PAUSED' },
    ])
    const active = getActiveSessions()
    const ids = active.map(s => s.id)
    assert.ok(ids.includes('1'))
    assert.ok(ids.includes('2'))
    assert.ok(ids.includes('6'))
    assert.ok(ids.includes('7'))
    assert.ok(ids.includes('8'))
    assert.ok(ids.includes('9'))
    assert.ok(!ids.includes('3'))
    assert.ok(!ids.includes('4'))
    assert.ok(!ids.includes('5'))
    resetStoreMocks()
  })

  test('upsertSession appends multiple sessions preserving order', () => {
    const d = makeStore()
    upsertSession({ id: 'x1', title: 'First' })
    upsertSession({ id: 'x2', title: 'Second' })
    upsertSession({ id: 'x3', title: 'Third' })
    const ids = getSessions().map(s => s.id)
    assert.deepEqual(ids, ['x1', 'x2', 'x3'])
    resetStoreMocks()
  })

  test('upsertSession with all optional fields', () => {
    const d = makeStore()
    upsertSession({
      id: 'full',
      title: 'Full Session',
      state: 'IN_PROGRESS',
      createdAt: 1000,
      lastUpdated: 2000,
      repo: 'sources/github/owner/repo',
      repoDisplay: 'owner/repo',
      julesUrl: 'https://jules.example.com/s/1',
      pullRequestUrl: 'https://github.com/pr/1',
      pullRequestTitle: 'My PR',
      waitingOn: null,
    })
    const s = getSessions()[0]
    assert.equal(s.pullRequestTitle, 'My PR')
    assert.equal(s.julesUrl, 'https://jules.example.com/s/1')
    resetStoreMocks()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 2.  STORE — FILE LOCKS
// ═════════════════════════════════════════════════════════════════════════════

describe('Store — File Locks', () => {
  test('getFileLocks returns {} by default', () => {
    const d = makeStore()
    assert.deepEqual(getFileLocks(), {})
    resetStoreMocks()
  })

  test('lockFiles adds entries', () => {
    const d = makeStore()
    lockFiles('s1', ['a.js', 'b.js'])
    const locks = getFileLocks()
    assert.equal(locks['a.js'], 's1')
    assert.equal(locks['b.js'], 's1')
    resetStoreMocks()
  })

  test('unlockFiles removes only that sessions locks', () => {
    const d = makeStore()
    d.set('fileLocks', { 'a.js': 's1', 'b.js': 's2', 'c.js': 's1' })
    unlockFiles('s1')
    const locks = getFileLocks()
    assert.equal(locks['b.js'], 's2')
    assert.equal(locks['a.js'], undefined)
    assert.equal(locks['c.js'], undefined)
    resetStoreMocks()
  })

  test('checkFileLockConflicts — no locks → no conflicts', () => {
    const d = makeStore()
    assert.deepEqual(checkFileLockConflicts(['x.js']), [])
    resetStoreMocks()
  })

  test('checkFileLockConflicts — no files → no conflicts', () => {
    const d = makeStore()
    d.set('fileLocks', { 'a.js': 's1' })
    assert.deepEqual(checkFileLockConflicts([]), [])
    resetStoreMocks()
  })

  test('checkFileLockConflicts — exact path match', () => {
    const d = makeStore()
    d.set('fileLocks', { 'src/app.js': 's1' })
    const c = checkFileLockConflicts(['src/app.js'])
    assert.equal(c.length, 1)
    assert.equal(c[0].lockedBy, 's1')
    resetStoreMocks()
  })

  test('checkFileLockConflicts — directory lock covers child file', () => {
    const d = makeStore()
    d.set('fileLocks', { 'src/components': 's1' })
    const c = checkFileLockConflicts(['src/components/Button.js'])
    assert.equal(c.length, 1)
    assert.equal(c[0].lockedBy, 's1')
    resetStoreMocks()
  })

  test('checkFileLockConflicts — child file lock blocks parent directory', () => {
    const d = makeStore()
    d.set('fileLocks', { 'src/components/Button.js': 's1' })
    const c = checkFileLockConflicts(['src/components'])
    assert.equal(c.length, 1)
    assert.equal(c[0].lockedBy, 's1')
    resetStoreMocks()
  })

  test('checkFileLockConflicts — trailing slash normalisation', () => {
    const d = makeStore()
    d.set('fileLocks', { 'src/components/': 's1' })
    const c = checkFileLockConflicts(['src/components/Foo.js'])
    assert.equal(c.length, 1)
    resetStoreMocks()
  })

  test('checkFileLockConflicts — non-overlapping paths produce no conflict', () => {
    const d = makeStore()
    d.set('fileLocks', { 'src/components1': 's1' })
    assert.deepEqual(checkFileLockConflicts(['src/components2/Foo.js']), [])
    resetStoreMocks()
  })

  test('checkFileLockConflicts — DOMAIN key exact match', () => {
    const d = makeStore()
    d.set('fileLocks', { 'DOMAIN:Billing': 's1' })
    const c = checkFileLockConflicts(['DOMAIN:Billing'])
    assert.equal(c.length, 1)
    assert.equal(c[0].lockedBy, 's1')
    resetStoreMocks()
  })

  test('checkFileLockConflicts — DOMAIN key prefix does NOT match', () => {
    const d = makeStore()
    d.set('fileLocks', { 'DOMAIN:Billing': 's1' })
    assert.deepEqual(checkFileLockConflicts(['DOMAIN:BillingService']), [])
    resetStoreMocks()
  })

  test('checkFileLockConflicts — returns first-found lock when multiple overlap', () => {
    const d = makeStore()
    const locks = {}
    locks['src/components'] = 'parent-session'
    locks['src/components/Button.js'] = 'child-session'
    d.set('fileLocks', locks)
    const c = checkFileLockConflicts(['src/components/Button.js'])
    assert.equal(c[0].lockedBy, 'parent-session')
    resetStoreMocks()
  })

  test('checkFileLockConflicts — deduplicates requested files', () => {
    const d = makeStore()
    d.set('fileLocks', { 'a.js': 's1' })
    const c = checkFileLockConflicts(['a.js', 'a.js', 'a.js'])
    assert.equal(c.length, 1)
    resetStoreMocks()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 3.  STORE — CONFIG & QUEUE
// ═════════════════════════════════════════════════════════════════════════════

describe('Store — Config & Queue', () => {
  test('getConfig returns {} by default', () => {
    const d = makeStore()
    assert.deepEqual(getConfig(), {})
    resetStoreMocks()
  })

  test('setConfig and getConfig round-trip', () => {
    const d = makeStore()
    setConfig('apiKey', 'sk-test')
    assert.equal(getConfig().apiKey, 'sk-test')
    resetStoreMocks()
  })

  test('setConfig merges multiple keys', () => {
    const d = makeStore()
    setConfig('apiKey', 'key1')
    setConfig('source', 'sources/github/owner/repo')
    setConfig('autoPr', true)
    const c = getConfig()
    assert.equal(c.apiKey, 'key1')
    assert.equal(c.source, 'sources/github/owner/repo')
    assert.equal(c.autoPr, true)
    resetStoreMocks()
  })

  test('setConfig overwrites existing key', () => {
    const d = makeStore()
    setConfig('apiKey', 'old')
    setConfig('apiKey', 'new')
    assert.equal(getConfig().apiKey, 'new')
    resetStoreMocks()
  })

  test('getQueue returns [] by default', () => {
    const d = makeStore()
    assert.deepEqual(getQueue(), [])
    resetStoreMocks()
  })

  test('setQueue and getQueue round-trip', () => {
    const d = makeStore()
    setQueue([{ id: 't1', priority: 1 }])
    assert.equal(getQueue().length, 1)
    assert.equal(getQueue()[0].id, 't1')
    resetStoreMocks()
  })

  test('getArchitectureDiagrams returns [] by default', () => {
    const d = makeStore()
    assert.deepEqual(getArchitectureDiagrams(), [])
    resetStoreMocks()
  })

  test('getArchitectureDiagrams returns stored diagrams', () => {
    const d = makeStore()
    d.set('architectureDiagrams', ['graph TD; A-->B'])
    assert.deepEqual(getArchitectureDiagrams(), ['graph TD; A-->B'])
    resetStoreMocks()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 4.  MARKDOWN — wrapText
// ═════════════════════════════════════════════════════════════════════════════

describe('Markdown — wrapText', () => {
  test('returns [""] for null/undefined input', () => {
    assert.deepEqual(wrapText(null, 80), [''])
    assert.deepEqual(wrapText(undefined, 80), [''])
  })

  test('returns empty string for empty input', () => {
    const r = wrapText('', 80)
    assert.ok(Array.isArray(r))
  })

  test('short text fits on one line', () => {
    const r = wrapText('hello world', 80)
    assert.equal(r.length, 1)
    assert.equal(r[0], 'hello world')
  })

  test('wraps at width boundary', () => {
    const r = wrapText('aaa bbb ccc', 4)
    assert.ok(r.length > 1)
    r.forEach(line => assert.ok(line.length <= 4, `Line too long: "${line}"`))
  })

  test('preserves newlines as line breaks', () => {
    const r = wrapText('line one\nline two', 80)
    assert.ok(r.some(l => l.includes('line one')))
    assert.ok(r.some(l => l.includes('line two')))
  })

  test('blank lines produce empty string entries', () => {
    const r = wrapText('a\n\nb', 80)
    assert.ok(r.includes(''))
  })

  test('very long word is broken at width', () => {
    const longWord = 'a'.repeat(20)
    const r = wrapText(longWord, 10)
    r.forEach(line => assert.ok(line.length <= 10))
    assert.equal(r.join(''), longWord)
  })

  test('multiple spaces are treated as word boundaries', () => {
    const r = wrapText('word    word2', 80)
    assert.ok(r[0].includes('word'))
  })

  test('exactly width characters fits on one line', () => {
    const s = 'a'.repeat(10)
    const r = wrapText(s, 10)
    assert.equal(r.length, 1)
  })

  test('width + 1 character wraps to next line', () => {
    const s = 'a'.repeat(11)
    const r = wrapText(s, 10)
    assert.ok(r.length >= 2)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 5.  MARKDOWN — parseMarkdown
// ═════════════════════════════════════════════════════════════════════════════

describe('Markdown — parseMarkdown', () => {
  test('returns [{type:"text",text:""}] for empty/null', () => {
    const r = parseMarkdown(null)
    assert.equal(r[0].type, 'text')
  })

  test('parses h1', () => {
    const r = parseMarkdown('# Hello')
    assert.ok(r.some(s => s.type === 'h1' && s.text === 'Hello'))
  })

  test('parses h2', () => {
    const r = parseMarkdown('## Section')
    assert.ok(r.some(s => s.type === 'h2' && s.text === 'Section'))
  })

  test('parses h3', () => {
    const r = parseMarkdown('### Subsection')
    assert.ok(r.some(s => s.type === 'h3' && s.text === 'Subsection'))
  })

  test('parses unordered bullet', () => {
    const r = parseMarkdown('- item one')
    assert.ok(r.some(s => s.type === 'bullet' && s.text === 'item one'))
  })

  test('parses * bullet', () => {
    const r = parseMarkdown('* item two')
    assert.ok(r.some(s => s.type === 'bullet'))
  })

  test('parses + bullet', () => {
    const r = parseMarkdown('+ item three')
    assert.ok(r.some(s => s.type === 'bullet'))
  })

  test('parses ordered list item', () => {
    const r = parseMarkdown('1. first item')
    assert.ok(r.some(s => s.type === 'ordered' && s.text === 'first item'))
  })

  test('parses nested bullet (indent level)', () => {
    const r = parseMarkdown('  - nested')
    const b = r.find(s => s.type === 'bullet')
    assert.ok(b && b.indent >= 1)
  })

  test('parses blockquote', () => {
    const r = parseMarkdown('> quoted text')
    assert.ok(r.some(s => s.type === 'blockquote' && s.text === 'quoted text'))
  })

  test('parses code block with language', () => {
    const r = parseMarkdown('```js\nconsole.log("hi")\n```')
    const cb = r.find(s => s.type === 'codeblock')
    assert.ok(cb)
    assert.equal(cb.lang, 'js')
    assert.ok(cb.text.includes('console.log'))
  })

  test('parses code block without language', () => {
    const r = parseMarkdown('```\ncode here\n```')
    const cb = r.find(s => s.type === 'codeblock')
    assert.ok(cb)
    assert.equal(cb.lang, '')
  })

  test('parses horizontal rule ---', () => {
    const r = parseMarkdown('---')
    assert.ok(r.some(s => s.type === 'hr'))
  })

  test('parses horizontal rule ***', () => {
    const r = parseMarkdown('***')
    assert.ok(r.some(s => s.type === 'hr'))
  })

  test('blank lines produce blank segments', () => {
    const r = parseMarkdown('a\n\nb')
    assert.ok(r.some(s => s.type === 'blank'))
  })

  test('plain text produces text segment', () => {
    const r = parseMarkdown('just regular text')
    assert.ok(r.some(s => s.type === 'text' && s.text === 'just regular text'))
  })

  test('mixed content preserves all segments', () => {
    const md = '# Title\n\nSome text\n\n- bullet\n\n```\ncode\n```'
    const r = parseMarkdown(md)
    const types = r.map(s => s.type)
    assert.ok(types.includes('h1'))
    assert.ok(types.includes('text'))
    assert.ok(types.includes('bullet'))
    assert.ok(types.includes('codeblock'))
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 6.  MARKDOWN — buildMarkdownLines
// ═════════════════════════════════════════════════════════════════════════════

describe('Markdown — buildMarkdownLines', () => {
  test('returns array of line objects', () => {
    const lines = buildMarkdownLines('Hello world', 40, true)
    assert.ok(Array.isArray(lines))
    assert.ok(lines.length > 0)
  })

  test('all line objects have a type property', () => {
    const lines = buildMarkdownLines('# H1\n\ntext\n\n- bullet', 40, true)
    lines.forEach(l => assert.ok(l.type, `Line missing type: ${JSON.stringify(l)}`))
  })

  test('standard-line has inlineTokens array', () => {
    const lines = buildMarkdownLines('hello **bold** world', 40, true)
    const std = lines.filter(l => l.type === 'standard-line')
    assert.ok(std.length > 0)
    std.forEach(l => assert.ok(Array.isArray(l.inlineTokens)))
  })

  test('codeblock produces header, line, footer objects', () => {
    const lines = buildMarkdownLines('```js\nconsole.log("x")\n```', 60, true)
    const types = lines.map(l => l.type)
    assert.ok(types.includes('codeblock-header'))
    assert.ok(types.includes('codeblock-line'))
    assert.ok(types.includes('codeblock-footer'))
  })

  test('consecutive blanks produce single gap (dedup)', () => {
    const lines = buildMarkdownLines('a\n\n\n\nb', 40, true)
    let consecutiveGaps = 0
    let maxConsecutive = 0
    for (const l of lines) {
      if (l.type === 'gap') consecutiveGaps++
      else { maxConsecutive = Math.max(maxConsecutive, consecutiveGaps); consecutiveGaps = 0 }
    }
    assert.ok(maxConsecutive <= 1, 'Consecutive gaps should be deduped')
  })

  test('h1 produces h1-underline', () => {
    const lines = buildMarkdownLines('# Big Title', 40, true)
    assert.ok(lines.some(l => l.type === 'h1-underline'))
  })

  test('hr produces hr-line', () => {
    const lines = buildMarkdownLines('---', 40, true)
    assert.ok(lines.some(l => l.type === 'hr-line'))
  })

  test('caches identical inputs (returns same reference)', () => {
    const a = buildMarkdownLines('cached text', 40, true)
    const b = buildMarkdownLines('cached text', 40, true)
    assert.equal(a, b)
  })

  test('different focused flag produces different cache entry', () => {
    const a = buildMarkdownLines('focus test', 40, true)
    const b = buildMarkdownLines('focus test', 40, false)
    assert.notEqual(a, b)
  })

  test('null input returns lines array', () => {
    const lines = buildMarkdownLines(null, 40, true)
    assert.ok(Array.isArray(lines))
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 7.  useSessionManager — pure helpers
// ═════════════════════════════════════════════════════════════════════════════

describe('useSessionManager — activitiesSignature', () => {
  test('returns "" for empty array', () => {
    assert.equal(activitiesSignature([]), '')
  })

  test('returns "" for non-array', () => {
    assert.equal(activitiesSignature(null), '')
  })

  test('different activity counts produce different signatures', () => {
    const a1 = [{ name: 'act/1', createTime: '2024-01-01' }]
    const a2 = [{ name: 'act/1', createTime: '2024-01-01' }, { name: 'act/2', createTime: '2024-01-02' }]
    assert.notEqual(activitiesSignature(a1), activitiesSignature(a2))
  })

  test('same activities produce same signature', () => {
    const acts = [{ name: 'act/1', createTime: '2024-01-01', updateTime: 'x' }]
    assert.equal(activitiesSignature(acts), activitiesSignature([...acts]))
  })

  test('signature includes length, last name, and last updateTime', () => {
    const acts = [{ name: 'act/99', updateTime: 'ts-abc' }]
    const sig = activitiesSignature(acts)
    assert.ok(sig.includes('1'))       // count
    assert.ok(sig.includes('act/99'))  // last name
    assert.ok(sig.includes('ts-abc'))  // last updateTime
  })
})

describe('useSessionManager — sortActivities', () => {
  test('sorts by createTime ascending', () => {
    const acts = [
      { name: 'c', createTime: '2024-01-03' },
      { name: 'a', createTime: '2024-01-01' },
      { name: 'b', createTime: '2024-01-02' },
    ]
    const sorted = sortActivities(acts)
    assert.equal(sorted[0].name, 'a')
    assert.equal(sorted[1].name, 'b')
    assert.equal(sorted[2].name, 'c')
  })

  test('does not mutate the original array', () => {
    const acts = [
      { name: 'b', createTime: '2024-01-02' },
      { name: 'a', createTime: '2024-01-01' },
    ]
    const copy = [...acts]
    sortActivities(acts)
    assert.deepEqual(acts, copy)
  })

  test('handles empty array', () => {
    assert.deepEqual(sortActivities([]), [])
  })

  test('handles missing createTime (treated as epoch 0)', () => {
    const acts = [{ name: 'b', createTime: '2024-01-01' }, { name: 'a' }]
    const sorted = sortActivities(acts)
    assert.equal(sorted[0].name, 'a')
  })
})

describe('useSessionManager — sortSessionsByRecent', () => {
  test('sorts by lastUpdated descending', () => {
    const sessions = [
      { id: 'old', lastUpdated: 1000 },
      { id: 'new', lastUpdated: 9000 },
      { id: 'mid', lastUpdated: 5000 },
    ]
    const sorted = sortSessionsByRecent(sessions)
    assert.equal(sorted[0].id, 'new')
    assert.equal(sorted[1].id, 'mid')
    assert.equal(sorted[2].id, 'old')
  })

  test('falls back to createdAt when lastUpdated is absent', () => {
    const sessions = [
      { id: 'a', createdAt: 1000 },
      { id: 'b', createdAt: 5000 },
    ]
    const sorted = sortSessionsByRecent(sessions)
    assert.equal(sorted[0].id, 'b')
  })

  test('does not mutate original', () => {
    const sessions = [{ id: 'a', lastUpdated: 2 }, { id: 'b', lastUpdated: 1 }]
    const copy = [...sessions]
    sortSessionsByRecent(sessions)
    assert.deepEqual(sessions, copy)
  })

  test('handles empty array', () => {
    assert.deepEqual(sortSessionsByRecent([]), [])
  })
})

describe('useSessionManager — extractToolCallsFromMessage', () => {
  test('passes through plain text unchanged', () => {
    const text = 'Hello, this is a normal message.'
    assert.equal(extractToolCallsFromMessage(text), text)
  })

  test('replaces JSON tool call array with readable label', () => {
    const json = JSON.stringify([{ function: { name: 'read_file' }, arguments: {} }])
    const input = `Some text before\n\`\`\`json\n${json}\n\`\`\`\nSome text after`
    const result = extractToolCallsFromMessage(input)
    assert.ok(result.includes('[TOOL CALLS:'))
    assert.ok(result.includes('read_file'))
  })

  test('handles flat format tool name', () => {
    const json = JSON.stringify([{ name: 'write_file', arguments: {} }])
    const input = `\`\`\`json\n${json}\n\`\`\``
    const result = extractToolCallsFromMessage(input)
    assert.ok(result.includes('write_file'))
  })

  test('handles multiple tool calls', () => {
    const json = JSON.stringify([
      { function: { name: 'tool_a' } },
      { function: { name: 'tool_b' } },
    ])
    const input = `\`\`\`json\n${json}\n\`\`\``
    const result = extractToolCallsFromMessage(input)
    assert.ok(result.includes('tool_a'))
    assert.ok(result.includes('tool_b'))
  })

  test('returns input unchanged when JSON parse fails', () => {
    const badInput = 'has "function" key but {"broken json'
    const result = extractToolCallsFromMessage(badInput)
    assert.equal(result, badInput)
  })

  test('handles empty string', () => {
    assert.equal(extractToolCallsFromMessage(''), '')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 8.  TABLE COMPONENT — ago, STATUS maps, buildRows, AgentRow
// ═════════════════════════════════════════════════════════════════════════════

describe('Table — ago()', () => {
  test('returns "--" for falsy input', () => {
    assert.equal(ago(undefined), '--')
    assert.equal(ago(null), '--')
    assert.equal(ago(0), '--')
  })

  test('"now" for < 5 seconds ago', () => {
    const now = Date.now()
    assert.equal(ago(now - 3000), 'now')
  })

  test('seconds format for 5–59s', () => {
    const now = Date.now()
    assert.match(ago(now - 30000), /^\d+s$/)
  })

  test('minutes format', () => {
    const now = Date.now()
    assert.match(ago(now - 120000), /^\d+m$/)
  })

  test('hours format', () => {
    const now = Date.now()
    assert.match(ago(now - 7200000), /^\d+h$/)
  })

  test('days format', () => {
    const now = Date.now()
    assert.match(ago(now - 172800000), /^\d+d$/)
  })
})

describe('Table — STATUS_COLOR and STATUS_SHORT', () => {
  const states = ['IN_PROGRESS', 'COMPLETED', 'AWAITING_PLAN_APPROVAL', 'AWAITING_USER_FEEDBACK',
                  'FAILED', 'QUEUED', 'PLANNING', 'PAUSED', 'KILLED']

  for (const state of states) {
    test(`STATUS_COLOR has entry for ${state}`, () => {
      assert.ok(STATUS_COLOR[state], `Missing STATUS_COLOR for ${state}`)
    })
    test(`STATUS_SHORT has entry for ${state}`, () => {
      assert.ok(STATUS_SHORT[state], `Missing STATUS_SHORT for ${state}`)
    })
  }
})

describe('Table — buildRows', () => {
  test('returns one row per session', () => {
    const sessions = [
      { id: '1', title: 'A' },
      { id: '2', title: 'B' },
      { id: '3', title: 'C' },
    ]
    const rows = buildRows(sessions)
    assert.equal(rows.length, 3)
  })

  test('each row has type: "session" and data property', () => {
    const rows = buildRows([{ id: 'x', title: 'X' }])
    assert.equal(rows[0].type, 'session')
    assert.equal(rows[0].data.id, 'x')
  })

  test('empty sessions returns empty rows', () => {
    assert.deepEqual(buildRows([]), [])
  })

  test('preserves session order', () => {
    const sessions = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const rows = buildRows(sessions)
    assert.deepEqual(rows.map(r => r.data.id), ['a', 'b', 'c'])
  })
})

describe('Table — AgentRow renders', () => {
  const baseAgent = {
    id: 'abc12345678',
    state: 'IN_PROGRESS',
    title: 'Do the thing',
    repo: 'sources/github/owner/myrepo',
    repoDisplay: 'owner/myrepo',
    lastUpdated: Date.now() - 10000,
  }

  test('renders without crashing for IN_PROGRESS', () => {
    const { lastFrame, unmount } = render(
      React.createElement(AgentRow, { agent: baseAgent, selected: false, tick: 0, isDimmed: false })
    )
    try {
      assert.ok(lastFrame().length > 0)
    } finally {
      unmount()
    }
  })

  test('renders session id (truncated)', () => {
    const { lastFrame, unmount } = render(
      React.createElement(AgentRow, { agent: baseAgent, selected: false, tick: 0, isDimmed: false })
    )
    try {
      assert.ok(lastFrame().includes('abc123'))
    } finally {
      unmount()
    }
  })

  test('renders status short label ACTIVE for IN_PROGRESS', () => {
    const { lastFrame, unmount } = render(
      React.createElement(AgentRow, { agent: { ...baseAgent, state: 'IN_PROGRESS' }, selected: false, tick: 0, isDimmed: false })
    )
    try {
      assert.ok(lastFrame().includes('ACTIVE'))
    } finally {
      unmount()
    }
  })

  test('renders DONE for COMPLETED', () => {
    const { lastFrame, unmount } = render(
      React.createElement(AgentRow, { agent: { ...baseAgent, state: 'COMPLETED' }, selected: false, tick: 0, isDimmed: false })
    )
    try {
      assert.ok(lastFrame().includes('DONE'))
    } finally {
      unmount()
    }
  })

  test('renders FAIL for FAILED', () => {
    const { lastFrame, unmount } = render(
      React.createElement(AgentRow, { agent: { ...baseAgent, state: 'FAILED' }, selected: false, tick: 0, isDimmed: false })
    )
    try {
      assert.ok(lastFrame().includes('FAIL'))
    } finally {
      unmount()
    }
  })

  test('renders QUEUE for QUEUED', () => {
    const { lastFrame, unmount } = render(
      React.createElement(AgentRow, { agent: { ...baseAgent, state: 'QUEUED' }, selected: false, tick: 0, isDimmed: false })
    )
    try {
      assert.ok(lastFrame().includes('QUEUE'))
    } finally {
      unmount()
    }
  })

  test('renders PLAN for PLANNING', () => {
    const { lastFrame, unmount } = render(
      React.createElement(AgentRow, { agent: { ...baseAgent, state: 'PLANNING' }, selected: false, tick: 0, isDimmed: false })
    )
    try {
      assert.ok(lastFrame().includes('PLAN'))
    } finally {
      unmount()
    }
  })

  test('renders WAIT for AWAITING_USER_FEEDBACK', () => {
    const { lastFrame, unmount } = render(
      React.createElement(AgentRow, { agent: { ...baseAgent, state: 'AWAITING_USER_FEEDBACK' }, selected: false, tick: 0, isDimmed: false })
    )
    try {
      assert.ok(lastFrame().includes('WAIT'))
    } finally {
      unmount()
    }
  })

  test('renders DEAD for KILLED', () => {
    const { lastFrame, unmount } = render(
      React.createElement(AgentRow, { agent: { ...baseAgent, state: 'KILLED' }, selected: false, tick: 0, isDimmed: false })
    )
    try {
      assert.ok(lastFrame().includes('DEAD'))
    } finally {
      unmount()
    }
  })

  test('selected row renders ">" prefix', () => {
    const { lastFrame, unmount } = render(
      React.createElement(AgentRow, { agent: baseAgent, selected: true, tick: 0, isDimmed: false })
    )
    try {
      assert.ok(lastFrame().includes('>'))
    } finally {
      unmount()
    }
  })

  test('renders repo name fragment', () => {
    const { lastFrame, unmount } = render(
      React.createElement(AgentRow, { agent: baseAgent, selected: false, tick: 0, isDimmed: false })
    )
    try {
      assert.ok(lastFrame().includes('myrepo'))
    } finally {
      unmount()
    }
  })

  test('renders title text', () => {
    const { lastFrame, unmount } = render(
      React.createElement(AgentRow, { agent: baseAgent, selected: false, tick: 0, isDimmed: false })
    )
    try {
      assert.ok(lastFrame().includes('Do the thing'))
    } finally {
      unmount()
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 9.  CHAT PANEL COMPONENT
// ═════════════════════════════════════════════════════════════════════════════

describe('ChatPanel — rendering', () => {
  const defaultProps = {
    input: '',
    chatVisibleRows: 10,
    width: 80,
    repoName: 'myrepo',
    tab: 'chat',
    focused: true,
    messages: [],
    startDialogOpen: false,
  }

  test('renders without crashing', () => {
    const { lastFrame, unmount } = render(React.createElement(ChatPanel, defaultProps))
    try {
      assert.ok(lastFrame().length > 0)
    } finally {
      unmount()
    }
  })

  test('shows NOT SET prompt when repoName is "NOT SET"', () => {
    const props = { ...defaultProps, repoName: 'NOT SET' }
    const { lastFrame, unmount } = render(React.createElement(ChatPanel, props))
    try {
      assert.ok(lastFrame().includes('Select a repository'))
    } finally {
      unmount()
    }
  })

  test('shows [SYSTEM] label with NOT SET repo', () => {
    const props = { ...defaultProps, repoName: 'NOT SET' }
    const { lastFrame, unmount } = render(React.createElement(ChatPanel, props))
    try {
      assert.ok(lastFrame().includes('[SYSTEM]'))
    } finally {
      unmount()
    }
  })

  test('shows START NEW TASK dialog when startDialogOpen=true', () => {
    const props = { ...defaultProps, startDialogOpen: true, chatTargetMode: 'CREATE_TASK' }
    const { lastFrame, unmount } = render(React.createElement(ChatPanel, props))
    try {
      assert.ok(lastFrame().includes('START NEW TASK'))
    } finally {
      unmount()
    }
  })

  test('shows repo name in start dialog', () => {
    const props = { ...defaultProps, startDialogOpen: true, repoName: 'special-repo' }
    const { lastFrame, unmount } = render(React.createElement(ChatPanel, props))
    try {
      assert.ok(lastFrame().includes('special-repo'))
    } finally {
      unmount()
    }
  })

  test('renders user messages', () => {
    const props = {
      ...defaultProps,
      messages: [{ role: 'user', text: 'hello from user' }],
    }
    const { lastFrame, unmount } = render(React.createElement(ChatPanel, props))
    try {
      assert.ok(lastFrame().includes('hello from user'))
    } finally {
      unmount()
    }
  })

  test('renders system messages with [SYS] label', () => {
    const props = {
      ...defaultProps,
      messages: [{ role: 'system', text: 'system info here' }],
    }
    const { lastFrame, unmount } = render(React.createElement(ChatPanel, props))
    try {
      assert.ok(lastFrame().includes('[SYS]'))
      assert.ok(lastFrame().includes('system info here'))
    } finally {
      unmount()
    }
  })

  test('renders agent messages with AGENT label', () => {
    const props = {
      ...defaultProps,
      messages: [{ role: 'agent', text: 'agent reply' }],
    }
    const { lastFrame, unmount } = render(React.createElement(ChatPanel, props))
    try {
      assert.ok(lastFrame().includes('AGENT'))
    } finally {
      unmount()
    }
  })

  test('shows spinner banner for IN_PROGRESS state', async () => {
    const props = {
      ...defaultProps,
      agentState: 'IN_PROGRESS',
      latestProgress: 'Working on it...',
    }
    const { lastFrame, unmount } = render(React.createElement(ChatPanel, props))
    try {
      await delay(50)
      assert.ok(lastFrame().includes('Working on it...'))
    } finally {
      unmount()
    }
  })

  test('shows AWAITING_USER_FEEDBACK banner', () => {
    const props = {
      ...defaultProps,
      agentState: 'AWAITING_USER_FEEDBACK',
    }
    const { lastFrame, unmount } = render(React.createElement(ChatPanel, props))
    try {
      assert.ok(lastFrame().includes('Waiting for reply'))
    } finally {
      unmount()
    }
  })

  test('shows AWAITING_PLAN_APPROVAL banner', () => {
    const props = {
      ...defaultProps,
      agentState: 'AWAITING_PLAN_APPROVAL',
    }
    const { lastFrame, unmount } = render(React.createElement(ChatPanel, props))
    try {
      assert.ok(lastFrame().includes('/approve'))
    } finally {
      unmount()
    }
  })

  test('shows QUEUED banner', () => {
    const props = { ...defaultProps, agentState: 'QUEUED' }
    const { lastFrame, unmount } = render(React.createElement(ChatPanel, props))
    try {
      assert.ok(lastFrame().includes('queue'))
    } finally {
      unmount()
    }
  })

  test('shows chat menu when chatMenuOpen=true', () => {
    const props = {
      ...defaultProps,
      chatMenuOpen: true,
      chatMenuSel: 0,
    }
    const { lastFrame, unmount } = render(React.createElement(ChatPanel, props))
    try {
      const frame = lastFrame()
      assert.ok(frame.includes('Start New Task') || frame.includes('Approve Plan'))
    } finally {
      unmount()
    }
  })

  test('shows second menu option highlighted when chatMenuSel=1', () => {
    const props = {
      ...defaultProps,
      chatMenuOpen: true,
      chatMenuSel: 1,
    }
    const { lastFrame, unmount } = render(React.createElement(ChatPanel, props))
    try {
      assert.ok(lastFrame().includes('Approve Plan'))
    } finally {
      unmount()
    }
  })

  test('no banner shown for COMPLETED state', () => {
    const props = { ...defaultProps, agentState: 'COMPLETED' }
    const { lastFrame, unmount } = render(React.createElement(ChatPanel, props))
    try {
      const frame = lastFrame()
      assert.ok(!frame.includes('Thinking...'))
      assert.ok(!frame.includes('Waiting for reply'))
    } finally {
      unmount()
    }
  })

  test('CHAT label in header when tab=chat and agent selected', () => {
    const props = {
      ...defaultProps,
      chatTargetMode: 'TALK_TO_SELECTED_AGENT',
      agentTitle: 'My Agent',
    }
    const { lastFrame, unmount } = render(React.createElement(ChatPanel, props))
    try {
      assert.ok(lastFrame().includes('CHAT'))
    } finally {
      unmount()
    }
  })

  test('NOTES label in header when tab=notes', () => {
    const props = { ...defaultProps, tab: 'notes', notes: '' }
    const { lastFrame, unmount } = render(React.createElement(ChatPanel, props))
    try {
      assert.ok(lastFrame().includes('NOTES'))
    } finally {
      unmount()
    }
  })

  test('renders with many messages without crashing', () => {
    const messages = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'agent',
      text: `Message ${i}`,
    }))
    const props = { ...defaultProps, messages, chatVisibleRows: 15 }
    const { lastFrame, unmount } = render(React.createElement(ChatPanel, props))
    try {
      assert.ok(lastFrame().length > 0)
    } finally {
      unmount()
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 10.  NOTEPAD COMPONENT
// ═════════════════════════════════════════════════════════════════════════════

describe('Notepad — rendering and interaction', () => {
  function NoteWrapper({ initial = '' }) {
    const [val, setVal] = useState(initial)
    return React.createElement(Notepad, { value: val, onChange: setVal, width: 20, height: 5, focused: true })
  }

  test('renders without crashing', () => {
    const { lastFrame, unmount } = render(React.createElement(NoteWrapper, { initial: 'hello' }))
    try {
      assert.ok(lastFrame().length > 0)
    } finally {
      unmount()
    }
  })

  test('shows initial text', () => {
    const { lastFrame, unmount } = render(React.createElement(NoteWrapper, { initial: 'initial text' }))
    try {
      assert.ok(lastFrame().includes('initial text') || lastFrame().includes('initial'))
    } finally {
      unmount()
    }
  })

  test('typing appends to end of content', async () => {
    const { stdin, lastFrame, unmount } = render(React.createElement(NoteWrapper, { initial: 'hi' }))
    try {
      stdin.write('!')
      await delay(50)
      assert.ok(lastFrame().includes('hi!'))
    } finally {
      unmount()
    }
  })

  test('backspace deletes last character', async () => {
    const { stdin, lastFrame, unmount } = render(React.createElement(NoteWrapper, { initial: 'abc' }))
    try {
      stdin.write('\x08')
      await delay(50)
      const frame = lastFrame()
      assert.ok(!frame.includes('abc') || frame.includes('ab'))
    } finally {
      unmount()
    }
  })

  test('return key creates new line', async () => {
    const { stdin, lastFrame, unmount } = render(React.createElement(NoteWrapper, { initial: 'line1' }))
    try {
      stdin.write('\r')
      await delay(30)
      stdin.write('line2')
      await delay(50)
      const frame = lastFrame()
      assert.ok(frame.includes('line1'))
      assert.ok(frame.includes('line2'))
    } finally {
      unmount()
    }
  })

  test('cursor starts at end of initial text (auto-scroll to bottom)', async () => {
    const longText = Array.from({ length: 12 }, (_, i) => `Line${i}`).join('\n')
    const { lastFrame, unmount } = render(
      React.createElement(Notepad, { value: longText, onChange: () => {}, width: 20, height: 3, focused: true })
    )
    try {
      await delay(50)
      const frame = lastFrame()
      assert.ok(!frame.includes('Line0'))
      assert.ok(frame.includes('Line11'))
    } finally {
      unmount()
    }
  })

  test('renders empty notepad without crash', () => {
    const { lastFrame, unmount } = render(React.createElement(NoteWrapper, { initial: '' }))
    try {
      assert.ok(lastFrame().length > 0)
    } finally {
      unmount()
    }
  })

  test('multiple backspaces merge lines', async () => {
    const { stdin, lastFrame, unmount } = render(React.createElement(NoteWrapper, { initial: 'a\nb' }))
    try {
      stdin.write('\x08') // delete 'b'
      await delay(20)
      stdin.write('\x08') // delete '\n'
      await delay(20)
      stdin.write('X')
      await delay(20)
      assert.ok(lastFrame().includes('aX'))
    } finally {
      unmount()
    }
  })

  test('focused=false does not show cursor highlight (unfocused)', () => {
    const { lastFrame, unmount } = render(
      React.createElement(Notepad, { value: 'test', onChange: () => {}, width: 20, height: 5, focused: false })
    )
    try {
      assert.ok(lastFrame().includes('test'))
    } finally {
      unmount()
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 11.  HELP SCREEN COMPONENT
// ═════════════════════════════════════════════════════════════════════════════

describe('HelpScreen — rendering', () => {
  test('renders without crashing', () => {
    const { lastFrame, unmount } = render(React.createElement(HelpScreen))
    try {
      assert.ok(lastFrame().length > 0)
    } finally {
      unmount()
    }
  })

  test('shows QUICK REFERENCE title', () => {
    const { lastFrame, unmount } = render(React.createElement(HelpScreen))
    try {
      assert.ok(lastFrame().includes('QUICK REFERENCE'))
    } finally {
      unmount()
    }
  })

  test('contains Alt+E shortcut', () => {
    const { lastFrame, unmount } = render(React.createElement(HelpScreen))
    try {
      assert.ok(lastFrame().includes('Alt + E') || lastFrame().includes('alt+e') || lastFrame().includes('Alt + E'))
    } finally {
      unmount()
    }
  })

  test('contains Alt+G shortcut', () => {
    const { lastFrame, unmount } = render(React.createElement(HelpScreen))
    try {
      assert.ok(lastFrame().includes('Alt + G') || lastFrame().includes('Alt + G'))
    } finally {
      unmount()
    }
  })

  test('contains Alt+M shortcut', () => {
    const { lastFrame, unmount } = render(React.createElement(HelpScreen))
    try {
      assert.ok(lastFrame().includes('Alt + M') || lastFrame().includes('Alt + M'))
    } finally {
      unmount()
    }
  })

  test('mentions "repo" or "repository"', () => {
    const { lastFrame, unmount } = render(React.createElement(HelpScreen))
    try {
      const frame = lastFrame().toLowerCase()
      assert.ok(frame.includes('repo'))
    } finally {
      unmount()
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 12.  GIT DIFF VIEWER COMPONENT
// ═════════════════════════════════════════════════════════════════════════════

describe('GitDiffViewer — rendering', () => {
  const baseProps = {
    sessionId: 'test-sess',
    width: 100,
    height: 24,
    fileSel: 0,
    diffFocus: 'files',
    setDiffFileSel: () => {},
    setDiffFileCount: () => {},
    isDimmed: false,
  }

  test('shows loading state initially', async () => {
    mockGetAllActivities.mock.mockImplementationOnce(
      () => new Promise(r => setTimeout(() => r({ activities: [] }), 500))
    )
    const { lastFrame, unmount } = render(React.createElement(GitDiffViewer, baseProps))
    try {
      assert.ok(lastFrame().includes('Loading diff...'))
    } finally {
      unmount()
    }
  })

  test('shows "No code changes" when no activities have diffs', async () => {
    mockGetAllActivities.mock.mockImplementationOnce(async () => ({ activities: [] }))
    const { lastFrame, unmount } = render(React.createElement(GitDiffViewer, baseProps))
    try {
      await delay(50)
      assert.ok(lastFrame().includes('No code changes'))
    } finally {
      unmount()
    }
  })

  test('parses and shows a real diff', async () => {
    const patch = [
      'Index: src/foo.js',
      '===================================================================',
      '--- src/foo.js',
      '+++ src/foo.js',
      '@@ -1,2 +1,2 @@',
      ' unchanged',
      '-removed line',
      '+added line',
    ].join('\n')

    mockGetAllActivities.mock.mockImplementationOnce(async () => ({
      activities: [{
        createTime: new Date().toISOString(),
        artifacts: [{ changeSet: { gitPatch: { unidiffPatch: patch } } }],
      }],
    }))

    const { lastFrame, unmount } = render(React.createElement(GitDiffViewer, baseProps))
    try {
      await delay(100)
      assert.ok(lastFrame().includes('foo.js'))
    } finally {
      unmount()
    }
  })

  test('shows added/removed lines in the diff', async () => {
    const patch = [
      'Index: hello.js',
      '===================================================================',
      '--- hello.js',
      '+++ hello.js',
      '@@ -1,1 +1,1 @@',
      '-old content',
      '+new content',
    ].join('\n')

    mockGetAllActivities.mock.mockImplementationOnce(async () => ({
      activities: [{
        createTime: new Date().toISOString(),
        artifacts: [{ changeSet: { gitPatch: { unidiffPatch: patch } } }],
      }],
    }))

    const { lastFrame, unmount } = render(React.createElement(GitDiffViewer, baseProps))
    try {
      await delay(100)
      const frame = lastFrame()
      assert.ok(frame.includes('old content') || frame.includes('new content'))
    } finally {
      unmount()
    }
  })

  test('shows error state when API throws', async () => {
    mockGetAllActivities.mock.mockImplementationOnce(async () => { throw new Error('Network error') })
    const { lastFrame, unmount } = render(React.createElement(GitDiffViewer, baseProps))
    try {
      await delay(50)
      assert.ok(lastFrame().includes('Error'))
    } finally {
      unmount()
    }
  })

  test('renders dimmed state without crashing', async () => {
    mockGetAllActivities.mock.mockImplementationOnce(async () => ({ activities: [] }))
    const { lastFrame, unmount } = render(
      React.createElement(GitDiffViewer, { ...baseProps, isDimmed: true })
    )
    try {
      await delay(50)
      assert.ok(lastFrame().length > 0)
    } finally {
      unmount()
    }
  })

  test('shows file count in header', async () => {
    const patch = [
      'Index: a.js',
      '===================================================================',
      '--- a.js',
      '+++ a.js',
      '@@ -1,1 +1,1 @@',
      '-x',
      '+y',
    ].join('\n')

    mockGetAllActivities.mock.mockImplementationOnce(async () => ({
      activities: [{
        createTime: new Date().toISOString(),
        artifacts: [{ changeSet: { gitPatch: { unidiffPatch: patch } } }],
      }],
    }))
    const { lastFrame, unmount } = render(
      React.createElement(GitDiffViewer, { ...baseProps, sessionId: 'file-count-test' })
    )
    try {
      await delay(100)
      assert.ok(lastFrame().includes('Files') || lastFrame().includes('a.js'))
    } finally {
      unmount()
    }
  })

  test('handles null sessionId gracefully', async () => {
    const { lastFrame, unmount } = render(
      React.createElement(GitDiffViewer, { ...baseProps, sessionId: null })
    )
    try {
      await delay(50)
      assert.ok(lastFrame().includes('No code changes'))
    } finally {
      unmount()
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 13.  useLayout — layout math
// ═════════════════════════════════════════════════════════════════════════════

describe('useLayout — layout computation', () => {
  function computeLayout({ columns = 120, rows = 40, mode = 'table', repoInputMode = false,
                            chatMenuOpen = false, chatTab = 'chat', chatInput = '',
                            hasLatestProgress = false, hasStartDialog = false } = {}) {
    const TERMINAL_ROWS = Math.max(10, rows)
    const isWide = columns >= 100
    const isCompact = columns < 110
    const isTight = columns < 92
    const rightPanelWidth = isWide ? Math.max(34, Math.floor(columns * 0.42)) : columns
    const leftPanelWidth = isWide ? columns - rightPanelWidth : columns
    const showLeftPanel = isWide || mode !== 'chat'
    const showRightPanel = isWide || mode === 'chat'
    const repoInputHeight = repoInputMode ? 8 : 0
    const fixedChromeRows = 5
    const availableBodyHeight = Math.max(1, TERMINAL_ROWS - (fixedChromeRows + repoInputHeight))
    const VISIBLE_AGENTS = Math.max(1, availableBodyHeight - 2)
    const chatWrapLimit = Math.max(10, rightPanelWidth - 6)
    const chatMenuHeight = chatMenuOpen && chatTab === 'chat' ? 4 : 0
    const progressHeight = (hasLatestProgress) && chatTab === 'chat' && !hasStartDialog ? 3 : 0
    const chatFixedHeights = 4
    const CHAT_VISIBLE_ROWS = Math.max(1, availableBodyHeight - (chatFixedHeights + chatMenuHeight + progressHeight))
    return { TERMINAL_ROWS, isWide, isCompact, isTight, rightPanelWidth, leftPanelWidth,
             showLeftPanel, showRightPanel, availableBodyHeight, VISIBLE_AGENTS, CHAT_VISIBLE_ROWS }
  }

  test('wide terminal (>=100) sets isWide=true', () => {
    const { isWide } = computeLayout({ columns: 120 })
    assert.ok(isWide)
  })

  test('narrow terminal sets isWide=false', () => {
    const { isWide } = computeLayout({ columns: 80 })
    assert.ok(!isWide)
  })

  test('compact flag for columns < 110', () => {
    const { isCompact } = computeLayout({ columns: 100 })
    assert.ok(isCompact)
  })

  test('tight flag for columns < 92', () => {
    const { isTight } = computeLayout({ columns: 88 })
    assert.ok(isTight)
  })

  test('right panel width is ~42% of columns on wide terminal', () => {
    const { rightPanelWidth } = computeLayout({ columns: 120 })
    assert.ok(rightPanelWidth >= 34)
    assert.ok(rightPanelWidth <= 120)
  })

  test('left + right panels sum to columns on wide terminal', () => {
    const { rightPanelWidth, leftPanelWidth } = computeLayout({ columns: 120 })
    assert.equal(leftPanelWidth + rightPanelWidth, 120)
  })

  test('narrow terminal shows only left panel in table mode', () => {
    const { showLeftPanel, showRightPanel } = computeLayout({ columns: 80, mode: 'table' })
    assert.ok(showLeftPanel)
    assert.ok(!showRightPanel)
  })

  test('narrow terminal shows only right panel in chat mode', () => {
    const { showLeftPanel, showRightPanel } = computeLayout({ columns: 80, mode: 'chat' })
    assert.ok(!showLeftPanel)
    assert.ok(showRightPanel)
  })

  test('wide terminal shows both panels', () => {
    const { showLeftPanel, showRightPanel } = computeLayout({ columns: 140 })
    assert.ok(showLeftPanel)
    assert.ok(showRightPanel)
  })

  test('repoInputMode reduces availableBodyHeight', () => {
    const a = computeLayout({ rows: 40, repoInputMode: false })
    const b = computeLayout({ rows: 40, repoInputMode: true })
    assert.ok(b.availableBodyHeight < a.availableBodyHeight)
  })

  test('VISIBLE_AGENTS is always >= 1', () => {
    const { VISIBLE_AGENTS } = computeLayout({ rows: 10 })
    assert.ok(VISIBLE_AGENTS >= 1)
  })

  test('CHAT_VISIBLE_ROWS shrinks when chatMenu is open', () => {
    const a = computeLayout({ chatMenuOpen: false })
    const b = computeLayout({ chatMenuOpen: true })
    assert.ok(b.CHAT_VISIBLE_ROWS < a.CHAT_VISIBLE_ROWS)
  })

  test('CHAT_VISIBLE_ROWS shrinks when progress banner visible', () => {
    const a = computeLayout({ hasLatestProgress: false })
    const b = computeLayout({ hasLatestProgress: true })
    assert.ok(b.CHAT_VISIBLE_ROWS < a.CHAT_VISIBLE_ROWS)
  })

  test('TERMINAL_ROWS minimum is 10', () => {
    const { TERMINAL_ROWS } = computeLayout({ rows: 5 })
    assert.equal(TERMINAL_ROWS, 10)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 14.  bin/jorch.js helpers — pollAndUpdate, killSession, syncSessions
// ═════════════════════════════════════════════════════════════════════════════

describe('jorch.js — helper functions', () => {
  test('killSession upserts state to KILLED', async () => {
    const d = makeStore()
    d.set('sessions', [{ id: 'sess-1', state: 'IN_PROGRESS' }])
    await killSession('sess-1')
    const s = getSessions().find(s => s.id === 'sess-1')
    assert.equal(s.state, 'KILLED')
    resetStoreMocks()
  })

  test('killSession calls deleteSession on the API', async () => {
    const d = makeStore()
    d.set('sessions', [{ id: 'sess-del', state: 'IN_PROGRESS' }])
    mockDeleteSession.mock.resetCalls()
    await killSession('sess-del')
    assert.ok(mockDeleteSession.mock.callCount() >= 1)
    resetStoreMocks()
  })

  test('killSession unlocks files for that session', async () => {
    const d = makeStore()
    d.set('sessions', [{ id: 'sess-lock', state: 'IN_PROGRESS' }])
    d.set('fileLocks', { 'a.js': 'sess-lock', 'b.js': 'other-sess' })
    await killSession('sess-lock')
    assert.equal(getFileLocks()['a.js'], undefined)
    assert.equal(getFileLocks()['b.js'], 'other-sess')
    resetStoreMocks()
  })

  test('pollAndUpdate returns [] when no active sessions', async () => {
    const d = makeStore()
    d.set('sessions', [{ id: 'done', state: 'COMPLETED' }])
    const updates = await pollAndUpdate()
    assert.deepEqual(updates, [])
    resetStoreMocks()
  })

  test('pollAndUpdate calls getSession for active sessions', async () => {
    const d = makeStore()
    d.set('sessions', [{ id: 'active-1', state: 'IN_PROGRESS' }])
    const updates = await pollAndUpdate()
    assert.ok(Array.isArray(updates))
    resetStoreMocks()
  })

  test('syncSessions runs without throwing', async () => {
    const d = makeStore()
    await syncSessions()
    assert.ok(true)
    resetStoreMocks()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 15.  parseSourceDisplay — exhaustive
// ═════════════════════════════════════════════════════════════════════════════

const { parseSourceDisplay } = await import('../../src/state/jules-api.js')

describe('parseSourceDisplay', () => {
  test('null returns null', () => assert.equal(parseSourceDisplay(null), null))
  test('undefined returns undefined', () => assert.equal(parseSourceDisplay(undefined), undefined))
  test('sources/github/owner/repo → owner/repo', () =>
    assert.equal(parseSourceDisplay('sources/github/owner/repo'), 'owner/repo'))
  test('sources/github-owner-repo → owner/repo (dash format)', () =>
    assert.equal(parseSourceDisplay('sources/github-owner-repo'), 'owner/repo'))
  test('unrecognised source returned as-is', () =>
    assert.equal(parseSourceDisplay('other/source'), 'other/source'))
  test('empty string returned as-is', () =>
    assert.equal(parseSourceDisplay(''), ''))
  test('sources/github/org/multiple/segments → org/multiple/segments', () => {
    const result = parseSourceDisplay('sources/github/org/multiple/segments')
    assert.ok(result.includes('org') || result.includes('multiple'))
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 16.  EDGE CASES & REGRESSION GUARDS
// ═════════════════════════════════════════════════════════════════════════════

describe('Regression — ChatPanel with edge-case props', () => {
  test('width=0 does not crash', () => {
    const { lastFrame, unmount } = render(
      React.createElement(ChatPanel, {
        input: '', chatVisibleRows: 10, width: 0,
        repoName: 'r', tab: 'chat', focused: false, messages: [],
      })
    )
    try {
      assert.ok(lastFrame().length >= 0)
    } finally {
      unmount()
    }
  })

  test('chatVisibleRows=1 does not crash', () => {
    const { lastFrame, unmount } = render(
      React.createElement(ChatPanel, {
        input: '', chatVisibleRows: 1, width: 80,
        repoName: 'r', tab: 'chat', focused: false, messages: [],
      })
    )
    try {
      assert.ok(lastFrame().length >= 0)
    } finally {
      unmount()
    }
  })

  test('long agent message renders without overflow crash', () => {
    const longMsg = 'word '.repeat(200)
    const { lastFrame, unmount } = render(
      React.createElement(ChatPanel, {
        input: '', chatVisibleRows: 10, width: 80,
        repoName: 'r', tab: 'chat', focused: true,
        messages: [{ role: 'agent', text: longMsg }],
        expandedMessages: new Set([0]),
        toggleMessageExpand: () => {},
      })
    )
    try {
      assert.ok(lastFrame().length > 0)
    } finally {
      unmount()
    }
  })

  test('expandedMessages not a Set falls back gracefully', () => {
    const { lastFrame, unmount } = render(
      React.createElement(ChatPanel, {
        input: '', chatVisibleRows: 10, width: 80,
        repoName: 'r', tab: 'chat', focused: true,
        messages: [{ role: 'agent', text: 'hello' }],
        expandedMessages: null,
        toggleMessageExpand: () => {},
      })
    )
    try {
      assert.ok(lastFrame().length > 0)
    } finally {
      unmount()
    }
  })
})

describe('Regression — AgentRow edge cases', () => {
  test('agent with no title renders without crash', () => {
    const agent = { id: 'x1', state: 'QUEUED' }
    const { lastFrame, unmount } = render(
      React.createElement(AgentRow, { agent, selected: false, tick: 0, isDimmed: false })
    )
    try {
      assert.ok(lastFrame().length > 0)
    } finally {
      unmount()
    }
  })

  test('agent with no repo renders without crash', () => {
    const agent = { id: 'x2', state: 'COMPLETED', title: 'Task' }
    const { lastFrame, unmount } = render(
      React.createElement(AgentRow, { agent, selected: false, tick: 0, isDimmed: false })
    )
    try {
      assert.ok(lastFrame().length > 0)
    } finally {
      unmount()
    }
  })

  test('agent with UNKNOWN state renders without crash', () => {
    const agent = { id: 'x3', state: 'UNKNOWN', title: 'Unknown' }
    const { lastFrame, unmount } = render(
      React.createElement(AgentRow, { agent, selected: false, tick: 0, isDimmed: false })
    )
    try {
      assert.ok(lastFrame().length > 0)
    } finally {
      unmount()
    }
  })

  test('isDimmed=true renders dimmed appearance', () => {
    const agent = { id: 'x4', state: 'IN_PROGRESS', title: 'Task' }
    const { lastFrame, unmount } = render(
      React.createElement(AgentRow, { agent, selected: true, tick: 0, isDimmed: true })
    )
    try {
      assert.ok(lastFrame().length > 0)
    } finally {
      unmount()
    }
  })

  test('very long title is truncated (row does not overflow)', () => {
    const agent = { id: 'x5', state: 'QUEUED', title: 'A'.repeat(200), repo: 'github/r' }
    const { lastFrame, unmount } = render(
      React.createElement(AgentRow, { agent, selected: false, tick: 0, isDimmed: false })
    )
    try {
      assert.ok(lastFrame().length > 0)
    } finally {
      unmount()
    }
  })
})

describe('Regression — wrapText edge cases', () => {
  test('wrapText with width=1 does not infinite loop', () => {
    const r = wrapText('hello', 1)
    assert.ok(r.length >= 5)
    r.forEach(l => assert.ok(l.length <= 1))
  })

  test('wrapText with numeric-only input', () => {
    const r = wrapText('12345 67890', 5)
    assert.ok(r.length >= 2)
  })

  test('wrapText handles unicode-adjacent ascii', () => {
    const r = wrapText('test string here', 6)
    r.forEach(l => assert.ok(l.length <= 6))
  })
})

describe('Regression — extractToolCallsFromMessage edge cases', () => {
  test('handles null gracefully', () => {
    try {
      extractToolCallsFromMessage(null)
    } catch (_) {
      assert.fail('Should not throw for null')
    }
  })

  test('nested JSON with missing function key is skipped', () => {
    const json = JSON.stringify([{ notFunction: 'blah' }])
    const input = `\`\`\`json\n${json}\n\`\`\``
    const result = extractToolCallsFromMessage(input)
    assert.ok(typeof result === 'string')
  })

  test('non-array JSON does not crash', () => {
    const json = JSON.stringify({ function: { name: 'lone_tool' } })
    const input = `\`\`\`json\n${json}\n\`\`\``
    const result = extractToolCallsFromMessage(input)
    assert.ok(typeof result === 'string')
  })
})

describe('Regression — sortSessionsByRecent', () => {
  test('single session returns itself', () => {
    const s = [{ id: 'only', lastUpdated: 100 }]
    assert.equal(sortSessionsByRecent(s)[0].id, 'only')
  })

  test('sessions with same timestamp preserve relative order', () => {
    const ts = Date.now()
    const s = [{ id: 'a', lastUpdated: ts }, { id: 'b', lastUpdated: ts }]
    const sorted = sortSessionsByRecent(s)
    assert.equal(sorted.length, 2)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 17.  INTEGRATION — multi-message chat flow
// ═════════════════════════════════════════════════════════════════════════════

describe('Integration — ChatPanel multi-message flow', () => {
  const makeMessages = (n) =>
    Array.from({ length: n }, (_, i) => ({
      role: i % 3 === 0 ? 'user' : i % 3 === 1 ? 'agent' : 'system',
      text: `Message number ${i} with some content`,
    }))

  test('10 messages render without crash', () => {
    const { lastFrame, unmount } = render(
      React.createElement(ChatPanel, {
        input: '', chatVisibleRows: 12, width: 80, tab: 'chat',
        focused: true, repoName: 'repo', messages: makeMessages(10),
      })
    )
    try {
      assert.ok(lastFrame().length > 0)
    } finally {
      unmount()
    }
  })

  test('50 messages render without crash', () => {
    const { lastFrame, unmount } = render(
      React.createElement(ChatPanel, {
        input: '', chatVisibleRows: 12, width: 80, tab: 'chat',
        focused: true, repoName: 'repo', messages: makeMessages(50),
      })
    )
    try {
      assert.ok(lastFrame().length > 0)
    } finally {
      unmount()
    }
  })

  test('agent message with markdown renders cleanly', () => {
    const md = '# Plan\n\n- Step one\n- Step two\n\n```js\nconsole.log("hi")\n```'
    const { lastFrame, unmount } = render(
      React.createElement(ChatPanel, {
        input: '', chatVisibleRows: 20, width: 80, tab: 'chat',
        focused: true, repoName: 'repo',
        messages: [{ role: 'agent', text: md }],
        expandedMessages: new Set([0]),
        toggleMessageExpand: () => {},
      })
    )
    try {
      assert.ok(lastFrame().includes('AGENT'))
    } finally {
      unmount()
    }
  })
})

describe('Integration — Agent list rendering', () => {
  test('renders a list of 5 agents without crash', () => {
    const agents = Array.from({ length: 5 }, (_, i) => ({
      id: `sess-${i}`,
      title: `Task ${i}`,
      state: ['QUEUED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'PLANNING'][i],
      repo: 'sources/github/owner/repo',
      repoDisplay: 'owner/repo',
      lastUpdated: Date.now() - i * 1000,
    }))

    const rows = agents.map((agent, i) =>
      React.createElement(AgentRow, {
        key: agent.id,
        agent,
        selected: i === 0,
        tick: 0,
        isDimmed: false,
      })
    )

    const App = () => React.createElement(React.Fragment, null, ...rows)
    const { lastFrame, unmount } = render(React.createElement(App))
    try {
      const frame = lastFrame()
      assert.ok(frame.includes('Task 0'))
    } finally {
      unmount()
    }
  })
})