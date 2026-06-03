---
title: Permissions & principals
titleTemplate: "... - Electric Agents"
description: >-
  Control who can spawn, read, write, signal, fork, schedule, and manage Electric Agents entities using principals and grants.
outline: [2, 3]
---

# Permissions & principals

Electric Agents servers authorize requests using a **principal** and permission grants. A principal identifies the caller; grants decide what that caller can do to entity types and entity instances.

## Principals

Pass a principal key as the `Electric-Principal` header. The key shape is:

```text
<kind>:<id>
```

Supported principal kinds are `user`, `agent`, `service`, and `system`. The server turns a key such as `user:sam` into the canonical principal URL `/principal/user%3Asam`.

From clients, use `principalKey`:

```ts
import { createRuntimeServerClient } from "@electric-ax/agents-runtime"

const client = createRuntimeServerClient({
  baseUrl: "http://localhost:4437",
  principalKey: "user:sam",
})
```

The CLI can pass the same value through the environment:

```sh
ELECTRIC_AGENTS_PRINCIPAL=user:sam electric agents ps
```

Servers may also accept additional auth headers through `ELECTRIC_AGENTS_SERVER_HEADERS` or `serverHeaders`, depending on the host.

## Entity type permissions

Entity type grants control who can spawn or manage entities of a type. Type-level permissions are:

| Permission | Allows |
| ---------- | ------ |
| `spawn`    | Spawn entities of this type |
| `manage`   | Manage the entity type and acts as the broader type-level permission |

Declare initial type grants in an entity definition:

```ts
registry.define("worker", {
  description: "Internal worker",
  permissionGrants: [
    {
      subject_kind: "principal_kind",
      subject_value: "user",
      permission: "spawn",
    },
  ],
  async handler(ctx) {
    // ...
  },
})
```

`subject_kind` can be `principal` for one principal URL/key or `principal_kind` for every principal of a kind.

## Entity permissions

Entity grants control access to existing entities. Entity-level permissions are:

| Permission | Allows |
| ---------- | ------ |
| `read`     | Read entity metadata and streams |
| `write`    | Send messages and write entity-owned resources |
| `delete`   | Delete or kill the entity |
| `signal`   | Send lifecycle signals |
| `fork`     | Fork from entity history |
| `schedule` | Create, update, or delete schedules |
| `spawn`    | Spawn children from this entity |
| `manage`   | Manage grants and acts as the broader entity-level permission |

Server spawn routes can include initial entity grants:

```ts
await fetch("http://localhost:4437/_electric/entities/assistant/support-ticket-42", {
  method: "PUT",
  headers: {
    "content-type": "application/json",
    "electric-principal": "user:sam",
  },
  body: JSON.stringify({
    grants: [
      {
        subject_kind: "principal",
        subject_value: "/principal/user%3Asam",
        permission: "read",
      },
    ],
  }),
})
```

When spawning from a parent, broad delegation requires `manage` on the parent. This applies to grants such as `manage`, principal-kind grants, descendant propagation, and `copy_to_children`.

## Grant propagation

Entity grants may include propagation options:

```ts
{
  subject_kind: "principal",
  subject_value: "/principal/user%3Asam",
  permission: "read",
  propagation: "descendants",
  copy_to_children: true,
}
```

- `propagation: "self"` applies to the entity itself.
- `propagation: "descendants"` applies through descendant entities.
- `copy_to_children: true` copies the grant when children are spawned.
- `expires_at` can set a grant expiry timestamp.

## Claim-scoped write tokens

Some low-level writes are protected by claim-scoped write tokens. Handler APIs such as `ctx.setTag()` and `ctx.deleteTag()` already have the active claim context. External clients should usually send messages instead of directly mutating entity-owned state.

If a host reserves the `Authorization` header for server auth, configure write token transport with `writeTokenHeader` or `claimTokenHeader`:

```ts
const client = createRuntimeServerClient({
  baseUrl: "http://localhost:4437",
  headers: { authorization: `Bearer ${serverToken}` },
  writeTokenHeader: "electric-claim-token",
})
```

## Development fallback

Local development servers can use a development principal fallback. Production deployments should authenticate requests and provide an explicit `Electric-Principal` header for every request.
