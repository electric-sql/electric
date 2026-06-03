# Agents Docs Update Plan

The agents docs in `website/docs/agents` were launched around Apr 29, 2026 and
have only had light updates since. The agents packages have changed heavily since
then, so this plan tracks the docs refresh needed to bring the public docs back
in line with `packages/agents*` and `packages/electric-ax`.

## Goals

- Make every code sample compile against the current package exports.
- Bring reference pages in sync with the current TypeScript interfaces.
- Update narrative docs for the current runtime model: pull-wake runners,
  principals/permissions, sandbox profiles, attachments, signals, event sources,
  model providers, MCP, desktop, and mobile.
- Remove references to removed or renamed concepts.

## Priority 0: Broken or Misleading Docs

- Fix `website/docs/agents/usage/embedded-builtins.md`.
  - Current docs describe the old webhook-server shape for `BuiltinAgentsServer`
    with `port`, `baseUrl`, `server.url`, and `registeredBaseUrl`.
  - Current `BuiltinAgentsServerOptions` requires `pullWake` and starts a
    pull-wake runner; `start()` returns `pull-wake:<runnerId>`.
  - Update examples around `pullWake.runnerId`, `ownerPrincipal`,
    `registerRunner`, `headers`, `claimHeaders`, `claimTokenHeader`,
    `loadProjectMcpConfig`, `extraMcpServers`, and `mcpOAuthRedirectBase`.

- Fix MCP import examples.
  - `mcp.tools()` is exported by `@electric-ax/agents-mcp`, not
    `@electric-ax/agents-runtime`.
  - Update `website/docs/agents/usage/mcp-servers.md` and any related examples.

- Remove Coder references.
  - `coder` was removed; built-ins are currently `horton` and `worker`.
  - Update `website/docs/agents/index.md`, `website/docs/agents/quickstart.md`,
    sidebars/nav if applicable, and any "Built-in agents" summaries.

- Fix client import examples.
  - `website/docs/agents/usage/clients-and-react.md` imports `codingSession`,
    which does not appear to be exported.
  - Remove or replace it with current helpers.

## Priority 1: Reference Pages

- Refresh `website/docs/agents/reference/handler-context.md`.
  - Add `principal`, `signal`, `sandbox`, `attachments`, `onSignal`, and
    `deleteTag`.
  - Change `send()` and `EntityHandle.send()` return types to
    `Promise<SendResult>`.
  - Document `spawn(..., { sandbox })`.
  - Replace `removeTag` with `deleteTag`.

- Refresh `website/docs/agents/reference/entity-definition.md`.
  - Remove `outputSchemas` unless it is intentionally supported elsewhere.
  - Add `stateSchemas` and `permissionGrants`.
  - Link permission grants to the server permission model.

- Refresh `website/docs/agents/usage/app-setup.md`.
  - Add `serverHeaders`, `webhookSignature`, `defaultDispatchPolicyForType`,
    `sandboxProfiles`, `publicUrl`, and event-source helpers in
    `createElectricTools`.
  - Correct `heartbeatInterval` default from `30000` to `10000`.
  - Explain webhook signature verification defaults and when disabling is
    appropriate.

- Refresh `website/docs/agents/usage/programmatic-runtime-client.md`.
  - Add config fields: `headers`, `writeTokenHeader`, `principalKey`.
  - Add spawn fields: `sandbox`, `dispatch_policy`.
  - Add message fields: `mode`, `position`.
  - Add `signalEntity`, `createAttachment`, `readAttachment`,
    `listEventSources`, `subscribeToEventSource`, and
    `unsubscribeFromEventSource`.
  - Check current method names: use `getEntity`, `deleteTag`, and
    `deleteEntity` consistently.

- Refresh `website/docs/agents/reference/built-in-collections.md`.
  - Recount current built-in collections from `packages/agents-runtime/src/entity-schema.ts`.
  - Add `signals` and attachment-related manifest details.
  - Update child status values: `paused`, `stopping`, and `killed`.
  - Include newer fields such as `_timeline_order`, `tool_call_id`, and wake
    change payload metadata where relevant.

## Priority 2: User-Facing Guides

- Update `website/docs/agents/quickstart.md`.
  - Decide whether the CLI should still require `ANTHROPIC_API_KEY` or whether
    docs should mention lower-level support for OpenAI, Codex, DeepSeek, and
    Kimi/Moonshot.
  - Add notes for model provider selection in desktop/UI where relevant.
  - Mention pull-wake runner startup language instead of old webhook runtime
    language.

