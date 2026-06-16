# @electric-ax/agents

## 0.6.1

### Patch Changes

- d2418d6: Add bounded, line-numbered read tool output with offset/limit support to reduce context bloat, and remove the edit tool's prior-read requirement.
- Updated dependencies [d2418d6]
  - @electric-ax/agents-runtime@0.6.1

## 0.6.0

### Minor Changes

- 15beffa: Release all Electric Agents packages as 0.6.

### Patch Changes

- Updated dependencies [15beffa]
  - @electric-ax/agents-runtime@0.6.0
  - @electric-ax/agents-mcp@0.6.0

## 0.4.19

### Patch Changes

- d8af425: Rename agent-facing webhook subscription APIs from generic event source terminology to webhook source terminology. This is a breaking rename for the experimental webhook-source tools, runtime/server types, routes, manifest metadata, and wake payload names.
- 23b7ec0: Require an explicit Electric shape endpoint URL for pg-sync observations. Source identity is derived from the shape options plus the observing tenant/principal/entity — ephemeral per-request fields (wakeId, runtimeConsumerId, streamPath) are excluded — so the same agent reuses one bridge across wakes while different principals get their own correctly-scoped streams. Registration validates the endpoint by fetching the shape log up front, failing with Electric's error instead of retrying silently, and a duplicate registration no longer resets a running bridge's bootstrap state (which could drop changes after a restart). Adds an `unobserve_pg_sync` tool so an agent can stop being woken by a shape stream it previously observed without affecting other observers.
- Updated dependencies [d8af425]
- Updated dependencies [23b7ec0]
- Updated dependencies [3528e67]
  - @electric-ax/agents-runtime@0.4.1

## 0.4.18

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
- 6fc36d8: Embedder customization hooks for the built-in agents:
  - `BuiltinAgentHandlerOptions.dockerSandbox` ({ image, allowFloatingTag, env, extraMounts }) threads into the built-in `docker` sandbox profile. These are embedder/operator-trust inputs: `extraMounts` is subject to the runtime's docker-socket guard and `env` is passed verbatim into the container.
  - `AgentHandlerResult.modelCatalog` exposes the resolved model catalog so embedders can register sibling agent types with the same model resolution.
  - New exports: `resolveBuiltinModelConfig`, and types `BuiltinModelCatalog`, `BuiltinAgentModelConfig`, `BuiltinDockerSandboxOptions`, `BuiltinDockerSandboxMount`.

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

- Updated dependencies [708c946]
- Updated dependencies [8bc630a]
- Updated dependencies [c48c1a8]
- Updated dependencies [c1f3aac]
  - @electric-ax/agents-runtime@0.4.0

## 0.4.17

### Patch Changes

- 683cfae: Bring the mobile new-session and chat composers to parity with desktop:
  - **Schema-driven spawn args + model/reasoning/speed controls.** The new-session screen now renders an agent type's `creation_schema` as native controls — enum properties become picker sheets (the model enum groups options by provider and remembers the last pick), booleans become switches, string/number become text fields, string-arrays a comma-separated field, and other objects a JSON field — so agents that need structured creation args can be configured and started from mobile (full parity with the desktop `SchemaForm`). Required fields gate the **Start session** button, which is now pinned to the bottom of the screen so it stays reachable as these extra sections grow (the scroll content is padded to clear it).
  - **Image attachments.** Both the in-session and new-session composers can attach images (photo library or camera) via `expo-image-picker`, gated on whether the session's model accepts image input. At spawn the first message is sent immediately after the entity is created so the upload can target it, mirroring the desktop flow. Attachments render in the chat log through the existing embedded timeline.

  The shared `agents-server-ui` send path (`uploadMessageAttachments`) accepts React Native file descriptors alongside browser `File`s, and the new-session schema-classification helpers (`inlineSchemaProperties`, model/reasoning/speed detection, model-settings grouping) move into a reusable `lib/schemaProperties` module shared by desktop and mobile. No server API changes — the title hardening below is the only server-side behavior change.

  Horton's session-title generation is also hardened for attachment messages: the title model could go conversational when the first message referenced images it couldn't see (e.g. apologizing that nothing was shared), and that sentence became the title. The system prompt now instructs it to infer a title from intent and never apologize, and a guard rejects sentence-like responses and falls back to the locally-derived title.

