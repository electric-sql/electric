---
'@electric-ax/agents-server': patch
---

Fix a lost `runFinished` wake when a child finishes while its parent's manifest lands. Syncing a manifest entry's wake registration used to unregister the entry's rows and then register the replacement, and a source event evaluated between the two statements — the spawned child's run completing a few milliseconds after the parent's run wrote the child's manifest entry — matched nothing and was never re-evaluated. The registry now replaces a manifest entry's registration in place: the replacement is upserted first (a manifest that re-describes the registration spawn already made resolves to that same row, so nothing is deleted or re-created), and only then are the entry's other rows removed.
