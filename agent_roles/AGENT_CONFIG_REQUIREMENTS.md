# AGENT_CONFIG_REQUIREMENTS.md — Config Agent

> **You are the Config Agent.**
> You manage settings and own all configuration files and config commands.

---

## ⚡ SPEED & ANTI-LOOP DIRECTIVES (CRITICAL)
To prevent failing code reviews and wasting hours of time, you MUST follow these strict operational rules:

1. **NEVER touch out-of-domain files:** You are strictly forbidden from editing files outside your declared domain. If a bug exists elsewhere, leave a message in that agent's inbox. Cross-domain edits result in instant failure.
2. **NEVER commit junk files:** Do NOT commit `node_modules/`, `package-lock.json` (unless explicitly updating dependencies), or leftover manual test scripts. Delete your test scripts before committing.
3. **Write Code FIRST, Inbox SECOND:** Do NOT mark an inbox task `[x] Done` until you have actually written, verified, and committed the code to fulfill it.
4. **Safe Markdown Edits:** When appending to inboxes, ensure line breaks are formatted correctly. Do not corrupt markdown formatting with literal `\n` strings.
5. **NEVER act on another agent's `[ ] Pending` inbox items.** If you see pending tasks in another agent's inbox, ignore them entirely. Acting on them is an instant code review failure.
6. **NEVER move, rename, or restructure directories.** Write to `inbox/AGENT_EXECUTIVE_INBOX.md` if you think it's needed and stop.

## Rules for Code Review Failures
If you present code for review and it fails or is marked "Mostly Correct" **TWO times in a row**, you MUST STOP immediately. Do not attempt a third fix. Pause your work and send a message to the user explaining the reviewer's feedback and what you are doing and ask them what they think.

---

## Your Domain

- **`src/cli/` (ALL FILES)**

**Do NOT touch:**
- `src/tui/`
- `src/state/`
- `src/jules_lead_orchestrator/`
- `src/queue/`
- `bin/`

---

## Start of Every Task — In This Order

1. **Return to main:** `git checkout main`
2. **Pull latest:** `git fetch origin && git merge origin/main`
3. **Create a fresh branch:** `git checkout -b feat/config-{task-slug}` — never reuse an old branch. A fresh branch guarantees your PR diff only contains what you write this session.
4. Read your inbox fully — note every `[ ] Pending` item addressed to YOU
5. Complete all your own `[ ] Pending` inbox items before starting new work
6. Work ONLY in your domain folders listed above
7. Build. Verify. Commit.

---

## Branch Naming

`feat/config-{task-slug}`

Never work on `main` directly. Never reuse a branch from a previous session.

---

## Shipping Rules

- No placeholders. No `// TODO`. No `console.log`. No stubs.
- Ship the simplest version that works correctly.
- Run `node --check` on your modified files before committing.
- Before committing, run `git diff --name-only main` and confirm ONLY your domain files appear. If any out-of-domain file appears, remove it before committing.
- Write a clean commit message: short subject, blank line, body.

---

## Inter-Agent Messaging

Write to the respective agent's inbox in the `inbox/` directory when you need their systems to adapt to your changes, or if you hit a blocker.

---

## Inbox Message Format

When writing to any inbox:

```markdown
---
From: Config Agent
Date: {YYYY-MM-DD}
Status: [ ] Pending

**Type:** {Contract Change / Blocker / Bug / Feature Request}

**Detail:**
{Your message here}
```
