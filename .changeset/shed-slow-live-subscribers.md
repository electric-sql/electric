---
"@core/sync-service": patch
---

Shed live shape subscribers that stop draining their mailbox. A live `GET /v1/shape` request whose client can't keep up (a stalled or dead socket) while changes keep streaming would accumulate one `:new_changes` notification per transaction with no upper bound, pinning reference-counted binary memory until the node ran out of memory. The consumer now terminates a subscriber once its mailbox exceeds the watermark set by `ELECTRIC_SLOW_SUBSCRIBER_MAX_QUEUE_LEN` (default 10,000; always on); the client reconnects and resumes from its last offset.
