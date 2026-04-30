import type { NormalizedEvent } from 'agent-session-protocol'
import { log } from '../log'
import { WorkspaceRegistry } from '../workspace-registry'
import type { LifecycleManager } from '../lifecycle-manager'
import type {
  RunRow,
  SessionMetaRow,
  EventRow,
  LifecycleRow,
} from './collections'
import { promptMessageSchema } from './messages'

export interface CodingAgentHandlerOptions {
  defaults: {
    idleTimeoutMs: number
    coldBootBudgetMs: number
    runTimeoutMs: number
  }
  /** Called per-turn to source CLI env (e.g. ANTHROPIC_API_KEY). */
  env: () => Record<string, string>
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

function lifecycleKey(label: string): string {
  return `${label}:${Date.now()}-${Math.floor(Math.random() * 1000)}`
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
        kind?: `claude`
        workspace?: any
        lifecycle?: { idleTimeoutMs?: number; keepWarm?: boolean }
      }
      const ws = args.workspace ?? { type: `volume` }
      const resolved = await WorkspaceRegistry.resolveIdentity(agentId, ws)
      const idleTimeoutMs =
        args.lifecycle?.idleTimeoutMs ?? options.defaults.idleTimeoutMs
      const keepWarm = args.lifecycle?.keepWarm ?? false
      const initial: SessionMetaRow = {
        key: `current`,
        status: `cold`,
        kind: args.kind ?? `claude`,
        pinned: false,
        workspaceIdentity: resolved.identity,
        workspaceSpec: resolved.resolved,
        idleTimeoutMs,
        keepWarm,
      }
      ctx.db.actions.sessionMeta_insert({ row: initial })
      wr.register(resolved.identity, agentId)
      meta = initial
    } else {
      meta = initialMeta
    }

    if (meta.status === `destroyed`) {
      // Tombstoned. Ignore everything.
      return
    }

    // ─── 2) RECONCILE ──────────────────────────────────────────────────────

    const providerStatus = await lm.provider.status(agentId)
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
    } else if (meta.status === `idle` && providerStatus === `stopped`) {
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
      return processRelease(ctx, lm)
    case `stop`:
      return processStop(ctx, lm)
    case `destroy`:
      return processDestroy(ctx, lm, wr)
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

  // Cold-boot: ensure sandbox up
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

  let sandbox
  try {
    sandbox = await raceTimeout(
      lm.ensureRunning({
        agentId,
        kind: meta.kind,
        workspace: meta.workspaceSpec,
        env: options.env(),
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

  meta = sessionMetaCol.get(`current`) as SessionMetaRow
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
      lm.armIdleTimer(agentId, finalMeta.idleTimeoutMs, () => {
        // Fire-and-forget: provider.destroy is keyed by agentId.
        void lm.provider.destroy(agentId).catch((err) => {
          log.warn({ err, agentId }, `idle stop failed`)
        })
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

function processRelease(ctx: any, lm: LifecycleManager): void {
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
      lm.armIdleTimer(agentId, meta.idleTimeoutMs, () => {
        void lm.provider.destroy(agentId).catch(() => undefined)
      })
    }
  }
}

async function processStop(ctx: any, lm: LifecycleManager): Promise<void> {
  const agentId = ctx.entityUrl as string
  ctx.db.actions.sessionMeta_update({
    key: `current`,
    updater: (d: SessionMetaRow) => {
      d.status = `stopping`
    },
  })
  await lm.stop(agentId)
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
  await lm.destroy(agentId)
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
