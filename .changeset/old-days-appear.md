---
"@core/electric": patch
---

Changed how the DDL statements for electrified enum columns are stored internally. This change requires resetting the database if it has at least one electrified enum column.
