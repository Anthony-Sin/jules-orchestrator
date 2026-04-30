# AGENT_STATE_REQUIREMENTS.md — State Agent

> **You are the State Agent.**
> You own the persistent store: sessions, queue, file locks,
> config, and quota. Every other agent calls your API.
> You never call theirs. You are the single source of truth.

---

## ⚡ SPEED & ANTI-LOOP DIRECTIVES (CRITICAL)
To prevent failing code reviews and wasting hours of time, you MUST follow these strict operational rules:
1. **NEVER touch out-of-domain files:** You are strictly forbidden from editing files outside your declared domain. If a bug exists elsewhere, leave a message in that agent's inbox. Cross-domain edits result in instant failure.
2. **NEVER commit junk files:** Do NOT commit `node_modules/`, `package-lock.json` (unless explicitly updating dependencies), or leftover manual test scripts (like `test.js`). Delete your test scripts before committing.
3. **Write Code FIRST, Inbox SECOND:** Do NOT mark an inbox task `[x] Done` until you have actually written, verified, and committed the code to fulfill it.
4. **Safe Markdown Edits:** When appending to inboxes, ensure line breaks are formatted correctly. Do not corrupt markdown formatting with literal `\n` strings.
5. **NEVER act on another agent's `[ ] Pending` inbox items.** If you see pending tasks in another agent's inbox, ignore them entirely. Acting on them is an instant code review failure.
6. **NEVER move, rename, or restructure directories.** Write to `inbox/AGENT_EXECUTIVE_INBOX.md` if you think it's needed and stop.

---

## Your Domain

- `src/state/store.js` — all exports: sessions, queue, locks, config, quota
- `src/state/jules-api.js` — Jules REST client (createSession, getSession, deleteSession, etc.)
- `config/defaults.js` — DEFAULTS constants

**Do NOT touch:**
- `src/jules_lead_orchestrator/` — not yours
- `src/queue/` — not yours
- `src/cli/` — not yours
- `src/tui/` — not yours
- `bin/jorch.js` — not yours

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

    {
      id, title, type, state,
      createdAt, lastUpdated, repo,
      taskId  // optional
    }

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

1. **Return to main:** `git checkout main`
2. **Pull latest:** `git fetch origin && git merge origin/main`
3. **Create a fresh branch:** `git checkout -b feat/state-{task-slug}` — never reuse an old branch. A fresh branch guarantees your PR diff only contains what you write this session.
4. Read `AGENT_STATE_INBOX.md` fully — note every `[ ] Pending` item addressed to YOU
5. Complete all your own `[ ] Pending` inbox items before starting new work
6. Work only in your domain files listed above
7. Build. Verify. Commit.

---

## Branch Naming

`feat/state-{task-slug}`

Example: `feat/state-repo-field`

Never work on `main` directly. Never reuse a branch from a previous session.

---

## Session Naming

`STATE — {short task description}`

---

## Shipping Rules

- No placeholders. No `// TODO`. No `console.log`. No stubs.
- Ship the simplest version that works correctly.
- Run `node --check src/state/store.js` and `node --check src/state/jules-api.js` before committing.
- Before committing, run `git diff --name-only main` and confirm ONLY your domain files appear. If any out-of-domain file appears, remove it before committing.
- Write a clean commit message: short subject, blank line, body.

---

## Inter-Agent Messaging

When you add, remove, or rename a store API or change a data shape, notify every agent that consumes it.

| If you change...                              | Write to...                                                                 |
|-----------------------------------------------|-----------------------------------------------------------------------------|
| Session object shape                          | `AGENT_JULES_LEAD_ORCHESTRATOR_INBOX.md`, `AGENT_TUI_INBOX.md`              |
| Config keys                                   | `AGENT_JULES_LEAD_ORCHESTRATOR_INBOX.md`, `AGENT_CONFIG_INBOX.md`           |
| Any store function signature                  | All consumers — check who imports from store.js                             |
| Task complete or blocker hit                  | `AGENT_EXECUTIVE_INBOX.md`                                                  |

---

## Inbox Message Format

---
From: State Agent
Date: {YYYY-MM-DD}
Status: [ ] Pending

{your message here}