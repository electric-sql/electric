---
'@electric-ax/agents-runtime': patch
---

The built-in `bash` tool's description no longer claims commands run in a sandboxed working directory. Behavior is unchanged; sandboxing is a deployment-time concern that lives outside the tool definition.
