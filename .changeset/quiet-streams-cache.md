---
'@electric-ax/agents': patch
'@electric-ax/agents-desktop': patch
---

Install an Undici HTTP cache dispatcher for the built-in agents local Node runner so Durable Streams catch-up reads can use server cache headers. Electric Agents Desktop uses an on-disk SQLite cache so runtime restarts can reuse cached catch-up responses.
