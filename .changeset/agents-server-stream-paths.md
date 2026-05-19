---
"@electric-ax/agents-server": patch
"@electric-ax/agents-runtime": patch
---

Keep Durable Streams paths service-agnostic in the OSS agents-server. Subscription payloads, webhook wake paths, callback ack paths, and routing adapters now treat stream names as relative to the configured Durable Streams base URL instead of applying service-id path transforms.

Persist and verify Durable Streams webhook signing secrets before forwarding webhook wakes through agents-server. Runtime handlers that use server auth headers now send Durable Streams claim tokens via `electric-claim-token`, preserving the configured server `Authorization` header for cloud callback routes.
