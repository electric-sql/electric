import { spawn } from 'node:child_process'
import { watch, promises as fsp } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import {
  deserializeCursor,
  discoverSessions,
  importLocalSession,
  loadSession,
  resolveSession,
  serializeCursor,
  tailSession,
} from 'agent-session-protocol'
import type {
  NormalizedEvent,
  SerializedSessionCursor,
  SessionCursor,
} from 'agent-session-protocol'
import type {
  CodingAgentType,
  CodingSessionEventRow,
  EntityRegistry,
  HandlerContext,
  WakeEvent,
} from '@electric-ax/agents-runtime'

/**
 * Abstraction over the claude/codex CLI. Default implementation spawns
 * the real binary; tests can inject a fake.
 *
 * `sessionId` is undefined for the first prompt on a fresh session —
 * the runner should then let the CLI generate its own id. For every
 * subsequent prompt, pass the id so the CLI resumes that conversation.
 */
export interface CodingSessionCliRunner {
  run(opts: {
    agent: CodingAgentType
    sessionId?: string
    cwd: string
    prompt: string
  }): Promise<{ exitCode: number; stdout: string; stderr: string }>
}

const defaultCliRunner: CodingSessionCliRunner = {
  async run(opts) {
    return new Promise((resolve, reject) => {
      // Claude Code: prompt goes in on stdin (not argv). Needs
      // --dangerously-skip-permissions because the session runs
      // autonomously — any tool call would otherwise block on an
      // interactive approval prompt and exit 1.
      // Codex: prompt is an argv; stdin is ignored.
      const isClaude = opts.agent === `claude`
      const bin = isClaude ? `claude` : `codex`
      const args = isClaude
        ? opts.sessionId
          ? [`-r`, opts.sessionId, `--dangerously-skip-permissions`, `-p`]
          : [`--dangerously-skip-permissions`, `-p`]
        : opts.sessionId
          ? [`exec`, `resume`, opts.sessionId, opts.prompt]
          : [`exec`, opts.prompt]
      const child = spawn(bin, args, {
        cwd: opts.cwd,
        stdio: [isClaude ? `pipe` : `ignore`, `pipe`, `pipe`],
      })
      let stdout = ``
      let stderr = ``
      child.stdout?.on(`data`, (d: Buffer) => {
        stdout += d.toString()
      })
      child.stderr?.on(`data`, (d: Buffer) => {
        stderr += d.toString()
      })
      child.on(`error`, reject)
      child.on(`exit`, (code) => {
        resolve({ exitCode: code ?? -1, stdout, stderr })
      })
      if (isClaude && child.stdin) {
        child.stdin.write(opts.prompt)
        child.stdin.end()
      }
    })
  },
}

async function discoverNewestSession(
  agent: CodingAgentType,
  cwd: string,
  excludeIds: ReadonlySet<string>
): Promise<string | null> {
  const all = await discoverSessions(agent)
  const candidates = all.filter(
    (s) => !excludeIds.has(s.sessionId) && (!s.cwd || s.cwd === cwd)
  )
  if (candidates.length === 0) return null
  // discoverSessions returns most-recent-first for each agent, so
  // the first match is what the CLI just wrote.
  return candidates[0]!.sessionId
}

/**
 * Compute the candidate directories where Claude Code stores per-cwd
 * session JSONL files. Claude resolves the cwd to its realpath when
 * choosing the directory name (so /tmp/foo on macOS lands under
 * `-private-tmp-foo`), but the entity may have been spawned with the
 * non-realpath form. Return both candidates so the caller can union
 * their contents.
 */
