---
'@electric-ax/agents': patch
'@electric-ax/agents-runtime': patch
'@electric-ax/agents-server-ui': patch
---

Remove the coder entity (coding-session). The `registerCodingSession`, `useCodingAgent`, `CodingSessionHandle`, and related types/tools (`spawn_coder`, `prompt_coder`) are no longer available. The `agent-session-protocol` dependency is also removed.
