import { ElectricAgentsError } from '../entity-manager.js'
import { ErrCodeInvalidRequest } from '../electric-agents-types.js'
import type {
  DispatchPolicy,
  ElectricAgentsEntity,
  EntitySandboxSelection,
  SandboxChoice,
} from '../electric-agents-types.js'
import type { PostgresRegistry } from '../entity-registry.js'

/**
 * Resolve and validate a spawn's sandbox CHOICE into the {@link
 * EntitySandboxSelection} persisted on the entity. Sibling of
 * `dispatch-policy.ts`'s `resolveEffectiveDispatchPolicyForSpawn`: kept off the
 * EntityManager so the spawn path reads as composed resolution steps.
 *
 * Profiles are a per-runner concern: each runner advertises what it supports.
 * When the spawn pins a runner via dispatch_policy, the chosen profile must be
 * in that runner's advertised set; otherwise we'd persist an unserviceable
 * choice that fails late at first wake. For unpinned dispatch (webhook /
 * parent-inherited) we can't pick a target ahead of time, so we fall back to a
 * tenant-wide "some runner offers this" check — better than nothing.
 */
export async function resolveSandboxForSpawn(
  registry: PostgresRegistry,
  dispatchPolicy: DispatchPolicy | undefined,
  requested: SandboxChoice | undefined,
  parentEntity: ElectricAgentsEntity | null
): Promise<EntitySandboxSelection | undefined> {
  if (!requested) return undefined

  const choice = applyInheritedSandbox(requested, parentEntity)
  // `inherit` against a parent with no shareable (keyed) sandbox yields none.
  if (!choice) return undefined

  const chosenName = choice.profile
  if (!chosenName) {
    throw new ElectricAgentsError(
      ErrCodeInvalidRequest,
      `sandbox requires a "profile" (or "inherit": true with a parent that has a shared sandbox).`,
      400
    )
  }

  const chosenIsRemote = await resolveChosenProfileRemote(
    registry,
    chosenName,
    dispatchPolicy
  )

  assertSharedSandboxColocated(choice.key, chosenIsRemote, dispatchPolicy)

  // Persist the selection. Only an explicit/inherited `key` is stored (it's
  // cross-entity, so the guard above applies); a `scope` is kept so the wake
  // can derive the key, but no `key` is stored for it — leaving the
  // co-location guard correctly keyed on genuine cross-entity sharing.
  const selection: EntitySandboxSelection = { profile: chosenName }
  if (choice.key !== undefined) selection.key = choice.key
  else if (choice.scope !== undefined) selection.scope = choice.scope
  if (choice.persistent !== undefined) selection.persistent = choice.persistent
  // Store ownership only when this entity is an attacher; owner is the
  // default, so it's left implicit (the wake resolver defaults to owner).
  if (choice.owner === false) selection.owner = false
  return selection
}

/**
 * Resolve `inherit` against the parent's *stored* sandbox. `inherit` reuses the
 * parent's keyed sandbox as a non-owner (attach-only). It's graceful: if the
 * parent has no shareable (keyed) sandbox the child simply gets none (returns
 * `undefined`), so `spawn_worker` can always request inheritance without
 * breaking unkeyed parents. (A running parent wake resolves inherit to its live
 * explicit key in the runtime instead — this server-side path covers direct API
 * callers, where only the parent's *stored* explicit key is available.)
 *
 * For a non-inherit choice the request passes through unchanged.
 *
 * NOTE: `inherit: true` takes the parent's identity AND durability wholesale —
 * any sibling field on the request (e.g. a caller-supplied `persistent: false`)
 * is intentionally ignored, because a child attaches to the parent's existing
 * sandbox and cannot change how that sandbox is torn down. `sandboxChoiceSchema`
 * permits the `{ inherit: true, persistent: ... }` combination, so the
 * precedence is resolved here rather than rejected at the schema level.
 */
function applyInheritedSandbox(
  requested: SandboxChoice,
  parentEntity: ElectricAgentsEntity | null
): SandboxChoice | undefined {
  if (!requested.inherit) return requested
  const parentKey = parentEntity?.sandbox?.key
  if (!parentKey) return undefined
  return {
    profile: parentEntity!.sandbox!.profile,
    key: parentKey,
    // Adopt the parent's durability; an explicit key has no scope. The child
    // attaches to (never owns) the parent's sandbox.
    persistent: parentEntity!.sandbox!.persistent,
    owner: false,
  }
}

/**
 * Validate the chosen profile is advertised by the relevant runner(s) and
 * determine whether it is a remote (off-host) sandbox, reachable from any
 * runner. Defaults to host-local (co-location required) unless every relevant
 * advertisement marks it remote. Throws if the profile is unserviceable.
 */
async function resolveChosenProfileRemote(
  registry: PostgresRegistry,
  chosenName: string,
  dispatchPolicy: DispatchPolicy | undefined
): Promise<boolean> {
  const runnerIds: Array<string> = []
  for (const target of dispatchPolicy?.targets ?? []) {
    if (target.type === `runner`) runnerIds.push(target.runnerId)
  }

  if (runnerIds.length > 0) {
    let allRemote = true
    for (const runnerId of runnerIds) {
      const runner = await registry.getRunner(runnerId)
      const advertised = runner?.sandbox_profiles ?? []
      const match = advertised.find((p) => p.name === chosenName)
      if (!match) {
        throw new ElectricAgentsError(
          ErrCodeInvalidRequest,
          `sandbox profile "${chosenName}" is not advertised by runner "${runnerId}" (advertised: ${advertised.map((p) => p.name).join(`, `) || `(none)`}).`,
          400
        )
      }
      if (match.remote !== true) allRemote = false
    }
    return allRemote
  }

  const available = await registry.listSandboxProfiles()
  const matches = available.filter((p) => p.name === chosenName)
  if (matches.length === 0) {
    throw new ElectricAgentsError(
      ErrCodeInvalidRequest,
      `sandbox profile "${chosenName}" is not offered by any registered runner (available: ${[...new Set(available.map((p) => p.name))].join(`, `) || `(none)`}).`,
      400
    )
  }
  // Only skip the co-location guard when every advertiser of this name is
  // remote — a same-named host-local profile on another runner could
  // otherwise land a collaborator on the wrong host.
  return matches.every((p) => p.remote === true)
}

/**
 * Co-location: a shared *local* sandbox lives on one host, so every
 * collaborator must be pinned to the same single runner. Subagents inherit the
 * parent's dispatch policy, so this holds once the root is pinned. A shared
 * *remote* sandbox is reachable from any runner, so the guard does not apply.
 */
function assertSharedSandboxColocated(
  key: string | undefined,
  chosenIsRemote: boolean,
  dispatchPolicy: DispatchPolicy | undefined
): void {
  if (key === undefined || chosenIsRemote) return
  const targets = dispatchPolicy?.targets ?? []
  const pinnedToSingleRunner =
    targets.length === 1 && targets[0]?.type === `runner`
  if (!pinnedToSingleRunner) {
    throw new ElectricAgentsError(
      ErrCodeInvalidRequest,
      `a shared sandbox (sandbox.key / sandbox.inherit) requires the entity to be pinned to a single runner via dispatch_policy, so all collaborators share one host.`,
      400
    )
  }
}
