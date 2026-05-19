---
"@electric-ax/agents-server": patch
---

Fix webhook dispatch never firing for service-prefixed durable-streams deployments.

`StreamClient` now accepts an optional `routing: { serviceId, adapter }` option that applies the `DurableStreamsRoutingAdapter` to subscription path payloads (patterns, stream paths, `wake_stream`, ack/release stream/path fields) and the inverse transform to response payloads. `AgentsHostTenantConfig` gains a `durableStreamsRouting` field that plumbs the adapter through to the per-tenant `StreamClient`.

Cloud / service-routed durable-streams deployments key appends on a service-prefixed backend path (`<serviceId>/<path>`), so subscriptions previously registered with the un-prefixed path never matched the HotBuffer lookup and webhook fanout silently dropped. Pull-wake dispatch was unaffected because it writes to an explicit `wake_stream` rather than relying on HotBuffer fanout. Tenant-root deployments are unaffected (no routing option passed → behavior unchanged).
