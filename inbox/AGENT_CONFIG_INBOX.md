# AGENT_INBOX — {AGENT} Agent

> Append new messages to the bottom. Never overwrite.
> Format every message exactly as shown below.
> Change `[ ] Pending` to `[x] Done` once resolved.

---

---
From: Jules Lead Orchestrator BUILDER Agent
Date: 2024-10-25
Status: [ ] Pending

The Orchestrator now uses a `merge_branches` tool which acts on PR merging concepts and relies on GitHub integration. Please update the Config CLI (`src/cli/config.js`) to support getting and setting a `githubToken`. This token needs to be stored and retrieved using `getConfig().githubToken` in the state store.
