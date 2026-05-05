import { Type } from '@sinclair/typebox'
import { db } from '@electric-ax/agents-runtime'
import {
  createBashTool,
  braveSearchTool,
  createEditTool,
  fetchUrlTool,
  createReadFileTool,
  createWriteTool,
} from '@electric-ax/agents-runtime/tools'
import { WORKER_TOOL_NAMES, createSpawnWorkerTool } from '../tools/spawn-worker'
import {
  REASONING_EFFORT_VALUES,
  resolveBuiltinModelConfig,
  type BuiltinModelCatalog,
} from '../model-catalog'
import type { WorkerToolName } from '../tools/spawn-worker'
import type { AgentTool, StreamFn } from '@mariozechner/pi-agent-core'
import type {
  EntityRegistry,
  HandlerContext,
  SharedStateHandle,
  SharedStateSchemaMap,
  StateCollectionProxy,
} from '@electric-ax/agents-runtime'

interface WorkerArgs {
  systemPrompt: string
  tools: Array<WorkerToolName>
  sharedDb?: { id: string; schema: SharedStateSchemaMap }
  sharedDbToolMode?: `full` | `write-only`
  model?: string
  provider?: string
  reasoningEffort?: string
}

function isWorkerToolName(value: unknown): value is WorkerToolName {
  return (
    typeof value === `string` &&
    (WORKER_TOOL_NAMES as ReadonlyArray<string>).includes(value)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === `object`
}

function parseWorkerArgs(value: Readonly<Record<string, unknown>>): WorkerArgs {
  if (
    typeof value.systemPrompt !== `string` ||
    value.systemPrompt.length === 0
  ) {
    throw new Error(`[worker] systemPrompt is required`)
  }
  const tools: Array<WorkerToolName> = []
  if (Array.isArray(value.tools)) {
    for (const t of value.tools) {
      if (!isWorkerToolName(t)) {
        throw new Error(
          `[worker] unknown tool name: ${JSON.stringify(t)}. Valid tools: ${WORKER_TOOL_NAMES.join(`, `)}`
        )
      }
      if (!tools.includes(t)) tools.push(t)
    }
  }

  const args: WorkerArgs = { systemPrompt: value.systemPrompt, tools }

  if (
    value.sharedDbToolMode === `full` ||
    value.sharedDbToolMode === `write-only`
  ) {
    args.sharedDbToolMode = value.sharedDbToolMode
  }

  if (value.sharedDb !== undefined) {
    if (!isRecord(value.sharedDb)) {
      throw new Error(`[worker] sharedDb must be an object`)
    }
    const { id, schema } = value.sharedDb
    if (typeof id !== `string` || id.length === 0) {
      throw new Error(`[worker] sharedDb.id must be a non-empty string`)
    }
    if (!isRecord(schema)) {
      throw new Error(`[worker] sharedDb.schema must be an object`)
    }
    args.sharedDb = { id, schema: schema as SharedStateSchemaMap }
  }

  if (tools.length === 0 && !args.sharedDb) {
    throw new Error(`[worker] must provide tools and/or sharedDb`)
  }

  if (typeof value.model === `string`) {
    args.model = value.model
  }

  if (typeof value.provider === `string`) {
    args.provider = value.provider
  }

  if (
    typeof value.reasoningEffort === `string` &&
    (REASONING_EFFORT_VALUES as ReadonlyArray<string>).includes(
      value.reasoningEffort
    )
  ) {
    args.reasoningEffort = value.reasoningEffort
  }

  return args
}

function buildToolsForWorker(
  tools: ReadonlyArray<WorkerToolName>,
  workingDirectory: string,
  ctx: HandlerContext,
  readSet: Set<string>
): Array<AgentTool> {
  const out: Array<AgentTool> = []
  for (const name of tools) {
    switch (name) {
      case `bash`:
        out.push(createBashTool(workingDirectory))
        break
      case `read`:
        out.push(createReadFileTool(workingDirectory, readSet))
        break
      case `write`:
        out.push(createWriteTool(workingDirectory, readSet))
        break
      case `edit`:
        out.push(createEditTool(workingDirectory, readSet))
        break
      case `web_search`:
        out.push(braveSearchTool)
        break
      case `fetch_url`:
        out.push(fetchUrlTool)
        break
      case `spawn_worker`:
        out.push(createSpawnWorkerTool(ctx))
        break
    }
  }
  return out
}

const WORKER_PROMPT_FOOTER = `

# Reporting back
When you finish, respond with a concise report covering what was done and any key findings. The caller will relay this to the user, so it only needs the essentials.`

function buildSharedStateTools(
  shared: SharedStateHandle<SharedStateSchemaMap>,
  schema: SharedStateSchemaMap,
  mode: `full` | `write-only`
): Array<AgentTool> {
  const tools: Array<AgentTool> = []

  for (const [collectionName] of Object.entries(schema)) {
    if (collectionName === `id`) continue

    const handle = (shared as Record<string, unknown>)[collectionName] as
      | StateCollectionProxy
      | undefined
    if (!handle) continue

    tools.push({
      name: `write_${collectionName}`,
      label: `Write ${collectionName}`,
      description: `Write an entry to the shared ${collectionName} collection. The data must include a unique 'key' field.`,
      parameters: Type.Object({
        data: Type.Record(Type.String(), Type.Unknown(), {
          description: `The data object to write`,
        }),
      }),
      execute: async (_id, params) => {
        const { data } = params as { data: Record<string, unknown> }
        handle.insert(data)
        return {
          content: [
            {
              type: `text` as const,
              text: `Written to ${collectionName}: ${JSON.stringify(data)}`,
            },
          ],
          details: {},
        }
      },
    })

    if (mode === `write-only`) continue

    tools.push({
      name: `read_${collectionName}`,
      label: `Read ${collectionName}`,
      description: `Read all entries from the shared ${collectionName} collection.`,
      parameters: Type.Object({}),
      execute: async () => {
        const entries = handle.toArray
        return {
          content: [
            { type: `text` as const, text: JSON.stringify(entries, null, 2) },
          ],
          details: {},
        }
      },
    })

    tools.push({
      name: `update_${collectionName}`,
      label: `Update ${collectionName}`,
      description: `Update an existing entry in the shared ${collectionName} collection by key.`,
      parameters: Type.Object({
        key: Type.String({ description: `The key of the entry to update` }),
        data: Type.Record(Type.String(), Type.Unknown(), {
          description: `The fields to update`,
        }),
      }),
      execute: async (_id, params) => {
        const { key, data } = params as {
          key: string
          data: Record<string, unknown>
        }
        try {
          handle.update(key, (draft: Record<string, unknown>) => {
            Object.assign(draft, data)
          })
        } catch (err) {
          return {
            content: [
              {
                type: `text` as const,
                text: `Failed to update ${collectionName} entry "${key}": ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            details: {},
          }
        }
        return {
          content: [
            {
              type: `text` as const,
              text: `Updated ${collectionName} entry "${key}"`,
            },
          ],
          details: {},
        }
      },
    })

    tools.push({
      name: `delete_${collectionName}`,
      label: `Delete ${collectionName}`,
      description: `Delete an entry from the shared ${collectionName} collection by key.`,
      parameters: Type.Object({
        key: Type.String({ description: `The key of the entry to delete` }),
      }),
      execute: async (_id, params) => {
        const { key } = params as { key: string }
        handle.delete(key)
        return {
          content: [
            {
              type: `text` as const,
              text: `Deleted ${collectionName} entry "${key}"`,
            },
          ],
          details: {},
        }
      },
    })
  }

  return tools
}

export function registerWorker(
  registry: EntityRegistry,
  options: {
    workingDirectory: string
    streamFn?: StreamFn
    modelCatalog: BuiltinModelCatalog
  }
): void {
  const { workingDirectory, streamFn, modelCatalog } = options
  registry.define(`worker`, {
    description: `Internal — generic worker spawned by other agents. Configure via spawn args (systemPrompt + tools + optional sharedDb).`,
    async handler(ctx) {
      const args = parseWorkerArgs(ctx.args)
      const readSet = new Set<string>()
      const builtinTools = buildToolsForWorker(
        args.tools,
        workingDirectory,
        ctx,
        readSet
      )
      const modelConfig = resolveBuiltinModelConfig(
        modelCatalog,
        args as unknown as Readonly<Record<string, unknown>>
      )

      const sharedStateTools: Array<AgentTool> = []
      if (args.sharedDb) {
        const shared = (await ctx.observe(
          db(args.sharedDb.id, args.sharedDb.schema)
        )) as SharedStateHandle<SharedStateSchemaMap>
        sharedStateTools.push(
          ...buildSharedStateTools(
            shared,
            args.sharedDb.schema,
            args.sharedDbToolMode ?? `full`
          )
        )
      }

      ctx.useAgent({
        systemPrompt: `${args.systemPrompt}${WORKER_PROMPT_FOOTER}`,
        ...modelConfig,
        tools: [...builtinTools, ...sharedStateTools],
        ...(streamFn && { streamFn }),
      })
      await ctx.agent.run()
    },
  })
}
