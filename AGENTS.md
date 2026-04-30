# AGENTS.md — Jules Orchestrator Multi-Agent System

> This repo uses parallel Jules sessions to build the `jorch` CLI. Each session is assigned a specific role.
> **Your role is determined by which requirements file the user points you to at the start of the session.**
> Read your requirements file first. It tells you exactly who you are, what files you own, and what you are not allowed to touch.

---

## ⚡ SPEED & ANTI-LOOP DIRECTIVES (CRITICAL)
To prevent failing code reviews and wasting time, you MUST follow these strict operational rules:

1. **NEVER touch out-of-domain files:** If you are the TUI agent, do NOT edit `src/pools` or `src/state`. If a bug exists in another domain, you MUST leave it alone and write a message to that agent's inbox. Cross-domain edits result in instant code review failure.
2. **NEVER commit junk files:** Do NOT commit `node_modules/`, `package-lock.json` (unless explicitly updating dependencies), or leftover manual test scripts like `test.js` or `test_upsert.js`. Delete your test scripts before committing.
3. **Write Code FIRST, Inbox SECOND:** Do NOT mark an inbox task `[x] Done` until you have actually written and verified the code to fulfill it.
4. **Safe Markdown Edits:** When appending to inboxes via CLI, ensure line breaks are formatted correctly. Do not corrupt markdown formatting with literal `\n` strings.
5. **NEVER act on another agent's `[ ] Pending` inbox items.** If you see pending tasks addressed to a different agent, ignore them. You are only allowed to read them for context. Acting on them is an instant code review failure.
6. **NEVER move, rename, or restructure directories.** If you believe a restructure is needed, write to `inbox/AGENT_EXECUTIVE_INBOX.md` and stop. Do not touch directory structure under any circumstance.

---

## Strict Context Isolation

**To avoid confusion and keep your context window focused, you must ONLY read your own `AGENT_{ROLE}_REQUIREMENTS.md` file.** Do not read the requirements files of other agents.

---

## Agent Roster

| Agent | Requirements File | Core Domain & Job |
|---|---|---|
| **Executive** | `agent_roles/AGENT_EXECUTIVE_REQUIREMENTS.md` | **Coordinator:** Reviews work, enforces API contracts, unblocks agents. Writes no product code. |
| **Config** | `agent_roles/AGENT_CONFIG_REQUIREMENTS.md` | **Settings:** Owns `jorch config *` commands (`src/cli/config.js`). |
| **Conflict** | `agent_roles/AGENT_CONFLICT_REQUIREMENTS.md` | **Resolver:** Owns `jorch conflict` command and dedicated merge sessions. |
| **Decomposer** | `agent_roles/AGENT_DECOMPOSER_REQUIREMENTS.md` | **Parser:** Splits raw prompts into atomic, typed tasks (`src/decomposer/decomposer.js`). |
| **Pools** | `agent_roles/AGENT_POOLS_REQUIREMENTS.md` | **Lifecycle:** Dispatches tasks, polls state, kills sessions (`src/pools/pool-manager.js`). |
| **Queue** | `agent_roles/AGENT_QUEUE_REQUIREMENTS.md` | **Traffic Control:** Enqueues, sorts priority, checks file locks (`src/queue/queue.js`). |
| **State** | `agent_roles/AGENT_STATE_REQUIREMENTS.md` | **Source of Truth:** Owns persistent store and Jules API calls (`src/state/`). |
| **TUI** | `agent_roles/AGENT_TUI_REQUIREMENTS.md` | **Dashboard + Entry Point:** Owns terminal render loop, UI formatting, and CLI wiring (`src/tui/`, `bin/jorch.js`). |

---

## Start of Every Task — The Speed Path

Before writing a single line of code, every agent MUST do the following **in this exact order**:

1. **Return to main:** `git checkout main`
2. **Pull latest:** `git fetch origin && git merge origin/main`
3. **Create a fresh branch:** `git checkout -b feat/{role}-{task-slug}` — this guarantees your PR diff only contains what YOU write this session. Never reuse an old branch.
4. **Read Inbox:** Check your specific inbox file located in the `inbox/` folder (e.g., `inbox/AGENT_STATE_INBOX.md`).
5. **Clear Inbox:** Complete all `[ ] Pending` items addressed to YOU before starting any new user tasks.
6. **Stay in your lane:** Only edit files explicitly listed in your Domain.
7. **Syntax Check:** Run `node --check <your-file>` before submitting.

> **Why a fresh branch matters:** If you reuse an old branch, the PR diff will contain all previous session commits — including out-of-domain changes from earlier failed attempts. The code reviewer will fail the PR even if your current work is correct. A fresh branch from `main` means a clean diff every time.

---

## Inter-Agent Communication (The Inbox System)

Agents do not edit each other's requirement files. Instead, they write to dedicated Inbox files located in the `inbox/` folder.

### ⚠️ Strict Read/Write Rules for Inboxes

1. **When writing to ANOTHER agent's inbox:** You must **ONLY APPEND** your message to the bottom of their file. You are strictly forbidden from overwriting, deleting, or modifying any existing text in another agent's inbox.
2. **When reading YOUR OWN inbox:** This is the *only* time you are allowed to modify an inbox file. Once you have completed a requested task, you must edit your own inbox to change the status from `[ ] Pending` to `[x] Done`. Never delete the message.
3. **Never mark another agent's inbox task `[x] Done`** — even if you believe you have fulfilled it. Only the receiving agent marks their own tasks done.

### Message Format

```markdown
---
From: {Your Agent Name} Agent
Date: {YYYY-MM-DD}
Status: [ ] Pending

**Type:** {Contract Change / Blocker / Bug / Feature Request}

**Detail:**
{Explain exactly what changed (e.g., old function signature vs. new) or what is needed.}

**Action Required:**
{Tell the receiving agent exactly what they need to do in their domain.}
```

---

## Inbox Directory

| Agent | Inbox File |
|---|---|
| Executive | `inbox/AGENT_EXECUTIVE_INBOX.md` |
| Config | `inbox/AGENT_CONFIG_INBOX.md` |
| Conflict | `inbox/AGENT_CONFLICT_INBOX.md` |
| Decomposer | `inbox/AGENT_DECOMPOSER_INBOX.md` |
| Pools | `inbox/AGENT_POOLS_INBOX.md` |
| Queue | `inbox/AGENT_QUEUE_INBOX.md` |
| State | `inbox/AGENT_STATE_INBOX.md` |
| TUI | `inbox/AGENT_TUI_INBOX.md` |
