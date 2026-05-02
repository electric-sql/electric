import { promises as fs } from 'node:fs'
import { realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { findSessionPath, normalize } from 'agent-session-protocol'
import type { NormalizedEvent } from 'agent-session-protocol'
import { log } from '../log'
import { WorkspaceRegistry } from '../workspace-registry'
import type { LifecycleManager } from '../lifecycle-manager'
import type { CodingAgentKind, SandboxInstance } from '../types'
import { getAdapter } from '../agents/registry'
import type {
  RunRow,
  SessionMetaRow,
  EventRow,
  LifecycleRow,
  NativeJsonlRow,
} from './collections'
import { randomUUID } from 'node:crypto'
import {
  convertKindMessageSchema,
  convertTargetMessageSchema,
  promptMessageSchema,
} from './messages'
import { convertNativeJsonl } from './conversion'

export interface CodingAgentHandlerOptions {
  defaults: {
    idleTimeoutMs: number
    coldBootBudgetMs: number
    runTimeoutMs: number
  }
  /** Called per-turn (with the agent kind) to source CLI env. */
  env: (kind: CodingAgentKind) => Record<string, string>
  /**
   * Optional. Called by the idle timer after destroying the container,
   * to re-enter the handler so reconcile can flip status to 'cold'.
   * Bootstrap supplies this once the runtime is constructed.
   */
  wakeEntity?: (agentId: string) => void
  /**
   * Optional override for the home directory used to locate
   * ~/.claude/projects/<dir>/<sessionId>.jsonl on import.
   * Defaults to os.homedir() at use-site.
   */
  homeDir?: string
}

interface InboxRow {
  key: string
  payload?: unknown
  message_type?: string
}

const NS_MAX = String(Number.MAX_SAFE_INTEGER).length

function eventKey(runId: string, seq: number): string {
  return `${runId}:${String(seq).padStart(NS_MAX, `0`)}`
}

// Monotonic counter so back-to-back lifecycleKey calls within a single
// handler invocation don't collide on Date.now() + 3-digit random.
let lifecycleSeq = 0
function lifecycleKey(label: string): string {
  return `${label}:${Date.now()}-${(++lifecycleSeq).toString(36)}`
}

/**
 * Idempotently materialise the captured transcript blob into the sandbox
 * so `claude --resume <sessionId>` finds its session file. Probes for the
 * file first; only writes if missing. Self-heals across idle-timer races,
 * external container death, and future recover() rehydration.
 */
async function ensureTranscriptMaterialised(
  sandbox: SandboxInstance,
  kind: CodingAgentKind,
  nativeSessionId: string,
  content: string
): Promise<{ written: boolean }> {
  if (!content) return { written: false }
  const adapter = getAdapter(kind)
  const homeDir = sandbox.homeDir
  const cwd = sandbox.workspaceMount

  // Probe: does the transcript already exist?
  const probe = await sandbox.exec({
    cmd: [
      ...adapter.probeCommand({ homeDir, cwd, sessionId: nativeSessionId }),
    ],
  })
  void (async () => {
    for await (const _ of probe.stdout) {
      // discard
    }
  })()
  void (async () => {
    for await (const _ of probe.stderr) {
      // discard
    }
  })()
  const probeExit = await probe.wait()
  if (probeExit.exitCode === 0) return { written: false }

  const fullPath = adapter.materialiseTargetPath({
    homeDir,
    cwd,
    sessionId: nativeSessionId,
    content,
  })

  // Ensure parent directory exists, then write content via copyTo.
  const parent = fullPath.slice(0, fullPath.lastIndexOf(`/`))
  const mkdir = await sandbox.exec({
    cmd: [`mkdir`, `-p`, parent],
  })
  void (async () => {
    for await (const _ of mkdir.stdout) {
      // discard
    }
  })()
  let mkdirErr = ``
  const drainMkdirErr = async () => {
    for await (const line of mkdir.stderr) mkdirErr += line + `\n`
  }
  const mkdirErrPromise = drainMkdirErr()
  const mkdirExit = await mkdir.wait()
  await mkdirErrPromise
  if (mkdirExit.exitCode !== 0) {
    throw new Error(
      `mkdir for transcript failed: exit ${mkdirExit.exitCode}, stderr=${mkdirErr.slice(0, 200)}`
    )
  }

  await sandbox.copyTo({
    destPath: fullPath,
    content,
    mode: 0o600,
  })
  return { written: true }
}

/**
 * Read claude's on-disk transcript out of the sandbox so we can
 * persist it for resume. claude writes the canonical conversation
 * history to ~/.claude/projects/<dir>/<sessionId>.jsonl during the
 * turn; we capture it after the turn exits.
 *
 * Uses base64 to round-trip the file as a single bash variable so we
 * never block on stream draining (which has hung in practice on the
 * Slice A docker exec stdio path).
 */
async function captureTranscript(
  sandbox: SandboxInstance,
  kind: CodingAgentKind,
  nativeSessionId: string
): Promise<string> {
  const adapter = getAdapter(kind)
  const handle = await sandbox.exec({
    cmd: [
      ...adapter.captureCommand({
        homeDir: sandbox.homeDir,
        cwd: sandbox.workspaceMount,
        sessionId: nativeSessionId,
      }),
    ],
    cwd: sandbox.workspaceMount,
  })
  let b64 = ``
  const drain = async () => {
    for await (const line of handle.stdout) b64 += line
  }
  const drainErr = async () => {
    for await (const _ of handle.stderr) {
      // discard
    }
  }
  const exit = handle.wait()
  await Promise.all([drain(), drainErr(), exit])
  if (!b64) return ``
  return Buffer.from(b64, `base64`).toString(`utf8`)
}

function raceTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const handle = setTimeout(() => {
      const e = new Error(`TimeoutError`)
      ;(e as any).name = `TimeoutError`
      reject(e)
    }, ms)
    p.then(
      (v) => {
        clearTimeout(handle)
        resolve(v)
      },
      (err) => {
        clearTimeout(handle)
        reject(err)
      }
    )
  })
}