- 50e93c2: Add editable session titles: a `set_title` tool for Horton, click-to-edit UI in EntityHeader, and txid propagation for tag/send/inbox mutations so clients can await sync consistency.
- 4640704: Add pg-sync observation source enabling agents to observe Electric Postgres shape streams and wake on matching row changes (insert/update/delete). Includes server-side bridge management with cursor persistence, durable stream forwarding, and an `observe_pg_sync` tool for Horton agents.
- 87be539: Fix two resilience bugs that could leave the desktop agents runtime unable to pick up sessions until a full app restart, and port the pull-wake runner lifecycle to an xstate state machine.
  - `installDurableStreamsFetchCache` is now idempotent (with a warning on repeat calls), so restarting the built-in agents runtime no longer stacks duplicate HTTP cache interceptors on the global undici dispatcher.
  - The pull-wake runner now recovers when the wake stream connection hangs during the connecting phase: repeated heartbeat failures abort the in-flight connection attempt instead of only resetting an already-established stream.
  - The runner lifecycle (stopped → connecting → streaming → reconnecting → stopping) is now an xstate machine, so in-flight connections, stream sessions, and backoff timers are cancelled automatically on state transitions, and every state × event pair is pinned by an exhaustive transition test matrix.

- Updated dependencies [baee54e]
- Updated dependencies [50e93c2]
- Updated dependencies [73c6f89]
- Updated dependencies [4640704]
- Updated dependencies [87be539]
- Updated dependencies [004bea1]
  - @electric-ax/agents-runtime@0.3.13
  - @electric-ax/agents-mcp@0.2.3

## 0.4.16

### Patch Changes

- Updated dependencies [5238055]
- Updated dependencies [916f6cd]
- Updated dependencies [a044ede]
  - @electric-ax/agents-runtime@0.3.12

## 0.4.15

### Patch Changes

- 8bcadb7: Preserve existing undici global dispatcher interceptors when installing the Durable Streams fetch cache so Electric Agents Desktop keeps injecting Cloud auth headers after the built-in agents runtime starts.
- 5aa2d78: Give Horton a `fork` tool that creates a child session inheriting this conversation's history up to the latest completed response. Takes an optional `entityUrl` (omit for self-fork), an optional `initialMessage` (server delivers to the fork in the same round-trip — no follow-up `send` needed; not atomic with fork creation), and optional `tags`. The fork is created as a CHILD of the calling entity (same parent-ownership model as `spawn_worker`) and wires reply delivery through the same manifest-anchored wake — when the fork's next run finishes, the parent wakes with the response in the wake message.

  Horton's system prompt grows a "When to fork (vs spawn_worker)" section framing the two tools as a pair: both create a child the parent owns and gets replies from, the difference is what the child boots with — `spawn_worker` starts with an empty context (you brief it from scratch), `fork` starts with a copy of the conversation up to the latest completed response. Includes an explicit trigger pattern ("prefer fork when generating multiple variants the user wants to compare; don't inline") to route "give me three takes" / "evaluate these N approaches" prompts to fork rather than collapsing them into one inline response, plus the workflow for the parallel-exploration loop (end-turn-first, fork-once-per-branch with a different `initialMessage` each, wait for all responses before synthesising).

- a1c1e30: Add built-in schedule tools to Horton and document them in the system prompt.
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

- Updated dependencies [d15852d]
- Updated dependencies [5aa2d78]
- Updated dependencies [1099366]
- Updated dependencies [1099366]
  - @electric-ax/agents-runtime@0.3.11

## 0.4.14

### Patch Changes

- 3ecdade: Add structured composer input support, slash command registration, and proactive skill context loading.
- Updated dependencies [3ecdade]
  - @electric-ax/agents-runtime@0.3.10

## 0.4.13

### Patch Changes

