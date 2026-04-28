import { randomUUID } from 'node:crypto'
import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { EntityStreamDBWithActions } from '@electric-ax/agents-runtime'

type ScheduleManifest = {
  key: string
  kind: `schedule`
  id: string
  scheduleType: `cron` | `future_send`
  expression?: string
  timezone?: string
  fireAt?: string
  targetUrl?: string
  payload?: unknown
  producerId?: string
  from?: string
  messageType?: string
  status?: `pending` | `sent` | `failed`
  sentAt?: string
  failedAt?: string
  lastError?: string
  wake?: unknown
}

type ToolResult = {
  content: Array<{ type: `text`; text: string }>
  details: Record<string, unknown>
}

function readTimezoneCandidate(value: unknown): string | undefined {
  return typeof value === `string` && value.trim().length > 0
    ? value.trim()
    : undefined
}

function inferTimezoneFromArgs(
  args: Readonly<Record<string, unknown>>
): string | undefined {
  return (
    readTimezoneCandidate(args.timezone) ??
    readTimezoneCandidate(args.timeZone) ??
    readTimezoneCandidate(args.tz)
  )
}

function manifestScheduleKey(id: string): string {
  return `schedule:${id}`
}

function asToolResult(value: unknown): ToolResult {
  return {
    content: [
      {
        type: `text`,
        text:
          typeof value === `string` ? value : JSON.stringify(value, null, 2),
      },
    ],
    details: {},
  }
}

