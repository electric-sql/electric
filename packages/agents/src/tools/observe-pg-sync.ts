import { Type } from '@sinclair/typebox'
import {
  getPgSyncStreamPath,
  pgSync,
  type HandlerContext,
} from '@electric-ax/agents-runtime'
import type { AgentTool } from '@mariozechner/pi-agent-core'

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

const PgSyncOperation = Type.Union([
  Type.Literal(`insert`),
  Type.Literal(`update`),
  Type.Literal(`delete`),
])

export function createObservePgSyncTool(ctx: HandlerContext): AgentTool {
  return {
    name: `observe_pg_sync`,
    label: `Observe Postgres Sync`,
    description: `Observe an Electric Postgres shape stream and wake this agent when matching row changes arrive. Requires the HTTP(S) URL of an Electric shape endpoint — ask the user for it if you don't know it. Registration validates the endpoint up front and fails with Electric's error if the shape can't be fetched.`,
    parameters: Type.Object({
      url: Type.String({
        description: `HTTP(S) URL of the Electric shape endpoint, e.g. http://localhost:3000/v1/shape. Not a postgres:// connection string. Never guess this — ask the user if it hasn't been provided.`,
      }),
      table: Type.String({
        minLength: 1,
        pattern: `\\S`,
        description: `Postgres table name to observe.`,
      }),
      columns: Type.Optional(
        Type.Array(Type.String(), {
          description: `Optional list of columns to include in the shape.`,
        })
      ),
      where: Type.Optional(
        Type.String({ description: `Optional Electric shape WHERE clause.` })
      ),
      params: Type.Optional(
        Type.Union([
          Type.Array(Type.String()),
          Type.Record(Type.String(), Type.String()),
        ])
      ),
      replica: Type.Optional(
        Type.Union([Type.Literal(`default`), Type.Literal(`full`)])
      ),
      wake: Type.Optional(
        Type.Object(
          {
            ops: Type.Optional(Type.Array(PgSyncOperation)),
            debounceMs: Type.Optional(Type.Number()),
          },
          { additionalProperties: false }
        )
      ),
    }),
    execute: async (_toolCallId, params) => {
      const args = params as {
        url: string
        table: string
        columns?: string[]
        where?: string
        params?: string[] | Record<string, string>
        replica?: `default` | `full`
        wake?: {
          ops?: Array<`insert` | `update` | `delete`>
          debounceMs?: number
        }
      }

      if (typeof args.url !== `string` || args.url.trim().length === 0) {
        throw new Error(`url is required`)
      }

      if (typeof args.table !== `string` || args.table.trim().length === 0) {
        throw new Error(`table is required`)
      }

      const source = pgSync({
        url: args.url,
        table: args.table,
        columns: args.columns,
        where: args.where,
        params: args.params,
        replica: args.replica,
      })
      const wake = {
        on: `change` as const,
        ...(args.wake?.ops ? { ops: args.wake.ops } : {}),
        ...(args.wake?.debounceMs !== undefined
          ? { debounceMs: args.wake.debounceMs }
          : {}),
      }

      const handle = await ctx.observe(source, { wake })

      return asToolResult({
        sourceRef: handle.sourceRef,
        streamUrl: handle.streamUrl ?? getPgSyncStreamPath(handle.sourceRef),
        wake,
      })
    },
  }
}
