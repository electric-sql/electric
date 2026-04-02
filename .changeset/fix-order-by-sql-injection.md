---
'@core/sync-service': patch
---

Fix SQL injection in ORDER BY clause validation. Replace permissive catch-all in the AST walker with a deny-by-default allowlist of safe node types, and rebuild the clause from validated AST via PgQuery deparse instead of passing the raw user string through.
