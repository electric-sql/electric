# Stratovolt follow-up: webhook source rename

This Electric PR makes a breaking rename from the overly generic **event source** terminology to **webhook source** terminology for agent-visible webhook subscriptions.

After this PR is merged, Stratovolt/cloud needs a companion update before it can consume the new agents runtime/server APIs.

## Why this is needed

Stratovolt currently mirrors agent-visible webhook ingress metadata into the cloud agents server as **event source** contracts. The Electric API/types/tools are being renamed to **webhook source** equivalents, including:

- `EventSource*` → `WebhookSource*`
- `EventSourceCatalog` → `WebhookSourceCatalog`
- `sourceKey` → `webhookKey`
- `listEventSources()` → `listWebhookSources()`
- `getEventSource()` → `getWebhookSource()`
- `eventSources` tenant context option → `webhookSources`
- `ensureEventSourceWakeSource` → `ensureWebhookSourceWakeSource`
- `/_electric/event-sources` → `/_electric/webhook-sources`
- `/event-source-subscriptions/:id` → `/webhook-source-subscriptions/:id`
- `event-source:<id>` manifest keys → `webhook-source:<id>`
- `config.eventSource` → `config.webhookSource`
- `event_source_wake` → `webhook_source_wake`

We are intentionally **not** adding backwards compatibility aliases in Electric for the old names/routes/manifests.

## Stratovolt areas to update

The following references were found in `/Users/kylemathews/programs/stratovolt` and should be updated in the companion PR.

### Cloud agents server

Primary integration points:

- `packages/cloud-agents-server/src/event-source-registry.ts`
  - Rename file/class if desired, e.g. `webhook-source-registry.ts` / `WebhookSourceRegistry`.
  - Update imported agents types:
    - `EventSourceBucket` → `WebhookSourceBucket`
    - `EventSourceCatalog` → `WebhookSourceCatalog`
    - `EventSourceContract` → `WebhookSourceContract`
  - Update public methods:
    - `listEventSources()` → `listWebhookSources()`
    - `getEventSource()` → `getWebhookSource()`
  - Update contract field projection:
    - `sourceKey` → `webhookKey`
  - Update logs from “event source shape” to “webhook source shape”.

- `packages/cloud-agents-server/src/app.ts`
  - Tenant context currently passes:
    - `eventSources: options.eventSourceRegistry.forService(...)`
    - `ensureEventSourceWakeSource: ...`
  - Update to:
    - `webhookSources: options.webhookSourceRegistry.forService(...)`
    - `ensureWebhookSourceWakeSource: ...`

- `packages/cloud-agents-server/src/main.ts`
  - Rename registry import/instantiation if the registry file/class is renamed.
  - Update config option names if changed.

- `packages/cloud-agents-server/src/config.ts`
  - Consider renaming:
    - `eventSourceShapeUrl` → `webhookSourceShapeUrl`
    - env var `AGENTS_EVENT_SOURCE_SHAPE_URL` → `AGENTS_WEBHOOK_SOURCE_SHAPE_URL`

- `infra/cloud-agents-server/server.ts`
  - Update environment variable wiring:
    - `AGENTS_EVENT_SOURCE_SHAPE_URL` → `AGENTS_WEBHOOK_SOURCE_SHAPE_URL`

- `scripts/generate-dev-env.ts`
  - Update generated dev env var:
    - `AGENTS_EVENT_SOURCE_SHAPE_URL` → `AGENTS_WEBHOOK_SOURCE_SHAPE_URL`

### Admin API / contract

The Admin API exposes the webhook ingress catalog shape consumed by the cloud agents server.

- `packages/admin-api-contract/src/schemas/services.ts`
  - Rename schema/types if we want public contract naming to match:
    - `WebhookIngressEventSourceFilterConditionSchema`
    - `WebhookIngressEventSourceFilterSchema`
    - `WebhookIngressEventSourceFilter`
  - Update contract field names from `sourceKey` to `webhookKey` if the API surface should match Electric.

- `packages/admin-api-contract/src/schemas/index.ts`
  - Update exports for renamed schemas/types.

- `packages/admin-api/src/lib/webhook-ingresses.ts`
  - Currently projects database `source_key` to `sourceKey`.
  - Update output to `webhookKey` if the shape/API is renamed.

- `packages/admin-api/src/routes/shapes/admin.ts`
  - Shape alias currently uses `agent-event-sources`.
  - Consider renaming to `agent-webhook-sources` and updating the description.
  - If renaming the shape alias, update all consumers/tests/env vars accordingly.

- `migrations/049-add-agent-event-source-fields.sql`
  - Existing migration name/comments mention event source terminology.
  - Usually do **not** rewrite applied migrations, but future migrations/docs/comments should use webhook source terminology.

### Dashboard

User-facing dashboard copy and form state still use “event source” language.

- `packages/dashboard/src/routes/_dashboard/projects/$projectId/envs/$envId/svc/streams/$serviceId/webhooks/$endpointKey/edit.tsx`
  - Rename form field/state if API changes:
    - `sourceKey` → `webhookKey`
  - Update copy: “event-source tools” → “webhook-source tools”.

- `packages/dashboard/src/components/webhooks/flow/BucketRouteSidePanel.tsx`
  - Update copy: “What agents see when they discover this bucket as an event source.”

- `packages/dashboard/src/components/webhooks/flow/AgentSourcePanel.tsx`
  - Update copy: “agent event-source discovery”.

- `packages/dashboard/src/components/webhooks/bucketTemplateFormState.ts`
  - Update comment reference from `electric/packages/agents-runtime/src/event-sources.ts` to `webhook-sources.ts`.

### Tests

Update tests after renaming the cloud/admin/dashboard surfaces:

- `packages/cloud-agents-server/test/event-source-registry.test.ts`
- `packages/cloud-agents-server/test/app.test.ts`
- `packages/admin-api/test/routes/public/shapes.test.ts`
- `packages/admin-api/test/orpc/procedures/services/streams/webhook-ingresses.test.ts`

## Suggested approach

1. Wait until the Electric webhook-source rename PR is merged.
2. Update Stratovolt dependencies / workspace link to the merged Electric packages.
3. Rename the cloud registry and tenant context wiring to the new webhook-source API.
4. Decide whether the Admin API shape alias should also break from `agent-event-sources` to `agent-webhook-sources`.
   - If yes, update env vars and tests together.
   - If no, keep the shape alias as a cloud-internal compatibility detail but project rows into the new `WebhookSourceContract` shape for agents-server.
5. Update dashboard copy and form/API field names as appropriate.
6. Run targeted tests for:
   - cloud agents server registry/app
   - admin API webhook ingress shape
   - dashboard webhook ingress editing

## Notes

Electric intentionally does not provide old route/type/manifest aliases for this rename. If Stratovolt has existing persisted dynamic subscriptions using `event-source:<id>` manifest keys, they should be considered disposable and recreated after rollout.
