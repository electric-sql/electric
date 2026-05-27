import { Type } from '@sinclair/typebox'

/**
 * Wire schema for a spawn-time sandbox CHOICE (the request input), as opposed to
 * the resolved {@link import('./electric-agents-types.js').EntitySandboxSelection}
 * persisted on the entity. The matching `SandboxChoice` type is hand-maintained
 * in `electric-agents-types.ts` — mirrors how `dispatchPolicySchema` pairs with
 * the `DispatchPolicy` type in `dispatch-policy-schema.ts`.
 *
 * Validation happens once, at the router boundary (this schema is embedded in
 * the spawn body schema); the spawn resolver consumes already-validated input,
 * so there is intentionally no separate `parse` helper here.
 */
export const sandboxChoiceSchema = Type.Object({
  profile: Type.Optional(Type.String()),
  // Explicit cross-entity identity — entities with the same key collaborate on
  // one workspace. `inherit` reuses the parent entity's resolved sandbox.
  key: Type.Optional(Type.String()),
  // Identity scope when no explicit `key`: per-entity (default) or per-wake.
  scope: Type.Optional(
    Type.Union([Type.Literal(`entity`), Type.Literal(`wake`)])
  ),
  // Idle-teardown durability; defaults by scope when unset.
  persistent: Type.Optional(Type.Boolean()),
  // Whether this entity owns the sandbox (default) or only attaches to one.
  owner: Type.Optional(Type.Boolean()),
  inherit: Type.Optional(Type.Boolean()),
})
