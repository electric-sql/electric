---
title: Coding Agent
titleTemplate: "... - Electric Agents"
description: >-
  Long-lived, sandboxed coding-agent CLI sessions (claude / codex / opencode) with persistent workspaces.
outline: [2, 3]
---

# Coding Agent

`coding-agent` is the built-in entity type for long-lived, supervised coding-CLI sessions. Each agent owns a persistent workspace and a CLI process — claude, codex, or opencode — wrapped in a state machine that survives idle hibernation, host restart, kind switches, and forks. The runtime exposes a single typed API (`ctx.spawnCodingAgent`) for parent entities to delegate code work and be woken when it completes.

**Sources**

- Entity, lifecycle, providers, bridges: [`packages/coding-agents/src/`](https://github.com/electric-sql/electric/blob/main/packages/coding-agents/src/)
- Runtime API surface: [`packages/agents-runtime/src/types.ts`](https://github.com/electric-sql/electric/blob/main/packages/agents-runtime/src/types.ts)
- Horton tools: [`packages/agents/src/tools/spawn-coding-agent.ts`](https://github.com/electric-sql/electric/blob/main/packages/agents/src/tools/spawn-coding-agent.ts)

## Pages

- **[Architecture](./architecture)** — package layout, dependency flow, the handler / lifecycle-manager / workspace-registry / providers / bridge pieces.
- **[Lifecycle](./lifecycle)** — state machine, inbox messages, idle eviction, lifecycle events.
- **[Native API](./api)** — `ctx.spawnCodingAgent`, sending prompts, state collections, convert and fork.
- **[Targets and kinds](./targets-and-kinds)** — sandbox / host / sprites; claude / codex / opencode; workspace types; cross-provider gates.
- **[Integrating new providers and kinds](./integrating)** — `Bridge` and `SandboxProvider` interfaces, conformance contract.
- **[Operations](./operations)** — UI controls, cleanup utilities, defaults, tracked limitations, examples.

## Quick reference

| Aspect            | Values                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------- |
| Agent kinds       | `claude`, `codex`, `opencode`                                                                |
| Sandbox targets   | `sandbox` (Docker), `host` (no isolation), `sprites` ([sprites.dev](https://sprites.dev))    |
| Workspace types   | `volume` (named Docker volume — sandbox/sprites), `bindMount` (host path — host/sandbox)     |
| Inbox messages    | `prompt`, `pin`, `release`, `stop`, `destroy`, `convert-kind`, `convert-target`              |
| Status states     | `cold`, `starting`, `idle`, `running`, `stopping`, `error`, `destroyed`                      |
| Provider env vars | `ANTHROPIC_API_KEY` (or `CLAUDE_CODE_OAUTH_TOKEN`), `OPENAI_API_KEY`, `SPRITES_TOKEN`        |

## When to use it

| Scenario                                                                              | Use                                                |
| ------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Multi-turn, stateful code edits with filesystem isolation                             | `coding-agent`                                     |
| Multi-file changes that benefit from a CLI's native tool set                          | `coding-agent`                                     |
| A parent entity that delegates coding work and is woken on completion                 | `ctx.spawnCodingAgent`                             |
| Conversational assistant that orchestrates coding as one of many tasks                | Horton + `spawn_coding_agent` tool                 |
| Short one-shot LLM completion or structured extraction                                | `ctx.useAgent` / `worker`                          |
| Running a known shell command in isolation                                            | `worker`                                           |

A `coding-agent` is the right primitive when continuity across turns matters — it can read its own prior work, iterate on a file, run tests, hibernate, and resume losslessly on the next prompt.

## Related

- [Horton agent](../agents/horton) — the assistant that uses `spawn_coding_agent` / `prompt_coding_agent`.
- [Worker agent](../agents/worker) — lightweight isolated subagent without session continuity.
- [Spawning and coordinating](/docs/agents/usage/spawning-and-coordinating) — `ctx.spawn`, `ctx.observe`, and wake semantics.
- [Defining entities](/docs/agents/usage/defining-entities) — entity types and state collections.
- [Implementation findings — round 2](https://github.com/electric-sql/electric/blob/main/docs/superpowers/plans/2026-05-02-coding-agents-fly-sprites.md#implementation-findings--round-2-2026-05-03) — sprites exec protocol, bug-hunt report, and notable post-merge fixes.
