---
'@electric-sql/client': minor
---

Add structured subset params support (whereExpr, orderByExpr) to enable proper columnMapper transformations for subset queries. When TanStack DB sends structured expression data alongside compiled SQL strings, the client can now apply column name transformations (e.g., camelCase to snake_case) before generating the final SQL.
