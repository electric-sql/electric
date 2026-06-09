---
'@electric-ax/agents-runtime': patch
---

Docker sandbox creation now pulls the image only when it isn't already present
locally, honoring the documented `pullIfMissing` semantics. Previously every
container create called `docker pull`, which round-trips to the registry even
for a fully cached digest-pinned image — making creation needlessly slow and
prone to failing whenever the registry was briefly unreachable.
