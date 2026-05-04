---
title: Lifecycle
titleTemplate: "Coding Agent - Electric Agents"
description: >-
  Status state machine, inbox messages, idle eviction, and the lifecycle event vocabulary.
outline: [2, 3]
---

# Lifecycle

A `coding-agent` cycles through seven states.

```text
                spawn ─────▶ ┌───────┐ ◀── idle-timeout fires (& not pinned)
                             │ COLD  │     or stop/destroy
                             └───┬───┘
                                 │ prompt
                                 ▼
                            ┌────────┐
                            │STARTING│
                            └───┬────┘
            cold-boot fail      │ ready    (sprites: also bootstrap.starting → bootstrap.complete)
              ┌─────────────────┴─────────────────┐
              ▼                                   ▼
          ┌───────┐                          ┌────────┐
          │ ERROR │                          │  IDLE  │ ◀──┐
          └──┬────┘                          └────┬───┘    │ runTurn done
             │ next prompt                        │ prompt │
             ▼                                    ▼        │
          ┌───────┐                          ┌────────┐   │
          │ COLD  │                          │RUNNING │───┘
          └───────┘                          └───┬────┘
                                                 │ stop / destroy
                                                 ▼
                                            ┌────────┐
                                            │STOPPING│ ─── SIGTERM → SIGKILL after 5 s
                                            └───┬────┘
                                                │ destroy completes
                                                ▼
                                          ┌──────────┐
                                          │DESTROYED │ tombstone — Pin/Release/Stop/Convert all gated
                                          └──────────┘
```

## Status states (`sessionMeta.status`)

| State       | Meaning                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| `cold`      | Sandbox is hibernated. Volume / sprite still exists; will wake on next prompt.                       |
| `starting`  | Cold-boot in progress (provider creating container / sprite, bootstrap running).                     |
| `idle`      | Sandbox up, no active turn. Idle timer counts down to eviction unless `keepWarm` or pinned.          |
| `running`   | A prompt is being processed (CLI is executing).                                                      |
| `stopping`  | Currently transitioning down (e.g. response to `stop` message or idle eviction).                     |
| `error`     | Most recent operation failed; `lastError` carries the message.                                       |
| `destroyed` | Permanent. Container removed; `pin`/`release`/`stop`/`convert-*` are no-ops.                         |

## Inbox messages (control plane)

Send these via `POST /coding-agent/<name>/send` with body `{ from: 'user' | ..., type, payload }`.

| Type             | Payload                                                          | Effect                                                                                            |
| ---------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `prompt`         | `{ text: string }`                                               | Run a turn. If cold, triggers sandbox start + bootstrap (sprites only).                           |
| `pin`            | `{}`                                                             | Increment pin refcount; while pinned, idle eviction is suppressed.                                |
| `release`        | `{}`                                                             | Decrement pin refcount; if 0 and idle, re-arms idle timer.                                        |
| `stop`           | `{}`                                                             | Hibernate now. Container removed; status → `cold`. Volume kept for resume.                       |
| `destroy`        | `{}`                                                             | Terminal. Removes container; status → `destroyed`; releases workspace lease.                      |
| `convert-target` | `{ to: 'sandbox' \| 'host' \| 'sprites' }`                        | Move the workspace to a different target. Cross-provider transitions rejected.                    |
| `convert-kind`   | `{ kind: 'claude' \| 'codex' \| 'opencode'; model?: string }`     | Swap the CLI in place; events history is preserved (see [API → Convert and Fork](./api#convert-and-fork)). |

Two internal types are sent self-to-self by the runtime:

- `lifecycle/idle-eviction-fired` — re-enters the handler after the idle timer fires.
- `lifecycle/init` — re-runs first-wake init after a CLI-driven import.

## Idle eviction & keepWarm

After a run completes, an idle timer arms (default 300 s). When it fires, the sandbox container is destroyed and status flips to `cold`. The workspace volume and the entity's durable stream survive — only the in-memory process and the container's tmpfs are discarded.

- **Pin refcount.** `pin` increments a per-agent counter; idle eviction is suppressed while > 0. The first `release` (count → 0) re-arms the timer.
- **`keepWarm`.** Spawning with `keepWarm: true` bypasses idle eviction entirely. Equivalent to a permanent self-pin.

The handler cancels any pending idle timer at the top of `processPrompt` so a new prompt arriving while a timer is armed never collides with a half-fired destroy.

## Lifecycle event vocabulary (`coding-agent.lifecycle`)

```text
sandbox.starting     bootstrap.starting       pin
sandbox.started      bootstrap.complete       release
sandbox.stopped      bootstrap.failed         orphan.detected
sandbox.failed       resume.restored          target.changed
                     import.restored          kind.converted
                     import.failed            kind.convert_failed
                                              kind.forked
```

`bootstrap.*` is sprites-only (per-sprite first-cold-boot install).

## Reconcile on wake

Every wake re-checks the actual sandbox state against `sessionMeta` before dispatching the inbox. Stale `running` rows from a host crash become `failed: orphaned`; an `idle` agent whose container disappeared (e.g. evicted by an external `docker rm`) flips to `cold`. This is what makes `dev.mjs restart` safe — the next wake repairs the world.
