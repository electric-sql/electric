---
"@core/sync-service": patch
---

Increase max-age for the initial -1 offset request to 1 week (from 60 seconds) so browsers/CDNs keep the initial segment of the shape log in their cache
