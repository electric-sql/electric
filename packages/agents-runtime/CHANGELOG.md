# @electric-ax/agents-runtime

## 0.4.0

### Minor Changes

- c48c1a8: Stream model reasoning / extended-thinking content into the UI. While
  the model is "thinking" (Anthropic extended thinking, DeepSeek-R1
  reasoning, Moonshot K2, OpenAI Responses summaries) the agent response
  now shows the live reasoning text faded above the answer, with the
  existing `Thinking` shimmer heading and an elapsed-time ticker. Once
  the reasoning settles it collapses to `▸ Thought for 12s` — click to
  expand. Multiple reasoning rows per run are rendered independently in
  order, so tool-using turns show each step's reasoning separately.

  Implementation:
  - **Schema** — `reasoning` row gains `run_id`, `encrypted` (Anthropic
    redacted-thinking opaque payload, must round-trip back to the model
    verbatim), and `summary_title` (extracted at write time for
    providers that emit a bolded heading). New `reasoningDeltas`
    collection mirrors `textDeltas` for streamed content.
  - **Bridge** — `OutboundBridge` gains `onReasoningStart` /
    `onReasoningDelta` / `onReasoningEnd`, parallel to the text path.
  - **Adapter** — `pi-adapter.ts` routes pi-ai's `thinking_start` /
    `thinking_delta` / `thinking_end` events to the bridge, parses the
    `**Title**\n\n<body>` heading (OpenAI Responses only) once at
    `thinking_end` so the UI doesn't re-parse on every render.
  - **Timeline** — `EntityTimelineRunRow` gains a live
    `reasoning: Collection<EntityTimelineReasoningItem>` with content
    built from a delta-join, mirroring `EntityTimelineTextItem`.
  - **UI** — New `<ReasoningSection>` component renders above the
    answer in `AgentResponseLive`. Live shows faded markdown via
    `Streamdown` with `ThinkingIndicator` heading + summary title +
    elapsed-time ticker. Settled collapses to `Thought for Ns` with
    click-to-expand. Redacted Anthropic blocks render a single muted
    line — content is opaque, but the encrypted payload is still
    persisted server-side so the model gets it back next turn.

  Providers without reasoning emit nothing → no reasoning section
  rendered. Historical responses recorded before this PR have no
  closure cue, same as today.

  Anthropic extended thinking is now always-on for reasoning-capable
  models: `reasoningEffort: auto` maps to the minimal budget
  (1024 tokens), matching the OpenAI branch where `auto` already
  defaulted to `minimal`. Explicit `low`/`medium`/`high` scale the
  budget as before.

### Patch Changes

- 708c946: Add `/goal` slash command to Horton sessions. Lets the user set an
  objective with an optional token budget; the agent works autonomously
  toward the goal and stops when it calls `mark_goal_complete` or when
  the run exceeds the budget.

  ```text
  /goal set "ship feature X" --tokens 50k   # default 50k tokens
  /goal set "explore" --unlimited           # opt out of the cap
  /goal show                                 # current state
  /goal complete                             # mark done manually
  /goal clear                                # remove the goal
  ```

  ## Behaviour
  - **One goal per session**, persisted as a `kind: 'goal'` entry on the
    `manifests` collection — resumes automatically across desktop
    restarts.
  - **Mid-run token enforcement**: an `onStepEnd` hook on the outbound
    bridge surfaces per-step token counts; Horton accumulates them and
    aborts the active `ctx.agent.run()` via an `AbortController` once
    `tokensUsed >= tokenBudget`. The cap counts **new input (fresh +
    cache-write tokens) + output** per step — prompt-cache reads (which
    re-count the whole conversation on every warm step) are excluded, so
    the budget tracks new work rather than context size.
  - **Live progress**: the goal banner ticks up after each step. The
    manifest update is written via `writeEvent` directly (not the
    wake-session's staged manifest transaction, which only commits at
    end-of-wake — too late for a long-running run).
  - **`mark_goal_complete` tool**: registered on Horton's tool list.
    Flips status to `complete`, surfaces in the chat as an ordinary
    agent reply via the new `ctx.replyText` helper.
  - **State-changing `/goal` commands interrupt the active run** —
    typing `/goal complete`, `/goal clear`, or `/goal set` while a run
    is in flight signals SIGINT alongside sending the message, so the
    prior run aborts instead of finishing the old work first. `/goal
show` is read-only and does not interrupt.
  - **Budget-limited stop message**: when the cap is hit mid-run, the
    agent posts a synthetic reply explaining what happened and
    suggesting a larger budget to resume.

  ## Plumbing
  - `entity-schema.ts` — new `ManifestGoalEntryValue` (objective,
    status, tokenBudget, tokensUsed, createdAt, updatedAt) added to the
    manifest discriminated union.
  - `goal-api.ts` (new) — `setGoal` / `clearGoal` / `getGoal` /
    `markGoalComplete` / `updateGoalUsage`. All goal mutations share a
    single ordered write channel (direct `writeEvent` upserts, live for
    the UI) plus an in-wake read-your-writes cache, so a mutation firing
    mid-run can never snapshot — and replay — a stale `tokensUsed` over
    a fresher one. `updateGoalUsage` additionally never decreases the
    counter.
  - `goal-command.ts` (new) — `/goal` parser (`--tokens N|50k|1.2m|
unlimited`, `--unlimited` flag, subcommand aliases `done`/`status`)
    and dispatcher.
  - `tools/goal-tools.ts` (new) — `createMarkGoalCompleteTool` exposes
    the completion signal to the LLM.
  - `outbound-bridge.ts` — new optional `OutboundBridgeHooks.onStepEnd`
    callback, threaded through `pi-adapter` and the `AgentConfig` passed
    to `useAgent`.
  - `context-factory.ts` — `AgentHandle.run` now accepts an optional
    `abortSignal` and combines it with the runtime's `runSignal`. New
    `ctx.replyText(text)` writes a complete runs + texts + textDeltas
    sequence so synthetic replies render in the chat. New goal-related
    methods exposed on `HandlerContext`.
  - `horton.ts` — `tryHandleSlashCommand` intercepts `/goal *` before
    the LLM; `/goal set` enqueues a one-shot kickoff so the agent starts
    immediately; `assistantHandler` wires the budget-enforcing
    `onStepEnd`, aborts on overflow, and posts the explanation reply.
  - `agents-server-ui` — new `GoalBanner` component above the timeline
    (objective + budget bar + status badge). `MessageInput` aborts the
    active run when a state-changing `/goal` command is submitted.
    `EntityTimeline` / `EntityContextDrawer` handle the new `goal`
    manifest kind.

