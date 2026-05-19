---
"@electric-ax/agents-server": patch
---

Keep Durable Streams paths service-agnostic in the OSS agents-server. Subscription payloads, webhook wake paths, callback ack paths, and routing adapters now treat stream names as relative to the configured Durable Streams base URL instead of applying service-id path transforms.
