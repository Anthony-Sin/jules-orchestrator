# AGENTS.md — Jules Orchestrator Multi-Agent System

> This repo uses parallel Jules sessions to build the `jorch` CLI. Each session is assigned a specific role.
> **Your role is determined by which requirements file the user points you to at the start of the session.**
> Read your requirements file first. It tells you exactly who you are, what files you own, and what you are not allowed to touch.

---

## Strict Context Isolation

**To avoid confusion and keep your context window focused, you must ONLY read your own `AGENT_{ROLE}_REQUIREMENTS.md` file.** Do not read the requirements files of other agents unless explicitly instructed by the user or the Executive Agent. 

---

## Agent Roster

| Agent | Requirements File | Core Domain & Job |
|---|---|---|
| **Executive** | `agent_roles/AGENT_EXECUTIVE_REQUIREMENTS.md` | **Coordinator:** Reviews work, enforces API contracts, unblocks agents. Writes no product code. |
| **Config** | `agent_roles/AGENT_CONFIG_REQUIREMENTS.md` | **Settings:** Owns `jorch config *` commands (`src/cli/config.js`). |
| **Conflict** | `agent_roles/AGENT_CONFLICT_REQUIREMENTS.md` | **Resolver:** Owns `jorch conflict` command and dedicated merge sessions. |
| **Decomposer** | `agent_roles/AGENT_DECOMPOSER_REQUIREMENTS.md` | **Parser:** Splits raw prompts into atomic, typed tasks (`src/decomposer/decomposer.js`). |
| **Pools** | `agent_roles/AGENT_POOLS_REQUIREMENTS.md` | **Lifecycle:** Dispatches tasks, polls state, kills sessions (`src/pool/pool-manager.js`). |
| **Queue** | `agent_roles/AGENT_QUEUE_REQUIREMENTS.md` | **Traffic Control:** Enqueues, sorts priority, checks file locks (`src/queue/queue.js`). |
| **State** | `agent_roles/AGENT_STATE_REQUIREMENTS.md` | **Source of Truth:** Owns persistent store and Jules API calls (`src/state/`). |
| **TUI** | `agent_roles/AGENT_TUI_REQUIREMENTS.md` | **Dashboard:** Owns terminal render loop and UI formatting (`src/tui/`). |

---

## Start of Every Task — The Golden Path

Before writing a single line of code, every agent MUST do the following:

1. **Sync branch:** `git fetch origin && git merge origin/main`
2. **Read Inbox:** Check your specific inbox file located in the `inbox/` folder (e.g., `inbox/AGENT_STATE_INBOX.md`).
3. **Clear Inbox:** Complete all `[ ] Pending` items before starting any new user tasks.
4. **Stay in your lane:** Only edit files explicitly listed in your Domain.

---

## Inter-Agent Communication (The Inbox System)

Agents do not edit each other's requirement files. Instead, they write to dedicated Inbox files located in the `inbox/` folder.

### ⚠️ Strict Read/Write Rules for Inboxes

1. **When writing to ANOTHER agent's inbox:** You must **ONLY APPEND** your message to the bottom of their file. You are strictly forbidden from overwriting, deleting, or modifying any existing text in another agent's inbox.
2. **When reading YOUR OWN inbox:** This is the *only* time you are allowed to modify an inbox file. Once you have completed a requested task, you must edit your own inbox to change the status from `[ ] Pending` to `[x] Done`. Never delete the message.

### How to Send a Message
Append your message to the **bottom** of the receiving agent's file (e.g., `inbox/AGENT_POOLS_INBOX.md`).

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