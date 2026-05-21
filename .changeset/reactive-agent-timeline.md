---
'@electric-ax/agents-runtime': patch
'@electric-ax/agents-mobile': patch
'@electric-ax/agents-server-conformance-tests': patch
'@electric-ax/agents-server-ui': patch
---

Add a fine-grained reactive entity timeline query and migrate the agents UI to use it. Timeline rows are maintained by TanStack DB using multi-source queries and live child collections, so streamed agent responses update incrementally without rematerializing the whole chat timeline. Update the mobile app to consume the row-based timeline shape and pin React to the React Native renderer version. Keep the conformance property-test model aligned with generated entity type names.
