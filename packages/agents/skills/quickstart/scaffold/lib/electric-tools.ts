import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@electric-ax/agents-runtime'

type CreateElectricToolsContext = {
  entityUrl: string
  entityType: string
  args: Readonly<Record<string, unknown>>
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
}

export function createElectricTools(
  ctx: CreateElectricToolsContext
): Array<AgentTool> {
  return [
    {
      name: `upsert_cron_schedule`,
      label: `Upsert Cron`,
      description: `Create or update a recurring cron wake schedule.`,
      parameters: Type.Object({
        id: Type.String({ description: `Stable schedule identifier` }),
        expression: Type.String({ description: `Cron expression` }),
        timezone: Type.Optional(Type.String({ description: `IANA timezone` })),
        payload: Type.Any({ description: `Instruction for the agent` }),
      }),
      execute: async (_toolCallId, params) => {
        const { id, expression, timezone, payload } = params as any
        const tz = timezone ?? `UTC`
        const { txid } = await ctx.upsertCronSchedule({
          id,
          expression,
          timezone: tz,
          payload,
        })
        return {
          content: [
            { type: `text` as const, text: `Cron "${id}" set. txid=${txid}` },
          ],
          details: { txid },
        }
      },
    },
    {
      name: `delete_schedule`,
      label: `Delete Schedule`,
      description: `Delete a schedule by id.`,
      parameters: Type.Object({
        id: Type.String({ description: `Schedule identifier` }),
      }),
      execute: async (_toolCallId, params) => {
        const { id } = params as { id: string }
        const { txid } = await ctx.deleteSchedule({ id })
        return {
          content: [
            {
              type: `text` as const,
              text: `Schedule "${id}" deleted. txid=${txid}`,
            },
          ],
          details: { txid },
        }
      },
    },
  ]
}
