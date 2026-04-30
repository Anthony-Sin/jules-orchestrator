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
