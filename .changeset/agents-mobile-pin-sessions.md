---
"@electric-ax/agents-mobile": patch
"@electric-ax/agents-server-ui": patch
---

Add session pinning to the mobile app: long-press a root session row to open a context sheet with the entity info (title, session id, type/status, subagents, runner, sandbox, spawned, last active) and a Pin/Unpin action. Pinned sessions surface in a Pinned section above the groups, persisted per-device in AsyncStorage — the mobile mirror of the web sidebar's pinning. Runner-param types in agents-server-ui's `entityRuntime` helpers are loosened to structural subsets so the mobile app can reuse them.