- f222d39: Add a form-based **Add / Edit / Remove** flow for MCP servers in the
  desktop's Settings → MCP Servers page. Before this, the only way to
  register a server was to hand-edit `settings.json` or a workspace
  `mcp.json`. The dialog supports both `http` and `stdio` transports, all
  four auth modes, and writes through to the global `settings.json
mcp.servers` block.

  The MCP page also gains provenance + shadowing awareness:
  - Entries from a workspace `mcp.json` render a "from mcp.json" badge
    and are read-only (no Edit/Remove). Lifecycle verbs still apply.
  - When a name in `settings.json` collides with one in workspace
    `mcp.json`, the workspace still wins (existing rule); the shadowed
    settings entry is rendered grayed-out next to the running workspace
    twin so the user can see what's been overridden.

  `BuiltinAgentsServer` gains a public `setExtraMcpServers(extras)` so
  the desktop can push add/edit/remove changes to the live MCP registry
  without restarting. Workspace `mcp.json` continues to win on name
  collision through the same merge path used by the file watcher.

- 6434774: Add owner-default agents-server permissions with type-level spawn grants, entity grants, effective permission materialization, principal-scoped entity observation streams, shared-state access links, runtime registration permission grants, and default user spawn grants for built-in Horton and Worker types.

  Existing entity observation bridges are rebuilt after upgrade because pre-permission bridge rows do not include principal attribution.

  Entity `manage` grants participate in read visibility, entity-type `manage` grants participate in spawn visibility, and broad parented spawn-time grants require `manage` on the parent.

- b2bf806: Upgrade `@durable-streams/state` to `0.3.1` and drop the `@tanstack/db` pnpm override.

  `@durable-streams/state@0.3.x` makes `@tanstack/db` an optional peer dependency (it was a direct `^0.6.0` dependency) and splits its tsdb-coupled tools into a `@durable-streams/state/db` subpath. tsdb-specific imports (`createStreamDB`, `queryOnce`, `createTransaction`, query operators, etc.) now come from `@durable-streams/state/db`; the bare entry keeps only the tsdb-free types and helpers.

  Because state no longer pulls its own `@tanstack/db` copy, the root `pnpm.overrides` collapsing `@tanstack/db@>=0.6.0 <0.7.0` to `0.6.7` is removed. To keep a single `0.6.7` instance without it, `@tanstack/react-db` is raised to `^0.1.85` and `@tanstack/electric-db-collection` to `^0.3.5` (both pin `@tanstack/db@0.6.7`), and `@durable-streams/server` to `^0.3.7` (depends on `state@0.3.1`, removing the lingering transitive `state@0.2.9`).

- 74d2341: Fix Codex auth for low-cost tool calls by passing fresh access tokens to URL extraction and worker tools.
- b0030a1: Size Horton's context source budget from the selected model's known context window, including Moonshot metadata, while preserving the previous default for unknown models.
- 5f96a15: Grant all users manage permission on the built-in Horton entity type by default, and backfill existing agents-server installations that already registered Horton without that grant.
- 9da7b8f: Install an Undici HTTP cache dispatcher for the built-in agents local Node runner so Durable Streams catch-up reads can use server cache headers. Electric Agents Desktop uses an on-disk SQLite cache so runtime restarts can reuse cached catch-up responses.
- 7c62024: Remove the old child-handle result API (`EntityHandle.run` and `EntityHandle.text()`) and internal spawn run promise plumbing. Child coordination should use durable `runFinished` server wakes with `includeResponse` so parent handlers can return safely instead of waiting in-memory for child output.
- 048e2b6: Grant all users manage permission on the built-in Worker entity type by default, and backfill existing agents-server installations that already registered Worker without that grant.
- Updated dependencies [9fdf96a]
- Updated dependencies [312f5ec]
- Updated dependencies [6434774]
- Updated dependencies [4f88e6d]
- Updated dependencies [b2bf806]
- Updated dependencies [74d2341]
- Updated dependencies [d14d9a9]
- Updated dependencies [7c62024]
  - @electric-ax/agents-runtime@0.3.9

## 0.4.12

### Patch Changes

