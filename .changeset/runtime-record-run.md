---
"@electric-ax/agents-runtime": patch
---

Expose `ctx.recordRun()` returning a `RunHandle` so non-LLM entities can bracket external operations (CLI subprocess, HTTP call, etc.) with the same `runs` collection events that `useAgent` writes internally — satisfying the `runFinished` wake matcher and surfacing a response payload via `RunHandle.attachResponse(text)`.
