---
"@core/sync-service": patch
---

Automatically recover sources whose replication slot creation is stuck waiting on a pending transaction, by periodically calling `pg_log_standby_snapshot()`. Previously such sources required a manual restart. When the function is unavailable (PostgreSQL < 14 or missing EXECUTE privilege), Electric falls back to the previous behavior and emits a one-time notice.
