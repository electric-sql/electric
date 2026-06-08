import type {
  ElectricEntity,
  ElectricRunner,
  ElectricSandboxProfile,
} from './ElectricAgentsProvider'

/**
 * Resolving "which runner / sandbox is this entity running in" for display.
 *
 * The runner is read off the entity's persistent `dispatch_policy` — the
 * pinned wake target chosen at spawn time (the desktop always pins its bundled
 * runner). Non-runner targets (e.g. webhook) carry no runner, so those entities
 * have no associated runner. The sandbox profile name lives on `entity.sandbox`;
 * its human label / description / `remote` flag are resolved against the
 * runner-advertised profile list.
 *
 * Runner params are typed against the structural subset of fields actually
 * read so callers that sync a narrower runners shape (the mobile app's
 * `agentsClient.ts`) can reuse these helpers without casts.
 */

type RunnerLike = Pick<ElectricRunner, `id` | `label` | `sandbox_profiles`>

/** The pinned runner id from the entity's dispatch policy, if any. */
export function getEntityRunnerId(
  entity: Pick<ElectricEntity, `dispatch_policy`>
): string | null {
  const targets = entity.dispatch_policy?.targets
  if (!targets) return null
  for (const t of targets) {
    if (t.type === `runner` && t.runnerId) return t.runnerId
  }
  return null
}

/** The sandbox profile name selected for the entity, if any. */
export function getEntitySandboxProfileName(
  entity: ElectricEntity
): string | null {
  return entity.sandbox?.profile ?? null
}

/** Look up a runner by id from a runners list. */
export function resolveRunner<R extends RunnerLike>(
  runners: ReadonlyArray<R>,
  id: string | null
): R | null {
  if (!id) return null
  return runners.find((r) => r.id === id) ?? null
}

/**
 * Find the advertised sandbox profile matching `name`. Prefer the profile as
 * advertised by the entity's own runner (its label may differ), otherwise fall
 * back to the first match across all runners.
 */
export function resolveSandboxProfile(
  runners: ReadonlyArray<RunnerLike>,
  name: string | null,
  preferredRunner?: RunnerLike | null
): ElectricSandboxProfile | null {
  if (!name) return null
  const fromPreferred = preferredRunner?.sandbox_profiles?.find(
    (p) => p.name === name
  )
  if (fromPreferred) return fromPreferred
  for (const runner of runners) {
    const match = runner.sandbox_profiles?.find((p) => p.name === name)
    if (match) return match
  }
  return null
}

/** Truncate a long opaque id (e.g. a runner UUID) for compact display. */
export function shortenId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id
}

/**
 * Best-effort display label for a runner: its advertised label, else a
 * shortened form of the id, else a generic fallback.
 */
export function runnerDisplayLabel(
  runner: Pick<ElectricRunner, `id` | `label`> | null,
  id: string | null
): string {
  if (runner) return runner.label || shortenId(runner.id)
  if (id) return shortenId(id)
  return `Unknown runner`
}

/** Display label for a sandbox profile: its advertised label, else its name. */
export function sandboxDisplayLabel(
  profile: ElectricSandboxProfile | null,
  name: string | null
): string | null {
  if (profile) return profile.label || profile.name
  return name
}

/**
 * The sandbox an entity actually runs in.
 *
 * `entity.sandbox.profile` is only populated when a profile was *explicitly*
 * chosen at spawn time. When it's absent the runtime falls back to an
 * in-process host sandbox (`unrestrictedSandbox`, advertised as the `local`
 * profile) — see `process-wake.ts`. That resolved default is never persisted,
 * so the UI mirrors the runtime rule here: no explicit profile ⇒ the host
 * "Local" default. This is what lets the UI distinguish Local vs Docker vs a
 * remote sandbox for every entity, not just ones with an explicit choice.
 */
export const DEFAULT_SANDBOX_PROFILE_NAME = `local`

export interface EffectiveSandbox {
  /** Profile name in use (`local` for the host default). */
  name: string
  label: string
  description?: string
  remote: boolean
  /** True when no profile was chosen and the runtime ran the host default. */
  isDefault: boolean
}

export function resolveEffectiveSandbox(
  runners: ReadonlyArray<RunnerLike>,
  entity: ElectricEntity,
  runner?: RunnerLike | null
): EffectiveSandbox {
  const explicit = getEntitySandboxProfileName(entity)
  if (explicit) {
    const profile = resolveSandboxProfile(runners, explicit, runner)
    return {
      name: explicit,
      label: profile?.label || explicit,
      description: profile?.description,
      remote: profile?.remote ?? false,
      isDefault: false,
    }
  }
  // No explicit profile → the host/local default. Prefer the runner's
  // advertised `local` profile (so the label/description match the picker),
  // else synthesize a sensible fallback.
  const localProfile = resolveSandboxProfile(
    runners,
    DEFAULT_SANDBOX_PROFILE_NAME,
    runner
  )
  return {
    name: localProfile?.name ?? DEFAULT_SANDBOX_PROFILE_NAME,
    label: localProfile?.label || `Local`,
    description:
      localProfile?.description ??
      `Runs on the host without isolation (default).`,
    remote: localProfile?.remote ?? false,
    isDefault: true,
  }
}
