# AGENT_INBOX — {AGENT} Agent

> Append new messages to the bottom. Never overwrite.
> Format every message exactly as shown below.
> Change `[ ] Pending` to `[x] Done` once resolved.

---

---
From: User
Date: 2026-04-29
Status: [x] Done

We are replacing the heuristic-based decomposer with a true AI parser.
1. In `src/decomposer/decomposer.js`, remove the hardcoded heuristic logic in `splitPrompt`, `detectType`, `scoreComplexity`, and `estimateFiles`.
2. Implement a call to the Gemini API (you will need to expect a `GEMINI_API_KEY` in the environment or config).
3. The prompt to Gemini must force it to return a JSON array matching our exact Task Object shape: `{ id, title, prompt, type, priority, estimatedFiles }`.
4. Parse this JSON and return it. Handle standard API failures gracefully.
