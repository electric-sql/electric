# Coding-agents — Fly Sprites (second sandbox provider)

**Date:** 2026-05-02
**Status:** Draft (pending implementation)
**Predecessors:** Slice A, B, C₁, C₂ (codex parity), Conformance suite, Cross-kind resume + fork, Opencode (third agent kind).
**Branch:** `coding-agents-slice-a` (continued).

---

## Why

`SandboxProvider` was designed to support multiple provider backends from day one — slice 2026-04-30's platform spec explicitly listed Modal/Fly/E2B as future implementations that "reuse the conformance suite". Adding sprites tests that promise.

[sprites.dev](https://sprites.dev) (Fly's purpose-built agentic-sandbox product, distinct from Fly Machines) maps cleanly onto `SandboxProvider`:

- `start` → `POST /sprites` (~1–2s cold-boot)
- `exec` → `WSS /sprites/{id}/exec` with stdin/stdout/stderr (matches our `ExecHandle` contract)
- `copyTo` → Filesystem REST endpoint
- `recover` → `GET /sprites` with name-prefix filter
- 100GB persistent FS per sprite, auto-sleep when idle (cost-bounded)

Reconnaissance confirmed:

- Auth: `SPRITES_TOKEN` bearer, org-scoped.
- API: REST + WebSocket. v0.0.1-rc30 (pre-1.0; expect churn).
- Stdin pipe in exec is supported (essential for claude prompt delivery).
- No custom OCI image input — base image is Fly-curated with claude/codex/gemini preinstalled. Bootstrap installs `opencode-ai` per sprite at create time.
- No separate volume concept — each sprite has an intrinsic 100GB FS.
- Cross-sprite checkpoint restore (would-be-`cloneWorkspace`) is documented but unverified for v1.

This slice ships a v1 `FlySpriteProvider` that:

1. Implements every required `SandboxProvider` method, passes the existing conformance suite, supports all three coding-agent kinds (claude / codex / opencode).
2. Exposes sprites as a third `target` value alongside `sandbox` and `host`. Spawn dialog gains the option; convert-target gates appropriately.
3. Supports convert-kind and fork **within sprites** (claude↔codex↔opencode in place; fork to sibling sprite with conversation history transfer via `denormalize`).

## Non-goals

- **`cloneWorkspace`** — cross-sprite checkpoint-restore semantics are pre-1.0 and unverified. Workspace files don't transfer on fork within sprites in v1. Deferred to v1.5 once verified empirically.
- **Workspace sharing across sprites** — sprites' "sprite IS the FS" model has no analog for our docker-volume sharing pattern. Sprite deployments are agent-per-sprite.
- **Cross-provider operations** — no `target=sandbox → sprites` (or reverse) conversion; no `Fork from local-docker source → sprites` or vice versa. The `target` field is fixed at spawn for the sprites case. Convert-kind (claude↔codex↔opencode) and same-provider fork remain available.
- **Custom OCI image input** — sprites doesn't accept one. Per-sprite bootstrap installs `opencode-ai` at start; claude+codex are preinstalled in the base image.
- **Region / zone selection** — defer. v1 uses the API's default region.
- **Sprite-level pin/release distinct from agent's** — sprites' auto-sleep handles cost; we don't add separate pin semantics.
- **Template-checkpoint-based start** — would eliminate the per-sprite bootstrap latency. Deferred to v1.5; depends on cross-sprite restore working.

---

## §1. Provider mechanism

New file `packages/coding-agents/src/providers/fly-sprites.ts` implementing `SandboxProvider`:

```ts
export class FlySpriteProvider implements SandboxProvider {
  readonly name = `fly-sprites`
  private readonly token: string
  private readonly baseUrl: string

  constructor(opts: FlySpriteProviderOptions = {}) {
    this.token =
      opts.token ?? process.env.SPRITES_TOKEN ?? throw_required(`SPRITES_TOKEN`)
    this.baseUrl = opts.baseUrl ?? `https://api.sprites.dev`
  }

  async start(spec: SandboxSpec): Promise<SandboxInstance> {
    // Resolve sprite by agentId — list with name=`coding-agent-${agentId}` prefix.
    // If exists + healthy: return existing handle (idempotent).
    // Else: POST /sprites { name, idle_timeout_secs, ... } → wait for ready (~1-2s).
    // Then bootstrap: exec the install script (idempotent — checks /opt/electric-ax/.bootstrapped).
    // Write spec.env to /run/agent.env so subsequent execs can source it.
  }

  async exec(req: ExecRequest): Promise<ExecHandle> {
    // WebSocket client → WSS /sprites/{id}/exec.
    // Adapt the Sprites exec frame protocol: stdout/stderr become async-iterable
    // string streams; writeStdin/closeStdin pass-through. Matches ExecHandle exactly.
  }

  async copyTo({ destPath, content, mode }): Promise<void> {
    // PUT /sprites/{id}/fs/{encodedPath} with body { content, mode }.
    // Falls back to exec + cat>destPath if filesystem REST proves flaky.
  }

  async stop(instanceId): Promise<void> {
    // Sprites auto-sleep when idle — explicit stop is a no-op for v1.
    // Optionally: PUT /sprites/{id} cordon=true to force-sleep immediately.
  }

  async destroy(agentId): Promise<void> {
    // DELETE /sprites/{id} — frees the FS.
  }

  async status(agentId): Promise<`running` | `stopped` | `unknown`> {
    // GET /sprites/{id} → map sprite state to our 3-value enum.
    // 'running' covers both active and auto-slept (slept sprites wake on next exec).
  }

  async recover(): Promise<Array<RecoveredSandbox>> {
    // GET /sprites?name_prefix=coding-agent- → reconstruct handles.
  }

  // cloneWorkspace: NOT implemented (deferred to v1.5).
}
```

**Exec WebSocket** uses Node 22's global `WebSocket` — no extra dep. The async-iterable stdout/stderr adapter is ~50 LOC, mirrors `LocalDockerProvider`'s docker-exec stdio drain pattern.

**SandboxInstance.homeDir** is `/root` (sprites run as root by default). `workspaceMount` is `/work`, ensured by bootstrap.

---

## §2. Lifecycle, workspace, and conversion boundaries

### Lifecycle states map directly

`cold/starting/idle/running/stopping/error/destroyed` align without modification. Auto-slept sprites are functionally `idle` from the runtime's perspective — `status()` returns `running` because the sprite wakes on the next exec (~300ms). No new state.

### Workspace identity

For `target='sprites'`:

- `workspace.type` MUST be `'volume'` — `'bindMount'` is rejected at spawn time with a clear error ("Sprites only support volume workspaces; bind-mount has no analog on remote infrastructure").
- `WorkspaceRegistry.resolveIdentity` returns `sprite:${agentId}` — one-to-one. **No multi-agent-per-volume sharing.** The lease registry's `acquire/release` becomes a no-op for sprites.
- `workspace.name` is informational only (surfaces in the UI, not semantically load-bearing).

### Conversion boundaries

| Operation                                                       | Allowed on sprites? | Mechanism                                                                                               |
| --------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------- |
| Convert kind (claude↔codex↔opencode)                          | ✅                  | Same sprite, kind flips in place. Existing `processConvertKind` handler unchanged.                      |
| Same-kind fork (within sprites)                                 | ✅                  | New sprite spawned. Conversation via `nativeJsonl` copy + `--resume`. **No workspace file copy** in v1. |
| Cross-kind fork (within sprites)                                | ✅                  | New sprite. Conversation via `denormalize(events, newKind)`. **No workspace file copy** in v1.          |
| Convert target (sandbox↔host↔sprites)                         | ❌ rejected         | `target` fixed at spawn. `processConvertTarget` validates and rejects.                                  |
| Cross-provider fork (local-docker source → sprites, or reverse) | ❌ rejected         | Fork dropdown gates by source target.                                                                   |

The existing `processConvertTarget` handler validates allowed transitions. Extend its allowed-transitions table to disallow sprites ↔ {sandbox, host}.

The fork dropdown reads `meta.target`:

- Source target = `sprites` → fork targets are sprites only (kind picker still shows claude/codex/opencode).
- Source target = `sandbox` or `host` → fork targets exclude sprites (visibly disabled with tooltip "Cross-provider fork not supported").

---

## §3. Bootstrap script

Per-sprite bootstrap runs once at `start()` after sprite is ready. Idempotent — checks if already done.

`packages/coding-agents/src/providers/fly-sprites/bootstrap.sh` (or inlined as a TS string template):

```sh
#!/bin/sh
set -e
[ -f /opt/electric-ax/.bootstrapped ] && exit 0

