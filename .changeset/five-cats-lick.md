---
"@electric-sql/prisma-generator": patch
---

Do not import `Relation` class if data model does not have any relations - fixes `unused import` TS errors.
