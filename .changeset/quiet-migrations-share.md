---
"@electric-ax/agents-server": patch
---

Allow `runMigrations` to use a caller-owned PostgreSQL client while always
closing clients created from PostgreSQL URLs.
