---
'@electric-ax/agents-server-ui': patch
---

Typecheck against agents-runtime's built types for the package index instead of
its source, so the UI no longer pulls node-only sandbox code into its program.
The browser-safe `client` entry stays source-mapped (matching the vite alias).
