---
'@electric-ax/agents-server': patch
'@electric-ax/agents-server-ui': patch
---

Fork at an earlier message instead of only at HEAD. `POST /_electric/entities/<type>/<id>/fork` accepts an optional `fork_pointer: { offset, sub_offset }` (snake_case wire) that truncates the new entity's `main` stream up to and including the chosen event; `error` and shared-state streams still clone at HEAD; the root's manifest is filtered so descendants spawned after the pointer are dropped from the fork along with their subtrees. Pointer-forks skip the all-subtree-idle wait on the root (the historical read can't be torn by concurrent writes past the pointer), so the affordance works during the post-run keep-alive window. UI: hover-revealed "Fork from here" button on user-message bubbles in `ChatView`, anchored to the latest preceding completed `runs` row; suppressed on the first message and while a run is in flight.
