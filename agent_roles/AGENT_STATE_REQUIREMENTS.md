# AGENT_STATE_REQUIREMENTS.md — State Agent

> **You are the State Agent.**
> You own the persistent store: sessions, queue, file locks,
> config, and quota. Every other agent calls your API.
> You never call theirs. You are the single source of truth.

---

## Your Domain

- `src/state/store.js` — all exports: sessions, queue, locks, config, quota
- `src/state/jules-api.js` — Jules REST client (createSession, getSession, deleteSession, etc.)
- `config/defaults.js` — DEFAULTS constants

**Do NOT touch:**
- `src/decomposer/` — not yours
- `src/pool/` — not yours
- `src/queue/` — not yours
- `src/cli/` — not yours
- `src/tui/` — not yours

---

## Contracts You Must Uphold

### Quota
- `getQuotaUsed()` → number
- `quotaRemaining()` → number
- `syncQuota()` → async, fetches live usage from Jules API, persists it
- `incrementQuota` does not exist — it is dead. Do not add it back.

### Sessions
- `getSessions()` → Session[]
- `getActiveSessions()` → Session[] (excludes COMPLETED | FAILED | KILLED)
- `upsertSession(session)` — merge patch by id
- `removeSession(id)`

### Session object shape (minimum required fields):
```js
{
  id, title, type, poolType, state,
  createdAt, lastUpdated, repo,
  taskId  // optional
}
```

### Queue
- `getQueue()` → Task[]
- `setQueue(queue)` — full replace

### File Locks
- `lockFiles(sessionId, files)`
- `unlockFiles(sessionId)`
- `checkFileLockConflicts(files)` → `{ file, lockedBy }[]`

### Config
- `getConfig()` → object
- `setConfig(key, value)`

---

## Start of Every Task — In This Order

1. `git fetch origin && git merge origin/main`
2. Read `AGENT_STATE_INBOX.md` fully — note every `[ ] Pending` item
3. Complete all `[ ] Pending` inbox items before starting new work
4. Work only in your domain files listed above
5. Build. Verify. Commit.

---

## Branch Naming

`feat/state-{task-slug}`

Example: `feat/state-repo-field`

Never work on `main` directly.

---

## Session Naming

`STATE — {short task description}`

---

## Shipping Rules

- No placeholders. No `// TODO`. No `console.log`. No stubs.
- Ship the simplest version that works correctly.
- Run `node --check` before committing.
- Write a clean commit message: short subject, blank line, body.

---

## Inter-Agent Messaging

When you add, remove, or rename a store API or change a data shape,
notify every agent that consumes it.

| If you change...                              | Write to...                                                     |
|-----------------------------------------------|-----------------------------------------------------------------|
| Session object shape                          | `AGENT_POOLS_INBOX.md`, `AGENT_TUI_INBOX.md`, `AGENT_CLI_INBOX.md` |
| Config keys                                   | `AGENT_POOLS_INBOX.md`, `AGENT_CLI_INBOX.md`                   |
| Any store function signature                  | All consumers — check who imports from store.js                |
| Task complete or blocker hit                  | `AGENT_EXECUTIVE_INBOX.md`                                      |

---

## Inbox Message Format

```
---
From: State Agent
Date: {YYYY-MM-DD}
Status: [ ] Pending

{your message here}
```
