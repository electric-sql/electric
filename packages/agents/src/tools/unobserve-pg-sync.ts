import { Type } from '@sinclair/typebox'
import type { HandlerContext } from '@electric-ax/agents-runtime'
import type { AgentTool } from '@earendil-works/pi-agent-core'

function asToolResult(value: unknown) {
  return {
    content: [
      {
        type: `text` as const,
        text:
          typeof value === `string` ? value : JSON.stringify(value, null, 2),
      },
    ],
    details: {},
  }
}

type PgSyncObservation = {
  sourceRef: string
  table?: string
  url?: string
  streamUrl?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === `object` && value !== null && !Array.isArray(value)
}

function listPgSyncObservations(ctx: HandlerContext): Array<PgSyncObservation> {
  const manifests = ctx.db.collections.manifests?.toArray as
    | Array<Record<string, unknown>>
    | undefined
  if (!Array.isArray(manifests)) return []

  const observations: Array<PgSyncObservation> = []
  for (const entry of manifests) {
    if (
      !isRecord(entry) ||
      entry.kind !== `source` ||
      entry.sourceType !== `pgSync` ||
      typeof entry.sourceRef !== `string`
    ) {
      continue
    }
    const config = isRecord(entry.config) ? entry.config : {}
    observations.push({
      sourceRef: entry.sourceRef,
      ...(typeof config.table === `string` ? { table: config.table } : {}),
      ...(typeof config.url === `string` ? { url: config.url } : {}),
      ...(typeof entry.streamUrl === `string`
        ? { streamUrl: entry.streamUrl }
        : {}),
    })
  }
  return observations.sort((left, right) =>
    left.sourceRef.localeCompare(right.sourceRef)
  )
}

export function createUnobservePgSyncTool(ctx: HandlerContext): AgentTool {
  return {
    name: `unobserve_pg_sync`,
    label: `Stop Observing Postgres Sync`,
    description: `Stop being woken by a Postgres shape stream you previously observed with observe_pg_sync. Identify the observation by its sourceRef (preferred) or table. Call with no arguments to list your active pg-sync observations. This only removes your own subscription; any other agents observing the same shape keep their stream.`,
    parameters: Type.Object({
      sourceRef: Type.Optional(
        Type.String({
          description: `The sourceRef returned by observe_pg_sync. Preferred — unambiguous.`,
        })
      ),
      table: Type.Optional(
        Type.String({
          description: `The observed table name. Used only when sourceRef is not given; fails if more than one observation matches.`,
        })
      ),
    }),
    execute: async (_toolCallId, params) => {
      const args = params as { sourceRef?: string; table?: string }
      const observations = listPgSyncObservations(ctx)

      if (!args.sourceRef && !args.table) {
        return asToolResult(
          observations.length > 0
            ? { observations }
            : `You have no active pg-sync observations.`
        )
      }

      let sourceRef = args.sourceRef
      if (!sourceRef) {
        const matches = observations.filter((o) => o.table === args.table)
        if (matches.length === 0) {
          return asToolResult(
            `No active pg-sync observation found for table "${args.table}".`
          )
        }
        if (matches.length > 1) {
          return asToolResult({
            error: `Multiple pg-sync observations match table "${args.table}"; pass a sourceRef instead.`,
            matches,
          })
        }
        sourceRef = matches[0]!.sourceRef
      } else if (!observations.some((o) => o.sourceRef === sourceRef)) {
        return asToolResult(
          `No active pg-sync observation found for sourceRef "${sourceRef}".`
        )
      }

      await ctx.unobserve(sourceRef)
      return asToolResult({ unobserved: true, sourceRef })
    },
  }
}
