---
"@electric-ax/durable-streams-server-rust": patch
---

Recovery hardening: durability barriers (committer fdatasync, checkpoint syncfs, segment seal) are fail-stop instead of retryable-in-place (a retried fsync can falsely succeed on Linux and ack/recycle lost bytes); failed checkpoints re-register their dirty set (previously a transient error + restart truncated acked bytes); torn sidecars are quarantined instead of deleting the stream's data file; missing stream-lane mounts refuse to boot instead of letting the WAL reset destroy the lane's records; append stage failures roll back the data write and producer state (500'd bytes no longer resurrect; retries no longer swallowed as duplicates); sealing cuts at the durable frontier; unreadable sealed chunks fail the read instead of serving a response with missing interior bytes; dir fsyncs added across the WAL metadata lifecycle.