- 17b374f: Adds the `Sandbox` primitive (`@electric-ax/agents-runtime/sandbox`) for isolating LLM-driven tool calls. Three providers ship: `unrestrictedSandbox()` (explicit pass-through), `remoteSandbox({provider: 'e2b'})` (E2B as an optional peer dep), and `dockerSandbox()` (container isolation via `dockerode` as an optional peer dep).

  Built-in entities (Horton, Worker) default to `unrestrictedSandbox` via the new `chooseDefaultSandbox(workingDirectory)` helper. Stronger isolation is opt-in by constructing `dockerSandbox` or `remoteSandbox` directly — `dockerSandbox` is the recommended path for multi-entity hosting.

  Behavior changes folded in: bash no longer forwards `process.env` to children (removes the trivial `env`-dump leak of secrets like `$ANTHROPIC_API_KEY` — note the host-sharing `unrestricted` provider still can't fully contain secrets, e.g. via `/proc/<ppid>/environ`, so use `docker`/`remote` for untrusted or multi-tenant entities), tool descriptions corrected, and read/write/edit reject symlink escapes from the workspace.

  Runtimes advertise named **sandbox profiles** (e.g. `local`, `docker`) to the agents-server; spawn requests pick a profile by name, the server validates the choice against the target runner's advertised set, and the new-session UI surfaces a picker. Internally, the built-in tool factories (`createBashTool`, `createFetchUrlTool`, etc.) now route their filesystem and network access through the active `Sandbox`.

- d5708c7: Bump `@durable-streams/{client,server,state}` pins in step with `@electric-ax/agents-runtime` and `@electric-ax/agents-server` to pick up the fork-at-pointer (`Stream-Fork-Offset` + `Stream-Fork-Sub-Offset`) wire protocol that the new fork-at-message UX depends on. No other code changes in these packages.
- Updated dependencies [17b374f]
- Updated dependencies [1a7d72e]
- Updated dependencies [d5708c7]
- Updated dependencies [f2d3d5e]
  - @electric-ax/agents-runtime@0.3.8

## 0.4.11

### Patch Changes

- 9a92af5: Defer logger initialization to first use so packaged Electron apps (where cwd is `/`) no longer crash trying to `mkdir '/logs'`. Logger init is now wrapped in try-catch with stderr fallback so logging infrastructure never throws. Add `ELECTRIC_AGENTS_LOG_FILE=false` escape hatch to the agents package for parity with agents-server.
- Updated dependencies [9e01e58]
  - @electric-ax/agents-runtime@0.3.7

## 0.4.10

### Patch Changes

- d921a9f: Allow desktop users to choose which configured provider models appear in Horton's model picker, and group model dropdown entries by provider.
- 98b51d6: Update Electric Agents packages to depend on the stable Durable Streams
  packages instead of pkg.pr builds. This pulls in `@durable-streams/client`
  0.2.6, `@durable-streams/server` 0.3.5, and `@durable-streams/state` 0.2.9.
  Examples now resolve `@electric-ax/agents-runtime` from the workspace so they
  do not keep older registry runtime builds pinned in the lockfile.
- aed2189: Add Kimi / Moonshot API support for local Horton runtimes, including model catalog entries, runtime provider resolution, desktop credential persistence, and UI credential inputs.
- 52a641f: Add manifest-backed attachments for agents.

  Attachments are uploaded through entity routes, stored in private attachment streams, referenced by manifest entries, and exposed to runtime handlers through `ctx.attachments`. The server UI can attach image files to user messages, renders message attachments with authenticated preview/download actions, exposes image previews from attachment manifest rows, rolls back uploaded attachments when send fails, and hides image attachment controls for models whose registered pi-ai metadata does not include image input. Image hydration now has a simple newest-images byte/count guardrail. Horton title generation now also works when the first user message is sent after attachment upload, including image-only starts.

- Updated dependencies [e9ea591]
- Updated dependencies [98b51d6]
- Updated dependencies [aed2189]
- Updated dependencies [52a641f]
  - @electric-ax/agents-runtime@0.3.6

## 0.4.9

### Patch Changes

- d344c32: Treat Electric Agents server URLs as opaque tenant-scoped base URLs rooted at `/t/<tenant-id>/v1`, migrate desktop and mobile Cloud clients to that URL shape, move observation stream ensure endpoints under `/_electric/observations/*/ensure-stream`, rename the pre-alpha entity/cron/schema/tag/docs APIs to their Electric Agents names, add a non-interactive `electric agents view` transcript command, and make Horton title extraction work with lightweight desktop inbox collection facades.

  Send the done callback for completed wake checkpoints during graceful shutdown, preventing desktop reloads from leaving already completed DS subscription claims pending.

- 8074f62: Align the agents package TypeScript peer context with agents-runtime so Durable Streams state and TanStack DB resolve to a single shared instance for live queries over runtime collections.
- Updated dependencies [d344c32]
- Updated dependencies [c1834f3]
- Updated dependencies [319e405]
  - @electric-ax/agents-runtime@0.3.5

## 0.4.8

### Patch Changes

- 833a1cb: Add agent webhook source contracts and dynamic webhook source subscription tools. Agents can list active, agent-visible webhook-backed webhook sources, subscribe entities to resolved bucket streams with explicit lifetimes, and persist those subscriptions as manifest-backed wake registrations. Bucket params are validated against the advertised `paramsSchema` before a subscription is accepted. Horton now receives these tools through the built-in agents runtime by default. Runtime-managed webhook source wakes now hydrate matching webhook rows into the agent trigger message so tool-created subscriptions include the event payload that caused the wake.
- Updated dependencies [833a1cb]
- Updated dependencies [833a1cb]
  - @electric-ax/agents-runtime@0.3.4

## 0.4.7

### Patch Changes

- a70567e: Add DeepSeek as a supported LLM provider.
  - `agents-runtime`: `detectAvailableProviders()` now detects `DEEPSEEK_API_KEY`; `deepseek` added to `AvailableProvider` type, `PREFERRED_IDS_BY_PROVIDER`, and `envCatalog()`
  - `agents`: model catalog probes `https://api.deepseek.com/v1/models` to surface available DeepSeek models (`deepseek-v4-flash`, `deepseek-v4-pro`); `deepseek-v4-flash` is the default fallback choice
  - `agents-desktop`: `ApiKeys` gains a `deepseek` field persisted in the keychain and mirrored to `DEEPSEEK_API_KEY` in the runtime environment
  - `agents-server-ui`: `ApiKeysForm` gains a DeepSeek API key input; `OnboardingModal` and `CredentialsPage` pass and persist the new field

- b3d4f02: feat: add self-send option to `send`
- Updated dependencies [9c2c3ae]
- Updated dependencies [a70567e]
- Updated dependencies [b3d4f02]
- Updated dependencies [dffbf62]
  - @electric-ax/agents-runtime@0.3.3

## 0.4.6

### Patch Changes

- Updated dependencies [e13cad1]
- Updated dependencies [4d9c36e]
  - @electric-ax/agents-runtime@0.3.2

## 0.4.5

### Patch Changes

- Updated dependencies [ca01b9d]
- Updated dependencies [9f10b20]
  - @electric-ax/agents-runtime@0.3.1

## 0.4.4

### Patch Changes

- 9c275b7: Add `send` tool exposing `ctx.send()` to LLM agents (Horton and Worker) for sending messages to Electric entities by URL. Change `send()` return type from `void` to `Promise<SendResult>` so callers can await delivery confirmation and handle failures with structured error results.
- 99ac6fd: Pin Durable Streams dependencies to commit `5d5c217` so local development resolves the same subscription-control routing code as the PR build.
- adc99e9: Move the `.md`-skill-directory loader (`createSkillsRegistry`) and the per-entity skill tool builder (`createSkillTools`) — together with the `SkillsRegistry` / `SkillMeta` types and the underlying `preamble` / `extract-meta` helpers — out of `@electric-ax/agents` and into `@electric-ax/agents-runtime`, alongside the rest of the entity-runtime primitives.

  No behaviour change. Same files, re-rooted to the package whose dependencies they already use: skills depend on `completeWithLowCostModel` and the runtime logger, both already in `agents-runtime`. The skills code uses zero symbols defined in `@electric-ax/agents`, so the previous arrangement had the dependency graph pointing the wrong way.

  This makes the skills primitives available to any package built on top of `agents-runtime` (e.g. external Discord / Slack / CLI bots) without pulling in Horton, Worker, or `BuiltinAgentsServer` as transitive context.

  Existing internal call sites in `@electric-ax/agents` (`bootstrap.ts`, `agents/horton.ts`) now import from `@electric-ax/agents-runtime`. No public API of `@electric-ax/agents` is affected — the skills surface was never re-exported from its `index.ts`, so embedders that only consumed Horton / Worker / Server APIs continue to work unchanged.

- Updated dependencies [9c275b7]
- Updated dependencies [1ab43f5]
- Updated dependencies [99ac6fd]
- Updated dependencies [adc99e9]
  - @electric-ax/agents-runtime@0.3.0

## 0.4.3

### Patch Changes

- e126eba: Harden pull-wake runner lifecycle with a state machine, heartbeat-driven stream resets, and exponential reconnect backoff (1s-30s). Add granular `status` field to `PullWakeRunnerHealth` (`stopped | starting | connecting | streaming | reconnecting | stopping`). The `onError` callback is now reporting-only (`(Error) => void`) - it can no longer control runner lifecycle. `stop()` rethrows `drainWakes` errors so callers observe wake handler failures. Event-driven heartbeat throttling avoids stale diagnostics between fixed-interval heartbeats. Durable Streams clients now append stream and `__ds` subscription control paths to the configured backend URL prefix without inferring a `/v1/stream` layout, so pull-wake subscriptions work behind arbitrary DS backend prefixes. Remove the stale `StreamClient.getConsumerState()` helper for the old Durable Streams `/consumers` endpoint.
- e126eba: Add pull-wake runner health check endpoint and rename `owner_user_id` to `owner_principal` across the runners system. The `GET /_electric/runners/:id/health` endpoint returns comprehensive diagnostics including runner state, client-reported stream/heartbeat/claim metrics, active claims, and dispatch stats with a derived health status (healthy/degraded/unhealthy). The `PullWakeRunner` now tracks internal diagnostics and reports them to the server via heartbeats, stored in a separate `runner_runtime_diagnostics` table so the main `runners` shape stays stable for normal UI sync. The `owner_user_id` → `owner_principal` rename stores canonical principal URLs instead of keys, with strict validation and canonicalization at route boundaries. The migration expires active runner claims and deletes existing runner rows as part of the principal rewrite. This is a breaking change with no backward compatibility — all callers must send principal URLs.
- Updated dependencies [e126eba]
- Updated dependencies [e126eba]
  - @electric-ax/agents-runtime@0.2.2

## 0.4.2

### Patch Changes

- c4e046f: Add Electric Cloud sign-in to the desktop app. New Settings → Account panel signs in via GitHub or Google through `dashboard.electric-sql.cloud`'s loopback OAuth flow (the same one the CLI uses), encrypts the resulting JWT with `safeStorage`, refreshes name + workspaces via `auth.whoami`, and offers a one-click jump to the user's Electric Cloud dashboard.

  Add first-launch onboarding for Electric Cloud sign-in and LLM API keys, plus a Cloud Agent Servers settings section that syncs the user's Cloud agent servers, mints per-tenant agents tokens in the main process, and connects the desktop runtime/UI to tenant-scoped Cloud agents URLs without exposing those tokens to the renderer or `settings.json`.

- 21ad820: Harden Electric Agents remote error reporting and add optional `ELECTRIC_AGENTS_PRINCIPAL` support for principal-aware servers.
- 0e72995: Move spawn worker tool instructions from system prompt to initial message for better worker briefing

## 0.4.1

### Patch Changes

- dfc9a45: Combine the desktop app packaging setup, app settings, and agents UI improvements. Adds desktop packaging assets/configuration, multi-server desktop settings, improved chat and workspace UI behavior, and queued inbox message modes in the runtime.
- 83204d9: Add principals support to the agents system. Every API request now carries a `Principal` (user, agent, service, or system) threaded through the full request lifecycle. Runner dispatch is scoped to the authenticated owner via dispatch policy authorization. The runtime exposes `ctx.principal` in handler context so agent code can implement principal-aware logic. The server UI uses asserted identity headers for dev-mode authentication.
- Updated dependencies [dfc9a45]
- Updated dependencies [83204d9]
  - @electric-ax/agents-runtime@0.2.1
  - @electric-ax/agents-mcp@0.2.2

## 0.4.0

### Minor Changes

- dec65ae: Port pull-wake runners onto the tenant-aware agents-server routing refactor.

  Agents-server now supports runner registration, runner-owned pull-wake subscriptions, dispatch policy resolution, subscription stream linking, compact Durable Streams wake claims, callback-forward claim lifecycle handling, and claim-scoped write tokens. Runtime built-ins can register pull-wake runners, tail runner wake streams, claim work through the server, heartbeat offsets, and acknowledge completed work. The CLI, desktop integration, server UI, and local full-stack compose setup now use runner-backed local sessions for the pull-wake flow.

  Saved agents-server connections can include additional request headers for tenant-aware deployments, and CLI/runtime URL handling now preserves base query parameters such as `?secret=...`.

### Patch Changes

- dec65ae: Do not register a built-in pull-wake runner as the default dispatch policy for built-in agent entity types.
- 08e85a0: Refactor agents-server HTTP routing around a single `globalRouter` entrypoint passed a flat `TenantContext`.

  The `ElectricAgentsServer` class now owns lifecycle setup only and dispatches each request through an OSS-only wrapper router that layers dashboard and mock-agent routes over `globalRouter.fetch(request, tenantContext)`. This prepares the exported `globalRouter` for library-mode use by callers that build tenant context outside the OSS server class without pulling in the bundled UI or mock agent.

  Breaking change: entity RPC URLs moved from `/:type/:instanceId/...` to `/_electric/entities/:type/:instanceId/...`. This affects entity spawn/get/head/delete, send, fork, tag, and schedule endpoints. The root namespace is now durable-streams pass-through, with no reserved entity control routes.

  Breaking change: the `@electric-ax/agents-server` package root now only exports the library-mode routing assembly surface: DB setup helpers, `AgentsHost`, `StreamClient`, `globalRouter`, `TenantContext`, `GlobalRoutes`, `EntityBridgeCoordinator`, and tenant helpers. OSS server classes, subrouters, entity-manager internals, scheduler/wake-registry internals, schema helpers, and entity response helpers are no longer root exports.

  The runtime server client, bundled agents-server UI, and conformance tests have been updated for the new route layout. Agents-server control-plane routes now use shared TypeBox/Ajv body validation.

- Updated dependencies [dec65ae]
- Updated dependencies [dec65ae]
- Updated dependencies [08e85a0]
  - @electric-ax/agents-runtime@0.2.0
  - @electric-ax/agents-mcp@0.2.1

## 0.3.0

### Minor Changes

- 1df7cce: Add Model Context Protocol (MCP) support — agents can call tools, read resources, and use prompts from external MCP servers (stdio + Streamable HTTP), with OAuth handled by the runtime. New `@electric-ax/agents-mcp` package ships the `Registry` API, transports, OAuth bridges, and opt-in `keychainPersistence` / `filePersistence` helpers. The Electron desktop app exposes a Settings → MCP Servers page and a `mcp.servers` block in `settings.json` that layers with the per-workspace `mcp.json`. Built-in `horton` and `worker` agents see registered MCP tools transparently via `mcp.tools()`.

### Patch Changes

- 65f0cf0: Add `openai-codex` as a built-in model provider. When the user has logged into OpenAI Codex CLI (`~/.codex/auth.json` exists), GPT-5.x models automatically appear in the dashboard model dropdown with reasoning effort support.
- f509387: Allow Horton and Worker to use configured Anthropic or OpenAI models. Adds a `model-catalog` that selects providers from `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`, surfaces UI-selectable reasoning effort for compatible OpenAI reasoning models, and threads the catalog through `bootstrap`, `registerHorton`, `registerWorker`, and `spawnWorker`.
- 590aabb: Improve the agents UI timeline and reactivity, add a browser-safe runtime client export, and route built-in agent metadata extraction through the configurable low-cost model runner.
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

- a3cee92: Remove the coder entity (coding-session). The `registerCodingSession`, `useCodingAgent`, `CodingSessionHandle`, and related types/tools (`spawn_coder`, `prompt_coder`) are no longer available. The `agent-session-protocol` dependency is also removed.
- 7f8947a: Require low-cost model calls to provide an explicit system prompt and add prompts for URL extraction and skill metadata extraction.
- Updated dependencies [1df7cce]
- Updated dependencies [f509387]
- Updated dependencies [590aabb]
- Updated dependencies [744c47f]
- Updated dependencies [28d127b]
- Updated dependencies [6399147]
- Updated dependencies [a3cee92]
- Updated dependencies [7f8947a]
  - @electric-ax/agents-mcp@0.2.0
  - @electric-ax/agents-runtime@0.1.3

## 0.2.4

### Patch Changes

- 1aec196: feat: CLI quickstart readability and clarity improvements

## 0.2.3

### Patch Changes

- Updated dependencies [1cb5020]
- Updated dependencies [1cb5020]
  - @electric-ax/agents-runtime@0.1.2

## 0.2.2

### Patch Changes

- 4d8e452: Bundle Electric Agents documentation with the package so Horton can search docs without an external docs directory. Copies 39 markdown files from the docs site into `packages/agents/docs/` and updates `resolveDocsRoot` to find them relative to the module directory in both development and production builds.
- b0af010: Fix chat starter typing indicator: inline multiple agent names in a single line and use useChat state for reliable detection.
- b0af010: Redesign quickstart tutorial: replace chatroom steps with perspectives analyzer UI, add scaffold-based frontend with Radix Themes and Streamdown markdown, improve Horton prompt for docs search priority, add checkpoint with multiple paths after entity-building steps.

## 0.2.1

### Patch Changes

- 125c276: Improve Horton's onboarding: add warm greeting for initial messages and present multiple onboarding paths instead of defaulting to the quickstart skill.
- e0b588f: Bump `@electric-ax/durable-streams-*-beta` dependencies to the latest published versions (`client@^0.3.1`, `state@^0.3.1`, `server@^0.3.2`).
- Updated dependencies [e0b588f]
  - @electric-ax/agents-runtime@0.1.1

## 0.2.0

### Minor Changes

- 491ba04: Move tool implementations (bash, read, write, edit, fetch_url, web_search, schedules) from agents-server to agents package, removing duplicate code. Tools are now exported from `@electric-ax/agents`.
- 4fc022b: Redesign Horton onboarding: rename tutorial to quickstart skill (extended with routes + frontend phases), add init skill for project scaffolding, add onboarding routing to system prompt, configurable docs URL via HORTON_DOCS_URL, upgrade to claude-sonnet-4-6, fix web search fallback tool definition, and remove duplicate braveSearchTool from agents-server (now exported from agents)
- 4987694: Move tool implementations (bash, read, write, edit, fetch_url, web_search, schedules) from `@electric-ax/agents` to `@electric-ax/agents-runtime` so they are available without importing the built-in agents package. **Breaking:** tool exports removed from `@electric-ax/agents` — import from `@electric-ax/agents-runtime` instead.

### Patch Changes

- 89debcf: Add the `coder` entity (a Claude Code / Codex CLI session wrapped as a long-lived entity) and give Horton matching `spawn_coder` / `prompt_coder` tools so the chatbot can dispatch coding work and keep prompting the same coder across many turns. The coder records its own `runs` events around each CLI invocation and pipes the assistant reply through `attachResponse`, so observers waking with `runFinished` get the response in the wake payload. Includes `--skip-git-repo-check` for `codex exec`, deterministic per-cwd Claude session discovery (so non-interactive `claude -p` runs are found reliably), and adopts the first prompt's text as the entity's display title.
- Updated dependencies [4987694]
- Updated dependencies [89debcf]
  - @electric-ax/agents-runtime@0.1.0

## 0.1.5

### Patch Changes

- 4801e76: fix: ensure builtin skills are packaged

## 0.1.4

### Patch Changes

- Updated dependencies [9024ec2]
  - @electric-ax/agents-runtime@0.0.4

## 0.1.3

### Patch Changes

- Updated dependencies [5ef535b]
- Updated dependencies [6d8be8b]
  - @electric-ax/agents-runtime@0.0.3

## 0.1.2

### Patch Changes

- 1786ee6: feat: add shared state (sharedDb) support to built-in worker agent

## 0.1.1

### Patch Changes

- 097f2c4: Add shared state support to worker agents and deep survey example
  - Worker agents can now observe a shared state DB via `sharedDb` spawn arg, generating per-collection CRUD tools
  - New `sharedDbToolMode` option controls whether `full` (read/write/update/delete) or `write-only` tools are generated
  - Rename `schema` parameter to `dbSchema` in `db()` observation source to avoid shadowing

- 46e0a75: Add skills system for dynamic knowledge loading with use_skill/remove_skill tools, including an interactive tutorial skill
- Updated dependencies [097f2c4]
  - @electric-ax/agents-runtime@0.0.2
