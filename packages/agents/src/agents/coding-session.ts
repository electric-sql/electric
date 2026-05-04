import { z } from 'zod'
import {
  importLocalSession,
  loadSession,
  serializeCursor,
} from 'agent-session-protocol'
import type { NormalizedEvent } from 'agent-session-protocol'
import {
  CODING_SESSION_CURSOR_COLLECTION_TYPE,
  CODING_SESSION_EVENT_COLLECTION_TYPE,
  CODING_SESSION_META_COLLECTION_TYPE,
} from '@electric-ax/agents-runtime'
import type {
  CodingAgentType,
  CodingSessionEventRow,
  EntityRegistry,
  HandlerContext,
  WakeEvent,
} from '@electric-ax/agents-runtime'

import { claudeSdkRunner } from './runners/claude-sdk.js'
import { codexSdkRunner } from './runners/codex-sdk.js'

/**
 * Abstraction over a coding-agent runner. The default implementations
 * drive `@anthropic-ai/claude-agent-sdk` and `@openai/codex-sdk`
 * directly; tests can inject a fake.
 *
 * Runners stream `NormalizedEvent`s via `onEvent` as the agent makes
 * progress, and call `onSessionId` once with the new (or resumed)
 * session id so the orchestrator can persist it on the entity.
 *
 * `sessionId` is undefined for the first prompt on a fresh session —
 * the runner should then let the SDK generate its own id and emit it
 * via `onSessionId`. For every subsequent prompt, pass the id so the
 * SDK resumes that conversation.
 */
export interface CodingSessionCliRunner {
  run(opts: {
    agent: CodingAgentType
    sessionId?: string
    cwd: string
    prompt: string
    onEvent?: (ev: NormalizedEvent) => void
    onSessionId?: (id: string) => void
  }): Promise<{ exitCode: number; stdout: string; stderr: string }>
}

const defaultCliRunner: CodingSessionCliRunner = {
  async run(opts) {
    const runner = opts.agent === `claude` ? claudeSdkRunner : codexSdkRunner
    return runner.run(opts)
  },
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
  /**
   * JSON-serialized SerializedSessionCursor or empty string. Used as a
   * "have I seeded the events collection from the JSONL yet?" marker for
   * imported / attached sessions — once non-empty, we don't reseed.
   * The SDK runners stream events live, so this is no longer used for
   * tail/cursor state past first wake.
   */
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
  /** Working directory the runner uses when `args.cwd` is not provided. Defaults to `process.cwd()`. */
  defaultWorkingDirectory?: string
  /** Override the runner (for tests or alternate backends). */
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

export function registerCodingSession(
  registry: EntityRegistry,
  options: RegisterCodingSessionOptions = {}
): void {
  const runner = options.cliRunner ?? defaultCliRunner
  const defaultCwd = options.defaultWorkingDirectory ?? process.cwd()

  registry.define(`coder`, {
    description: `Runs a Claude Code / Codex SDK session and mirrors its normalized event stream into a durable store. Prompts arrive via message_received (type: "prompt") and are executed serially.`,
    creationSchema: creationArgsSchema,
    inboxSchemas: {
      prompt: promptMessageSchema,
    },
    state: {
      sessionMeta: {
        schema: sessionMetaRowSchema,
        type: CODING_SESSION_META_COLLECTION_TYPE,
        primaryKey: `key`,
      },
      cursorState: {
        schema: cursorStateRowSchema,
        type: CODING_SESSION_CURSOR_COLLECTION_TYPE,
        primaryKey: `key`,
      },
      events: {
        schema: eventRowSchema,
        type: CODING_SESSION_EVENT_COLLECTION_TYPE,
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

        // Adopt the first prompt as the entity's display title (truncated)
        // so the sidebar surfaces something meaningful for coders that
        // would otherwise fall back to a random slug. Only set it if no
        // title is already present — preserves explicit titles supplied
        // by spawners (e.g. a future deep-survey-style use of `tags.title`).
        const existingTitle = ctx.tags.title
        if (typeof existingTitle !== `string` || existingTitle.length === 0) {
          void ctx.setTag(`title`, prompt.slice(0, 80))
        }

        ctx.db.actions.sessionMeta_update({
          key: `current`,
          updater: (d: SessionMetaRow) => {
            d.status = `running`
            d.currentPromptInboxKey = inboxMsg.key
            delete d.error
          },
        })

        // Record the run as a `runs` collection event so observers
        // waking on `runFinished` are notified when the turn ends.
        // Without this the parent (e.g. Horton via spawn_coder) would
        // never be woken because the coder bypasses useAgent.
        const recordedRun = ctx.recordRun()
        // Snapshot the existing event keys so we can identify which
        // events are appended during this run and surface their
        // assistant text as the run's response payload.
        const eventKeysBefore = new Set(
          (
            ctx.db.collections.events.toArray as unknown as Array<{
              key: string
            }>
          ).map((e) => e.key)
        )

        try {
          const mirrorCtx: LiveMirrorCtx = {
            events: {
              get: (k) => ctx.db.collections.events.get(k),
            },
            actions: {
              events_insert: ctx.db.actions.events_insert,
            },
          }

          const cliResult = await runner.run({
            agent: runningMeta.agent,
            ...(runningMeta.nativeSessionId
              ? { sessionId: runningMeta.nativeSessionId }
              : {}),
            cwd: runningMeta.cwd,
            prompt,
            onEvent: (ev) => appendIfNew(mirrorCtx, ev),
            onSessionId: (id) => {
              if (runningMeta.nativeSessionId === id) return
              ctx.db.actions.sessionMeta_update({
                key: `current`,
                updater: (d: SessionMetaRow) => {
                  d.nativeSessionId = id
                },
              })
              runningMeta = { ...runningMeta, nativeSessionId: id }
            },
          })

          if (cliResult.exitCode !== 0) {
            throw new Error(
              `[coding-session] ${runningMeta.agent} runner exited ${cliResult.exitCode}. stderr=${cliResult.stderr.slice(0, 800) || `<empty>`} stdout=${cliResult.stdout.slice(0, 800) || `<empty>`}`
            )
          }

          ctx.db.actions.cursorState_update({
            key: `current`,
            updater: (d: CursorStateRow) => {
              // Cursor is now just a "have we seeded?" marker — set to
              // any non-empty string after the first successful run.
              if (!d.cursor) d.cursor = `sdk-stream`
              d.lastProcessedInboxKey = inboxMsg.key
            },
          })
          runningCursor = {
            ...runningCursor,
            cursor: runningCursor.cursor || `sdk-stream`,
            lastProcessedInboxKey: inboxMsg.key,
          }
          // Pipe assistant_message text from this run into recordedRun
          // so the runFinished wake's `includeResponse` payload carries
          // the coder's reply.
          for (const row of ctx.db.collections.events
            .toArray as unknown as Array<{
            key: string
            type: string
            payload: { text?: unknown }
          }>) {
            if (eventKeysBefore.has(row.key)) continue
            if (row.type !== `assistant_message`) continue
            const text = row.payload?.text
            if (typeof text === `string` && text.length > 0) {
              recordedRun.attachResponse(text)
            }
          }
          recordedRun.end({ status: `completed` })
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          recordedRun.end({ status: `failed`, finishReason: `error` })
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
          // Re-throw so the agent-runtime entity bridge surfaces the
          // failure to observers (Horton wakes on `runFinished` with
          // status=failed, the UI flips the badge to error). The
          // failed prompt's inbox key was advanced above, so on the
          // next wake the for-loop resumes from the *next* queued
          // prompt — remaining inbox messages aren't dropped, just
          // deferred until the framework re-wakes us.
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