# Verify preinstalled CLIs.
claude --version >/dev/null && codex --version >/dev/null

# Install opencode-ai (~10–20s on a fresh sprite).
npm install -g opencode-ai@1.14.31
opencode --version >/dev/null

# Workspace mount point.
mkdir -p /work

# Per-instance env file (slice C₁ pattern).
mkdir -p /run/agent && touch /run/agent.env && chmod 600 /run/agent.env

# Mark complete.
mkdir -p /opt/electric-ax && touch /opt/electric-ax/.bootstrapped
echo "bootstrap complete"
```

The provider runs this via `WSS /sprites/{id}/exec` after `POST /sprites` returns. Output is streamed to a debug log; bootstrap failure surfaces as a `lifecycle.bootstrap_failed` row.

**Pin policy.** `opencode-ai@1.14.31` must match the local-docker `Dockerfile` pin. When opencode-ai bumps, bump both atomically (one PR; the conformance suite catches drift).

**Cost.** Bootstrap adds 10–30s to first cold-boot per sprite. Subsequent prompts on the same sprite reuse the bootstrapped state — sprites auto-sleep, so the marker file survives wake-up cycles. UX: the timeline shows `lifecycle.bootstrap.starting` → `lifecycle.bootstrap.complete` so users see what's happening.

---

## §4. Auth

`SPRITES_TOKEN` env var, mirroring `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`. Read once at `FlySpriteProvider` construction; sent as `Authorization: Bearer ${token}` on every API call. Org-scoped per recon — one token covers all sprites in the org.

`packages/coding-agents/src/index.ts` registers the provider only when the env var is present:

```ts
if (process.env.SPRITES_TOKEN) {
  // Lazy registration — provider instantiated by the runtime when needed.
  registerProvider(`sprites`, () => new FlySpriteProvider())
}
```

If `SPRITES_TOKEN` is absent, the provider isn't registered. `target='sprites'` spawns fail at validation with a clear message: `"sprites provider not configured (SPRITES_TOKEN unset)"`.

For dev: add `SPRITES_TOKEN=...` to `.env`. For CI / production: standard secret-injection.

The auth env var is **NOT** propagated into the sprite (no chain-of-custody concern — sprites authenticate via their own bearer token at the API layer; the CLI inside the sprite doesn't need it).

---

## §5. UI surface

### Spawn dialog (`CodingAgentSpawnDialog.tsx`)

Add `'sprites'` to the **target** radio. When selected:

- Workspace type radio: only `volume` enabled (`bindMount` disabled with tooltip).
- Workspace name field: shown, marked "informational".
- All three kind options remain selectable (claude, codex, opencode).
- The opencode model picker still appears when kind is opencode.

### EntityHeader convert-target dropdown

Currently lists `→ Sandbox` / `→ Host`. Extend with `→ Sprites`. Cross-provider transitions are visibly disabled with tooltip: `"Cross-provider conversion is not supported. Spawn a fresh agent on Sprites instead."`. Specifically:

- Sandbox / Host current → `→ Sprites` disabled.
- Sprites current → `→ Sandbox` and `→ Host` both disabled.

### Fork dropdown

Reads `meta.target` of the source agent and gates the targets:

- Source = `sprites` → kind picker covers all 3 kinds; new agent forced to `target='sprites'`.
- Source = `sandbox` or `host` → sprites is **NOT** offered as a fork target. (The dropdown either hides it entirely, or shows it disabled with tooltip "Cross-provider fork not supported" — pick disabled-with-tooltip for discoverability, matching the opencode-cross-kind UX.)

### Lifecycle timeline

Two new event types: `bootstrap.starting`, `bootstrap.complete`, `bootstrap.failed`. Render as muted lifecycle rows like the existing `sandbox.starting`/`sandbox.started`. Sprites' auto-sleep is implicit (no event); when a slept sprite wakes for a turn, it manifests as a normal `sandbox.starting` → `sandbox.started` pair.

---

## §6. Testing strategy

### Layer 1 (unit, no network, no token)

`packages/coding-agents/test/unit/fly-sprites.test.ts` — mock the Sprites API client (intercept `fetch` and `WebSocket`). Cover:

- `start()` builds the right `POST /sprites` payload + bootstrap exec sequence.
- `exec()` translates WebSocket frames to async-iterable streams correctly.
- `copyTo()` issues the right Filesystem REST PUT.
- `recover()` parses the list response + filters by name prefix.
- Auth header is set on every request.
- Bootstrap idempotency (marker file check skips re-install).
- `cloneWorkspace` is **not** present (asserts `provider.cloneWorkspace === undefined`).

### Layer 2 — provider conformance (gated `SPRITES=1 + SPRITES_TOKEN`)

`packages/coding-agents/test/integration/fly-sprites-conformance.test.ts` mirrors `local-docker-conformance.test.ts`:

```ts
runSandboxProviderConformance(`FlySpriteProvider`, {
  createProvider: () => new FlySpriteProvider(),
  scratchWorkspace: () => ({
    spec: { type: 'volume', name: `conf-sprite-${nanoid(8)}` },
    cleanup: async () => undefined, // sprite destroy is the cleanup
  }),
  target: 'sprites',
  skipIf: () => !process.env.SPRITES_TOKEN || process.env.SPRITES !== '1',
  supportsCloneWorkspace: false,
})

