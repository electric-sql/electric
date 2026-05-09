# Engineering diary — pull-wake runtime and desktop integration

Dear diary,

After the post-merge security work, today’s next chapter was about turning pull-wake from a server-side control-plane feature into something the desktop can actually use for manual testing. The big themes were: install/build after the `origin/main` merge, replace the temporary built-in webhook server with a pull-wake runner, make local manual stacks isolated from other checkouts, add local asserted auth, and ensure desktop-created entities explicitly target the desktop runner.

## Fresh install after merging `origin/main`

The merge brought in new workspace packages and dependencies, especially the desktop and MCP packages. Earlier typechecks were failing with missing modules like:

- `diff`
- `@electric-ax/agents-mcp`

So the next implementation slice started with:

```sh
pnpm install
```

After that, the worker built the needed packages:

```sh
pnpm --filter @electric-ax/agents-runtime build
pnpm --filter @electric-ax/agents-mcp build
```

That cleared the stale workspace-link / missing-dependency issues. Subsequent focused typechecks for runtime, agents, desktop, and electric-ax passed in the relevant slices.

## General pull-wake runner library

The first runtime integration slice added a reusable pull-wake runner helper in:

```txt
packages/agents-runtime/src/pull-wake-runner.ts
```

Exported from:

```txt
packages/agents-runtime/src/index.ts
```

The runner tails the runner wake stream:

```txt
/runners/{runnerId}/wake
```

and dispatches `WakeNotification`s through the existing runtime path:

```ts
runtime.dispatchWake(notification, options)
```

It supports:

- optional runner registration,
- runner wake-stream/control-plane headers,
- claim callback headers,
- default `Electric-Runner-Id` injection,
- `claimTokenHeader: 'electric-claim-token'`,
- offset tracking via `onOffset`,
- `start()` / `stop()` / `waitForStopped()`,
- duplicate-start protection.

A review initially found two blockers:

1. `claimHeaders` existed on the config but were not actually used.
2. `registerTypes()` no longer created webhook subscription records, but still sent legacy `serve_endpoint` metadata.

The follow-up fixed both:

- `RuntimeRouter.dispatchWake(notification, options)` now accepts per-dispatch claim options.
- `createPullWakeRunner` passes `claimHeaders` through to `processWake`.
- The runner injects `Electric-Runner-Id: <runnerId>` by default unless the caller overrides it.
- Runtime registration is now metadata-only: no `serve_endpoint`, no subscription `PUT`.

Focused tests passed:

```txt
packages/agents-runtime/test/pull-wake-runner.test.ts
packages/agents-runtime/test/create-handler.test.ts
packages/agents-runtime/test/process-wake.test.ts
```

with 61 tests passing in review.

## Removing built-in webhook setup

The desktop local HTTP webhook server was only a temporary bridge. The user clarified that a desktop cannot reasonably use inbound webhooks without special setup, so the old built-in webhook path should be completely removed rather than retained as legacy compatibility.

A worker removed the built-in local webhook server path from `packages/agents`.

Removed concepts included:

- `DEFAULT_BUILTIN_AGENT_HANDLER_PATH`,
- local HTTP server creation inside `BuiltinAgentsServer`,
- health route from that local server,
- `POST /_electric/builtin-agent-handler`,
- public base URL / `serveEndpoint` computation,
- `url` / `registeredBaseUrl` server getters.

`BuiltinAgentsServer` now requires a pull-wake runner id and starts `createPullWakeRunner`. `start()` returns:

```txt
pull-wake:<runnerId>
```

The built-in path still preserves:

- MCP registry wiring,
- model/tool provider wiring,
- optional local runner registration,
- no default Horton dispatch policy.

The standalone agents entrypoint now requires:

```sh
ELECTRIC_AGENTS_PULL_WAKE_RUNNER_ID
# or
PULL_WAKE_RUNNER_ID
```

and fails clearly if neither is provided.

The electric-ax start command was updated to stop resolving built-in host/port and to report pull-wake runner startup instead of webhook server startup.

A review found one desktop blocker: generated `pullWakeRunnerId` was not reliably persisted. `loadSettings()` generated a UUID, but because `restartRuntime()` then saw a truthy id, it did not save settings. A follow-up fixed this so missing/blank runner ids are generated and immediately persisted during settings load.

Review confirmed:

- missing settings generate and save a UUID,
- corrupt settings fall back to defaults and save a UUID,
- blank ids are normalized and replaced,
- env override remains temporary and does not overwrite the persisted id.

## Desktop pull-wake wiring

The desktop now always has a pull-wake runner id.

In:

```txt
packages/agents-desktop/src/main.ts
```

it uses:

```sh
ELECTRIC_DESKTOP_PULL_WAKE_RUNNER_ID
```

when set, otherwise a generated persisted `pullWakeRunnerId` from desktop settings.

Desktop can optionally register the runner for local testing:

```sh
ELECTRIC_DESKTOP_PULL_WAKE_REGISTER_RUNNER=1
```

and can provide owner id via:

```sh
ELECTRIC_DESKTOP_PULL_WAKE_OWNER_USER_ID
```

The local listener host/port options were removed because there is no inbound local webhook server anymore.

## Isolated manual stack support

Because another server/desktop stack may already be running from another checkout, the manual test stack needs to be isolated.

A worker inspected the compose setup and found that `packages/agents-server/docker-compose.dev.yml` already supports host port overrides:

- `PG_HOST_PORT`
- `ELECTRIC_HOST_PORT`
- `JAEGER_UI_PORT`
- `JAEGER_OTLP_HTTP_PORT`
- `JAEGER_OTLP_GRPC_PORT`

