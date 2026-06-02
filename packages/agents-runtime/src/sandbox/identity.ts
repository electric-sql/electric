/**
 * Pure resolution of a sandbox's lifecycle knobs from the per-entity sandbox
 * config plus the live wake. Kept free of any provider or IO so it's trivially
 * unit-testable and reusable by both the wake path (process-wake) and the spawn
 * `inherit` path.
 *
 * Three orthogonal facts come out of this:
 *
 *  - KEY SCOPE (identity): an explicit `key` (set directly or adopted via
 *    `inherit`) is a cross-entity rendezvous handle and always wins. Absent a
 *    key, `scope` derives one: `'wake'` ⇒ `${entityUrl}#${wakeId}` (full
 *    per-wake isolation), `'entity'` (the default) ⇒ `entityUrl` (a stable
 *    per-entity workspace shared across that entity's wakes).
 *
 *  - DURABILITY (`persistent`): drives the *owner's* idle-teardown action —
 *    `true` preserves the sandbox (stop / suspend) for later reattach, `false`
 *    wipes it (remove / kill). When unset it defaults by scope: a per-wake
 *    sandbox is ephemeral, an explicit-key or per-entity one is persistent.
 *
 *  - OWNERSHIP (`owner`): an owner CREATES the sandbox and its lifecycle governs
 *    teardown (idle ⇒ stop/remove per `persistent`; terminal ⇒ reclaim). A
 *    non-owner can only ATTACH to an already-live sandbox and never creates or
 *    tears down — so a subagent can't conjure a fresh, empty sandbox under a
 *    shared key. Defaults to `true`; `inherit` resolves to `owner: false`.
 *
 * "Full isolation" therefore comes purely from a unique per-wake key, never a
 * separate code path — the provider only ever sees a resolved key, persistent,
 * and owner flag.
 */
export interface SandboxSelectionConfig {
  /**
   * An explicit cross-entity key (set directly on the entity's sandbox config,
   * or adopted from a parent via `inherit`). When present it is the identity
   * verbatim and `scope` is ignored.
   */
  key?: string
  /** Per-wake or per-entity identity when no explicit `key` is set. */
  scope?: `entity` | `wake`
  /** Idle-teardown durability. Defaults by scope (see module docs). */
  persistent?: boolean
  /**
   * Whether this entity OWNS the sandbox (create + attach + drive teardown) or
   * only ATTACHES to an owner's sandbox. Defaults to `true`; an `inherit` spawn
   * resolves to `false` upstream.
   */
  owner?: boolean
}

export interface ResolvedSandboxIdentity {
  /** The key the provider uses to name / reattach the sandbox. */
  sandboxKey: string
  /** Whether idle teardown preserves (true) or wipes (false) the sandbox. */
  persistent: boolean
  /** Whether this entity owns the sandbox (may create) or only attaches. */
  owner: boolean
}

/**
 * Resolve the sandbox key, persistent, and owner flags for a wake. See module
 * docs for the model. `wakeId` is only consulted for `scope: 'wake'`.
 */
export function resolveSandboxIdentity(
  config: SandboxSelectionConfig,
  wake: { entityUrl: string; wakeId: string }
): ResolvedSandboxIdentity {
  const scope = config.scope ?? `entity`
  const sandboxKey =
    config.key ??
    (scope === `wake` ? `${wake.entityUrl}#${wake.wakeId}` : wake.entityUrl)
  // Default durability: a per-wake sandbox is throwaway; an explicit-key or
  // per-entity sandbox persists. An explicit config value always wins.
  const defaultPersistent = config.key !== undefined ? true : scope !== `wake`
  const persistent = config.persistent ?? defaultPersistent
  // Ownership defaults to true; only an explicit `owner: false` (e.g. an
  // `inherit` spawn) makes this entity a pure attacher.
  const owner = config.owner ?? true
  return { sandboxKey, persistent, owner }
}

/**
 * The teardown ACTION decision shared by the providers: a sandbox is WIPED
 * (docker `remove` / remote `kill`) when its owning entity reclaimed it (went
 * terminal) or it was ephemeral; otherwise it is PRESERVED (docker `stop` /
 * remote `suspend`) for a later wake or collaborator to reattach.
 *
 * This is only the un-gated core. Owner-gating is applied by each provider
 * AROUND this call, where it genuinely differs and must stay local:
 *   - remote gates the whole decision on ownership (`owner && wipes(...)`) so a
 *     non-owner attacher only suspends, never kills the owner's VM;
 *   - docker folds the owner gate into `reclaim` upstream and lets an ephemeral
 *     container wipe once the last lease drains regardless of the last holder
 *     (the refcounted registry guarantees teardown runs once).
 */
export function sandboxWipesOnDispose(
  reclaim: boolean,
  persistent: boolean
): boolean {
  return reclaim || !persistent
}
