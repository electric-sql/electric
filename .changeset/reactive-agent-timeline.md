---
'@electric-ax/agents-runtime': patch
'@electric-ax/agents-server-ui': patch
---

Add a fine-grained reactive entity timeline query and migrate the agents UI to use it. Timeline rows are maintained by TanStack DB using multi-source queries and live child collections, so streamed agent responses update incrementally without rematerializing the whole chat timeline.