So no compose changes were needed. The docs were updated in:

```txt
docs/agents-development.md
```

with an isolated stack recipe using:

```txt
Postgres: 55432
Electric:  33060
Jaeger UI: 16687
Agents:    4447
```

The desktop also gained:

```sh
ELECTRIC_DESKTOP_USER_DATA_DIR
```

which is applied via `app.setPath('userData', ...)` early enough — before the single-instance lock, before `app.whenReady()`, and before settings load.

Desktop startup can also force/select a server URL:

```sh
ELECTRIC_DESKTOP_SERVER_URL
# preferred, falling back to
ELECTRIC_AGENTS_SERVER_URL
```

The env URL is validated as `http:` or `https:`, added to settings if missing, selected as active, and persisted. Review passed with one caution: launching desktop from a shell with `ELECTRIC_AGENTS_SERVER_URL` set can persistently switch the active server, which is intentional but worth remembering.

## Local dev asserted auth

For the two-desktop manual test, one local Agents Server needs to simulate two users. A server-wide env identity is not enough because both desktops hit the same server. The chosen design is header-asserted dev auth, gated off by default.

Added:

```txt
packages/agents-server/src/dev-asserted-auth.ts
```

Enabled by:

```sh
ELECTRIC_AGENTS_DEV_ASSERTED_AUTH=1
```

It reads:

```http
X-Electric-Asserted-Email
X-Electric-Asserted-Name
```

and falls back to:

```sh
ELECTRIC_ASSERTED_AUTH_EMAIL
ELECTRIC_ASSERTED_AUTH_NAME
```

It returns `null` when enabled but no identity is supplied. The user id is:

```ts
email ?? name
```

`AuthenticatedRequestUser` was extended with optional `email` and `name`.

The helper is wired into the agents-server entrypoint only when the env gate is set, so production/default behavior is unchanged.

Desktop now builds asserted headers from:

```sh
ELECTRIC_ASSERTED_AUTH_EMAIL
ELECTRIC_ASSERTED_AUTH_NAME
```

and passes them into built-in pull-wake as both:

- `headers` for runner registration/heartbeat/wake-stream calls,
- `claimHeaders` for callback-forward claim/heartbeat/done calls.

The standalone built-in agents entrypoint was also updated to pass the same asserted headers when those env vars are set.

Docs were updated so the standalone built-in command includes the required pull-wake runner id and optional asserted-auth envs. Stale docs for `ELECTRIC_AGENTS_BUILTIN_HOST` and `ELECTRIC_AGENTS_BUILTIN_PORT` were removed.

Focused tests passed for dev asserted auth and agents entrypoint behavior.

## Explicit runner dispatch policy for desktop-created entities

Horton should not get a default dispatch policy. Instead, each desktop-created entity should explicitly target that desktop’s runner.

The desktop now exposes the current runner id through `DesktopState`:

- `packages/agents-desktop/src/main.ts`,
- `packages/agents-desktop/src/preload.ts`,
- `packages/agents-server-ui/src/lib/server-connection.ts`.

The new-session spawn path in:

```txt
packages/agents-server-ui/src/components/views/NewSessionView.tsx
```

now calls `window.electronAPI.getDesktopState()` when running inside desktop. If a non-empty `pullWakeRunnerId` is present, it sends:

```ts
dispatch_policy: {
  targets: [{ type: 'runner', runnerId }]
}
```

with the spawn request.

The shared provider/client layers were updated to accept and forward `dispatch_policy` only when provided:

- `packages/agents-server-ui/src/lib/ElectricAgentsProvider.tsx`,
- `packages/agents-runtime/src/runtime-server-client.ts`.

Review confirmed:

- web/non-desktop behavior is unchanged,
- desktop adds explicit policy only when it has a runner id,
- the body shape matches server expectations,
- no default Horton/entity-type policy was introduced.

Focused typechecks passed for server UI, runtime, and desktop.

## Current manual test readiness

We now have the key pieces needed for a real isolated desktop pull-wake smoke test:

- no built-in webhook server,
- general pull-wake runner library,
- desktop runner id generation/persistence,
- optional local runner registration,
- isolated compose/server/desktop env support,
- local dev asserted auth,
- explicit runner-target dispatch policy for desktop-created sessions,
- no public entity write token,
- no write tokens in wake payloads.

The next practical step is to build everything and run the isolated stack:

```sh
pnpm --filter @electric-ax/agents-runtime build
pnpm --filter @electric-ax/agents-server build
pnpm --filter @electric-ax/agents build
pnpm --filter @electric-ax/agents-server-ui build:desktop
pnpm --filter @electric-ax/agents-desktop build
```

then start isolated services, Agents Server on port `4447`, and one desktop with asserted auth + runner registration. Once a single desktop registers, heartbeats, spawns a runner-targeted Horton session, and processes a wake, we can run the two-desktop Alice/Bob isolation test.

## Remaining risks / things to watch

- The working tree is large and includes many staged/untracked pull-wake files; before finalizing, review `git status` carefully.
- Claim write tokens are process-local by design for v1. Restart/token loss fails closed and runtimes must reacquire.
- Desktop env server URL fallback to `ELECTRIC_AGENTS_SERVER_URL` can persistently change active server if accidentally set.
- We still need an actual manual run to discover integration issues around Durable Streams offsets, runner registration auth, callback-forward claim headers, and Electron multi-instance behavior.

That’s where the branch stands now: most of the architectural migration is coded, reviewed, and focused-test green; the next chapter is build-and-run reality.
