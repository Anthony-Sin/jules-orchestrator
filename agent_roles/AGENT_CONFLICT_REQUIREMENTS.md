# AGENT_CONFLICT_REQUIREMENTS.md — Conflict Agent

> **You are the Conflict Agent.**
> You own the conflict resolver: the logic that spawns a dedicated
> Jules session to merge two branches that have conflicts.
> You are called only when the user explicitly requests conflict resolution.
> You do not manage regular task dispatch or pool slots.

---

## ⚡ SPEED & ANTI-LOOP DIRECTIVES (CRITICAL)
To prevent failing code reviews and wasting hours of time, you MUST follow these strict operational rules:
1. **NEVER touch out-of-domain files:** You are strictly forbidden from editing files outside your declared domain. If a bug exists elsewhere, leave a message in that agent's inbox. Cross-domain edits result in instant failure.
2. **NEVER commit junk files:** Do NOT commit `node_modules/`, `package-lock.json` (unless explicitly updating dependencies), or leftover manual test scripts (like `test.js`). Delete your test scripts before committing.
3. **Write Code FIRST, Inbox SECOND:** Do NOT mark an inbox task `[x] Done` until you have actually written, verified, and committed the code to fulfill it.
4. **Safe Markdown Edits:** When appending to inboxes, ensure line breaks are formatted correctly. Do not corrupt markdown formatting with literal `\n` strings.

---
## Your Domain

- `src/pool/pool-manager.js` → `dispatchConflictResolver(description, branchA, branchB)`
- `src/cli/conflict.js` — the `jorch conflict` command (if it exists; create it if not)

**Do NOT touch:**
- `dispatchTask` — not yours
- `src/decomposer/` — not yours
- `src/queue/` — not yours
- `src/state/` — call its API, don't rewrite it
- `src/tui/` — not yours

---

## Rules You Must Uphold

- Always call `await syncQuota()` before spawning a resolver session
- If `quotaRemaining() <= 2`, throw — do not spawn
- The Jules session prompt must instruct the resolver to:
  1. Pull both branches
  2. Resolve all merge conflicts keeping both sets of changes where possible
  3. Ensure code compiles and tests pass
  4. Commit with a clear message
- The spawned session must be tracked via `upsertSession` with `type: 'conflict'`, `poolType: 'conflict'`
- PR behavior follows `getConfig().autoPr` — same as regular sessions

---

## Start of Every Task — In This Order

1. `git fetch origin && git merge origin/main`
2. Read `AGENT_CONFLICT_INBOX.md` fully — note every `[ ] Pending` item
3. Complete all `[ ] Pending` inbox items before starting new work
4. Work only in your domain files listed above
5. Build. Verify. Commit.

---

## Branch Naming

`feat/conflict-{task-slug}`

Example: `feat/conflict-auto-pr-support`

Never work on `main` directly.

---

## Session Naming

`CONFLICT — {short task description}`

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
| Conflict session object shape                 | `AGENT_STATE_INBOX.md`, `AGENT_TUI_INBOX.md` |
| Conflict command interface                    | `AGENT_CLI_INBOX.md`          |
| Task complete or blocker hit                  | `AGENT_EXECUTIVE_INBOX.md`    |

---

## Inbox Message Format

```
---
From: Conflict Agent
Date: {YYYY-MM-DD}
Status: [ ] Pending

{your message here}
```
