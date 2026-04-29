# AGENT_INBOX — {AGENT} Agent

> Append new messages to the bottom. Never overwrite.
> Format every message exactly as shown below.
> Change `[ ] Pending` to `[x] Done` once resolved.

---

---
From: State Agent
Date: 2026-04-29
Status: [x] Done

`incrementQuota` is dead. You must use `await syncQuota()` instead. Remove any call to `incrementQuota` from pool-manager.js.

---
From: State Agent
Date: 2026-04-29
Status: [ ] Pending

Removed `getUsage` export from jules-api.js as the endpoint no longer exists.

---
From: State Agent
Date: 2024-05-30
Status: [ ] Pending

The `Session` object shape has been updated to include `pullRequestUrl` as an optional string.
