---
'@electric-ax/agents-server': patch
'@electric-ax/agents-server-ui': patch
---

Add server-resolved fork anchor + spawn-parity body fields to `POST /_electric/entities/<type>/<id>/fork`.

- `anchor: 'latest_completed_run'` is an alternative to `fork_pointer`: the server scans the source root's `main` history, finds the most recent `runs` row with `status === 'completed'`, derives the matching `{ offset, sub_offset }` pointer, and runs the existing pointer-fork path with it. Mutually exclusive with `fork_pointer` (400 if both); 400 if no completed run exists. Lets callers without access to the source's per-row pointer side-table (e.g. an agent forking via a tool) fork at the same anchor the per-row "Fork from here" UI uses.
- `parent` overrides the new root fork's `parent` field, making it a CHILD of that URL (rather than inheriting the source's parent).
- `wake` registers a subscription on the new root fork at fork time (same shape as `spawn`'s `wake`).
- `initialMessage` is delivered to the new root fork via `entityManager.send` after `linkEntityDispatchSubscription` runs — same ordering spawn uses, so the dispatcher is subscribed before the inbox row lands and the fork actually wakes on the message instead of sitting idle.
- `tags` are stamped on the new root fork in addition to those copied from the source.

Together these let an agent fork itself as a child and receive replies via the same manifest-anchored wake mechanism `spawn` uses, with a single round-trip fork-and-dispatch.

Chat UI: `readInboxText` falls back to `message` and `content` keys when `text` isn't present, so messages sent by agents (which sometimes emit those shapes) render as a chat bubble body instead of a blank bar.
