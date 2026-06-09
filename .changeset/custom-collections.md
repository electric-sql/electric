---
"@electric-ax/agents-runtime": patch
"@electric-ax/agents-server": patch
"@electric-ax/agents-server-ui": patch
---

Custom collections on entity streams.

Server: entity types declare the custom collections they accept via `custom_collection_schemas: { <name>: <JSON Schema> }` (same shape as `inbox_schemas` / `state_schemas`). `POST /_electric/entities/:type/:id/collections/:name` validates every write against the declared schema before appending; writes to a name the entity type did not declare are rejected with 422, and reserved built-in collection names (`BUILT_IN_COLLECTION_TYPES` exported from `@electric-ax/agents-runtime`) are rejected too so the runtime stays the sole writer of agent-managed collections.

Runtime: `createEntityTimelineQuery` accepts an optional `customSource` query-builder branch. Callers shape their custom-collection rows into the `EntityTimelineCustomRow` envelope (`{ collection, key, order, value }`) and the runtime splices them into the same unionAll/orderBy pipeline as the built-in timeline collections, so consumers don't have to client-side merge a second source. `EntityDefinition.customCollectionSchemas` lets typed entity definitions declare schemas that the runtime forwards through entity-type registration.

UI: session comments are wired on top of the generic mechanism — registered as a `comments` custom collection in the StreamDB customState, projected through the runtime's `customSource` branch, and reshaped back into a `comment` row variant for renderers. Comment surface (bubbles, reply affordances, comments-only tile view) is gated on whether the entity's type opted in to a `comment` custom collection schema.