async function getClaudeProjectDirs(cwd: string): Promise<Array<string>> {
  const home = homedir()
  const make = (c: string): string =>
    path.join(home, `.claude`, `projects`, c.replace(/\//g, `-`))
  const dirs = [make(cwd)]
  try {
    const real = await fsp.realpath(cwd)
    if (real !== cwd) dirs.push(make(real))
  } catch {
    // cwd may not exist on disk yet — skip realpath
  }
  return dirs
}

async function listClaudeJsonlIdsByCwd(cwd: string): Promise<Set<string>> {
  const ids = new Set<string>()
  for (const dir of await getClaudeProjectDirs(cwd)) {
    try {
      const files = await fsp.readdir(dir)
      for (const f of files) {
        if (f.endsWith(`.jsonl`)) ids.add(f.slice(0, -`.jsonl`.length))
      }
    } catch {
      // dir may not exist (no prior runs in this cwd)
    }
  }
  return ids
}

/**
 * Deterministic-path discovery for a freshly created session. After the
 * Claude CLI runs in `-p` mode it writes the new JSONL straight into
 * `~/.claude/projects/<sanitize(cwd)>/<id>.jsonl` *without* leaving a
 * `~/.claude/sessions/<pid>.json` lock file (those are interactive-only),
 * so `discoverSessions` can miss it. Compute the expected dir directly
 * and diff its contents against a pre-run snapshot. Returns the newest
 * fresh sessionId or null. Codex falls back to discoverNewestSession.
 */
async function findNewSessionAfterRun(
  agent: CodingAgentType,
  cwd: string,
  preDirectIds: ReadonlySet<string>,
  preDiscoveredIds: ReadonlySet<string>
): Promise<string | null> {
  if (agent === `claude`) {
    const dirs = await getClaudeProjectDirs(cwd)
    let best: { id: string; mtime: number } | null = null
    for (const dir of dirs) {
      try {
        const files = await fsp.readdir(dir)
        for (const f of files) {
          if (!f.endsWith(`.jsonl`)) continue
          const id = f.slice(0, -`.jsonl`.length)
          if (preDirectIds.has(id)) continue
          const st = await fsp.stat(path.join(dir, f)).catch(() => null)
          if (!st) continue
          if (!best || st.mtimeMs > best.mtime) {
            best = { id, mtime: st.mtimeMs }
          }
        }
      } catch {
        // dir may not exist
      }
    }
    if (best) return best.id
  }
  return discoverNewestSession(agent, cwd, preDiscoveredIds)
}

const sessionMetaRowSchema = z.object({
  key: z.literal(`current`),
  electricSessionId: z.string(),
  nativeSessionId: z.string().optional(),
  agent: z.enum([`claude`, `codex`]),
  cwd: z.string(),
  status: z.enum([`initializing`, `idle`, `running`, `error`]),
  error: z.string().optional(),
  currentPromptInboxKey: z.string().optional(),
})

const cursorStateRowSchema = z.object({
  key: z.literal(`current`),
  /** JSON-serialized SerializedSessionCursor, or empty string if none yet. */
  cursor: z.string(),
  lastProcessedInboxKey: z.string().optional(),
})

const eventRowSchema = z.object({
  key: z.string(),
  ts: z.number(),
  type: z.string(),
  callId: z.string().optional(),
  // `z.record(z.string(), z.unknown())` would emit JSON-Schema `propertyNames`,
  // which the agents-server schema validator rejects. `looseObject` emits a
  // plain `{ type: "object", additionalProperties: {} }` that's allowed and
  // still captures "any JSON object".
  payload: z.looseObject({}),
})

const creationArgsSchema = z.object({
  agent: z.enum([`claude`, `codex`]),
  cwd: z.string().optional(),
  nativeSessionId: z.string().optional(),
  importFrom: z
    .object({
      agent: z.enum([`claude`, `codex`]),
      sessionId: z.string(),
    })
    .optional(),
})

const promptMessageSchema = z.object({
  text: z.string(),
})

type SessionMetaRow = z.infer<typeof sessionMetaRowSchema>
type CursorStateRow = z.infer<typeof cursorStateRowSchema>

interface InboxRow {
  key: string
  from: string
  payload?: unknown
  timestamp: string
  message_type?: string
}

export interface RegisterCodingSessionOptions {
  /** Working directory the CLI runs in when `args.cwd` is not provided. Defaults to `process.cwd()`. */
  defaultWorkingDirectory?: string
  /** Override the CLI runner (for tests or alternate backends). */
  cliRunner?: CodingSessionCliRunner
}

/**
 * Stable key for an events-collection row, derived from the event's content.
 * Lets us re-insert the same event without producing duplicates — the caller
 * (or the collection's uniqueness guard) uses this to de-dup across retries,
 * replays, and crash recovery. Sorts chronologically by ts, then by type.
 */
function eventKey(event: NormalizedEvent): string {
  const tsPart = String(event.ts).padStart(16, `0`)
  return `${tsPart}_${event.type}_${contentHashHex(event)}`
}

function contentHashHex(event: NormalizedEvent): string {
  const json = JSON.stringify(event)
  // djb2 variant
  let h = 5381
  for (let i = 0; i < json.length; i++) {
    h = ((h * 33) ^ json.charCodeAt(i)) >>> 0
  }
  return h.toString(16).padStart(8, `0`)
}

function buildEventRow(event: NormalizedEvent): CodingSessionEventRow {
  const callId =
    `callId` in event && typeof event.callId === `string`
      ? event.callId
      : undefined
  return {
    key: eventKey(event),
    ts: event.ts,
    type: event.type,
    ...(callId !== undefined ? { callId } : {}),
    payload: event as unknown as Record<string, unknown>,
  }
}

interface LiveMirrorCtx {
  events: {
    get: (k: string) => unknown
  }
  actions: {
    events_insert: (arg: { row: CodingSessionEventRow }) => unknown
  }
}

function appendIfNew(ctx: LiveMirrorCtx, event: NormalizedEvent): void {
  const row = buildEventRow(event)
  if (ctx.events.get(row.key) !== undefined) return
  ctx.actions.events_insert({ row })
}

/**
 * Mirror every event that lands in the JSONL file while `runWork` is
 * executing (i.e. while the CLI is running). Returns the advanced cursor
 * and the `runWork` result once everything has settled and every append
 * has been persisted to the entity's durable stream.
 *
 * If setup fails (e.g. the session file can't be resolved), `runWork`
 * still runs — but nothing is mirrored and `setupError` is populated so
 * the caller can surface the condition. If `runWork` throws, the error
 * propagates after the watcher has been cleaned up.
 */
async function runWithLiveMirror<T>(opts: {
  agent: CodingAgentType
  nativeSessionId: string
  serializedCursor: SerializedSessionCursor | null
  ctx: LiveMirrorCtx
  runWork: () => Promise<T>
}): Promise<{
  cursor: SerializedSessionCursor | null
  setupError?: unknown
  result: T
}> {
  let cursor: SessionCursor | null = null
  let setupError: unknown = undefined

  try {
    const session = await resolveSession(opts.nativeSessionId, opts.agent)
    if (opts.serializedCursor) {
      cursor = deserializeCursor({
        ...opts.serializedCursor,
        path: session.path,
      })
    } else {
      // First real tail — absorb whatever's already on disk (e.g. the
      // pre-existing user turn for an imported session, or nothing for
      // a freshly-created empty file).
      const initial = await loadSession({
        sessionId: opts.nativeSessionId,
        agent: opts.agent,
      })
      for (const ev of initial.events) appendIfNew(opts.ctx, ev)
      cursor = initial.cursor
    }
  } catch (e) {
    setupError = e
  }

  if (!cursor) {
    // Setup failed — just run and surface the error to the caller.
    const result = await opts.runWork()
    return { cursor: opts.serializedCursor, setupError, result }
  }

  let activeCursor: SessionCursor = cursor
  let busy = false
  let pending = false
  let stopped = false

  const drainOnce = async (): Promise<void> => {
    if (stopped && busy) return
    if (busy) {
      pending = true
      return
    }
    busy = true
    try {
      const res = await tailSession({ cursor: activeCursor })
      activeCursor = res.cursor
      for (const ev of res.newEvents) appendIfNew(opts.ctx, ev)
    } catch {
      // Transient read errors (truncation, rename during rotation) —
      // the final tail after runWork settles will catch up.
    } finally {
      busy = false
      if (pending && !stopped) {
        pending = false
        void drainOnce()
      }
    }
  }

  const fileWatcher = watch(activeCursor.path, () => {
    void drainOnce()
  })
  const pollHandle = setInterval(() => {
    void drainOnce()
  }, 1500)

  let result: T
  try {
    result = await opts.runWork()
  } finally {
    stopped = true
    clearInterval(pollHandle)
    fileWatcher.close()
    // Wait for any in-flight drain to settle before doing the final tail.
    while (busy) {
      await new Promise((r) => setTimeout(r, 10))
    }
    // Final tail — catches anything written between the last watcher
    // tick and the watcher shutdown.
    try {
      const final = await tailSession({ cursor: activeCursor })
      activeCursor = final.cursor
      for (const ev of final.newEvents) appendIfNew(opts.ctx, ev)
    } catch {
      // Swallow; the caller's own post-run tail/persistence will
      // surface the condition if it matters.
    }
  }

  return { cursor: serializeCursor(activeCursor), setupError, result }
}

export function registerCodingSession(
  registry: EntityRegistry,
  options: RegisterCodingSessionOptions = {}
): void {
  const runner = options.cliRunner ?? defaultCliRunner
  const defaultCwd = options.defaultWorkingDirectory ?? process.cwd()

  registry.define(`coder`, {
    description: `Runs a Claude Code / Codex CLI session and mirrors its normalized event stream into a durable store. Prompts arrive via message_received (type: "prompt") and are executed serially.`,
    creationSchema: creationArgsSchema,
    inboxSchemas: {
      prompt: promptMessageSchema,
    },
    state: {
      sessionMeta: {
        schema: sessionMetaRowSchema,
        type: `coding_session_meta`,
        primaryKey: `key`,
      },
      cursorState: {
        schema: cursorStateRowSchema,
        type: `coding_session_cursor`,
        primaryKey: `key`,
      },
      events: {
        schema: eventRowSchema,
        type: `coding_session_event`,
        primaryKey: `key`,
      },
    },
    async handler(ctx: HandlerContext, _wake: WakeEvent) {
      // Seed sessionMeta / cursorState on the very first wake, once and
      // only once. `ctx.firstWake` is derived from "manifest is empty" —
      // this entity never writes a manifest entry (no mkdb/observe/spawn/
      // effect), so firstWake stays true on every wake. Guard by reading
      // state instead, per the define-entity review checklist.
      const existingMeta = ctx.db.collections.sessionMeta.get(`current`)
      if (!existingMeta) {
        const args = creationArgsSchema.parse(ctx.args)
        const cwd = args.cwd ?? defaultCwd
        const electricSessionId =
          ctx.entityUrl.split(`/`).pop() ?? ctx.entityUrl

        let resolvedNativeId = args.nativeSessionId
        if (args.importFrom) {
          const result = await importLocalSession({
            source: {
              sessionId: args.importFrom.sessionId,
              agent: args.importFrom.agent,
            },
            target: { agent: args.agent, cwd },
          })
          resolvedNativeId = result.sessionId
        }

        const hasNative = resolvedNativeId !== undefined
        ctx.db.actions.sessionMeta_insert({
          row: {
            key: `current`,
            electricSessionId,
            ...(hasNative ? { nativeSessionId: resolvedNativeId } : {}),
            agent: args.agent,
            cwd,
            status: hasNative ? `idle` : `initializing`,
          } satisfies SessionMetaRow,
        })
      }
      if (!ctx.db.collections.cursorState.get(`current`)) {
        ctx.db.actions.cursorState_insert({
          row: {
            key: `current`,
            cursor: ``,
          } satisfies CursorStateRow,
        })
      }

      const metaRow = ctx.db.collections.sessionMeta.get(`current`) as
        | SessionMetaRow
        | undefined
      const cursorRow = ctx.db.collections.cursorState.get(`current`) as
        | CursorStateRow
        | undefined
      if (!metaRow || !cursorRow) {
        throw new Error(
          `[coding-session] expected sessionMeta and cursorState rows to exist after init`
        )
      }

      // Initial mirror. When the session already exists on disk (imported
      // or attached) but the cursor is still empty, pull every existing
      // event into the durable stream so the viewer shows the full history
      // without waiting for a first prompt.
      if (metaRow.nativeSessionId && !cursorRow.cursor) {
        const mirrorCtx: LiveMirrorCtx = {
          events: {
            get: (k) => ctx.db.collections.events.get(k),
          },
          actions: {
            events_insert: ctx.db.actions.events_insert,
          },
        }
        try {
          const initial = await loadSession({
            sessionId: metaRow.nativeSessionId,
            agent: metaRow.agent,
          })
          for (const ev of initial.events) appendIfNew(mirrorCtx, ev)
          const serialized = serializeCursor(initial.cursor)
          ctx.db.actions.cursorState_update({
            key: `current`,
            updater: (d: CursorStateRow) => {
              d.cursor = JSON.stringify(serialized)
            },
          })
        } catch (e) {
          // Non-fatal: the session will still work on the next prompt,
          // we just won't have the pre-prompt history mirrored.
          const message = e instanceof Error ? e.message : String(e)
          ctx.db.actions.sessionMeta_update({
            key: `current`,
            updater: (d: SessionMetaRow) => {
              d.error = `initial mirror failed: ${message}`
            },
          })
        }
      }

      // Every inbox entry is treated as a prompt. `message_type === "prompt"`
      // is the preferred tag (see inboxSchemas) but is not required — a bare
      // `/send` with `{ payload: { text } }` from the generic UI MessageInput
      // arrives with no message_type and should still be processed.
      // Entries whose payload is not a `{ text }` object are ignored
      // (tracked via lastProcessedInboxKey so they don't re-trigger).
      const inboxRows = (ctx.db.collections.inbox.toArray as Array<InboxRow>)
        .slice()
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      const lastKey = cursorRow.lastProcessedInboxKey ?? ``
      const pending = inboxRows.filter((m) => m.key > lastKey)

      if (pending.length === 0) {
        if (metaRow.status === `running` || metaRow.status === `error`) {
          ctx.db.actions.sessionMeta_update({
            key: `current`,
            updater: (d: SessionMetaRow) => {
              d.status = `idle`
              delete d.currentPromptInboxKey
              delete d.error
            },
          })
        }
        return
      }

      let runningMeta = metaRow
      let runningCursor = cursorRow

      for (const inboxMsg of pending) {
        const parsed = promptMessageSchema.safeParse(inboxMsg.payload)
        if (!parsed.success) {
          ctx.db.actions.cursorState_update({
            key: `current`,
            updater: (d: CursorStateRow) => {
              d.lastProcessedInboxKey = inboxMsg.key
            },
          })
          runningCursor = {
            ...runningCursor,
            lastProcessedInboxKey: inboxMsg.key,
          }
          continue
        }
        const prompt = parsed.data.text

        ctx.db.actions.sessionMeta_update({
          key: `current`,
          updater: (d: SessionMetaRow) => {
            d.status = `running`
            d.currentPromptInboxKey = inboxMsg.key
            delete d.error
          },
        })

        try {
          const mirrorCtx: LiveMirrorCtx = {
            events: {
              get: (k) => ctx.db.collections.events.get(k),
            },
            actions: {
              events_insert: ctx.db.actions.events_insert,
            },
          }

          let nextCursorJson = runningCursor.cursor
          let discoveredNativeId: string | undefined

          if (!runningMeta.nativeSessionId) {
            // First real prompt on a fresh session. Let the CLI create
            // its own jsonl (writing an empty one ourselves breaks
            // `claude -r <id>` — claude can't resume an empty file).
            // After it exits, diff the on-disk sessions to find the
            // new id, then load and mirror in one shot. Snapshot both
            // the deterministic per-cwd directory (works for Claude
            // `-p` runs that don't drop a metadata lock file) and
            // discoverSessions (covers Codex + interactive Claude
            // sessions) before the run so either path can spot the
            // freshly written session.
            const preDirectIds =
              runningMeta.agent === `claude`
                ? await listClaudeJsonlIdsByCwd(runningMeta.cwd)
                : new Set<string>()
            const preDiscoveredIds = new Set(
              (await discoverSessions(runningMeta.agent)).map(
                (s) => s.sessionId
              )
            )
            const cliResult = await runner.run({
              agent: runningMeta.agent,
              cwd: runningMeta.cwd,
              prompt,
            })
            if (cliResult.exitCode !== 0) {
              throw new Error(
                `[coding-session] ${runningMeta.agent} CLI exited ${cliResult.exitCode}. stderr=${cliResult.stderr.slice(0, 800) || `<empty>`} stdout=${cliResult.stdout.slice(0, 800) || `<empty>`}`
              )
            }
            const foundId = await findNewSessionAfterRun(
              runningMeta.agent,
              runningMeta.cwd,
              preDirectIds,
              preDiscoveredIds
            )
            if (!foundId) {
              throw new Error(
                `[coding-session] ${runningMeta.agent} CLI succeeded but no new session file was found`
              )
            }
            discoveredNativeId = foundId
            ctx.db.actions.sessionMeta_update({
              key: `current`,
              updater: (d: SessionMetaRow) => {
                d.nativeSessionId = foundId
              },
            })
            runningMeta = { ...runningMeta, nativeSessionId: foundId }

            // Post-run full load. No live streaming on the first prompt
            // since the file didn't exist when we started.
            const initial = await loadSession({
              sessionId: foundId,
              agent: runningMeta.agent,
            })
            for (const ev of initial.events) appendIfNew(mirrorCtx, ev)
            nextCursorJson = JSON.stringify(serializeCursor(initial.cursor))
          } else {
            // Existing session: stream events into the DS while the CLI
            // runs, so the UI sees the prompt turn, assistant tokens,
            // and tool calls as they land.
            const serializedCursor = runningCursor.cursor
              ? (JSON.parse(runningCursor.cursor) as SerializedSessionCursor)
              : null

            const {
              cursor: nextSerialized,
              setupError,
              result: cliResult,
            } = await runWithLiveMirror({
              agent: runningMeta.agent,
              nativeSessionId: runningMeta.nativeSessionId,
              serializedCursor,
              ctx: mirrorCtx,
              runWork: () =>
                runner.run({
                  agent: runningMeta.agent,
                  sessionId: runningMeta.nativeSessionId,
                  cwd: runningMeta.cwd,
                  prompt,
                }),
            })

            if (setupError) {
              throw setupError instanceof Error
                ? setupError
                : new Error(String(setupError))
            }
            if (cliResult.exitCode !== 0) {
              throw new Error(
                `[coding-session] ${runningMeta.agent} CLI exited ${cliResult.exitCode}. stderr=${cliResult.stderr.slice(0, 800) || `<empty>`} stdout=${cliResult.stdout.slice(0, 800) || `<empty>`}`
              )
            }

            const persistedCursor = nextSerialized ?? serializedCursor
            nextCursorJson = persistedCursor
              ? JSON.stringify(persistedCursor)
              : ``
          }

          void discoveredNativeId
          ctx.db.actions.cursorState_update({
            key: `current`,
            updater: (d: CursorStateRow) => {
              d.cursor = nextCursorJson
              d.lastProcessedInboxKey = inboxMsg.key
            },
          })
          runningCursor = {
            ...runningCursor,
            cursor: nextCursorJson,
            lastProcessedInboxKey: inboxMsg.key,
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          ctx.db.actions.sessionMeta_update({
            key: `current`,
            updater: (d: SessionMetaRow) => {
              d.status = `error`
              d.error = message
            },
          })
          ctx.db.actions.cursorState_update({
            key: `current`,
            updater: (d: CursorStateRow) => {
              d.lastProcessedInboxKey = inboxMsg.key
            },
          })
          throw e
        }
      }

      ctx.db.actions.sessionMeta_update({
        key: `current`,
        updater: (d: SessionMetaRow) => {
          d.status = `idle`
          delete d.currentPromptInboxKey
          delete d.error
        },
      })
    },
  })
}
