---
"@electric-sql/client": patch
---

Fix columnMapper to support loading subsets. When using `columnMapper` with ShapeStream, the `columns` parameter is now properly encoded from application column names (e.g., camelCase) to database column names (e.g., snake_case) before transmission to the server.
