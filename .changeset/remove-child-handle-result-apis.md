---
'@electric-ax/agents-runtime': patch
'@electric-ax/agents-server': patch
'@electric-ax/agents': patch
---

Remove the old child-handle result API (`EntityHandle.run` and `EntityHandle.text()`) and internal spawn run promise plumbing. Child coordination should use durable `runFinished` server wakes with `includeResponse` so parent handlers can return safely instead of waiting in-memory for child output.
