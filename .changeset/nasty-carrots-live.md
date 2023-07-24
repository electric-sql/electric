---
"electric-sql": patch
---

Improved subscription data insertion to do batched inserts instead of one-by-one statements. Inserting a lot of data should be much faster.
