---
title: Operations
titleTemplate: "Coding Agent - Electric Agents"
description: >-
  UI controls, cleanup utilities, defaults, tracked limitations, and end-to-end examples.
outline: [2, 3]
---

# Operations

## Setup

### Required env

At least one of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` must be set; both is fine. `SPRITES_TOKEN` is required only if you want the sprites target.

```bash
ANTHROPIC_API_KEY=sk-ant-...                           # claude / opencode (anthropic models)
OPENAI_API_KEY=sk-proj-...                             # codex / opencode (openai models)
SPRITES_TOKEN=<bearer-token-from-sprites.dev>          # optional — enables target=sprites
```

`registerCodingAgent`'s default `env()` callback mirrors `ANTHROPIC_API_KEY` → `CLAUDE_CODE_OAUTH_TOKEN` when the value matches the OAuth shape (`sk-ant-oat...`), so a single `ANTHROPIC_API_KEY=sk-ant-oat...` covers both API-key and OAuth-token code paths transparently.

### Local dev

```bash
node packages/electric-ax/bin/dev.mjs up           # spawn full stack on :4437
node packages/electric-ax/bin/dev.mjs restart      # bounce host services (state preserved)
node packages/electric-ax/bin/dev.mjs clear-state  # nuke postgres + volumes + streams
```

`dev.mjs` runs an embedded `DurableStreamTestServer` and persists its data directory to `.local/dev-streams` so existing entities survive `up`-after-`down`.

### Bootstrap registration

[`packages/agents/src/bootstrap.ts`](https://github.com/electric-sql/electric/blob/main/packages/agents/src/bootstrap.ts) wires the providers + bridge into the entity registry on dev-server startup:

```ts
import {
  registerCodingAgent,
  LocalDockerProvider,
  HostProvider,
  StdioBridge,
  createSpritesProviderIfConfigured,
} from '@electric-ax/coding-agents'

const spritesProvider = createSpritesProviderIfConfigured()

registerCodingAgent(registry, {
  providers: {
    sandbox: new LocalDockerProvider(),
    host: new HostProvider(),
    ...(spritesProvider ? { sprites: spritesProvider } : {}),
  },
  bridge: new StdioBridge(),
})
```

The sprites provider is registered conditionally on `SPRITES_TOKEN` so deployments without it see no behavioural change.

## UI

The `agents-server-ui` renders coding agents with a status badge, a streaming timeline, and Pin / Release / Stop / Convert-target / Convert-kind / Fork controls — all of which translate to the inbox messages described in [Lifecycle](./lifecycle#inbox-messages-control-plane). See [`packages/agents-server-ui/src/components/EntityHeader.tsx`](https://github.com/electric-sql/electric/blob/main/packages/agents-server-ui/src/components/EntityHeader.tsx) for the wire-up.

The spawn dialog ([`CodingAgentSpawnDialog.tsx`](https://github.com/electric-sql/electric/blob/main/packages/agents-server-ui/src/components/CodingAgentSpawnDialog.tsx)) auto-disables incompatible workspace types (e.g. bind-mount when `target=sprites`) and surfaces cross-provider Convert/Fork options as visible-but-disabled with a tooltip explaining why. Pin / Release / Stop / Convert-target / Convert-kind triggers are gated when status flips to `destroyed`.

### Status colour map

| Colour    | Status         | Meaning                                                   |
| --------- | -------------- | --------------------------------------------------------- |
| Gray      | `cold`         | Sandbox hibernated.                                       |
| Amber     | `starting`     | Cold-boot in progress (sprites also show bootstrap rows). |
| Green     | `idle`         | Container running, no active CLI turn.                    |
| Blue      | `running`      | CLI turn in progress.                                     |
| Amber     | `stopping`     | Sandbox is being torn down.                               |
| Red       | `error`        | Last cold-boot or run failed. `lastError` shown.          |
| Dim gray  | `destroyed`    | Entity tombstoned. All controls gated.                    |

## Cleanup utilities

Two operator scripts ship in `packages/coding-agents/scripts/`. Both run via Node 24's native TypeScript stripping; no build or extra dependency required.

```bash
SPRITES_TOKEN=... pnpm -C packages/coding-agents cleanup:sprites           # dry-run
SPRITES_TOKEN=... pnpm -C packages/coding-agents cleanup:sprites --delete  # actually delete

