---
'@electric-ax/agents-server': patch
'@electric-ax/agents-server-ui': patch
---

Add server-resolved fork anchor + parent/wake fields to `POST /_electric/entities/<type>/<id>/fork`.

- `anchor: 'latest_completed_run'` is an alternative to `fork_pointer`: the server scans the source root's `main` history, finds the most recent `runs` row with `status === 'completed'`, derives the matching `{ offset, sub_offset }` pointer, and runs the existing pointer-fork path with it. Mutually exclusive with `fork_pointer` (400 if both); 400 if no completed run exists. Lets callers without access to the source's per-row pointer side-table (e.g. an agent forking via a tool) fork at the same anchor the per-row "Fork from here" UI uses.
- `parent` and `wake` mirror the corresponding `spawn` body fields. When `parent` is set, the new root fork is a CHILD of that URL (rather than inheriting the source's parent). `wake` registers a subscription on the new root fork at fork time (same shape as `spawn`'s `wake`). Together these let an agent fork itself as a child and receive replies via the same manifest-anchored wake mechanism `spawn` uses.

Chat UI: `readInboxText` falls back to `message` and `content` keys when `text` isn't present, so messages sent by agents (which sometimes emit those shapes) render as a chat bubble body instead of a blank bar.