export function makeCodingAgentHandler(
  lm: LifecycleManager,
  wr: WorkspaceRegistry,
  options: CodingAgentHandlerOptions
) {
  return async function handleCodingAgentEntity(
    ctx: any,
    _wake: any
  ): Promise<void> {
    const agentId = ctx.entityUrl as string
    const sessionMetaCol = ctx.db.collections.sessionMeta
    const runsCol = ctx.db.collections.runs
    const inboxCol = ctx.db.collections.inbox

    // ─── 1) FIRST-WAKE INIT ────────────────────────────────────────────────

    const initialMeta = sessionMetaCol.get(`current`) as
      | SessionMetaRow
      | undefined
    let meta: SessionMetaRow
    if (!initialMeta) {
      const args = ctx.args as {
        kind?: CodingAgentKind
        target?: `sandbox` | `host`
        workspaceType?: `volume` | `bindMount`
        workspaceName?: string
        workspaceHostPath?: string
        importNativeSessionId?: string
        idleTimeoutMs?: number
        keepWarm?: boolean
        fromAgentId?: string
        fromWorkspaceMode?: `share` | `clone` | `fresh`
      }
      const target = args.target ?? `sandbox`
      const ws =
        args.workspaceType === `bindMount`
          ? {
              type: `bindMount` as const,
              hostPath: args.workspaceHostPath ?? process.cwd(),
            }
          : { type: `volume` as const, name: args.workspaceName }

      if (args.importNativeSessionId && target !== `host`) {
        const initial: SessionMetaRow = {
          key: `current`,
          status: `error`,
          kind: args.kind ?? `claude`,
          target,
          pinned: false,
          workspaceIdentity: `error:import-requires-host`,
          workspaceSpec: { type: `volume`, name: `none` },
          idleTimeoutMs: options.defaults.idleTimeoutMs,
          keepWarm: false,
          lastError: `importNativeSessionId requires target='host'`,
        }
        ctx.db.actions.sessionMeta_insert({ row: initial })
        return
      }

      if (target === `host` && ws.type !== `bindMount`) {
        const initial: SessionMetaRow = {
          key: `current`,
          status: `error`,
          kind: args.kind ?? `claude`,
          target,
          pinned: false,
          workspaceIdentity: `error:host-requires-bindMount`,
          workspaceSpec: { type: `volume`, name: `none` },
          idleTimeoutMs: options.defaults.idleTimeoutMs,
          keepWarm: false,
          lastError: `target='host' requires workspaceType='bindMount'`,
        }
        ctx.db.actions.sessionMeta_insert({ row: initial })
        return
      }

      const resolved = await WorkspaceRegistry.resolveIdentity(agentId, ws)
      const idleTimeoutMs = args.idleTimeoutMs ?? options.defaults.idleTimeoutMs
      const keepWarm = args.keepWarm ?? false
      const initial: SessionMetaRow = {
        key: `current`,
        status: `cold`,
        kind: args.kind ?? `claude`,
        target,
        pinned: false,
        workspaceIdentity: resolved.identity,
        workspaceSpec: resolved.resolved,
        idleTimeoutMs,
        keepWarm,
      }
      ctx.db.actions.sessionMeta_insert({ row: initial })
      wr.register(resolved.identity, agentId)
      meta = initial

      if (args.importNativeSessionId && target === `host`) {
        const importedKind: CodingAgentKind = args.kind ?? `claude`
        const home = options.homeDir ?? os.homedir()
        // Resolve the on-host source JSONL path. Claude uses a
        // deterministic <home>/.claude/projects/<sanitised-cwd>/<id>.jsonl
        // layout; codex's path embeds a wall-clock timestamp so we
        // delegate to agent-session-protocol's findSessionPath which
        // scans ~/.codex/sessions for *-<id>.jsonl. asp uses os.homedir()
        // internally; if a test overrides options.homeDir, claude path
        // honors it but codex falls through to asp's view of HOME.
        let sessionPath: string | null
        if (importedKind === `codex`) {
          sessionPath = await findSessionPath(
            `codex`,
            args.importNativeSessionId
          )
        } else {
          const realWorkspace = await realpath(
            args.workspaceHostPath ?? process.cwd()
          )
          const projectDir = realWorkspace.replace(/\//g, `-`)
          sessionPath = path.join(
            home,
            `.claude`,
            `projects`,
            projectDir,
            `${args.importNativeSessionId}.jsonl`
          )
        }
        try {
          if (!sessionPath) {
            throw Object.assign(new Error(`codex session not found by id`), {
              code: `ENOENT`,
            })
          }
          const content = await fs.readFile(sessionPath, `utf8`)
          ctx.db.actions.nativeJsonl_insert({
            row: {
              key: `current`,
              nativeSessionId: args.importNativeSessionId,
              content,
            } satisfies NativeJsonlRow,
          })
          ctx.db.actions.sessionMeta_update({
            key: `current`,
            updater: (d: SessionMetaRow) => {
              d.nativeSessionId = args.importNativeSessionId
            },
          })
          ctx.db.actions.lifecycle_insert({
            row: {
              key: lifecycleKey(`import`),
              ts: Date.now(),
              event: `import.restored`,
              detail: `bytes=${content.length}`,
            } satisfies LifecycleRow,
          })

          // Backfill events from the imported transcript so the UI
          // timeline renders the prior conversation history. Without
          // this, the entity's events collection only contains turns
          // that happen after import, and the imported transcript is
          // invisible to the UI (it only feeds claude --resume on
          // disk). All events go under a single synthetic 'imported'
          // run; the timeline renders user/assistant/tool rows in seq
          // order regardless of run grouping.
          try {
            const lines = content
              .split(`\n`)
              .filter((l: string) => l.trim().length > 0)
            const importedEvents = normalize(lines, importedKind)
            if (importedEvents.length > 0) {
              const importedRunId = `imported`
              const earliestTs = importedEvents[0]!.ts
              const latestTs = importedEvents[importedEvents.length - 1]!.ts
              const lastAssistantText = (() => {
                for (let i = importedEvents.length - 1; i >= 0; i--) {
                  const e = importedEvents[i]!
                  if (e.type === `assistant_message` && `text` in e) {
                    return (e as { text?: string }).text
                  }
                }
                return undefined
              })()
              ctx.db.actions.runs_insert({
                row: {
                  key: importedRunId,
                  startedAt: earliestTs,
                  endedAt: latestTs,
                  status: `completed`,
                  promptInboxKey: `imported`,
                  responseText: lastAssistantText,
                  finishReason: `imported`,
                } satisfies RunRow,
              })
              importedEvents.forEach((e: NormalizedEvent, idx: number) => {
                ctx.db.actions.events_insert({
                  row: {
                    key: eventKey(importedRunId, idx),
                    runId: importedRunId,
                    seq: idx,
                    ts: e.ts,
                    type: e.type,
                    payload: e as unknown as Record<string, unknown>,
                  } satisfies EventRow,
                })
              })
              ctx.db.actions.lifecycle_insert({
                row: {
                  key: lifecycleKey(`import`),
                  ts: Date.now(),
                  event: `import.restored`,
                  detail: `events=${importedEvents.length}`,
                } satisfies LifecycleRow,
              })
            }
          } catch (err) {
            // Non-fatal: the resume path still works via nativeJsonl;
            // the timeline just won't show prior history.
            log.warn(
              { err, agentId, sessionId: args.importNativeSessionId },
              `import events backfill failed (resume still works)`
            )
          }
          meta = sessionMetaCol.get(`current`) as SessionMetaRow
        } catch (err) {
          const msg =
            err instanceof Error && (err as any).code === `ENOENT`
              ? `imported session file not found at ${sessionPath}`
              : `imported session read failed: ${err instanceof Error ? err.message : String(err)}`
          ctx.db.actions.sessionMeta_update({
            key: `current`,
            updater: (d: SessionMetaRow) => {
              d.status = `error`
              d.lastError = msg
            },
          })
          ctx.db.actions.lifecycle_insert({
            row: {
              key: lifecycleKey(`import`),
              ts: Date.now(),
              event: `import.failed`,
              detail: msg,
            } satisfies LifecycleRow,
          })
          return
        }
      }

      if (args.fromAgentId) {
        try {
          const sourceHandle = await (ctx as any).observe({
            sourceType: `entity`,
            sourceRef: args.fromAgentId,
          })
          const sourceEventsCol = sourceHandle?.db?.collections?.events
          if (!sourceEventsCol) {
            throw new Error(
              `fork: source agent ${args.fromAgentId} has no events collection`
            )
          }
          const sourceEventRows = (sourceEventsCol.toArray as Array<EventRow>)
            .slice()
            .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
          const sourceEvents = sourceEventRows.map(
            (r) => r.payload as unknown as NormalizedEvent
          )

          // Resolve effective workspace mode and (optionally) clone.
          const sourceMetaCol = sourceHandle?.db?.collections?.sessionMeta
          const sourceMeta = sourceMetaCol?.get?.(`current`) as
            | SessionMetaRow
            | undefined
          const sourceWsType = sourceMeta?.workspaceSpec?.type ?? `volume`
          const requested = args.fromWorkspaceMode
          const effectiveMode: `share` | `clone` | `fresh` =
            requested ?? (sourceWsType === `bindMount` ? `share` : `clone`)

          if (effectiveMode === `clone`) {
            // The handler doesn't have direct provider access; LifecycleManager does.
            // Acquire it via lm and check capability before proceeding.
            const provider = lm.providerFor(meta.target)
            if (!provider.cloneWorkspace) {
              throw new Error(
                `fork: workspaceMode=clone requires provider.cloneWorkspace; provider '${provider.name}' does not implement it`
              )
            }
            if (
              sourceMeta?.workspaceSpec?.type === `volume` &&
              ws.type === `volume` &&
              sourceMeta.workspaceSpec.name &&
              ws.name
            ) {
              await provider.cloneWorkspace({
                source: sourceMeta.workspaceSpec,
                target: { type: `volume`, name: ws.name },
              })
            }
          }
          // 'share' and 'fresh' need no action here — share inherits via the
          // existing workspace identity passed at spawn; fresh is a normal spawn.

          const newSessionId = randomUUID()
          const cwd = ws.type === `bindMount` ? ws.hostPath : `/work`
          const result = convertNativeJsonl(
            sourceEvents,
            args.kind ?? `claude`,
            {
              sessionId: newSessionId,
              cwd,
            }
          )

          ctx.db.actions.nativeJsonl_insert({
            row: {
              key: `current`,
              nativeSessionId: result.sessionId,
              content: result.content,
            } satisfies NativeJsonlRow,
          })
          ctx.db.actions.sessionMeta_update({
            key: `current`,
            updater: (d: SessionMetaRow) => {
              d.nativeSessionId = result.sessionId
            },
          })
          ctx.db.actions.lifecycle_insert({
            row: {
              key: lifecycleKey(`fork`),
              ts: Date.now(),
              event: `kind.forked`,
              detail: `source=${args.fromAgentId};mode=${effectiveMode};events=${sourceEvents.length}`,
            } satisfies LifecycleRow,
          })
          meta = sessionMetaCol.get(`current`) as SessionMetaRow
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          log.warn({ err, agentId, sourceId: args.fromAgentId }, `fork failed`)
          ctx.db.actions.sessionMeta_update({
            key: `current`,
            updater: (d: SessionMetaRow) => {
              d.status = `error`
              d.lastError = `fork failed: ${msg}`
            },
          })
          return
        }
      }
    } else {
      meta = initialMeta
    }

    if (meta.status === `destroyed`) {
      // Tombstoned. Ignore everything.
      return
    }

    // ─── 2) RECONCILE ──────────────────────────────────────────────────────

    const providerStatus = await lm.statusFor(agentId, meta.target)
    const openRun = (runsCol.toArray as Array<RunRow>).find(
      (r) => r.status === `running`
    )
    const isOrphaned = openRun && openRun.startedAt < lm.startedAtMs

    if (meta.status === `running` && providerStatus !== `running`) {
      if (openRun) {
        ctx.db.actions.runs_update({
          key: openRun.key,
          updater: (d: RunRow) => {
            d.status = `failed`
            d.finishReason = `orphaned`
            d.endedAt = Date.now()
          },
        })
      }
      ctx.db.actions.lifecycle_insert({
        row: {
          key: lifecycleKey(`orphan`),
          ts: Date.now(),
          event: `orphan.detected`,
        } satisfies LifecycleRow,
      })
      ctx.db.actions.sessionMeta_update({
        key: `current`,
        updater: (d: SessionMetaRow) => {
          d.status = `cold`
          d.instanceId = undefined
        },
      })
      meta = sessionMetaCol.get(`current`) as SessionMetaRow
    } else if (
      meta.status === `running` &&
      providerStatus === `running` &&
      isOrphaned
    ) {
      ctx.db.actions.runs_update({
        key: openRun!.key,
        updater: (d: RunRow) => {
          d.status = `failed`
          d.finishReason = `orphaned`
          d.endedAt = Date.now()
        },
      })
      ctx.db.actions.lifecycle_insert({
        row: {
          key: lifecycleKey(`orphan`),
          ts: Date.now(),
          event: `orphan.detected`,
        } satisfies LifecycleRow,
      })
      ctx.db.actions.sessionMeta_update({
        key: `current`,
        updater: (d: SessionMetaRow) => {
          d.status = `idle`
        },
      })
      meta = sessionMetaCol.get(`current`) as SessionMetaRow
    } else if (meta.status === `idle` && providerStatus !== `running`) {
      ctx.db.actions.sessionMeta_update({
        key: `current`,
        updater: (d: SessionMetaRow) => {
          d.status = `cold`
          d.instanceId = undefined
        },
      })
      meta = sessionMetaCol.get(`current`) as SessionMetaRow
    } else if (
      (meta.status === `starting` || meta.status === `stopping`) &&
      providerStatus !== `running`
    ) {
      ctx.db.actions.sessionMeta_update({
        key: `current`,
        updater: (d: SessionMetaRow) => {
          d.status = `cold`
        },
      })
      meta = sessionMetaCol.get(`current`) as SessionMetaRow
    } else if (
      (meta.status === `starting` || meta.status === `stopping`) &&
      providerStatus === `running`
    ) {
      ctx.db.actions.sessionMeta_update({
        key: `current`,
        updater: (d: SessionMetaRow) => {
          d.status = `idle`
        },
      })
      meta = sessionMetaCol.get(`current`) as SessionMetaRow
    }

    // ─── 3) PROCESS PENDING INBOX ──────────────────────────────────────────

    const inboxRows = (inboxCol.toArray as Array<InboxRow>)
      .slice()
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    const lastKey = meta.lastInboxKey ?? ``
    const pending = inboxRows.filter((m) => m.key > lastKey)

    for (const inboxMsg of pending) {
      try {
        await dispatchInboxMessage(ctx, lm, wr, options, inboxMsg)
      } catch (err) {
        log.error({ err, inboxMsg }, `coding-agent handler dispatch threw`)
        ctx.db.actions.sessionMeta_update({
          key: `current`,
          updater: (d: SessionMetaRow) => {
            d.status = `error`
            d.lastError = err instanceof Error ? err.message : String(err)
          },
        })
      }
      ctx.db.actions.sessionMeta_update({
        key: `current`,
        updater: (d: SessionMetaRow) => {
          d.lastInboxKey = inboxMsg.key
        },
      })
      meta = sessionMetaCol.get(`current`) as SessionMetaRow
      if (meta.status === `destroyed`) return
    }
  }
}

async function dispatchInboxMessage(
  ctx: any,
  lm: LifecycleManager,
  wr: WorkspaceRegistry,
  options: CodingAgentHandlerOptions,
  inboxMsg: InboxRow
): Promise<void> {
  const type = inboxMsg.message_type ?? `prompt`
  switch (type) {
    case `prompt`:
      return processPrompt(ctx, lm, wr, options, inboxMsg)
    case `pin`:
      return processPin(ctx, lm)
    case `release`:
      return processRelease(ctx, lm, options)
    case `stop`:
      return processStop(ctx, lm)
    case `destroy`:
      return processDestroy(ctx, lm, wr)
    case `lifecycle/idle-eviction-fired`:
      // No-op: reconcile at the top of the handler already saw
      // 'idle && !running' and flipped status to 'cold'. This message
      // exists only to re-enter the handler after the timer fired.
      return
    case `lifecycle/init`:
      // No-op nudge from the import CLI to give the runtime a "fresh
      // wake input" so first-wake init runs and applies spawn args.
      // First-wake init is keyed on `!sessionMeta`, so this dispatch
      // just returns; subsequent invocations also no-op.
      return
    case `convert-target`:
      return processConvertTarget(ctx, lm, options, inboxMsg)
    case `convert-kind`:
      return processConvertKind(ctx, inboxMsg)
    default:
      log.warn({ type }, `coding-agent: unknown inbox message type`)
  }
}

async function processPrompt(
  ctx: any,
  lm: LifecycleManager,
  wr: WorkspaceRegistry,
  options: CodingAgentHandlerOptions,
  inboxMsg: InboxRow
): Promise<void> {
  const parsed = promptMessageSchema.safeParse(inboxMsg.payload)
  if (!parsed.success) return
  const promptText = parsed.data.text
  const agentId = ctx.entityUrl as string
  const sessionMetaCol = ctx.db.collections.sessionMeta

  let meta = sessionMetaCol.get(`current`) as SessionMetaRow

  // Only emit sandbox.starting/sandbox.started lifecycle rows when we
  // actually cold-boot. lm.ensureRunning is idempotent (returns the
  // existing instance if already running); without this guard, every
  // warm prompt produces misleading "Sandbox starting" entries in the
  // UI timeline.
  const wasCold = meta.status === `cold`

  if (wasCold) {
    ctx.db.actions.sessionMeta_update({
      key: `current`,
      updater: (d: SessionMetaRow) => {
        d.status = `starting`
      },
    })
    ctx.db.actions.lifecycle_insert({
      row: {
        key: lifecycleKey(`boot`),
        ts: Date.now(),
        event: `sandbox.starting`,
      } satisfies LifecycleRow,
    })
  }

  let sandbox
  try {
    sandbox = await raceTimeout(
      lm.ensureRunning({
        agentId,
        kind: meta.kind,
        target: meta.target,
        workspace: meta.workspaceSpec,
        env: options.env(meta.kind),
      }),
      options.defaults.coldBootBudgetMs
    )
  } catch (err) {
    ctx.db.actions.sessionMeta_update({
      key: `current`,
      updater: (d: SessionMetaRow) => {
        d.status = `error`
        d.lastError = err instanceof Error ? err.message : String(err)
      },
    })
    ctx.db.actions.lifecycle_insert({
      row: {
        key: lifecycleKey(`boot`),
        ts: Date.now(),
        event: `sandbox.failed`,
        detail: err instanceof Error ? err.message : String(err),
      } satisfies LifecycleRow,
    })
    return
  }

  if (wasCold) {
    ctx.db.actions.sessionMeta_update({
      key: `current`,
      updater: (d: SessionMetaRow) => {
        d.status = `idle`
        d.instanceId = sandbox.instanceId
      },
    })
    ctx.db.actions.lifecycle_insert({
      row: {
        key: lifecycleKey(`boot`),
        ts: Date.now(),
        event: `sandbox.started`,
      } satisfies LifecycleRow,
    })
  } else if (!meta.instanceId) {
    // Warm path but instanceId wasn't recorded (defensive backfill).
    ctx.db.actions.sessionMeta_update({
      key: `current`,
      updater: (d: SessionMetaRow) => {
        d.instanceId = sandbox.instanceId
      },
    })
  }

  meta = sessionMetaCol.get(`current`) as SessionMetaRow

  if (meta.nativeSessionId) {
    const transcript = ctx.db.collections.nativeJsonl.get(`current`) as
      | NativeJsonlRow
      | undefined
    if (
      transcript &&
      transcript.nativeSessionId === meta.nativeSessionId &&
      transcript.content
    ) {
      const { written } = await ensureTranscriptMaterialised(
        sandbox,
        meta.kind,
        meta.nativeSessionId,
        transcript.content
      )
      if (written) {
        ctx.db.actions.lifecycle_insert({
          row: {
            key: lifecycleKey(`resume`),
            ts: Date.now(),
            event: `resume.restored`,
            detail: `bytes=${transcript.content.length}`,
          } satisfies LifecycleRow,
        })
      }
    }
  }

  const releaseLease = await wr.acquire(meta.workspaceIdentity)
  try {
    ctx.db.actions.sessionMeta_update({
      key: `current`,
      updater: (d: SessionMetaRow) => {
        d.status = `running`
        d.currentPromptInboxKey = inboxMsg.key
      },
    })

    const recordedRun = ctx.recordRun()
    const runId = recordedRun.key
    ctx.db.actions.runs_insert({
      row: {
        key: runId,
        startedAt: Date.now(),
        status: `running`,
        promptInboxKey: inboxMsg.key,
      } satisfies RunRow,
    })

    let seq = 0
    let finalText: string | undefined
    try {
      const result = await raceTimeout(
        lm.bridge.runTurn({
          sandbox,
          kind: meta.kind,
          prompt: promptText,
          nativeSessionId: meta.nativeSessionId,
          onEvent: (e: NormalizedEvent) => {
            ctx.db.actions.events_insert({
              row: {
                key: eventKey(runId, seq),
                runId,
                seq,
                ts: Date.now(),
                type: e.type,
                payload: e as unknown as Record<string, unknown>,
              } satisfies EventRow,
            })
            seq++
          },
        }),
        options.defaults.runTimeoutMs
      )
      finalText = result.finalText

      const finalNativeSessionId =
        result.nativeSessionId ?? meta.nativeSessionId
      if (result.nativeSessionId && !meta.nativeSessionId) {
        ctx.db.actions.sessionMeta_update({
          key: `current`,
          updater: (d: SessionMetaRow) => {
            d.nativeSessionId = result.nativeSessionId
          },
        })
      }

      // Capture the on-disk transcript so a future cold-boot can resume.
      if (finalNativeSessionId) {
        try {
          const content = await captureTranscript(
            sandbox,
            meta.kind,
            finalNativeSessionId
          )
          if (content) {
            ctx.db.actions.nativeJsonl_insert({
              row: {
                key: `current`,
                nativeSessionId: finalNativeSessionId,
                content,
              } satisfies NativeJsonlRow,
            })
          }
        } catch (err) {
          log.warn(
            { err, agentId, finalNativeSessionId },
            `transcript capture failed`
          )
        }
      }

      ctx.db.actions.runs_update({
        key: runId,
        updater: (d: RunRow) => {
          d.status = `completed`
          d.endedAt = Date.now()
          d.responseText = finalText
        },
      })
      if (finalText) recordedRun.attachResponse(finalText)
      recordedRun.end({ status: `completed` })
    } catch (err) {
      const reason =
        err instanceof Error && err.name === `TimeoutError`
          ? `timeout`
          : `cli-exit:${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`
      ctx.db.actions.runs_update({
        key: runId,
        updater: (d: RunRow) => {
          d.status = `failed`
          d.endedAt = Date.now()
          d.finishReason = reason
        },
      })
      ctx.db.actions.sessionMeta_update({
        key: `current`,
        updater: (d: SessionMetaRow) => {
          d.status = `error`
          d.lastError = err instanceof Error ? err.message : String(err)
        },
      })
      recordedRun.end({ status: `failed` })
      return
    }

    ctx.db.actions.sessionMeta_update({
      key: `current`,
      updater: (d: SessionMetaRow) => {
        d.status = `idle`
        d.currentPromptInboxKey = undefined
      },
    })

    const finalMeta = sessionMetaCol.get(`current`) as SessionMetaRow
    if (!finalMeta.keepWarm && lm.pinCount(agentId) === 0) {
      const target = finalMeta.target
      lm.armIdleTimer(agentId, finalMeta.idleTimeoutMs, () => {
        // Fire-and-forget: destroyFor is keyed by agentId + target.
        // After destroy, wake the entity so reconcile flips status idle→cold
        // and any parent observing via wake:'runFinished' is notified.
        void lm
          .destroyFor(agentId, target)
          .catch((err) =>
            log.warn({ err, agentId, target }, `idle stop failed`)
          )
          .finally(() => options.wakeEntity?.(agentId))
      })
    }
  } finally {
    releaseLease()
  }
}

function processPin(ctx: any, lm: LifecycleManager): void {
  const agentId = ctx.entityUrl as string
  const { count } = lm.pin(agentId)
  ctx.db.actions.sessionMeta_update({
    key: `current`,
    updater: (d: SessionMetaRow) => {
      d.pinned = true
    },
  })
  ctx.db.actions.lifecycle_insert({
    row: {
      key: lifecycleKey(`pin`),
      ts: Date.now(),
      event: `pin`,
      detail: `count=${count}`,
    } satisfies LifecycleRow,
  })
}

function processRelease(
  ctx: any,
  lm: LifecycleManager,
  options: CodingAgentHandlerOptions
): void {
  const agentId = ctx.entityUrl as string
  const { count } = lm.release(agentId)
  ctx.db.actions.sessionMeta_update({
    key: `current`,
    updater: (d: SessionMetaRow) => {
      d.pinned = count > 0
    },
  })
  ctx.db.actions.lifecycle_insert({
    row: {
      key: lifecycleKey(`release`),
      ts: Date.now(),
      event: `release`,
      detail: `count=${count}`,
    } satisfies LifecycleRow,
  })
  if (count === 0) {
    const meta = ctx.db.collections.sessionMeta.get(`current`) as SessionMetaRow
    if (!meta.keepWarm && meta.status === `idle`) {
      const target = meta.target
      lm.armIdleTimer(agentId, meta.idleTimeoutMs, () => {
        void lm
          .destroyFor(agentId, target)
          .catch(() => undefined)
          .finally(() => options.wakeEntity?.(agentId))
      })
    }
  }
}

async function processStop(ctx: any, lm: LifecycleManager): Promise<void> {
  const agentId = ctx.entityUrl as string
  const meta = ctx.db.collections.sessionMeta.get(`current`) as SessionMetaRow
  ctx.db.actions.sessionMeta_update({
    key: `current`,
    updater: (d: SessionMetaRow) => {
      d.status = `stopping`
    },
  })
  await lm.destroyFor(agentId, meta.target)
  ctx.db.actions.sessionMeta_update({
    key: `current`,
    updater: (d: SessionMetaRow) => {
      d.status = `cold`
      d.instanceId = undefined
    },
  })
  ctx.db.actions.lifecycle_insert({
    row: {
      key: lifecycleKey(`stop`),
      ts: Date.now(),
      event: `sandbox.stopped`,
    } satisfies LifecycleRow,
  })
}

async function processDestroy(
  ctx: any,
  lm: LifecycleManager,
  wr: WorkspaceRegistry
): Promise<void> {
  const agentId = ctx.entityUrl as string
  const meta = ctx.db.collections.sessionMeta.get(`current`) as SessionMetaRow
  await lm.destroyAndForget(agentId, meta.target)
  if (meta) wr.release(meta.workspaceIdentity, agentId)
  ctx.db.actions.sessionMeta_update({
    key: `current`,
    updater: (d: SessionMetaRow) => {
      d.status = `destroyed`
      d.instanceId = undefined
    },
  })
  ctx.db.actions.lifecycle_insert({
    row: {
      key: lifecycleKey(`destroy`),
      ts: Date.now(),
      event: `sandbox.stopped`,
      detail: `destroyed`,
    } satisfies LifecycleRow,
  })
}

async function processConvertTarget(
  ctx: any,
  lm: LifecycleManager,
  _options: CodingAgentHandlerOptions,
  inboxMsg: InboxRow
): Promise<void> {
  const parsed = convertTargetMessageSchema.safeParse(inboxMsg.payload)
  if (!parsed.success) return
  const to = parsed.data.to
  const agentId = ctx.entityUrl as string
  const meta = ctx.db.collections.sessionMeta.get(`current`) as SessionMetaRow

  // No-op if already on the requested target
  if (meta.target === to) return

  // Validation: host requires bindMount
  if (to === `host` && meta.workspaceSpec.type !== `bindMount`) {
    ctx.db.actions.sessionMeta_update({
      key: `current`,
      updater: (d: SessionMetaRow) => {
        d.lastError = `convert to host requires a bindMount workspace`
      },
    })
    ctx.db.actions.lifecycle_insert({
      row: {
        key: lifecycleKey(`target`),
        ts: Date.now(),
        event: `target.changed`,
        detail: `failed: host requires bindMount`,
      } satisfies LifecycleRow,
    })
    return
  }

  // Reject in-flight transitions
  if (
    meta.status === `running` ||
    meta.status === `starting` ||
    meta.status === `stopping`
  ) {
    ctx.db.actions.sessionMeta_update({
      key: `current`,
      updater: (d: SessionMetaRow) => {
        d.lastError = `cannot convert target while status=${meta.status}`
      },
    })
    ctx.db.actions.lifecycle_insert({
      row: {
        key: lifecycleKey(`target`),
        ts: Date.now(),
        event: `target.changed`,
        detail: `failed: in-flight (status=${meta.status})`,
      } satisfies LifecycleRow,
    })
    return
  }

  const from = meta.target

  // Tear down old provider's record (best-effort).
  await lm.destroyFor(agentId, from).catch(() => undefined)

  ctx.db.actions.sessionMeta_update({
    key: `current`,
    updater: (d: SessionMetaRow) => {
      d.target = to
      d.status = `cold`
      d.instanceId = undefined
      d.lastError = undefined
    },
  })
  ctx.db.actions.lifecycle_insert({
    row: {
      key: lifecycleKey(`target`),
      ts: Date.now(),
      event: `target.changed`,
      detail: `from=${from};to=${to}`,
    } satisfies LifecycleRow,
  })
}

async function processConvertKind(ctx: any, inboxMsg: InboxRow): Promise<void> {
  const parsed = convertKindMessageSchema.safeParse(inboxMsg.payload)
  if (!parsed.success) return
  const { kind: newKind, model } = parsed.data
  const meta = ctx.db.collections.sessionMeta.get(`current`) as SessionMetaRow
  const oldKind = meta.kind

  // Read all events for this agent.
  const eventRows = (ctx.db.collections.events.toArray as Array<EventRow>)
    .slice()
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const events: Array<NormalizedEvent> = eventRows.map(
    (r) => r.payload as unknown as NormalizedEvent
  )

  const newSessionId = randomUUID()
  const cwd =
    meta.workspaceSpec.type === `bindMount`
      ? meta.workspaceSpec.hostPath
      : `/work`

  let result
  try {
    result = convertNativeJsonl(events, newKind, {
      sessionId: newSessionId,
      cwd,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    ctx.db.actions.lifecycle_insert({
      row: {
        key: lifecycleKey(`convert`),
        ts: Date.now(),
        event: `kind.convert_failed`,
        detail: msg,
      } satisfies LifecycleRow,
    })
    log.warn({ err, oldKind, newKind }, `convertKind: denormalize threw`)
    return
  }

  // Atomic-ish: replace nativeJsonl, update meta, insert lifecycle row.
  ctx.db.actions.nativeJsonl_insert({
    row: {
      key: `current`,
      nativeSessionId: result.sessionId,
      content: result.content,
    } satisfies NativeJsonlRow,
  })
  ctx.db.actions.sessionMeta_update({
    key: `current`,
    updater: (d: SessionMetaRow) => {
      d.kind = newKind
      d.nativeSessionId = result.sessionId
      d.lastError = undefined
    },
  })
  const detailParts = [`from=${oldKind}`, `to=${newKind}`]
  if (model) detailParts.push(`model=${model}`)
  ctx.db.actions.lifecycle_insert({
    row: {
      key: lifecycleKey(`convert`),
      ts: Date.now(),
      event: `kind.converted`,
      detail: detailParts.join(`;`),
    } satisfies LifecycleRow,
  })
}