- 8bc630a: Add generic externally-writable custom collections for agent entity state: collections opt in via `externallyWritable`, writes go through an authenticated schema-validated endpoint that stamps the principal into a read-only `_principal` column, and `createEntityTimelineQuery` can project them into the timeline via `customSources`. Comments are reimplemented as one such collection, gated per agent type through a reserved `comments/v1` contract that the UI keys its comment affordances on. External writes are restricted to a per-collection operations allowlist (insert-only by default), and comments are insert-only.
- c1f3aac: Show only uncached input tokens in the per-response token usage label.

  The input side previously summed `input + cacheRead + cacheWrite`, so
  on warm-cache turns the meta row re-counted the entire conversation on
  every step and ballooned into a cumulative number that said nothing
  about the work the response actually did. The adapter now surfaces the
  uncached side only — fresh prompt tokens plus cache writes, with
  prompt-cache reads excluded. (`cacheWrite` is counted because
  cache-enabled providers report newly appended prompt tokens there,
  with `input` collapsing to ~0.)

  Steps recorded before this change keep their stored cache-inclusive
  totals — both step fields are optional and the display just sums
  what's persisted, so no migration is needed.

## 0.3.13

### Patch Changes

- baee54e: Increase agent tool call timeouts to a 2-minute default with a 10-minute maximum, and allow bash calls to request longer timeouts per command.
- 50e93c2: Add editable session titles: a `set_title` tool for Horton, click-to-edit UI in EntityHeader, and txid propagation for tag/send/inbox mutations so clients can await sync consistency.
- 73c6f89: Add default model-provider timeout/error handling for agent runs and render durable run errors in the UI.
- 4640704: Add pg-sync observation source enabling agents to observe Electric Postgres shape streams and wake on matching row changes (insert/update/delete). Includes server-side bridge management with cursor persistence, durable stream forwarding, and an `observe_pg_sync` tool for Horton agents.
- 87be539: Fix two resilience bugs that could leave the desktop agents runtime unable to pick up sessions until a full app restart, and port the pull-wake runner lifecycle to an xstate state machine.
  - `installDurableStreamsFetchCache` is now idempotent (with a warning on repeat calls), so restarting the built-in agents runtime no longer stacks duplicate HTTP cache interceptors on the global undici dispatcher.
  - The pull-wake runner now recovers when the wake stream connection hangs during the connecting phase: repeated heartbeat failures abort the in-flight connection attempt instead of only resetting an already-established stream.
  - The runner lifecycle (stopped → connecting → streaming → reconnecting → stopping) is now an xstate machine, so in-flight connections, stream sessions, and backoff timers are cancelled automatically on state transitions, and every state × event pair is pinned by an exhaustive transition test matrix.

- 004bea1: Render standalone entity stream errors in the timeline with their error code and message.
- Updated dependencies [baee54e]
  - @electric-ax/agents-mcp@0.2.3

## 0.3.12

### Patch Changes