function formatForLog(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function withScheduleToolLogging<TParams>(
  entityUrl: string,
  toolName: string,
  execute: (
    toolCallId: string | undefined,
    params: TParams
  ) => Promise<ToolResult>
): (toolCallId: string | undefined, params: TParams) => Promise<ToolResult> {
  return async (toolCallId, params) => {
    console.info(`[agent-server] ${entityUrl} ${toolName} start`, {
      toolCallId: toolCallId ?? null,
      params: formatForLog(params),
    })

    try {
      const result = await execute(toolCallId, params)
      console.info(`[agent-server] ${entityUrl} ${toolName} success`, {
        toolCallId: toolCallId ?? null,
        result: formatForLog(result),
      })
      return result
    } catch (error) {
      console.error(`[agent-server] ${entityUrl} ${toolName} failed`, {
        toolCallId: toolCallId ?? null,
        params: formatForLog(params),
        error,
      })
      throw error
    }
  }
}

function isScheduleManifest(value: unknown): boolean {
  return (
    typeof value === `object` &&
    value !== null &&
    (value as { kind?: unknown }).kind === `schedule` &&
    typeof (value as { id?: unknown }).id === `string` &&
    ((value as { scheduleType?: unknown }).scheduleType === `cron` ||
      (value as { scheduleType?: unknown }).scheduleType === `future_send`)
  )
}

function getScheduleEntries(
  db: EntityStreamDBWithActions
): Array<ScheduleManifest> {
  const entries: Array<ScheduleManifest> = []

  for (const entry of db.collections.manifests.toArray) {
    if (!isScheduleManifest(entry)) continue
    const schedule = entry as Record<string, unknown>
    entries.push({
      key: String(schedule.key),
      kind: `schedule`,
      id: String(schedule.id),
      scheduleType: schedule.scheduleType === `cron` ? `cron` : `future_send`,
      expression:
        typeof schedule.expression === `string`
          ? schedule.expression
          : undefined,
      timezone:
        typeof schedule.timezone === `string` ? schedule.timezone : undefined,
      fireAt: typeof schedule.fireAt === `string` ? schedule.fireAt : undefined,
      targetUrl:
        typeof schedule.targetUrl === `string` ? schedule.targetUrl : undefined,
      payload: schedule.payload,
      producerId:
        typeof schedule.producerId === `string`
          ? schedule.producerId
          : undefined,
      from: typeof schedule.from === `string` ? schedule.from : undefined,
      messageType:
        typeof schedule.messageType === `string`
          ? schedule.messageType
          : undefined,
      status:
        schedule.status === `pending` ||
        schedule.status === `sent` ||
        schedule.status === `failed`
          ? schedule.status
          : undefined,
      sentAt: typeof schedule.sentAt === `string` ? schedule.sentAt : undefined,
      failedAt:
        typeof schedule.failedAt === `string` ? schedule.failedAt : undefined,
      lastError:
        typeof schedule.lastError === `string` ? schedule.lastError : undefined,
      wake: schedule.wake,
    })
  }

  return entries.sort((left, right) => left.id.localeCompare(right.id))
}

function getScheduleEntry(
  db: EntityStreamDBWithActions,
  scheduleId: string
): ScheduleManifest | undefined {
  return getScheduleEntries(db).find((entry) => entry.id === scheduleId)
}

function normalizeIsoTime(input: string): string {
  const parsed = new Date(input)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid fireAt timestamp: ${input}`)
  }
  return parsed.toISOString()
}

function buildFutureSendProducerId(existing?: ScheduleManifest): string {
  if (
    existing?.scheduleType === `future_send` &&
    existing.status === `pending` &&
    typeof existing.producerId === `string` &&
    existing.producerId.length > 0
  ) {
    return existing.producerId
  }
  return `future-send-${randomUUID()}`
}

export function createScheduleTools(opts: {
  entityUrl: string
  args?: Readonly<Record<string, unknown>>
  db: EntityStreamDBWithActions
  upsertCronSchedule: (opts: {
    id: string
    expression: string
    timezone?: string
    payload?: unknown
    debounceMs?: number
    timeoutMs?: number
  }) => Promise<{ txid: string }>
  upsertFutureSendSchedule: (opts: {
    id: string
    payload: unknown
    targetUrl?: string
    fireAt: string
    from?: string
    messageType?: string
  }) => Promise<{ txid: string }>
  deleteSchedule: (opts: { id: string }) => Promise<{ txid: string }>
}): Array<AgentTool> {
  const {
    args = {},
    db,
    entityUrl,
    upsertCronSchedule,
    upsertFutureSendSchedule,
    deleteSchedule,
  } = opts
  const defaultTimezone = inferTimezoneFromArgs(args)

  const listSchedulesTool: AgentTool = {
    name: `list_schedules`,
    label: `List Schedules`,
    description: `List this entity's manifest-backed cron and future-send schedules.`,
    parameters: Type.Object({}),
    execute: withScheduleToolLogging(entityUrl, `list_schedules`, async () =>
      asToolResult(
        getScheduleEntries(db).map((entry) => ({
          id: entry.id,
          key: entry.key,
          scheduleType: entry.scheduleType,
          expression: entry.expression,
          timezone: entry.timezone,
          fireAt: entry.fireAt,
          targetUrl: entry.targetUrl,
          payload: entry.payload,
          from: entry.from,
          messageType: entry.messageType,
          status: entry.status,
          sentAt: entry.sentAt,
          failedAt: entry.failedAt,
          lastError: entry.lastError,
          wake: entry.wake,
        }))
      )
    ),
  }

  const upsertCronTool: AgentTool = {
    name: `upsert_cron_schedule`,
    label: `Upsert Cron`,
    description: `Create or update a recurring cron wake. Always include payload with the concrete instruction or message the agent should receive when the cron fires. If timezone is omitted, the tool uses the entity or user timezone from args when present, otherwise UTC.`,
    parameters: Type.Object({
      id: Type.String({ description: `Stable schedule identifier` }),
      expression: Type.String({
        description: `Cron expression, e.g. */5 * * * * or */30 * * * * *`,
      }),
      timezone: Type.Optional(
        Type.String({
          description: `Optional IANA timezone like America/Denver or UTC. Defaults to the entity or user timezone from args when present, otherwise UTC.`,
        })
      ),
      payload: Type.Any({
        description: `Required instruction or message delivered to the agent when this cron fires`,
      }),
      debounceMs: Type.Optional(
        Type.Number({ description: `Optional debounce window in milliseconds` })
      ),
      timeoutMs: Type.Optional(
        Type.Number({ description: `Optional timeout window in milliseconds` })
      ),
    }),
    execute: withScheduleToolLogging(
      entityUrl,
      `upsert_cron_schedule`,
      async (_toolCallId, params) => {
        const { id, expression, timezone, payload, debounceMs, timeoutMs } =
          params as {
            id: string
            expression: string
            timezone?: string
            payload: unknown
            debounceMs?: number
            timeoutMs?: number
          }
        const resolvedTimezone = timezone ?? defaultTimezone
        const nextValue = {
          key: manifestScheduleKey(id),
          kind: `schedule` as const,
          id,
          scheduleType: `cron` as const,
          expression,
          ...(resolvedTimezone ? { timezone: resolvedTimezone } : {}),
          payload,
          wake: {
            on: `change` as const,
            ...(typeof debounceMs === `number` ? { debounceMs } : {}),
            ...(typeof timeoutMs === `number` ? { timeoutMs } : {}),
          },
        }

        const { txid } = await upsertCronSchedule({
          id,
          expression,
          timezone: resolvedTimezone,
          payload,
          debounceMs,
          timeoutMs,
        })
        await db.utils.awaitTxId(txid, 10_000)
        return asToolResult(getScheduleEntry(db, id) ?? nextValue)
      }
    ),
  }

  const upsertFutureSendTool: AgentTool = {
    name: `upsert_future_send`,
    label: `Upsert Future Send`,
    description: `Create or update a manifest-backed delayed send. Use either fireAt or afterMs.`,
    parameters: Type.Object({
      id: Type.String({ description: `Stable schedule identifier` }),
      payload: Type.Any({ description: `Message payload to deliver` }),
      targetUrl: Type.Optional(
        Type.String({
          description: `Target entity URL. Defaults to this entity.`,
        })
      ),
      fireAt: Type.Optional(
        Type.String({
          description: `Absolute delivery time in ISO-8601 format`,
        })
      ),
      afterMs: Type.Optional(
        Type.Number({
          description: `Relative delay in milliseconds from now`,
        })
      ),
      from: Type.Optional(
        Type.String({ description: `Optional message sender identity` })
      ),
      messageType: Type.Optional(
        Type.String({ description: `Optional message type` })
      ),
    }),
    execute: withScheduleToolLogging(
      entityUrl,
      `upsert_future_send`,
      async (_toolCallId, params) => {
        const { afterMs, fireAt, from, id, messageType, payload, targetUrl } =
          params as {
            id: string
            payload: unknown
            targetUrl?: string
            fireAt?: string
            afterMs?: number
            from?: string
            messageType?: string
          }

        if ((fireAt ? 1 : 0) + (typeof afterMs === `number` ? 1 : 0) !== 1) {
          throw new Error(`Provide exactly one of fireAt or afterMs`)
        }

        const existing = getScheduleEntry(db, id)
        const resolvedFireAt =
          typeof afterMs === `number`
            ? new Date(Date.now() + afterMs).toISOString()
            : normalizeIsoTime(fireAt!)
        const producerId = buildFutureSendProducerId(existing)
        const nextValue = {
          key: manifestScheduleKey(id),
          kind: `schedule` as const,
          id,
          scheduleType: `future_send` as const,
          fireAt: resolvedFireAt,
          targetUrl: targetUrl ?? entityUrl,
          payload,
          producerId,
          ...(from ? { from } : {}),
          ...(messageType ? { messageType } : {}),
          status: `pending` as const,
        }

        const { txid } = await upsertFutureSendSchedule({
          id,
          payload,
          targetUrl: targetUrl ?? entityUrl,
          fireAt: resolvedFireAt,
          from,
          messageType,
        })
        await db.utils.awaitTxId(txid, 10_000)
        return asToolResult(getScheduleEntry(db, id) ?? nextValue)
      }
    ),
  }

  const deleteScheduleTool: AgentTool = {
    name: `delete_schedule`,
    label: `Delete Schedule`,
    description: `Delete a cron or future-send schedule from this entity's manifest.`,
    parameters: Type.Object({
      id: Type.String({ description: `Stable schedule identifier` }),
    }),
    execute: withScheduleToolLogging(
      entityUrl,
      `delete_schedule`,
      async (_toolCallId, params) => {
        const { id } = params as { id: string }
        const key = manifestScheduleKey(id)
        const existing = getScheduleEntry(db, id)
        if (!existing) {
          return asToolResult(`No schedule found for id "${id}"`)
        }
        const { txid } = await deleteSchedule({ id })
        await db.utils.awaitTxId(txid, 10_000)
        return asToolResult({
          deleted: true,
          id,
          key,
        })
      }
    ),
  }

  return [
    listSchedulesTool,
    upsertCronTool,
    upsertFutureSendTool,
    deleteScheduleTool,
  ]
}
