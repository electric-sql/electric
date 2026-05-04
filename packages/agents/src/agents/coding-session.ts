import { z } from 'zod'
import { importLocalSession, loadSession } from 'agent-session-protocol'
import type { NormalizedEvent } from 'agent-session-protocol'
import {
  CODER_RESOURCE_TAG,
  codingSessionResourceId,
  codingSessionResourceSchema,
  db,
} from '@electric-ax/agents-runtime'
import type {
  CodingAgentType,
  CodingSessionInfoRow,
  CodingSessionTranscriptRow,
  CodingSessionResourceSchema,
  EntityRegistry,
  HandlerContext,
  SharedStateHandle,
  WakeEvent,
} from '@electric-ax/agents-runtime'

import { claudeSdkRunner } from './runners/claude-sdk.js'
import { codexSdkRunner } from './runners/codex-sdk.js'

/**
 * Abstraction over a coding-agent runner. Defaults dispatch to the
 * Claude / Codex SDKs; tests can inject a fake. Runners stream
 * `NormalizedEvent`s via `onEvent` and call `onSessionId` once with
 * the new (or resumed) native session id.
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

// ── Entity-local state schemas ─────────────────────────────────────
//
// The coder entity is now a thin wrapper around the coding-session
// resource (see coding-session-resource.ts in agents-runtime). It
// owns only the bookkeeping that's tied to *this* entity instance:
// the run lifecycle status and the inbox processing cursor. Anything
// portable (event history, session metadata) lives on the resource.

const RUN_STATUS_COLLECTION_TYPE = `coder_run_status`
const INBOX_CURSOR_COLLECTION_TYPE = `coder_inbox_cursor`

const runStatusRowSchema = z.object({
  key: z.literal(`current`),
  status: z.enum([`initializing`, `idle`, `running`, `error`]),
  error: z.string().optional(),
  /** Inbox key of the prompt currently running, when status === `running`. */
  currentPromptInboxKey: z.string().optional(),
})

