---
"@core/sync-service": patch
---

Add read-only mode for seamless rolling deploys. Electric instances now serve existing shape data while waiting for the advisory lock, eliminating the HTTP outage window during rolling deploys.
