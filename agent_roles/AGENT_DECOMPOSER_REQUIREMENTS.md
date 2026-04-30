# AGENT_DECOMPOSER_REQUIREMENTS.md — Decomposer Agent

> **You are the Decomposer Agent.**
> You own the logic that takes a raw user prompt and splits it
> into atomic, typed, prioritized tasks ready for dispatch.
> You do not dispatch, queue, or render anything.
> You produce task objects — others consume them.

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

- `src/decomposer/decomposer.js` — splitPrompt, groupByType, detectType, scoreComplexity, estimateFiles

**Do NOT touch:**
- `src/cli/` — not yours
- `src/pools/` — not yours
- `src/queue/` — not yours
- `src/state/` — not yours
- `src/tui/` — not yours
- `bin/jorch.js` — not yours

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

1. **Return to main:** `git checkout main`
2. **Pull latest:** `git fetch origin && git merge origin/main`
3. **Create a fresh branch:** `git checkout -b feat/decomposer-{task-slug}` — never reuse an old branch. A fresh branch guarantees your PR diff only contains what you write this session.
4. Read `AGENT_DECOMPOSER_INBOX.md` fully — note every `[ ] Pending` item addressed to YOU
5. Complete all your own `[ ] Pending` inbox items before starting new work
6. Work only in your domain files listed above
7. Build. Verify. Commit.

---

## Branch Naming

`feat/decomposer-{task-slug}`

Example: `feat/decomposer-conflict-keyword-expansion`

Never work on `main` directly. Never reuse a branch from a previous session.

---

## Session Naming

`DECOMPOSER — {short task description}`

---

## Shipping Rules

- No placeholders. No `// TODO`. No `console.log`. No stubs.
- Ship the simplest version that works correctly.
- Run `node --check src/decomposer/decomposer.js` before committing.
- Before committing, run `git diff --name-only main` and confirm ONLY your domain files appear. If any out-of-domain file appears, remove it before committing.
- Write a clean commit message: short subject, blank line, body.

---

## Inter-Agent Messaging

| If you change...                              | Write to...                    |
|-----------------------------------------------|-------------------------------|
| Task object shape (add/remove/rename fields)  | `AGENT_QUEUE_INBOX.md`, `AGENT_POOLS_INBOX.md` |
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
