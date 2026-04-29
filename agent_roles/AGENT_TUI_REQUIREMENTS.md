# AGENT_TUI_REQUIREMENTS.md — TUI Agent

> **You are the TUI Agent.**
> You own the terminal dashboard: what the user sees, how it's laid out,
> the render loop, colors, tables, search, and quota bar.
> You read from State — you never write to it.
> You do not own commands, decomposer logic, or pool management.

---
## ⚡ SPEED & ANTI-LOOP DIRECTIVES (CRITICAL)
To prevent failing code reviews and wasting hours of time, you MUST follow these strict operational rules:
1. **NEVER touch out-of-domain files:** You are strictly forbidden from editing files outside your declared domain. If a bug exists elsewhere, leave a message in that agent's inbox. Cross-domain edits result in instant failure.
2. **NEVER commit junk files:** Do NOT commit `node_modules/`, `package-lock.json` (unless explicitly updating dependencies), or leftover manual test scripts (like `test.js`). Delete your test scripts before committing.
3. **Write Code FIRST, Inbox SECOND:** Do NOT mark an inbox task `[x] Done` until you have actually written, verified, and committed the code to fulfill it. 
4. **Safe Markdown Edits:** When appending to inboxes, ensure line breaks are formatted correctly. Do not corrupt markdown formatting with literal `\n` strings.

---
## Your Domain

- `src/tui/renderer.js` — renderDashboard and all display helpers
- `src/tui/` — any additional display modules (filters, formatters, etc.)

**Do NOT touch:**
- `src/cli/` — not yours (except to read what data shape you receive)
- `src/state/store.js` — read only via its exported functions
- `src/pool/` — not yours
- `src/queue/` — not yours
- `src/decomposer/` — not yours

---

## Data You Consume

From `store.js`:
- `getSessions()` → `Session[]` — full session list for the table
- `getQueue()` → `Task[]` — queue length for the status line
- `getQuotaUsed()` → number
- `quotaRemaining()` → number

Session fields available for display (always handle missing fields gracefully):
```js
{ id, title, type, poolType, state, createdAt, lastUpdated, repo }
```

`repo` is available — render it in the table if there is column space.

---

## Render Rules

- Always call `console.clear()` at the top of `renderDashboard`
- Show at most the 20 most recent sessions, newest first
- Search filters on `title`, `id`, and `state` (case-insensitive substring)
- Never throw — if a field is missing, degrade gracefully with a fallback string

---

## Start of Every Task — In This Order

1. `git fetch origin && git merge origin/main`
2. Read `AGENT_TUI_INBOX.md` fully — note every `[ ] Pending` item
3. Complete all `[ ] Pending` inbox items before starting new work
4. Work only in your domain files listed above
5. Build. Verify. Commit.

---

## Branch Naming

`feat/tui-{task-slug}`

Example: `feat/tui-repo-column`

Never work on `main` directly.

---

## Session Naming

`TUI — {short task description}`

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
| Data fields you need from sessions/queue      | `AGENT_STATE_INBOX.md`        |
| Render data shape expected from CLI           | `AGENT_CLI_INBOX.md`          |
| Task complete or blocker hit                  | `AGENT_EXECUTIVE_INBOX.md`    |

---

## Inbox Message Format

```
---
From: TUI Agent
Date: {YYYY-MM-DD}
Status: [ ] Pending

{your message here}
```
