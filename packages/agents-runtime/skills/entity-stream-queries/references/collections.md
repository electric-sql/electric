# Built-In Entity Collections

Electric agent entity streams expose built-in collections through `db.collections.*`.

Common built-ins:

- `manifests`: durable resource state for children, observes, shared state, and effects
- `childStatus`: current child lifecycle/status rows
- `wakes`: wake rows appended by the server
- `inbox`: inbound user/system messages
- `runs`: agent run rows
- `texts`: text message rows for runs
- `textDeltas`: incremental text chunks
- `toolCalls`: tool call rows
- `steps`: step rows
- `errors`: error rows
- `entityStopped`: server-written stop row

Manifest rows are resource state, not an append-only command log. Common kinds:

- `child`
- `observe`
- `shared-state`
- `effect`

Use the manifest key helpers in `src/manifest-helpers.ts` when you need stable keys:

- `manifestChildKey(entityType, id)`
- `manifestObserveKey(entityUrl)`
- `manifestSharedStateKey(id)`
- `manifestEffectKey(functionRef, id)`

Shared state collections are additional typed collections attached to the entity DB or a shared-state DB. Query them the same way as any other collection.