runCodingAgentsIntegrationConformance(`FlySpriteProvider`, {
  // similar, with envForKind passing through Anthropic/OpenAI keys per opencode pattern
  // and probeForKind picking models the chosen provider has auth for.
})
```

This automatically runs **all 8 L1 scenarios + all 8 L2 scenarios for all 3 kinds** (claude/codex/opencode) against real sprites. Same suite that catches LocalDocker regressions catches Sprites regressions.

**Cost guard:** `afterEach` calls `provider.destroy()`. Test name prefix `conf-sprite-` makes leaks findable via `GET /sprites?name_prefix=conf-sprite-`. Add a `pnpm cleanup:sprites` script that lists + deletes anything matching that prefix, for periodic operator hygiene.

### Layer 4 e2e — gated `SLOW=1 + SPRITES_TOKEN`

- `spawn-sprites-claude.e2e.test.ts`
- `spawn-sprites-codex.e2e.test.ts`
- `spawn-sprites-opencode.e2e.test.ts`
- `convert-kind-on-sprites.e2e.test.ts` (claude → codex on a sprites agent)
- `fork-on-sprites.e2e.test.ts` (claude → codex fork within sprites; verifies conversation transfer)

### Playwright UI

`packages/agents-server-ui/test/e2e/spawn-sprites.spec.ts`:

- Open spawn dialog, pick `target=sprites`, pick a kind, submit. Sidebar entry shows `data-target="sprites"`.
- Cross-provider Convert-target visibly disabled with tooltip.
- Cross-provider Fork visibly disabled with tooltip when source target is sandbox.

---

## §7. Build sequence

1. **Recon: live API smoke** — small script with a real `SPRITES_TOKEN` to confirm the `POST /sprites`, `WSS /exec`, `PUT /fs/...`, `DELETE` endpoints behave as documented. Catches API drift before code is written.
2. **`FlySpriteProvider` skeleton** — types + class shell + Bearer client. Layer 1 tests for `start`/`destroy` with mocked HTTP.
3. **Exec WebSocket adapter** — protocol translation. Layer 1 tests with mocked WS.
4. **Bootstrap script + integration in `start()`** — idempotency check. Layer 1 test: bootstrap calls expected exec sequence.
5. **`copyTo` via filesystem REST** — Layer 1 test with mocked PUT.
6. **`recover` via list-with-prefix** — Layer 1 test.
7. **Schema widening** — `target: z.enum(['sandbox','host','sprites'])` in `collections.ts` + `register.ts`.
8. **`LifecycleManager.providers['sprites']`** — register conditionally on `SPRITES_TOKEN`. Lifecycle wiring (status → bootstrap.starting → bootstrap.complete events).
9. **Conversion-target validation** — `processConvertTarget` rejects sandbox↔sprites and host↔sprites transitions.
10. **Layer 2 conformance** — `fly-sprites-conformance.test.ts` with `SPRITES=1` gate.
11. **Layer 4 e2e** — spawn / convert / fork on sprites for all 3 kinds.
12. **UI** — spawn dialog target option, convert-target / fork gates, timeline event rendering.
13. **Playwright** — `spawn-sprites.spec.ts`.
14. **Docs** — README sprites section, design backlinks, plan implementation findings.

---

## §8. Risks & tracked limitations

- **TL-S1: Sprites API is v0.0.1-rc30.** Pre-1.0; expect breaking changes. Pin to a known-good API version once published; integration tests catch drift. Mitigation: re-run conformance on each Sprites version bump.
- **TL-S2: No custom OCI image input.** Bootstrap latency on first sprite per agent (~10–30s for `opencode-ai`). Subsequent prompts hit the auto-sleep wake (~300ms). v1.5 can move to template-checkpoint to eliminate this.
- **TL-S3: No `cloneWorkspace`.** Workspace files don't transfer on fork within sprites. Fork inherits conversation only. v1.5 enables via cross-sprite checkpoint restore.
- **TL-S4: No cross-provider migration.** Local-docker agents can't move to sprites or vice versa. By design (the "no handover with local" constraint). Permanent UX limitation, not a defect.
- **TL-S5: DNS allowlist policy.** Sprites' egress is gated by a `Policy` endpoint. Tests that spawn agents which call out beyond the configured Anthropic/OpenAI endpoints may need policy updates. Document for operators.
- **TL-S6: Cost during conformance.** Real Sprites runs are billed (~$0.07/CPU-hour active; auto-sleep is free). Aggressive `afterEach` cleanup; `pnpm cleanup:sprites` script for runaway-detection. No CI gate prevents accidental long-running suites — operator responsibility.

---

## §9. Migration

- **Schema widening** is additive (`target` enum gets a third value). Existing `target: 'sandbox' | 'host'` rows remain valid; new spawns can use `'sprites'`.
- **Provider registration** is conditional on `SPRITES_TOKEN`. Deployments without the env var see no behavioural change.
- **No breaking changes** to existing CLIs, runtime APIs, or operator workflows.
- **Image rebuild not required** for local-docker users — the Dockerfile is unchanged.
- **Operator setup for sprites:** add `SPRITES_TOKEN=...` to `.env` (or equivalent secret-injection); restart the agents-handler. Spawn dialog automatically reveals the new target option.

---

## §10. Acceptance criteria

- `pnpm -C packages/coding-agents test` (unit) green: new `fly-sprites.test.ts` passes; existing tests unchanged.
- `DOCKER=1 pnpm -C packages/coding-agents test:integration` green: existing claude/codex/opencode conformance unchanged.
- `SPRITES=1 SPRITES_TOKEN=... pnpm -C packages/coding-agents test test/integration/fly-sprites-conformance.test.ts` green: all 8 L1 + all 8 L2 scenarios for all 3 kinds pass on real sprites.
- `SLOW=1 SPRITES_TOKEN=... pnpm -C packages/coding-agents test test/integration/spawn-sprites-*.e2e.test.ts test/integration/convert-kind-on-sprites.e2e.test.ts test/integration/fork-on-sprites.e2e.test.ts` green.
- `pnpm -C packages/agents-server-ui exec playwright test test/e2e/spawn-sprites.spec.ts` green.
- Manual: spawn a sprites agent via the dashboard, pick claude / claude-haiku-4-5, send "reply with ok", observe streaming timeline including `bootstrap.starting` → `bootstrap.complete` lifecycle rows. Restart the server; resume works.
- Manual: convert kind on a sprites agent (claude → codex), send another prompt, codex recalls prior context.
- Manual: fork a sprites claude agent into a codex sibling sprite, send a prompt to the fork, codex recalls source's conversation. (Workspace files don't transfer; document expected.)
- Convert-target sandbox↔sprites visibly disabled in the UI.
- Cross-provider fork (local-docker source → sprites) visibly disabled in the UI.
- README has a "## Fly Sprites provider" section with setup, limitations (TL-S1 through TL-S6), and the v1.5 roadmap items.