- Update `website/docs/agents/reference/cli.md`.
  - Add `electric agents view`.
  - Add `electric agents signal`.
  - Add env vars around pull-wake runners:
    `ELECTRIC_AGENTS_PULL_WAKE_RUNNER_ID`,
    `PULL_WAKE_RUNNER_ID`,
    `ELECTRIC_AGENTS_REGISTER_PULL_WAKE_RUNNER`,
    and `ELECTRIC_AGENTS_WORKING_DIRECTORY`.
  - Verify `ELECTRIC_AGENTS_URL` versus `ELECTRIC_AGENTS_SERVER_URL` usage for
    CLI versus built-in runtime entrypoints.

- Update `website/docs/agents/usage/spawning-and-coordinating.md`.
  - Document sandbox selection and inheritance.
  - Document `send()` return value and scheduled/self-send behavior.
  - Mention permissions required for spawn, write, signal, schedule, fork, and
    manage flows.

- Update `website/docs/agents/usage/waking-entities.md` and
  `website/docs/agents/reference/wake-event.md`.
  - Include event-source wakes and hydrated webhook rows.
  - Include lifecycle signals where they affect wake/session behavior.
  - Confirm current `WakeMessage` shape against `entity-schema.ts`.

- Update `website/docs/agents/usage/context-composition.md`.
  - Include manifest-backed attachments and image hydration in timeline context.
  - Mention volatile context source ordering fixes if the docs describe ordering.

## Priority 3: Package-Specific Coverage

- Add or update sandbox docs.
  - Cover `@electric-ax/agents-runtime/sandbox`.
  - Explain `unrestrictedSandbox()`, `dockerSandbox()`, `remoteSandbox({ provider: "e2b" })`,
    `chooseDefaultSandbox()`, sandbox profiles, network policy, and when to use
    each provider.

- Add or update permissions/principals docs.
  - Cover `Electric-Principal`, principal keys, principal URLs, principal kinds,
    entity type grants, entity grants, propagation, `copy_to_children`, and
    claim-scoped write tokens.
  - Document how clients pass `principalKey` and server headers.

- Add attachments docs.
  - Cover upload/read APIs, manifest entries, inbox/image attachment rendering,
    model image capability gating, rollback on send failure, and runtime
    `ctx.attachments`.

- Add signals docs.
  - Cover CLI `signal`, `AgentsClient.signal`, `ctx.onSignal`, runtime-controlled
    signals (`SIGINT`, `SIGSTOP`, `SIGCONT`, `SIGKILL`), and handler-delivered
    signals (`SIGHUP`, `SIGTERM`, `SIGUSR`).

- Add event-source docs.
  - Cover `list_event_sources`, `subscribe_event_source`,
    `unsubscribe_event_source`, subscription lifetimes, bucket/filter params,
    and hydrated webhook wake payloads.

- Decide how to document `packages/agents-mobile`.
  - Add a short mobile overview if it is intended to be public.
  - Include Cloud agent server connection behavior and signal controls if
    relevant.

## Validation Checklist

- Run a docs sample compile check where possible.
- Search for stale terms:
  - `coder`
  - `outputSchemas`
  - `removeTag`
  - `mcp.tools` imported from `agents-runtime`
  - old `BuiltinAgentsServer` fields: `port`, `baseUrl`, `registeredBaseUrl`
  - heartbeat default `30000`
- Compare reference snippets against:
  - `packages/agents-runtime/src/types.ts`
  - `packages/agents-runtime/src/create-handler.ts`
  - `packages/agents-runtime/src/runtime-server-client.ts`
  - `packages/agents-runtime/src/entity-schema.ts`
  - `packages/agents/src/server.ts`
  - `packages/electric-ax/src/index.ts`
  - `packages/electric-ax/src/start.ts`
- Run website docs lint/build after edits.

## Suggested Order

1. Fix compile-breaking samples and removed concepts.
2. Regenerate or manually refresh reference pages from current TypeScript types.
3. Update quickstart and CLI docs around pull-wake, signals, and provider support.
4. Add new topical guides for permissions, sandboxing, attachments, signals, and
   event sources.
5. Do a final pass for consistency, links, sidebars, and terminology.