const inboxCursorRowSchema = z.object({
  key: z.literal(`current`),
  lastProcessedInboxKey: z.string().optional(),
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

type RunStatusRow = z.infer<typeof runStatusRowSchema>
type InboxCursorRow = z.infer<typeof inboxCursorRowSchema>

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
 * Stable key for an event row, derived from content. Lets the same
 * event re-arrive (e.g. on retry) without producing duplicates.
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

function buildTranscriptRow(
  event: NormalizedEvent
): CodingSessionTranscriptRow {
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

type CodingSessionResource = SharedStateHandle<CodingSessionResourceSchema>

function appendIfNew(
  resource: CodingSessionResource,
  event: NormalizedEvent
): void {
  const row = buildTranscriptRow(event)
  if (resource.transcript.get(row.key) !== undefined) return
  resource.transcript.insert(row)
}

export function registerCodingSession(
  registry: EntityRegistry,
  options: RegisterCodingSessionOptions = {}
): void {
  const runner = options.cliRunner ?? defaultCliRunner
  const defaultCwd = options.defaultWorkingDirectory ?? process.cwd()

  registry.define(`coder`, {
    description: `Wraps a Claude Code / Codex SDK session. The session's history (events + sessionInfo) lives on a coding-session resource (shared-state DB) the entity creates on first wake; the entity itself just queues prompts and drives the SDK runner. Prompts arrive via message_received (type: "prompt") and run serially.`,
    creationSchema: creationArgsSchema,
    inboxSchemas: {
      prompt: promptMessageSchema,
    },
    state: {
      runStatus: {
        schema: runStatusRowSchema,
        type: RUN_STATUS_COLLECTION_TYPE,
        primaryKey: `key`,
      },
      inboxCursor: {
        schema: inboxCursorRowSchema,
        type: INBOX_CURSOR_COLLECTION_TYPE,
        primaryKey: `key`,
      },
    },
    async handler(ctx: HandlerContext, _wake: WakeEvent) {
      const entityId = ctx.entityUrl.split(`/`).pop() ?? ctx.entityUrl
      const resourceId = codingSessionResourceId(entityId)

      // First wake: register the resource via mkdb so subsequent
      // wakes can observe it (and any third party can attach by id).
      // mkdb throws if called more than once for the same id, so the
      // firstWake guard is mandatory. After this wake commits the
      // manifest entry, ctx.firstWake will correctly be false next
      // time round.
      if (ctx.firstWake) {
        ctx.mkdb(resourceId, codingSessionResourceSchema)
      }

      const resource = (await ctx.observe(
        db(resourceId, codingSessionResourceSchema)
      )) as unknown as CodingSessionResource

      // First-wake initialisation: parse args, run the optional
      // cross-agent import, seed sessionInfo + entity-local state,
      // and tag the entity so the UI can find the resource.
      if (ctx.firstWake) {
        const args = creationArgsSchema.parse(ctx.args)
        const cwd = args.cwd ?? defaultCwd

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

        resource.sessionInfo.insert({
          key: `current`,
          agent: args.agent,
          cwd,
          electricSessionId: entityId,
          ...(resolvedNativeId ? { nativeSessionId: resolvedNativeId } : {}),
          createdAt: Date.now(),
        })

        ctx.db.actions.runStatus_insert({
          row: {
            key: `current`,
            status: resolvedNativeId ? `idle` : `initializing`,
          } satisfies RunStatusRow,
        })
        ctx.db.actions.inboxCursor_insert({
          row: { key: `current` } satisfies InboxCursorRow,
        })
        void ctx.setTag(CODER_RESOURCE_TAG, resourceId)
      }

      const sessionInfo = resource.sessionInfo.get(`current`) as
        | CodingSessionInfoRow
        | undefined
      if (!sessionInfo) {
        throw new Error(
          `[coding-session] sessionInfo missing on resource ${resourceId}`
        )
      }

      // Initial event mirror. When the session already exists on
      // disk (imported or attached) but the resource's events
      // collection is still empty, pull every existing event from
      // the JSONL into the resource so the viewer has the full
      // history without waiting for a first prompt.
      if (
        sessionInfo.nativeSessionId !== undefined &&
        resource.transcript.toArray.length === 0
      ) {
        try {
          const initial = await loadSession({
            sessionId: sessionInfo.nativeSessionId,
            agent: sessionInfo.agent,
          })
          for (const ev of initial.events) appendIfNew(resource, ev)
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          ctx.db.actions.runStatus_update({
            key: `current`,
            updater: (d: RunStatusRow) => {
              d.error = `initial mirror failed: ${message}`
            },
          })
        }
      }

      const cursorRow = ctx.db.collections.inboxCursor.get(`current`) as
        | InboxCursorRow
        | undefined
      if (!cursorRow) {
        throw new Error(
          `[coding-session] inboxCursor missing — first-wake init never completed`
        )
      }

      // Every inbox entry is treated as a prompt. `message_type === "prompt"`
      // is preferred but not required — bare `/send { payload: { text } }`
      // from the generic UI MessageInput arrives without a type. Entries
      // whose payload isn't a `{ text }` object are skipped (and tracked
      // via lastProcessedInboxKey so they don't re-trigger).
      const inboxRows = (ctx.db.collections.inbox.toArray as Array<InboxRow>)
        .slice()
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      const lastKey = cursorRow.lastProcessedInboxKey ?? ``
      const pending = inboxRows.filter((m) => m.key > lastKey)

      const runStatus = ctx.db.collections.runStatus.get(`current`) as
        | RunStatusRow
        | undefined

      if (pending.length === 0) {
        if (runStatus?.status === `running` || runStatus?.status === `error`) {
          ctx.db.actions.runStatus_update({
            key: `current`,
            updater: (d: RunStatusRow) => {
              d.status = `idle`
              delete d.currentPromptInboxKey
              delete d.error
            },
          })
        }
        return
      }

      let currentInfo = sessionInfo

      for (const inboxMsg of pending) {
        const parsed = promptMessageSchema.safeParse(inboxMsg.payload)
        if (!parsed.success) {
          ctx.db.actions.inboxCursor_update({
            key: `current`,
            updater: (d: InboxCursorRow) => {
              d.lastProcessedInboxKey = inboxMsg.key
            },
          })
          continue
        }
        const prompt = parsed.data.text

        // Adopt the first prompt as the entity's display title so the
        // sidebar shows something meaningful instead of a random slug.
        // Only set if no title is already present.
        const existingTitle = ctx.tags.title
        if (typeof existingTitle !== `string` || existingTitle.length === 0) {
          void ctx.setTag(`title`, prompt.slice(0, 80))
        }

        ctx.db.actions.runStatus_update({
          key: `current`,
          updater: (d: RunStatusRow) => {
            d.status = `running`
            d.currentPromptInboxKey = inboxMsg.key
            delete d.error
          },
        })

        // Record the run so observers waking on `runFinished` are
        // notified. Without this the parent (e.g. Horton via
        // spawn_coder) would never be woken because the coder bypasses
        // useAgent.
        const recordedRun = ctx.recordRun()
        // Snapshot existing event keys so we can later pick out the
        // assistant_message rows produced by *this* run for
        // attachResponse.
        const eventKeysBefore = new Set(
          (
            resource.transcript
              .toArray as unknown as Array<CodingSessionTranscriptRow>
          ).map((e) => e.key)
        )

        try {
          const cliResult = await runner.run({
            agent: currentInfo.agent,
            ...(currentInfo.nativeSessionId
              ? { sessionId: currentInfo.nativeSessionId }
              : {}),
            cwd: currentInfo.cwd,
            prompt,
            onEvent: (ev) => appendIfNew(resource, ev),
            onSessionId: (id) => {
              if (currentInfo.nativeSessionId === id) return
              resource.sessionInfo.update(`current`, (d) => {
                d.nativeSessionId = id
              })
              currentInfo = { ...currentInfo, nativeSessionId: id }
            },
          })

          if (cliResult.exitCode !== 0) {
            throw new Error(
              `[coding-session] ${currentInfo.agent} runner exited ${cliResult.exitCode}. stderr=${cliResult.stderr.slice(0, 800) || `<empty>`} stdout=${cliResult.stdout.slice(0, 800) || `<empty>`}`
            )
          }

          ctx.db.actions.inboxCursor_update({
            key: `current`,
            updater: (d: InboxCursorRow) => {
              d.lastProcessedInboxKey = inboxMsg.key
            },
          })
          // Pipe assistant_message text from this run into recordedRun
          // so the runFinished wake's `includeResponse` payload carries
          // the coder's reply.
          for (const row of resource.transcript
            .toArray as unknown as Array<CodingSessionTranscriptRow>) {
            if (eventKeysBefore.has(row.key)) continue
            if (row.type !== `assistant_message`) continue
            const text = (row.payload as { text?: unknown }).text
            if (typeof text === `string` && text.length > 0) {
              recordedRun.attachResponse(text)
            }
          }
          recordedRun.end({ status: `completed` })
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          recordedRun.end({ status: `failed`, finishReason: `error` })
          ctx.db.actions.runStatus_update({
            key: `current`,
            updater: (d: RunStatusRow) => {
              d.status = `error`
              d.error = message
            },
          })
          ctx.db.actions.inboxCursor_update({
            key: `current`,
            updater: (d: InboxCursorRow) => {
              d.lastProcessedInboxKey = inboxMsg.key
            },
          })
          // Re-throw so the agent-runtime entity bridge surfaces the
          // failure to observers (Horton wakes on `runFinished` with
          // status=failed, the UI flips the badge to error).
          throw e
        }
      }

      ctx.db.actions.runStatus_update({
        key: `current`,
        updater: (d: RunStatusRow) => {
          d.status = `idle`
          delete d.currentPromptInboxKey
          delete d.error
        },
      })
    },
  })
}
