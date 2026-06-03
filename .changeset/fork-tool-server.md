---
'@electric-ax/agents-server': patch
'@electric-ax/agents-server-ui': patch
---

Add a server-resolved fork anchor for `POST /_electric/entities/<type>/<id>/fork`. The fork body now accepts an optional `anchor: 'latest_completed_run'` field as an alternative to `fork_pointer`: the server scans the source root's `main` history, finds the most recent `runs` row with `status === 'completed'`, derives the matching `{ offset, sub_offset }` pointer, and runs the existing pointer-fork path with it. Mutually exclusive with `fork_pointer` (400 if both); errors with 400 if the source has no completed run. Lets callers without access to the source's per-row pointer side-table (e.g. an agent forking a session via a tool) still fork at the same anchor the per-row "Fork from here" UI uses.
