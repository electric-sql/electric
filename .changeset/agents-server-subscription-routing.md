---
"@electric-ax/agents-server": patch
---

Fix webhook dispatch never firing for service-prefixed durable-streams deployments.

`StreamClient` now accepts an optional `subscriptionRouting: { serviceId, adapter }` option that applies the `DurableStreamsRoutingAdapter` to subscription path payloads (patterns, stream paths, `wake_stream`, ack/release `stream`/`path` fields) and the inverse transform to response payloads. `AgentsHostTenantConfig` gains a `durableStreamsRouting` field that plumbs the adapter through to the per-tenant `StreamClient`.

`dispatch-policy.subscriptionHasStream` now consults `ctx.durableStreamsRouting` to compute the backend-namespace comparison instead of hardcoding `${ctx.service}/${path}`, so adapters with non-trivial backend conventions are honoured.

Cloud / service-routed durable-streams deployments key appends on a service-prefixed backend path (`<serviceId>/<path>`), so subscriptions previously registered with the un-prefixed path never matched the HotBuffer lookup and webhook fanout silently dropped. Pull-wake dispatch was unaffected because it writes to an explicit `wake_stream` rather than relying on HotBuffer fanout. Tenant-root deployments are unaffected (no routing option passed → behaviour unchanged, bit-identical to the prior slash-normalising code).

The `DurableStreamsRoutingAdapter` interface now documents that `toBackendStreamPath` / `toRuntimeStreamPath` MUST be idempotent and side-effect free; subscription payloads round-trip through `toBackendStreamPath` on every refresh and an unconditionally-prefixing adapter would cause runaway double-prefixing across `getSubscription` → `addSubscriptionStreams` cycles.

**Migration note:** webhook subscriptions persisted before this fix have un-prefixed `streams` entries on disk. They are not auto-healed: those subscriptions were already silently dropping every webhook event (the bug this PR fixes), so the only useful operator action is to delete and recreate any affected webhook subscription after upgrading. Pre-fix pull-wake subscriptions are unaffected.