pnpm -C packages/coding-agents cleanup:volumes                              # dry-run
pnpm -C packages/coding-agents cleanup:volumes --delete                     # delete unattached volumes
pnpm -C packages/coding-agents cleanup:volumes --in-use                     # also list still-mounted ones
```

`cleanup:sprites` lists / deletes sprites whose name starts with `coding-agent-`, `conf-sprite-`, or `e2e-sprites-` (the prefixes used by production UI-spawned agents and conformance / e2e tests).

`cleanup:volumes` lists / deletes `coding-agent-workspace-*` Docker volumes (kept by `LocalDockerProvider.destroy()` for resume safety, orphaned after entity DELETE).

## Defaults

| Setting             | Default                              | Override via                                          |
| ------------------- | ------------------------------------ | ----------------------------------------------------- |
| `idleTimeoutMs`     | 300 000 (5 min)                      | `lifecycle.idleTimeoutMs` in `spawnCodingAgent`       |
| `keepWarm`          | `false`                              | `lifecycle.keepWarm` in `spawnCodingAgent`            |
| `coldBootBudgetMs`  | 30 000 (sandbox/host); sprites is clamped to a 240 000 floor | `RegisterCodingAgentDeps.defaults.coldBootBudgetMs` |
| `runTimeoutMs`      | 1 800 000 (30 min)                   | `RegisterCodingAgentDeps.defaults.runTimeoutMs`       |
| Sprites idle timeout| 300 s (auto-sleep)                   | `FlySpriteProviderOptions.idleTimeoutSecs`            |

## Tracked limitations

- **TL-S1**: Sprites API is pre-1.0; the protocol has shifted (rc30 docs vs rc43 server) and is expected to keep shifting until 1.0.
- **TL-S2**: Sprites have no custom OCI image input. First cold-boot per agent installs `opencode-ai` (~10 s on the default Ubuntu image, which preinstalls Claude CLI / OpenAI Codex / Gemini CLI / node).
- **TL-S3**: `cloneWorkspace` is not supported on sprites (deferred to v1.5). Workspace files don't transfer on fork-within-sprites; conversation history does.
- **TL-S4**: No cross-provider migration (sandbox/host ↔ sprites). By design.
- **O-1 (mitigated)**: `LocalDockerProvider.destroy()` keeps the workspace volume for resume safety; the volume orphans after the entity's terminal DELETE. Mitigation: `pnpm cleanup:volumes`.

## Examples

### Entity handler: spawn a coding-agent and await its reply

```ts
import {
  registerCodingAgent,
  LocalDockerProvider,
  HostProvider,
  StdioBridge,
  createSpritesProviderIfConfigured,
} from '@electric-ax/coding-agents'

// In your server bootstrap (called once):
registerCodingAgent(registry, {
  providers: {
    sandbox: new LocalDockerProvider(),
    host: new HostProvider(),
    ...(createSpritesProviderIfConfigured()
      ? { sprites: createSpritesProviderIfConfigured()! }
      : {}),
  },
  bridge: new StdioBridge(),
})

// In any entity handler:
registry.define('my-orchestrator', {
  async handler(ctx, wake) {
    const coder = await ctx.spawnCodingAgent({
      id: 'feature-impl',
      kind: 'claude',
      workspace: { type: 'volume', name: 'feature-branch' },
      initialPrompt: 'Add a sum() helper to src/math.ts and a test.',
      wake: { on: 'runFinished', includeResponse: true },
    })

    if (wake.source?.entityUrl === coder.url) {
      const responseText = wake.payload?.responseText
      if (responseText && !responseText.includes('test')) {
        await coder.send('Please also add the test in src/math.test.ts.')
      }
    }
  },
})
```

### Horton chat: ask Horton to spawn a coder

With the dev server running (`npx electric-ax agents quickstart`):

```
User: Spawn a coding agent and have it create a hello-world Express server in /workspace.
```

Horton calls `spawn_coding_agent`. The coding-agent runs the task and reports back; Horton is woken with the response and reports the result.

To send a follow-up:

```
User: Now have the same coding agent add a /health endpoint.
```

Horton calls `prompt_coding_agent` with the URL from the prior `spawn_coding_agent` result. The agent resumes its session — the container cold-boots if it has hibernated, but the Claude session is restored losslessly.
