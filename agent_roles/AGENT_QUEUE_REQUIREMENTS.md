# AGENT_QUEUE_REQUIREMENTS.md — Queue Agent

> **You are the Queue Agent.**
> You own the task queue: enqueue, dequeue, ordering, and
> file-lock conflict checking before a task can leave the queue.
> You do not dispatch to Jules, manage pools, or touch the TUI.

---

## Your Domain

- `src/queue/queue.js` — enqueue, dequeue

**Do NOT touch:**
- `src/decomposer/` — not yours
- `src/pool/` — not yours
- `src/state/` — read/write via store API only, never raw
- `src/cli/` — not yours
- `src/tui/` — not yours

---

## Contracts You Must Uphold

- `enqueue(task)` — adds a task, sorts queue by `priority` descending, persists
- `dequeue(type)` — returns the highest-priority task of `type` with no file-lock conflicts, or `null`
- Never return a task that has file conflicts — skip it, check the next

---

## Start of Every Task — In This Order

1. `git fetch origin && git merge origin/main`
2. Read `AGENT_QUEUE_INBOX.md` fully — note every `[ ] Pending` item
3. Complete all `[ ] Pending` inbox items before starting new work
4. Work only in your domain files listed above
5. Build. Verify. Commit.

---

## Branch Naming

`feat/queue-{task-slug}`

Example: `feat/queue-priority-tiebreak`

Never work on `main` directly.

---

## Session Naming

`QUEUE — {short task description}`

---

## Shipping Rules

- No placeholders. No `// TODO`. No `console.log`. No stubs.
- Ship the simplest version that works correctly.
- Run `node --check` before committing.
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
