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
From: TUI Agent
Date: 2024-05-30
Status: [ ] Pending

The TUI now uses Ink for rendering. Update the CLI so it supports rendering React Ink components instead of string rendering via `console.log`. The `renderDashboard` is now a React Component that can be rendered using Ink.
