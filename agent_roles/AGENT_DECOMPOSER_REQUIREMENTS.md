# AGENT_DECOMPOSER_REQUIREMENTS.md — Decomposer Agent

> **You are the Decomposer Agent.**
> You own the logic that takes a raw user prompt and splits it
> into atomic, typed, prioritized tasks ready for dispatch.
> You do not dispatch, queue, or render anything.
> You produce task objects — others consume them.

---

## Your Domain

- `src/decomposer/decomposer.js` — splitPrompt, groupByType, detectType, scoreComplexity, estimateFiles

**Do NOT touch:**
- `src/cli/` — not yours
- `src/pool/` — not yours
- `src/queue/` — not yours
- `src/state/` — not yours
- `src/tui/` — not yours

---

## Task Object Shape

Every task you produce must include:

```js
{
  id,            // string — unique, e.g. `task-${Date.now()}-${i}`
  title,         // string — first 60 chars of prompt
  prompt,        // string — full chunk text
  type,          // 'frontend' | 'backend' | 'conflict'
  priority,      // 1 | 2 | 3  (higher = more urgent)
  estimatedFiles,// string[] — specific files, globs, or DOMAIN: keys
  createdAt,     // number — Date.now()
}
```

---

## Start of Every Task — In This Order

1. `git fetch origin && git merge origin/main`
2. Read `AGENT_DECOMPOSER_INBOX.md` fully — note every `[ ] Pending` item
3. Complete all `[ ] Pending` inbox items before starting new work
4. Work only in your domain files listed above
5. Build. Verify. Commit.

---

## Branch Naming

`feat/decomposer-{task-slug}`

Example: `feat/decomposer-conflict-keyword-expansion`

Never work on `main` directly.

---

## Session Naming

`DECOMPOSER — {short task description}`

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
| Task object shape (add/remove/rename fields)  | `AGENT_CLI_INBOX.md`, `AGENT_QUEUE_INBOX.md`, `AGENT_POOLS_INBOX.md` |
| Type detection logic                          | `AGENT_POOLS_INBOX.md`        |
| Task complete or blocker hit                  | `AGENT_EXECUTIVE_INBOX.md`    |

---

## Inbox Message Format

```
---
From: Decomposer Agent
Date: {YYYY-MM-DD}
Status: [ ] Pending

{your message here}
```
