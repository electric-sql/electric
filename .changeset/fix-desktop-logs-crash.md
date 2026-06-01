---
'@electric-ax/agents': patch
'@electric-ax/agents-server': patch
---

Defer logger initialization to first use so packaged Electron apps (where cwd is `/`) no longer crash trying to `mkdir '/logs'`. Logger init is now wrapped in try-catch with stderr fallback so logging infrastructure never throws. Add `ELECTRIC_AGENTS_LOG_FILE=false` escape hatch to the agents package for parity with agents-server.
