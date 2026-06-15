# @electric-ax/agents-server-ui

## 0.5.0

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

- 0b26edf: Bring session sharing to mobile (desktop `ShareEntityDialog` parity, mobile-first UX):
  - **Share session screen.** A modal route opened from the session menu's new **Share** entry. It exposes a link pill (abbreviated session web URL — one tap opens the native OS share sheet, which includes Copy), a "People with access" list with a pinned Owner row, a Google-Drive-style "General access" section for the workspace-wide _All users_ grant, and a search-first "Add people" section. Roles (View / Chat / Manage, same permission sets and glyphs as desktop) commit per row through a bottom-sheet picker with a destructive _Remove access_ action — no deferred Grant/Update button. The grant list comes from the manage-protected REST `GET /grants` endpoint (the synced effective-permissions shape is scoped to the current principal, so it can't list other people's access); non-managers still get the link actions and see a manage-required message below.
  - **Copy session id.** The session menu's status header and the long-press row sheet now render the id with a tap-to-copy affordance (copy→check icon swap, mirroring the desktop entity header), via a new `expo-clipboard` dependency.
  - **Session web links.** `sessionWebUrl()` builds `{serverUrl}/__agent_ui/#/entity/{id}` directly — targeting the web UI path rather than the server root, whose absolute-path redirect would drop a Cloud `/t/<service-id>/v1` tenant prefix.

  The desktop dialog's `userDisplay()`/`initials()` helpers move into `agents-server-ui`'s `lib/userDisplay.ts` so mobile deep-imports them instead of duplicating. Grant-diffing, removal, and access-model grouping logic is ported into a pure, unit-tested `entityGrants` module. No server API changes.

- 8bc630a: Add generic externally-writable custom collections for agent entity state: collections opt in via `externallyWritable`, writes go through an authenticated schema-validated endpoint that stamps the principal into a read-only `_principal` column, and `createEntityTimelineQuery` can project them into the timeline via `customSources`. Comments are reimplemented as one such collection, gated per agent type through a reserved `comments/v1` contract that the UI keys its comment affordances on. External writes are restricted to a per-collection operations allowlist (insert-only by default), and comments are insert-only.
- 8b1d39f: Hide the per-response token-usage label when the combined input + output
  count falls below a threshold (`SHOW_USAGE_THRESHOLD`, currently 1000).
  Tiny tool-only steps and one-line replies no longer clutter the meta row
  with noise like `47 ↑ 12 ↓`; the threshold lives in a single constant so
  it's easy to tune.
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

- Updated dependencies [708c946]
- Updated dependencies [8bc630a]
- Updated dependencies [c48c1a8]
- Updated dependencies [c1f3aac]
  - @electric-ax/agents-runtime@0.4.0

## 0.4.20

### Patch Changes

- 683cfae: Bring the mobile new-session and chat composers to parity with desktop:
  - **Schema-driven spawn args + model/reasoning/speed controls.** The new-session screen now renders an agent type's `creation_schema` as native controls — enum properties become picker sheets (the model enum groups options by provider and remembers the last pick), booleans become switches, string/number become text fields, string-arrays a comma-separated field, and other objects a JSON field — so agents that need structured creation args can be configured and started from mobile (full parity with the desktop `SchemaForm`). Required fields gate the **Start session** button, which is now pinned to the bottom of the screen so it stays reachable as these extra sections grow (the scroll content is padded to clear it).
  - **Image attachments.** Both the in-session and new-session composers can attach images (photo library or camera) via `expo-image-picker`, gated on whether the session's model accepts image input. At spawn the first message is sent immediately after the entity is created so the upload can target it, mirroring the desktop flow. Attachments render in the chat log through the existing embedded timeline.

  The shared `agents-server-ui` send path (`uploadMessageAttachments`) accepts React Native file descriptors alongside browser `File`s, and the new-session schema-classification helpers (`inlineSchemaProperties`, model/reasoning/speed detection, model-settings grouping) move into a reusable `lib/schemaProperties` module shared by desktop and mobile. No server API changes — the title hardening below is the only server-side behavior change.

  Horton's session-title generation is also hardened for attachment messages: the title model could go conversational when the first message referenced images it couldn't see (e.g. apologizing that nothing was shared), and that sentence became the title. The system prompt now instructs it to infer a title from intent and never apologize, and a guard rejects sentence-like responses and falls back to the locally-derived title.

