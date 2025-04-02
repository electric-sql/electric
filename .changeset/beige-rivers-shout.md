---
"@electric-sql/client": patch
"@core/sync-service": patch
---

fix!: Convert live responses with no changes from `204` to `200`.

BREAKING CHANGE: community clients relying on `204` alone for up-to-date logic might break - live responses now always return a `200` with a body/
