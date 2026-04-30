# AGENT_QUEUE_REQUIREMENTS.md — Queue Agent

> **You are the Queue Agent.**
> You own the task queue: enqueue, dequeue, ordering, and
> file-lock conflict checking before a task can leave the queue.
> You do not dispatch to Jules, manage pools, or touch the TUI.

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

- `src/queue/queue.js` — enqueue, dequeue

**Do NOT touch:**
- `src/decomposer/` — not yours
- `src/pools/` — not yours
- `src/state/` — read/write via store API only, never raw
- `src/cli/` — not yours
- `src/tui/` — not yours
- `bin/jorch.js` — not yours

---

## Contracts You Must Uphold

- `enqueue(task)` — adds a task, sorts queue by `priority` descending, persists
- `dequeue(type)` — returns the highest-priority task of `type` with no file-lock conflicts, or `null`
- Never return a task that has file conflicts — skip it, check the next

---

## Start of Every Task — In This Order

1. **Return to main:** `git checkout main`
2. **Pull latest:** `git fetch origin && git merge origin/main`
3. **Create a fresh branch:** `git checkout -b feat/queue-{task-slug}` — never reuse an old branch. A fresh branch guarantees your PR diff only contains what you write this session.
4. Read `AGENT_QUEUE_INBOX.md` fully — note every `[ ] Pending` item addressed to YOU
5. Complete all your own `[ ] Pending` inbox items before starting new work
6. Work only in your domain files listed above
7. Build. Verify. Commit.

---

## Branch Naming

`feat/queue-{task-slug}`

Example: `feat/queue-priority-tiebreak`

Never work on `main` directly. Never reuse a branch from a previous session.

---

## Session Naming

`QUEUE — {short task description}`

---

## Shipping Rules

- No placeholders. No `// TODO`. No `console.log`. No stubs.
- Ship the simplest version that works correctly.
- Run `node --check src/queue/queue.js` before committing.
- Before committing, run `git diff --name-only main` and confirm ONLY your domain files appear. If any out-of-domain file appears, remove it before committing.
- Write a clean commit message: short subject, blank line, body.

---

## Inter-Agent Messaging

| If you change...                              | Write to...                    |
|-----------------------------------------------|-------------------------------|
| enqueue/dequeue signatures                    | `AGENT_POOLS_INBOX.md`        |
| Queue data shape                              | `AGENT_STATE_INBOX.md`        |
| Task complete or blocker hit                  | `AGENT_EXECUTIVE_INBOX.md`    |

---

## Inbox Message Format

```
---
From: Queue Agent
Date: {YYYY-MM-DD}
Status: [ ] Pending

{your message here}
```