- 50e93c2: Add editable session titles: a `set_title` tool for Horton, click-to-edit UI in EntityHeader, and txid propagation for tag/send/inbox mutations so clients can await sync consistency.
- 73c6f89: Add default model-provider timeout/error handling for agent runs and render durable run errors in the UI.
- 004bea1: Render standalone entity stream errors in the timeline with their error code and message.
- Updated dependencies [baee54e]
- Updated dependencies [50e93c2]
- Updated dependencies [73c6f89]
- Updated dependencies [4640704]
- Updated dependencies [87be539]
- Updated dependencies [004bea1]
  - @electric-ax/agents-runtime@0.3.13

## 0.4.19

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
- Updated dependencies [5238055]
- Updated dependencies [916f6cd]
- Updated dependencies [a044ede]
  - @electric-ax/agents-runtime@0.3.12

## 0.4.18

### Patch Changes

- 3dbd075: Add session pinning to the mobile app: long-press a root session row (or any search result) to open a context sheet with the entity info (title, session id, type/status, subagents, runner, sandbox, spawned, last active) and a Pin/Unpin action; the in-session kebab menu also gets a Pin/Unpin item, mirroring the desktop tile menu. Pinned sessions surface in a Pinned section above the groups, persisted per-device in AsyncStorage — the mobile mirror of the web sidebar's pinning. Runner-param types in agents-server-ui's `entityRuntime` helpers are loosened to structural subsets so the mobile app can reuse them.
- 5aa2d78: Add server-resolved fork anchor + spawn-parity body fields to `POST /_electric/entities/<type>/<id>/fork`.
  - `anchor: 'latest_completed_run'` is an alternative to `fork_pointer`: the server scans the source root's `main` history, finds the most recent `runs` row with `status === 'completed'`, derives the matching `{ offset, sub_offset }` pointer, and runs the existing pointer-fork path with it. Mutually exclusive with `fork_pointer` (400 if both); 400 if no completed run exists. Lets callers without access to the source's per-row pointer side-table (e.g. an agent forking via a tool) fork at the same anchor the per-row "Fork from here" UI uses.
  - `parent` overrides the new root fork's `parent` field, making it a CHILD of that URL (rather than inheriting the source's parent).
  - `wake` registers a subscription on the new root fork at fork time (same shape as `spawn`'s `wake`).
  - `initialMessage` is delivered to the new root fork via `entityManager.send` after `linkEntityDispatchSubscription` runs — same ordering spawn uses, so the dispatcher is subscribed before the inbox row lands and the fork actually wakes on the message instead of sitting idle.
  - `tags` are stamped on the new root fork in addition to those copied from the source.

  Together these let an agent fork itself as a child and receive replies via the same manifest-anchored wake mechanism `spawn` uses, with a single round-trip fork-and-dispatch.

  Chat UI: `readInboxText` falls back to `message` and `content` keys when `text` isn't present, so messages sent by agents (which sometimes emit those shapes) render as a chat bubble body instead of a blank bar.

- 146f238: Polish the agents UI with improved spawn-form model controls, tooltips,
  macOS sidebar vibrancy styling, select sizing fixes, and a response-footer
  fork action in the timeline.
- 7892079: Per-runner recent working directories in the spawn UI, derived from the synced sessions list so the same recents appear on every device. The desktop picker becomes per-runner (replacing the localStorage list), and mobile gains sandbox-profile and working-directory selection — including sending the sandbox profile on spawn, without which the runtime ignores the chosen directory.
- Updated dependencies [d15852d]
- Updated dependencies [5aa2d78]
- Updated dependencies [1099366]
- Updated dependencies [1099366]
  - @electric-ax/agents-runtime@0.3.11

## 0.4.17

### Patch Changes

- 3ecdade: Add structured composer input support, slash command registration, and proactive skill context loading.
- Updated dependencies [3ecdade]
  - @electric-ax/agents-runtime@0.3.10

## 0.4.16

### Patch Changes

- 9fdf96a: Track agent-originated sends with `from_agent` / `from_principal` inbox metadata and render agent/self-send inbox messages with JSON payload fallbacks.
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

- 312f5ec: Typecheck against agents-runtime's built types for the package index instead of
  its source, so the UI no longer pulls node-only sandbox code into its program.
  The browser-safe `client` entry stays source-mapped (matching the vite alias).
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

- 6e9e4a7: Show elapsed time while an agent is responding. While a turn is
  streaming, the meta row now ticks `Thinking · 12s` (or just `12s` once
  tokens start flowing). When a turn settles, the bare `✓ done` becomes
  `✓ done in 1m 5s` for turns completed in-session. Historical turns
  (already complete on page load) keep the bare label, since the client
  has no reliable completion timestamp for those — only the user message
  time, and subtracting `now()` would lie about the duration.
- d14d9a9: Remove the unused per-entity agents error stream. Entities now expose only their main stream; spawn, fork, registry lookup, terminal signal handling, UI/runtime types, client helpers, and conformance tests no longer create or require an entity-level error stream.
- 889fa20: Expose tenant-scoped users as an Electric shape and add a chat sharing dialog that grants user principals or all workspace users view, chat, or manage permissions over an entity. View/chat sharing includes fork access, forked chats are owned by the principal that creates the fork, shared chats can be identified and filtered by creator in the sidebar, and Cloud requests now inject the signed-in user as the Electric principal.

  Mobile now syncs the users and effective-permissions shapes, marks and filters shared chats by creator, disables native chat and signal controls when the current principal lacks permission, and shows the signed-in user principal on the Account screen for debugging.

- Updated dependencies [9fdf96a]
- Updated dependencies [312f5ec]
- Updated dependencies [6434774]
- Updated dependencies [4f88e6d]
- Updated dependencies [b2bf806]
- Updated dependencies [74d2341]
- Updated dependencies [d14d9a9]
- Updated dependencies [7c62024]
  - @electric-ax/agents-runtime@0.3.9

## 0.4.15

### Patch Changes

- 17b374f: Adds the `Sandbox` primitive (`@electric-ax/agents-runtime/sandbox`) for isolating LLM-driven tool calls. Three providers ship: `unrestrictedSandbox()` (explicit pass-through), `remoteSandbox({provider: 'e2b'})` (E2B as an optional peer dep), and `dockerSandbox()` (container isolation via `dockerode` as an optional peer dep).

  Built-in entities (Horton, Worker) default to `unrestrictedSandbox` via the new `chooseDefaultSandbox(workingDirectory)` helper. Stronger isolation is opt-in by constructing `dockerSandbox` or `remoteSandbox` directly — `dockerSandbox` is the recommended path for multi-entity hosting.

  Behavior changes folded in: bash no longer forwards `process.env` to children (removes the trivial `env`-dump leak of secrets like `$ANTHROPIC_API_KEY` — note the host-sharing `unrestricted` provider still can't fully contain secrets, e.g. via `/proc/<ppid>/environ`, so use `docker`/`remote` for untrusted or multi-tenant entities), tool descriptions corrected, and read/write/edit reject symlink escapes from the workspace.

  Runtimes advertise named **sandbox profiles** (e.g. `local`, `docker`) to the agents-server; spawn requests pick a profile by name, the server validates the choice against the target runner's advertised set, and the new-session UI surfaces a picker. Internally, the built-in tool factories (`createBashTool`, `createFetchUrlTool`, etc.) now route their filesystem and network access through the active `Sandbox`.

- f73d64a: Keep shared dropdown overlays clickable when they overlap desktop pane titlebar regions.
- d5708c7: Fork at an earlier message instead of only at HEAD. `POST /_electric/entities/<type>/<id>/fork` accepts an optional `fork_pointer: { offset, sub_offset }` (snake_case wire) that truncates the new entity's `main` stream up to and including the chosen event; shared-state streams still clone at HEAD; the root's manifest is filtered so descendants spawned after the pointer are dropped from the fork along with their subtrees. Pointer-forks skip the all-subtree-idle wait on the root (the historical read can't be torn by concurrent writes past the pointer), so the affordance works during the post-run keep-alive window. UI: hover-revealed "Fork from here" button on user-message bubbles in `ChatView`, anchored to the latest preceding completed `runs` row; suppressed on the first message and while a run is in flight.
- 4e2cc22: Make the "Fork from here" affordance work in the mobile Expo DOM embed. Two pieces: (1) wire the fork-anchor map in `ChatLogView` (the view the mobile embed mounts) so `EntityTimeline` actually receives the per-row callbacks; (2) add a `:global(html[data-electric-mobile-dom='true']) .forkButton { opacity: 1 }` rule in `UserMessage.module.css` so the button is visible without a hover/tap (touch devices don't fire `:hover`). The fork POST and post-fork navigation already route through the existing `serverFetch` + `onRequestOpenEntity` callback, so no changes to the mobile package itself.
- 2896820: Render lightweight markdown links and formatting in inbox messages.
- f2d3d5e: Render self-send wake notifications with the sent message payload in the agent timeline.
- Updated dependencies [17b374f]
- Updated dependencies [1a7d72e]
- Updated dependencies [d5708c7]
- Updated dependencies [f2d3d5e]
  - @electric-ax/agents-runtime@0.3.8

## 0.4.14

### Patch Changes

- 7d029a9: Keep Electric Agents Desktop awake while the local runtime is active, with controls in Settings, onboarding, and the tray menu.
- Updated dependencies [9e01e58]
  - @electric-ax/agents-runtime@0.3.7

## 0.4.13

### Patch Changes

- e9ea591: Show detailed agent run failure information in the timeline instead of the generic `Run failed` fallback. Run errors now include their error code, failed tool calls preserve and render their error text, and failed runs fall back to tool errors or finish reasons when no run error row is available.
- 86643d5: Prefer live Electric Cloud server metadata when rendering saved Cloud servers so project, environment, and workspace names stay up to date in the desktop server picker.
- 0a15a47: Bundle the Electric CLI with the desktop app and add managed install/status UI.
- d921a9f: Allow desktop users to choose which configured provider models appear in Horton's model picker, and group model dropdown entries by provider.
- 98b51d6: Update Electric Agents packages to depend on the stable Durable Streams
  packages instead of pkg.pr builds. This pulls in `@durable-streams/client`
  0.2.6, `@durable-streams/server` 0.3.5, and `@durable-streams/state` 0.2.9.
  Examples now resolve `@electric-ax/agents-runtime` from the workspace so they
  do not keep older registry runtime builds pinned in the lockfile.
- aed2189: Add Kimi / Moonshot API support for local Horton runtimes, including model catalog entries, runtime provider resolution, desktop credential persistence, and UI credential inputs.
- 52a641f: Add manifest-backed attachments for agents.

  Attachments are uploaded through entity routes, stored in private attachment streams, referenced by manifest entries, and exposed to runtime handlers through `ctx.attachments`. The server UI can attach image files to user messages, renders message attachments with authenticated preview/download actions, exposes image previews from attachment manifest rows, rolls back uploaded attachments when send fails, and hides image attachment controls for models whose registered pi-ai metadata does not include image input. Image hydration now has a simple newest-images byte/count guardrail. Horton title generation now also works when the first user message is sent after attachment upload, including image-only starts.

- c89aac8: Surface failed signal and kill requests in the UI with toast notifications instead of silently swallowing persistence failures.
- 7001f8f: Add a launch-at-login preference for Electric Agents Desktop, including background startup handling, settings/onboarding controls, and a shared Base UI switch control.
- Updated dependencies [e9ea591]
- Updated dependencies [98b51d6]
- Updated dependencies [aed2189]
- Updated dependencies [52a641f]
  - @electric-ax/agents-runtime@0.3.6

## 0.4.12

### Patch Changes

- 0ba0a43: Refactor the new-session prompt form. Move the working-directory and runner pickers out of the composer's inline pill row into a "session context" tray that tucks under the composer's curved bottom edge (mirrors the chat screen's `<EntityContextDrawer>` pattern, just flipped). Give the runner picker visual parity with the working-directory picker via a new optional leading-icon slot on `Select.Trigger`, and reword the working-directory "None" option to "Don't work in a directory".

## 0.4.11

### Patch Changes

- d344c32: Treat Electric Agents server URLs as opaque tenant-scoped base URLs rooted at `/t/<tenant-id>/v1`, migrate desktop and mobile Cloud clients to that URL shape, move observation stream ensure endpoints under `/_electric/observations/*/ensure-stream`, rename the pre-alpha entity/cron/schema/tag/docs APIs to their Electric Agents names, add a non-interactive `electric agents view` transcript command, and make Horton title extraction work with lightweight desktop inbox collection facades.

  Send the done callback for completed wake checkpoints during graceful shutdown, preventing desktop reloads from leaving already completed DS subscription claims pending.

- c1834f3: Prepare the mobile app for Expo EAS builds and CI. Adds dynamic Expo config, EAS build profiles, mobile CI/export scripts, and aligns shared React/TypeScript dependency resolution so the Expo DOM embed typechecks and passes `expo-doctor`.
- 319e405: Explicit ChatGPT / Codex opt-in with native PKCE OAuth sign-in (opened in the user's default browser to avoid Cloudflare bot detection), per-source consent for detected Codex CLI / OpenCode logins, an inline "Use this login?" prompt under the new-session composer, and a "Restart local runtime" banner gated on credential changes. The runtime no longer reads `~/.codex/auth.json` implicitly — it now requires `ELECTRIC_CODEX_ACCESS_TOKEN` and honours `ELECTRIC_CODEX_REQUIRE_OPT_IN=1`.
- Updated dependencies [d344c32]
- Updated dependencies [c1834f3]
- Updated dependencies [319e405]
  - @electric-ax/agents-runtime@0.3.5

## 0.4.10

### Patch Changes

- ac21b9a: Refine desktop agents onboarding and settings server management.

## 0.4.9

### Patch Changes

- Updated dependencies [833a1cb]
- Updated dependencies [833a1cb]
  - @electric-ax/agents-runtime@0.3.4

## 0.4.8

### Patch Changes

- b39f581: Fix Agent UI message submission on mobile browsers. The Send button now keeps the textarea focused on tap so the on-screen keyboard does not dismiss and reflow the viewport mid-click, and the composer recognises the soft-keyboard return key via `enterKeyHint="send"` plus a `beforeinput` fallback (Android Chrome / GBoard route it as `insertLineBreak` without a matching `keydown`). The Enter handler now also ignores IME composition (`keyCode === 229`).
- a70567e: Add DeepSeek as a supported LLM provider.
  - `agents-runtime`: `detectAvailableProviders()` now detects `DEEPSEEK_API_KEY`; `deepseek` added to `AvailableProvider` type, `PREFERRED_IDS_BY_PROVIDER`, and `envCatalog()`
  - `agents`: model catalog probes `https://api.deepseek.com/v1/models` to surface available DeepSeek models (`deepseek-v4-flash`, `deepseek-v4-pro`); `deepseek-v4-flash` is the default fallback choice
  - `agents-desktop`: `ApiKeys` gains a `deepseek` field persisted in the keychain and mirrored to `DEEPSEEK_API_KEY` in the runtime environment
  - `agents-server-ui`: `ApiKeysForm` gains a DeepSeek API key input; `OnboardingModal` and `CredentialsPage` pass and persist the new field

- d7506a2: Add mobile agent signal controls. The mobile chat composer now shows a stop control while a run is active, the session menu exposes all entity signal types in a child menu, and the embedded chat timeline accounts for the native composer/drawer inset with aligned message widths and bottom fade masking.
- 86e69d5: Add defensive null guards for timeline run items and an error boundary around each timeline row to prevent a single malformed row from crashing the entire view.
- Updated dependencies [9c2c3ae]
- Updated dependencies [a70567e]
- Updated dependencies [b3d4f02]
- Updated dependencies [dffbf62]
  - @electric-ax/agents-runtime@0.3.3

## 0.4.7

### Patch Changes

- e13cad1: Add durable entity signals and signal-driven stop controls for agents. The server, runtime, conformance tests, and CLI now use signal APIs, persist signal events, and let the UI send `SIGINT` to cancel active generations with pending stop feedback.
- da26799: Add a runner picker to the new-session view so users can choose which pull-wake runner handles a spawned entity. Defaults to the Electron shell's own runner when it's one of the enabled choices (preserves the previous single-runtime behaviour) and falls back to the first enabled runner otherwise. The picker is only rendered when at least one runner is registered, so servers using webhook-based dispatch are unaffected. Also extends `Select.Trigger` with an optional `renderValue` prop so triggers can show a human-readable label when option values are opaque keys (e.g. runner ids).
- 4d9c36e: Add a fine-grained reactive entity timeline query and migrate the agents UI to use it. Timeline rows are maintained by TanStack DB using multi-source queries and live child collections, so streamed agent responses update incrementally without rematerializing the whole chat timeline. Update the mobile app to consume the row-based timeline shape and pin React to the React Native renderer version. Keep the conformance property-test model aligned with generated entity type names.
- Updated dependencies [e13cad1]
- Updated dependencies [4d9c36e]
  - @electric-ax/agents-runtime@0.3.2

## 0.4.6

### Patch Changes

- ca01b9d: Add the React Native agents mobile app package.
- 64d9354: Connect the Electric mobile app to Electric Cloud agent servers end-to-end. Trade the dashboard JWT for a per-service agents token, inject `Authorization`/`x-electric-service`/`electric-principal` on every outbound request (via `serverFetch` + `fetchClient` on shape collections, including the React Native long-poll `DurableStream`), forward those headers across the Expo DOM-embed boundary as a prop so the embed's own `auth-fetch` instance picks them up, switch URL composition to `appendPathToUrl` (Cloud URLs carry `?service=…`), spawn via the canonical `/_electric/entities/<type>/<name>` endpoint with `initialMessage` in the body (fixes a STREAM_NOT_FOUND race), and add a runner picker so users target a specific pull-wake runner.
- Updated dependencies [ca01b9d]
- Updated dependencies [9f10b20]
  - @electric-ax/agents-runtime@0.3.1

## 0.4.5

### Patch Changes

- e6a0bff: Add configurable UI port via `ELECTRIC_DESKTOP_UI_PORT` env var for parallel desktop development. Include version in desktop artifact filename.
- 99ac6fd: Pin Durable Streams dependencies to commit `5d5c217` so local development resolves the same subscription-control routing code as the PR build.
- Updated dependencies [9c275b7]
- Updated dependencies [1ab43f5]
- Updated dependencies [99ac6fd]
- Updated dependencies [adc99e9]
  - @electric-ax/agents-runtime@0.3.0

## 0.4.4

### Patch Changes

- e126eba: Route local desktop mutating agents-server requests through the Electron main process so CORS preflights cannot stall behind renderer connection limits.
- e126eba: Default unauthenticated local desktop sessions to the `system:dev-local` principal and resolve optimistic send principals at mutation time so pending messages do not render as `unknown`.
- e126eba: Send new-session initial messages through the spawn request so pull-wake sessions can start without waiting for the UI to preload the entity stream.
- Updated dependencies [e126eba]
- Updated dependencies [e126eba]
  - @electric-ax/agents-runtime@0.2.2

## 0.4.3

### Patch Changes

- c4e046f: Add Electric Cloud sign-in to the desktop app. New Settings → Account panel signs in via GitHub or Google through `dashboard.electric-sql.cloud`'s loopback OAuth flow (the same one the CLI uses), encrypts the resulting JWT with `safeStorage`, refreshes name + workspaces via `auth.whoami`, and offers a one-click jump to the user's Electric Cloud dashboard.

  Add first-launch onboarding for Electric Cloud sign-in and LLM API keys, plus a Cloud Agent Servers settings section that syncs the user's Cloud agent servers, mints per-tenant agents tokens in the main process, and connects the desktop runtime/UI to tenant-scoped Cloud agents URLs without exposing those tokens to the renderer or `settings.json`.

- 6aa0186: Add `ELECTRIC_DESKTOP_PRINCIPAL` env var for local development without auth. The desktop app injects the `electric-principal` header on all requests to the agents-server, enabling pull-wake runner registration and message sends to work locally. Also fix the UI to derive the optimistic message sender from the configured principal and stop sending the redundant `from` field in API requests.

## 0.4.2

## 0.4.1

### Patch Changes

- dfc9a45: Combine the desktop app packaging setup, app settings, and agents UI improvements. Adds desktop packaging assets/configuration, multi-server desktop settings, improved chat and workspace UI behavior, and queued inbox message modes in the runtime.
- 83204d9: Add principals support to the agents system. Every API request now carries a `Principal` (user, agent, service, or system) threaded through the full request lifecycle. Runner dispatch is scoped to the authenticated owner via dispatch policy authorization. The runtime exposes `ctx.principal` in handler context so agent code can implement principal-aware logic. The server UI uses asserted identity headers for dev-mode authentication.
- Updated dependencies [dfc9a45]
- Updated dependencies [83204d9]
  - @electric-ax/agents-runtime@0.2.1

## 0.4.0

### Minor Changes

- 08e85a0: Refactor agents-server HTTP routing around a single `globalRouter` entrypoint passed a flat `TenantContext`.

  The `ElectricAgentsServer` class now owns lifecycle setup only and dispatches each request through an OSS-only wrapper router that layers dashboard and mock-agent routes over `globalRouter.fetch(request, tenantContext)`. This prepares the exported `globalRouter` for library-mode use by callers that build tenant context outside the OSS server class without pulling in the bundled UI or mock agent.

  Breaking change: entity RPC URLs moved from `/:type/:instanceId/...` to `/_electric/entities/:type/:instanceId/...`. This affects entity spawn/get/head/delete, send, fork, tag, and schedule endpoints. The root namespace is now durable-streams pass-through, with no reserved entity control routes.

  Breaking change: the `@electric-ax/agents-server` package root now only exports the library-mode routing assembly surface: DB setup helpers, `AgentsHost`, `StreamClient`, `globalRouter`, `TenantContext`, `GlobalRoutes`, `EntityBridgeCoordinator`, and tenant helpers. OSS server classes, subrouters, entity-manager internals, scheduler/wake-registry internals, schema helpers, and entity response helpers are no longer root exports.

  The runtime server client, bundled agents-server UI, and conformance tests have been updated for the new route layout. Agents-server control-plane routes now use shared TypeBox/Ajv body validation.

### Patch Changes

- dec65ae: Port pull-wake runners onto the tenant-aware agents-server routing refactor.

  Agents-server now supports runner registration, runner-owned pull-wake subscriptions, dispatch policy resolution, subscription stream linking, compact Durable Streams wake claims, callback-forward claim lifecycle handling, and claim-scoped write tokens. Runtime built-ins can register pull-wake runners, tail runner wake streams, claim work through the server, heartbeat offsets, and acknowledge completed work. The CLI, desktop integration, server UI, and local full-stack compose setup now use runner-backed local sessions for the pull-wake flow.

  Saved agents-server connections can include additional request headers for tenant-aware deployments, and CLI/runtime URL handling now preserves base query parameters such as `?secret=...`.

- Updated dependencies [dec65ae]
- Updated dependencies [dec65ae]
- Updated dependencies [08e85a0]
  - @electric-ax/agents-runtime@0.2.0

## 0.3.0

### Minor Changes

- 1df7cce: Add Model Context Protocol (MCP) support — agents can call tools, read resources, and use prompts from external MCP servers (stdio + Streamable HTTP), with OAuth handled by the runtime. New `@electric-ax/agents-mcp` package ships the `Registry` API, transports, OAuth bridges, and opt-in `keychainPersistence` / `filePersistence` helpers. The Electron desktop app exposes a Settings → MCP Servers page and a `mcp.servers` block in `settings.json` that layers with the per-workspace `mcp.json`. Built-in `horton` and `worker` agents see registered MCP tools transparently via `mcp.tools()`.

### Patch Changes

- f509387: Redesign.
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
- Updated dependencies [1df7cce]
- Updated dependencies [f509387]
- Updated dependencies [590aabb]
- Updated dependencies [744c47f]
- Updated dependencies [28d127b]
- Updated dependencies [6399147]
- Updated dependencies [a3cee92]
- Updated dependencies [7f8947a]
  - @electric-ax/agents-runtime@0.1.3

## 0.2.8

### Patch Changes

- d13820e: Tune the agents server UI accent colors and restore readable dark-mode code snippets.
- c0037aa: fix: update the ui

## 0.1.6

### Patch Changes

- Updated dependencies [1cb5020]
- Updated dependencies [1cb5020]
  - @electric-ax/agents-runtime@0.1.2

## 0.1.5

### Patch Changes

- e0b588f: Bump `@electric-ax/durable-streams-*-beta` dependencies to the latest published versions (`client@^0.3.1`, `state@^0.3.1`, `server@^0.3.2`).
- Updated dependencies [e0b588f]
  - @electric-ax/agents-runtime@0.1.1

## 0.1.4

### Patch Changes

- 89debcf: Coder-session UI improvements: a dedicated 3-tab Create / Attach / Import spawn dialog routed in from the sidebar's _New session_ flow, a timeline view that shows queued user prompts immediately as a "queued" bubble (matched against canonical `user_message` events by text so they swap cleanly when the CLI mirrors the JSONL back), and a session header that surfaces the full `nativeSessionId` for copy/paste against on-disk session files.
- Updated dependencies [4987694]
- Updated dependencies [89debcf]
  - @electric-ax/agents-runtime@0.1.0

## 0.1.3

### Patch Changes

- Updated dependencies [9024ec2]
  - @electric-ax/agents-runtime@0.0.4

## 0.1.2

### Patch Changes

- Updated dependencies [5ef535b]
- Updated dependencies [6d8be8b]
  - @electric-ax/agents-runtime@0.0.3

## 0.1.1

### Patch Changes

- Updated dependencies [097f2c4]
  - @electric-ax/agents-runtime@0.0.2
