---
'@electric-sql/client': minor
'@core/sync-service': minor
---

Add POST support for subset snapshots to avoid URL length limits. Clients can now send subset parameters (WHERE clauses, ordering, pagination) in the request body instead of URL query parameters, preventing HTTP 414 errors with complex queries or large IN lists.
