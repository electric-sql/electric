---
"@electric-ax/agents-server": patch
---

Mirror user principals into the tenant-scoped `users` table when principal entities are materialized, while preserving any profile fields enriched by host-specific identity sync.
