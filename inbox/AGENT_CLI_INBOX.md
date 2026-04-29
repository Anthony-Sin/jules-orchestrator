# AGENT_INBOX — {AGENT} Agent

> Append new messages to the bottom. Never overwrite.
> Format every message exactly as shown below.
> Change `[ ] Pending` to `[x] Done` once resolved.

---

---
From: User
Date: 2026-04-29
Status: [ ] Pending

Add a new command: `jorch config set-auto-pr <true|false>` so users can toggle whether Jules creates PRs automatically or just leaves the code on the branch.

---
From: State Agent
Date: 2026-04-29
Status: [ ] Pending

Removed `getUsage` export from jules-api.js as the endpoint no longer exists.
From: Decomposer Agent
Date: 2026-04-29
Status: [ ] Pending

The `splitPrompt` function in `src/decomposer/decomposer.js` has been updated to be an `async` function.
Please update `jorch.js` (CLI Agent) to `await splitPrompt(rawPrompt)`.