- 5238055: Show per-response token usage in the agent meta row, e.g. `1.2k ↑ 412
↓`. Updates as each step settles — for a single-turn call this lands
  once at done; for tool-using runs the counter jumps at each step
  boundary (the LLM SDK only emits `usage` at end-of-step, so we can't
  tick smoothly between tokens).

  Plumbing:
  - `StepValue` gains optional `input_tokens` / `output_tokens` columns
    (Zod + TS). Strictly additive: events recorded before this change
    stay valid since both fields are optional, so no migration.
  - `outbound-bridge.ts:onStepEnd` now persists the `tokenInput` /
    `tokenOutput` it already received from `pi-adapter.ts` — previously
    those values were accepted and silently dropped.
  - `EntityTimelineStepItem` / `IncludesStep` surface the new fields,
    and the three `.select()` blocks that materialize steps include
    them.
  - The cached `agent_response` section gets a `tokens?: { input?,
output? }` summed across the run's steps at section-build time, and
    the section-cache fingerprint factors in step token deltas so a
    late-arriving `onStepEnd` invalidates a stale section.

- 916f6cd: agents-mobile: native slash-command composer for the Horton prompt. The in-session and new-session inputs gain slash-command autocomplete, structured `composer_input` payloads, and inline command/argument highlighting — reaching feature parity with the desktop composer, on a native `TextInput` rather than a WebView. The slash-command grammar and serializer move into `@electric-ax/agents-runtime` (exported via `/client`) as the shared source of truth for both surfaces; the desktop composer repoints to them with no behaviour change.
- a044ede: agents-server, agents-runtime: fix two first-spawn races that prevented writer-side shared-state entities from reaching their first handler run on a fresh tenant.

  **agents-server**: `PUT /_electric/shared-state/<id>` now inserts the corresponding `shared_state_links` row synchronously whenever the request carries a valid `electric-owner-entity` header and the principal can access the entity. Previously this PUT only ran the authz check; the link row was created later — asynchronously — when the entity's manifest stream event was processed via `applyManifestEntitySource`. The runtime's `mkdb` wiring schedules the PUT and the preload GET back-to-back, so the GET always raced ahead of the eventually-consistent link insert and returned `401 UNAUTHORIZED: Principal is not allowed to read shared state` on every fresh-tenant first wake.

  **agents-runtime**: `createChildDb` (used by entity observations) now swallows `Stream not found` / `404` on initial preload. A handler may legitimately observe an entity that hasn't been spawned yet — e.g. a parent observes its own future child to wake on the child's `runFinished`. Treating the 404 as "no events yet" matches the spirit of the observation (we'll be woken when the entity appears); the previous unconditional throw aborted the entire wake with `HTTP Error 404 ... Stream not found`, and the entity could never recover because the spawn that would create the child never ran.

  Verified end-to-end with OpenFactory's `daily-digest` entity (uses `mkdb` + `observe(db(...))` + `observe(entity(<future child>))`) against a freshly torn-down local agents-server: the first `run-now` now writes the digest row, the discord-router subscriber picks it up, and the digest reaches Discord — without manual SQL or out-of-band link bootstrapping.

## 0.3.11

### Patch Changes

- d15852d: Fix runtime-originated agent send attribution by sending `from_principal`, `from_agent`, and the active wake write token, and accepting `from_agent` when backed by a valid agent write token.
- 5aa2d78: Add `ctx.fork(opts?)` to `HandlerContext`, with an opts shape that mirrors `ctx.spawn`'s where the semantics map:

  ```ts
  ctx.fork(opts?: {
    targetEntityUrl?: string  // omit for self-fork
    initialMessage?: unknown  // server delivers to the fork in the same round-trip (not atomic with creation)
    wake?: Wake               // overrides the default runFinished + includeResponse
    tags?: Record<string, string>
    observe?: boolean         // `false` = fire-and-forget (no parent, no wake, no manifest entry)
  })
  ```

  By default (`observe: true`), the new fork is a CHILD of this entity (same parent-ownership model as `ctx.spawn`), and a `runFinished + includeResponse` wake is registered on it server-side. Reply delivery uses the same manifest-anchored wake mechanism `ctx.spawn` uses — when the fork's next run finishes, this entity wakes with the response. `observe: false` opts out of the parent relationship entirely: no parent URL, no wake subscription, no manifest entry on the parent's stream.

  Internally writes a `kind: 'child'` manifest row on the parent's stream alongside the server-side wake registration, mirroring the spawn flow's bookkeeping so the relationship persists across wakes. Wired through new fields on `RuntimeServerClient.forkEntity` (`parent`, `wake`, `initialMessage`, `tags`) and `WiringConfig.forkEntity`. A `normalizeWake` helper translates the user-facing `Wake` type into the wakeRegistry-compatible shape, same logic `createOrGetChild` uses for spawn.

  The `send` tool's `payload` description now documents the canonical `{ text: "..." }` shape for chat-rendered targets (Horton sessions, agent forks) so messages emitted by `send` render as chat bubbles instead of blank bars.

- 1099366: Docker sandbox creation now pulls the image only when it isn't already present
  locally, honoring the documented `pullIfMissing` semantics. Previously every
  container create called `docker pull`, which round-trips to the registry even
  for a fully cached digest-pinned image — making creation needlessly slow and
  prone to failing whenever the registry was briefly unreachable.
- 1099366: Fix leftover Docker sandbox containers (`electric-sbx-*`) piling up.

  Sandbox containers are meant to be short-lived, but several gaps let them
  outlive the work they were created for — opening the desktop app could leave
  15+ containers running that were never explicitly started. This closes those
  gaps so a container only exists while something is actually using it:
  - **Created only when used.** A container now starts the first time an agent
    actually uses its sandbox (runs a command, reads/writes a file), so trivial
    wakes (scheduled ticks, bookkeeping) no longer spin one up.
  - **Cleaned up on quit.** Shutdown now tears down idle containers immediately
    instead of leaving their delayed-teardown timers to die with the process.
  - **Leftovers reclaimed at startup.** Containers are tagged with the process
    that created them; at startup, those whose owner is gone are reclaimed
    (throwaway ones removed, reusable ones stopped so their files survive), while
    containers a live process is still using are left untouched.

  Also: a failed container setup step no longer strands an untracked container,
  and all sandboxes are grouped under one `electric-sandboxes` entry in Docker
  Desktop so they can be stopped/removed together.

## 0.3.10

### Patch Changes

- 3ecdade: Add structured composer input support, slash command registration, and proactive skill context loading.

## 0.3.9

### Patch Changes

- 9fdf96a: Track agent-originated sends with `from_agent` / `from_principal` inbox metadata and render agent/self-send inbox messages with JSON payload fallbacks.
- 312f5ec: Promote `skills/types` to a first-class tsdown entry so its `.d.ts` is a stable
  named output, avoiding an intermittent dts generation failure under CI's
  parallel build.
- 6434774: Add owner-default agents-server permissions with type-level spawn grants, entity grants, effective permission materialization, principal-scoped entity observation streams, shared-state access links, runtime registration permission grants, and default user spawn grants for built-in Horton and Worker types.

  Existing entity observation bridges are rebuilt after upgrade because pre-permission bridge rows do not include principal attribution.

  Entity `manage` grants participate in read visibility, entity-type `manage` grants participate in spawn visibility, and broad parented spawn-time grants require `manage` on the parent.

- 4f88e6d: Dedupe `@tanstack/db` to a single instance.

  `@tanstack/db` is effectively a singleton (collections/transactions/live
  queries use `instanceof` checks and module-level state), but the lockfile had
  drifted to several `0.6.x` copies, breaking StreamDB collections. Adds a root
  `pnpm.overrides` entry collapsing the `0.6.x` line to `0.6.7`, scoped to
  `>=0.6.0 <0.7.0` so the legacy example starters pinned to `0.0.x`/`0.5.8` are
  untouched. Stopgap until `@durable-streams/state` ships `@tanstack/db` as a
  peer dependency.

  Also raises the `agents-mobile` iOS minimum deployment target to 16.4 (via
  `expo-build-properties`). The chat renders in an Expo DOM WebView whose markdown
  stack ships regex lookbehind, which JavaScriptCore only parses on iOS 16.4+;
  below that the whole DOM bundle fails to parse and the chat renders blank.

- b2bf806: Upgrade `@durable-streams/state` to `0.3.1` and drop the `@tanstack/db` pnpm override.

  `@durable-streams/state@0.3.x` makes `@tanstack/db` an optional peer dependency (it was a direct `^0.6.0` dependency) and splits its tsdb-coupled tools into a `@durable-streams/state/db` subpath. tsdb-specific imports (`createStreamDB`, `queryOnce`, `createTransaction`, query operators, etc.) now come from `@durable-streams/state/db`; the bare entry keeps only the tsdb-free types and helpers.

  Because state no longer pulls its own `@tanstack/db` copy, the root `pnpm.overrides` collapsing `@tanstack/db@>=0.6.0 <0.7.0` to `0.6.7` is removed. To keep a single `0.6.7` instance without it, `@tanstack/react-db` is raised to `^0.1.85` and `@tanstack/electric-db-collection` to `^0.3.5` (both pin `@tanstack/db@0.6.7`), and `@durable-streams/server` to `^0.3.7` (depends on `state@0.3.1`, removing the lingering transitive `state@0.2.9`).

- 74d2341: Fix Codex auth for low-cost tool calls by passing fresh access tokens to URL extraction and worker tools.
- d14d9a9: Remove the unused per-entity agents error stream. Entities now expose only their main stream; spawn, fork, registry lookup, terminal signal handling, UI/runtime types, client helpers, and conformance tests no longer create or require an entity-level error stream.
- 7c62024: Remove the old child-handle result API (`EntityHandle.run` and `EntityHandle.text()`) and internal spawn run promise plumbing. Child coordination should use durable `runFinished` server wakes with `includeResponse` so parent handlers can return safely instead of waiting in-memory for child output.

## 0.3.8

### Patch Changes

- 17b374f: Adds the `Sandbox` primitive (`@electric-ax/agents-runtime/sandbox`) for isolating LLM-driven tool calls. Three providers ship: `unrestrictedSandbox()` (explicit pass-through), `remoteSandbox({provider: 'e2b'})` (E2B as an optional peer dep), and `dockerSandbox()` (container isolation via `dockerode` as an optional peer dep).

  Built-in entities (Horton, Worker) default to `unrestrictedSandbox` via the new `chooseDefaultSandbox(workingDirectory)` helper. Stronger isolation is opt-in by constructing `dockerSandbox` or `remoteSandbox` directly — `dockerSandbox` is the recommended path for multi-entity hosting.

  Behavior changes folded in: bash no longer forwards `process.env` to children (removes the trivial `env`-dump leak of secrets like `$ANTHROPIC_API_KEY` — note the host-sharing `unrestricted` provider still can't fully contain secrets, e.g. via `/proc/<ppid>/environ`, so use `docker`/`remote` for untrusted or multi-tenant entities), tool descriptions corrected, and read/write/edit reject symlink escapes from the workspace.

  Runtimes advertise named **sandbox profiles** (e.g. `local`, `docker`) to the agents-server; spawn requests pick a profile by name, the server validates the choice against the target runner's advertised set, and the new-session UI surfaces a picker. Internally, the built-in tool factories (`createBashTool`, `createFetchUrlTool`, etc.) now route their filesystem and network access through the active `Sandbox`.

- 1a7d72e: Preserve volatile context source order in `assembleContext()` instead of globally sorting by `at` timestamp. Fixes a bug where the SIGINT reordering performed by `reorderInterruptedRuns()` was undone by a downstream sort, causing interrupted run output to appear after the interrupt marker in the model transcript.
- d5708c7: Add `EventPointer { offset, subOffset }` for addressing single events on a durable stream. Widen `__electricRowOffsets` side-tables on `EntityStreamDB` collections from `Map<key, string>` to `Map<key, EventPointer>`, with pointers minted along log-entry boundaries (grouped by each item's `headers.offset`) so they round-trip cleanly through `Stream-Fork-Sub-Offset` regardless of how a live read is chunked.
- f2d3d5e: Render self-send wake notifications with the sent message payload in the agent timeline.

## 0.3.7

### Patch Changes

- 9e01e58: Preserve and surface detailed run failure information from the Pi adapter so failed runs can render actionable error details instead of a generic failure message.

## 0.3.6

### Patch Changes

- e9ea591: Show detailed agent run failure information in the timeline instead of the generic `Run failed` fallback. Run errors now include their error code, failed tool calls preserve and render their error text, and failed runs fall back to tool errors or finish reasons when no run error row is available.
- 98b51d6: Update Electric Agents packages to depend on the stable Durable Streams
  packages instead of pkg.pr builds. This pulls in `@durable-streams/client`
  0.2.6, `@durable-streams/server` 0.3.5, and `@durable-streams/state` 0.2.9.
  Examples now resolve `@electric-ax/agents-runtime` from the workspace so they
  do not keep older registry runtime builds pinned in the lockfile.
- aed2189: Add Kimi / Moonshot API support for local Horton runtimes, including model catalog entries, runtime provider resolution, desktop credential persistence, and UI credential inputs.
- 52a641f: Add manifest-backed attachments for agents.

  Attachments are uploaded through entity routes, stored in private attachment streams, referenced by manifest entries, and exposed to runtime handlers through `ctx.attachments`. The server UI can attach image files to user messages, renders message attachments with authenticated preview/download actions, exposes image previews from attachment manifest rows, rolls back uploaded attachments when send fails, and hides image attachment controls for models whose registered pi-ai metadata does not include image input. Image hydration now has a simple newest-images byte/count guardrail. Horton title generation now also works when the first user message is sent after attachment upload, including image-only starts.

## 0.3.5

### Patch Changes

- d344c32: Treat Electric Agents server URLs as opaque tenant-scoped base URLs rooted at `/t/<tenant-id>/v1`, migrate desktop and mobile Cloud clients to that URL shape, move observation stream ensure endpoints under `/_electric/observations/*/ensure-stream`, rename the pre-alpha entity/cron/schema/tag/docs APIs to their Electric Agents names, add a non-interactive `electric agents view` transcript command, and make Horton title extraction work with lightweight desktop inbox collection facades.

  Send the done callback for completed wake checkpoints during graceful shutdown, preventing desktop reloads from leaving already completed DS subscription claims pending.

- c1834f3: Prepare the mobile app for Expo EAS builds and CI. Adds dynamic Expo config, EAS build profiles, mobile CI/export scripts, and aligns shared React/TypeScript dependency resolution so the Expo DOM embed typechecks and passes `expo-doctor`.
- 319e405: Explicit ChatGPT / Codex opt-in with native PKCE OAuth sign-in (opened in the user's default browser to avoid Cloudflare bot detection), per-source consent for detected Codex CLI / OpenCode logins, an inline "Use this login?" prompt under the new-session composer, and a "Restart local runtime" banner gated on credential changes. The runtime no longer reads `~/.codex/auth.json` implicitly — it now requires `ELECTRIC_CODEX_ACCESS_TOKEN` and honours `ELECTRIC_CODEX_REQUIRE_OPT_IN=1`.

## 0.3.4

### Patch Changes

- 833a1cb: Add agent event source contracts and dynamic event source subscription tools. Agents can list active, agent-visible webhook-backed event sources, subscribe entities to resolved bucket streams with explicit lifetimes, and persist those subscriptions as manifest-backed wake registrations. Bucket params are validated against the advertised `paramsSchema` before a subscription is accepted. Horton now receives these tools through the built-in agents runtime by default. Runtime-managed event source wakes now hydrate matching webhook rows into the agent trigger message so tool-created subscriptions include the event payload that caused the wake.
- 833a1cb: Add `webhook(endpointKey, { bucket })` observation sources for webhook ingress streams, including deterministic stream path generation, event schema, default wake registration, and observe-time stream creation before preload.

## 0.3.3

### Patch Changes

- 9c2c3ae: Settle interrupted agent runs promptly when the model stream ignores abort completion, while preserving aborted run context ordering.
- a70567e: Add DeepSeek as a supported LLM provider.
  - `agents-runtime`: `detectAvailableProviders()` now detects `DEEPSEEK_API_KEY`; `deepseek` added to `AvailableProvider` type, `PREFERRED_IDS_BY_PROVIDER`, and `envCatalog()`
  - `agents`: model catalog probes `https://api.deepseek.com/v1/models` to surface available DeepSeek models (`deepseek-v4-flash`, `deepseek-v4-pro`); `deepseek-v4-flash` is the default fallback choice
  - `agents-desktop`: `ApiKeys` gains a `deepseek` field persisted in the keychain and mirrored to `DEEPSEEK_API_KEY` in the runtime environment
  - `agents-server-ui`: `ApiKeysForm` gains a DeepSeek API key input; `OnboardingModal` and `CredentialsPage` pass and persist the new field

- b3d4f02: feat: add self-send option to `send`
- dffbf62: fix: no more duplicated runFinished wakes

## 0.3.2

### Patch Changes

- e13cad1: Add durable entity signals and signal-driven stop controls for agents. The server, runtime, conformance tests, and CLI now use signal APIs, persist signal events, and let the UI send `SIGINT` to cancel active generations with pending stop feedback.
- 4d9c36e: Add a fine-grained reactive entity timeline query and migrate the agents UI to use it. Timeline rows are maintained by TanStack DB using multi-source queries and live child collections, so streamed agent responses update incrementally without rematerializing the whole chat timeline. Update the mobile app to consume the row-based timeline shape and pin React to the React Native renderer version. Keep the conformance property-test model aligned with generated entity type names.

## 0.3.1

### Patch Changes

- ca01b9d: Add the React Native agents mobile app package.
- 9f10b20: Update Durable Streams server webhook support to Ed25519/JWKS signatures. Agents-server now exposes its own stream-root JWKS endpoint, supports injectable webhook signing keys/signers, validates upstream Durable Streams webhook signatures, rewrites subscription signing metadata to the agents-server JWKS, re-signs forwarded webhook deliveries, and preserves bodyless upstream 204/205/304 subscription responses. Agents-runtime now validates webhook signatures before dispatching wakes.

## 0.3.0

### Minor Changes

- adc99e9: Move the `.md`-skill-directory loader (`createSkillsRegistry`) and the per-entity skill tool builder (`createSkillTools`) — together with the `SkillsRegistry` / `SkillMeta` types and the underlying `preamble` / `extract-meta` helpers — out of `@electric-ax/agents` and into `@electric-ax/agents-runtime`, alongside the rest of the entity-runtime primitives.

  No behaviour change. Same files, re-rooted to the package whose dependencies they already use: skills depend on `completeWithLowCostModel` and the runtime logger, both already in `agents-runtime`. The skills code uses zero symbols defined in `@electric-ax/agents`, so the previous arrangement had the dependency graph pointing the wrong way.

  This makes the skills primitives available to any package built on top of `agents-runtime` (e.g. external Discord / Slack / CLI bots) without pulling in Horton, Worker, or `BuiltinAgentsServer` as transitive context.

  Existing internal call sites in `@electric-ax/agents` (`bootstrap.ts`, `agents/horton.ts`) now import from `@electric-ax/agents-runtime`. No public API of `@electric-ax/agents` is affected — the skills surface was never re-exported from its `index.ts`, so embedders that only consumed Horton / Worker / Server APIs continue to work unchanged.

### Patch Changes

- 9c275b7: Add `send` tool exposing `ctx.send()` to LLM agents (Horton and Worker) for sending messages to Electric entities by URL. Change `send()` return type from `void` to `Promise<SendResult>` so callers can await delivery confirmation and handle failures with structured error results.
- 1ab43f5: The built-in `bash` tool's description no longer claims commands run in a sandboxed working directory. Behavior is unchanged; sandboxing is a deployment-time concern that lives outside the tool definition.
- 99ac6fd: Pin Durable Streams dependencies to commit `5d5c217` so local development resolves the same subscription-control routing code as the PR build.

## 0.2.2

### Patch Changes

- e126eba: Harden pull-wake runner lifecycle with a state machine, heartbeat-driven stream resets, and exponential reconnect backoff (1s-30s). Add granular `status` field to `PullWakeRunnerHealth` (`stopped | starting | connecting | streaming | reconnecting | stopping`). The `onError` callback is now reporting-only (`(Error) => void`) - it can no longer control runner lifecycle. `stop()` rethrows `drainWakes` errors so callers observe wake handler failures. Event-driven heartbeat throttling avoids stale diagnostics between fixed-interval heartbeats. Durable Streams clients now append stream and `__ds` subscription control paths to the configured backend URL prefix without inferring a `/v1/stream` layout, so pull-wake subscriptions work behind arbitrary DS backend prefixes. Remove the stale `StreamClient.getConsumerState()` helper for the old Durable Streams `/consumers` endpoint.
- e126eba: Add pull-wake runner health check endpoint and rename `owner_user_id` to `owner_principal` across the runners system. The `GET /_electric/runners/:id/health` endpoint returns comprehensive diagnostics including runner state, client-reported stream/heartbeat/claim metrics, active claims, and dispatch stats with a derived health status (healthy/degraded/unhealthy). The `PullWakeRunner` now tracks internal diagnostics and reports them to the server via heartbeats, stored in a separate `runner_runtime_diagnostics` table so the main `runners` shape stays stable for normal UI sync. The `owner_user_id` → `owner_principal` rename stores canonical principal URLs instead of keys, with strict validation and canonicalization at route boundaries. The migration expires active runner claims and deletes existing runner rows as part of the principal rewrite. This is a breaking change with no backward compatibility — all callers must send principal URLs.

## 0.2.1

### Patch Changes

- dfc9a45: Combine the desktop app packaging setup, app settings, and agents UI improvements. Adds desktop packaging assets/configuration, multi-server desktop settings, improved chat and workspace UI behavior, and queued inbox message modes in the runtime.
- 83204d9: Add principals support to the agents system. Every API request now carries a `Principal` (user, agent, service, or system) threaded through the full request lifecycle. Runner dispatch is scoped to the authenticated owner via dispatch policy authorization. The runtime exposes `ctx.principal` in handler context so agent code can implement principal-aware logic. The server UI uses asserted identity headers for dev-mode authentication.
- Updated dependencies [dfc9a45]
  - @electric-ax/agents-mcp@0.2.2

## 0.2.0

### Minor Changes

- dec65ae: Port pull-wake runners onto the tenant-aware agents-server routing refactor.

  Agents-server now supports runner registration, runner-owned pull-wake subscriptions, dispatch policy resolution, subscription stream linking, compact Durable Streams wake claims, callback-forward claim lifecycle handling, and claim-scoped write tokens. Runtime built-ins can register pull-wake runners, tail runner wake streams, claim work through the server, heartbeat offsets, and acknowledge completed work. The CLI, desktop integration, server UI, and local full-stack compose setup now use runner-backed local sessions for the pull-wake flow.

  Saved agents-server connections can include additional request headers for tenant-aware deployments, and CLI/runtime URL handling now preserves base query parameters such as `?secret=...`.

- 08e85a0: Refactor agents-server HTTP routing around a single `globalRouter` entrypoint passed a flat `TenantContext`.

  The `ElectricAgentsServer` class now owns lifecycle setup only and dispatches each request through an OSS-only wrapper router that layers dashboard and mock-agent routes over `globalRouter.fetch(request, tenantContext)`. This prepares the exported `globalRouter` for library-mode use by callers that build tenant context outside the OSS server class without pulling in the bundled UI or mock agent.

  Breaking change: entity RPC URLs moved from `/:type/:instanceId/...` to `/_electric/entities/:type/:instanceId/...`. This affects entity spawn/get/head/delete, send, fork, tag, and schedule endpoints. The root namespace is now durable-streams pass-through, with no reserved entity control routes.

  Breaking change: the `@electric-ax/agents-server` package root now only exports the library-mode routing assembly surface: DB setup helpers, `AgentsHost`, `StreamClient`, `globalRouter`, `TenantContext`, `GlobalRoutes`, `EntityBridgeCoordinator`, and tenant helpers. OSS server classes, subrouters, entity-manager internals, scheduler/wake-registry internals, schema helpers, and entity response helpers are no longer root exports.

  The runtime server client, bundled agents-server UI, and conformance tests have been updated for the new route layout. Agents-server control-plane routes now use shared TypeBox/Ajv body validation.

### Patch Changes

- dec65ae: Resolve configured pull-wake runner headers before opening the durable wake stream.
- Updated dependencies [dec65ae]
  - @electric-ax/agents-mcp@0.2.1

## 0.1.3

### Patch Changes

- 1df7cce: Add Model Context Protocol (MCP) support — agents can call tools, read resources, and use prompts from external MCP servers (stdio + Streamable HTTP), with OAuth handled by the runtime. New `@electric-ax/agents-mcp` package ships the `Registry` API, transports, OAuth bridges, and opt-in `keychainPersistence` / `filePersistence` helpers. The Electron desktop app exposes a Settings → MCP Servers page and a `mcp.servers` block in `settings.json` that layers with the per-workspace `mcp.json`. Built-in `horton` and `worker` agents see registered MCP tools transparently via `mcp.tools()`.
- f509387: Stabilise chat section identity across streaming updates: `buildSections` / `buildTimelineEntries` in `use-chat` now key a fingerprint-based section cache by `run.key` / `msg.key`, so settled rows return the same reference even when the upstream pipeline rebuilds row objects. Adds a bounded prune pass + a `__resetSectionCachesForTesting` hook for test isolation. Also small cleanups in `tools/context-tools.ts`.
- 590aabb: Improve the agents UI timeline and reactivity, add a browser-safe runtime client export, and route built-in agent metadata extraction through the configurable low-cost model runner.
- 744c47f: Replace static entity write tokens with claim-scoped tokens. Write tokens are now issued when a consumer claims a wake and revoked on done, preventing leaked credentials from granting permanent write access. Removes `writeToken` from webhook notifications and spawn response headers.
- 28d127b: Electron desktop shell, tile-based workspace, and per-session
  working-directory picker.
  - `@electric-ax/agents-desktop`: new package — Electron app
    bundling a local Horton runtime, system-tray status, multi-
    window support, frameless windows with in-app title bars,
    native menus, About dialog, on-launch API key prompt
    (Anthropic / OpenAI / Brave), localhost agent-server discovery,
    and HMR via `vite-plugin-electron`.
  - `@electric-ax/agents-server`: entrypoint support for the local
    desktop runtime wiring.
  - `@electric-ax/agents-server-ui`: tile-based workspace (DnD,
    splits, persisted layouts, shareable URLs), redesigned new-
    session screen, refreshed dropdown chrome (`Combobox`
    primitive, sentence-case section headings, ServerPicker-style
    rows), sidebar filter & view menu with grouping by date /
    type / status / working dir, full Settings screen with
    General / Appearance / Local Runtime categories.
  - `@electric-ax/agents`: Horton accepts an optional
    `workingDirectory` spawn arg so each session can run against
    its own project root without restarting the runtime.
  - `@electric-ax/agents-runtime`: tool-pair preservation during
    compaction and matching tool-call events by id (bug fixes
    surfaced while building the desktop UI).
  - `@electric-sql/experimental`, `@electric-sql/react`: align test
    type configuration with DOM AbortSignal types used by the client.

- 6399147: Preserve the caller's HOME environment variable when running bash tool commands so CLIs can find user-level config and credentials.
- a3cee92: Remove the coder entity (coding-session). The `registerCodingSession`, `useCodingAgent`, `CodingSessionHandle`, and related types/tools (`spawn_coder`, `prompt_coder`) are no longer available. The `agent-session-protocol` dependency is also removed.
- 7f8947a: Require low-cost model calls to provide an explicit system prompt and add prompts for URL extraction and skill metadata extraction.
- Updated dependencies [1df7cce]
  - @electric-ax/agents-mcp@0.2.0

## 0.1.2

### Patch Changes

- 1cb5020: feat: add better typing to all agent callbacks (missed changeset in 6bb1c7a0dc72d1ca76ee439f0cbd4e1470e84e0c)
- 1cb5020: fix: ensure fork doesn't reply last turn of the agent (missed changeset in 19f52f410f8a4fd7d3094b91d0aa2f3b39802a72)

## 0.1.1

### Patch Changes

- e0b588f: Bump `@electric-ax/durable-streams-*-beta` dependencies to the latest published versions (`client@^0.3.1`, `state@^0.3.1`, `server@^0.3.2`).

## 0.1.0

### Minor Changes

- 4987694: Move tool implementations (bash, read, write, edit, fetch_url, web_search, schedules) from `@electric-ax/agents` to `@electric-ax/agents-runtime` so they are available without importing the built-in agents package. **Breaking:** tool exports removed from `@electric-ax/agents` — import from `@electric-ax/agents-runtime` instead.

### Patch Changes

- 89debcf: Expose `ctx.recordRun()` returning a `RunHandle` so non-LLM entities can bracket external operations (CLI subprocess, HTTP call, etc.) with the same `runs` collection events that `useAgent` writes internally — satisfying the `runFinished` wake matcher and surfacing a response payload via `RunHandle.attachResponse(text)`.

## 0.0.4

### Patch Changes

- 9024ec2: fix: allow for `onPayload` to support non-standard model APIs

## 0.0.3

### Patch Changes

- 5ef535b: feat: allow arbitrary models instead of hardcoding anthropic
- 6d8be8b: fix: ensure api keys are correctly passed through

## 0.0.2

### Patch Changes

- 097f2c4: Add shared state support to worker agents and deep survey example
  - Worker agents can now observe a shared state DB via `sharedDb` spawn arg, generating per-collection CRUD tools
  - New `sharedDbToolMode` option controls whether `full` (read/write/update/delete) or `write-only` tools are generated
  - Rename `schema` parameter to `dbSchema` in `db()` observation source to avoid shadowing
