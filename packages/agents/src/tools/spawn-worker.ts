import { Type } from '@sinclair/typebox'
import { customAlphabet } from 'nanoid'
import { serverLog } from '../log'
import type { BuiltinAgentModelConfig } from '../model-catalog'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type {
  HandlerContext,
  ManifestDocumentEntry,
} from '@electric-ax/agents-runtime'

export const MARKDOWN_WORKER_TOOL_NAMES = [
  `create_markdown_doc`,
  `set_markdown_doc_cursor`,
  `insert_markdown_doc`,
  `replace_markdown_doc_range`,
  `read_markdown_doc`,
  `write_markdown_doc`,
  `edit_markdown_doc`,
] as const

export const WORKER_TOOL_NAMES = [
  `bash`,
  `read`,
  `write`,
  `edit`,
  `web_search`,
  `fetch_url`,
  `spawn_worker`,
  `send`,
  ...MARKDOWN_WORKER_TOOL_NAMES,
] as const

export type WorkerToolName = (typeof WORKER_TOOL_NAMES)[number]

const EXISTING_MARKDOWN_WORKER_TOOL_NAMES = new Set<string>(
  MARKDOWN_WORKER_TOOL_NAMES.filter((name) => name !== `create_markdown_doc`)
)
const workerIdSuffix = customAlphabet(`0123456789abcdefghijklmnopqrstuvwxyz`, 6)
const WORKER_ID_MAX_SLUG_LENGTH = 48
const WORKER_ID_STOP_WORDS = new Set([
  `a`,
  `an`,
  `and`,
  `are`,
  `as`,
  `at`,
  `be`,
  `by`,
  `can`,
  `do`,
  `for`,
  `from`,
  `have`,
  `in`,
  `into`,
  `it`,
  `of`,
  `on`,
  `or`,
  `please`,
  `the`,
  `this`,
  `to`,
  `with`,
  `you`,
])

function isManifestDocumentEntry(
  value: unknown
): value is ManifestDocumentEntry {
  if (!value || typeof value !== `object`) return false
  const entry = value as Partial<ManifestDocumentEntry>
  return (
    entry.kind === `document` &&
    typeof entry.id === `string` &&
    entry.provider === `y-durable-streams` &&
    typeof entry.docPath === `string` &&
    typeof entry.streamPath === `string` &&
    entry.transportMimeType ===
      `application/vnd.electric-agents.markdown-yjs` &&
    entry.contentMimeType === `text/markdown` &&
    entry.yTextName === `markdown` &&
    typeof entry.title === `string`
  )
}

function manifestMarkdownDocuments(
  ctx: HandlerContext
): Array<ManifestDocumentEntry> {
  const manifests = ctx.db?.collections?.manifests?.toArray as
    | Array<unknown>
    | undefined
  const injectedDocs = Array.isArray(ctx.args?.markdownDocs)
    ? ctx.args.markdownDocs.filter(isManifestDocumentEntry)
    : []
  const docsById = new Map(
    [
      ...(manifests?.filter(isManifestDocumentEntry) ?? []),
      ...injectedDocs,
    ].map((document) => [document.id, document])
  )
  return [...docsById.values()]
}

function usesExistingMarkdownDocumentTool(
  tools: ReadonlyArray<WorkerToolName>
): boolean {
  return tools.some((tool) => EXISTING_MARKDOWN_WORKER_TOOL_NAMES.has(tool))
}

function workerIdSlug(...sources: Array<string | undefined>): string {
  const words = sources
    .join(` `)
    .normalize(`NFKD`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ` `)
    .trim()
    .split(/\s+/)
    .filter(
      (word) =>
        word.length > 0 &&
        !WORKER_ID_STOP_WORDS.has(word) &&
        !/^\d+$/.test(word)
    )
    .slice(0, 8)
  const slug = words.join(`-`).slice(0, WORKER_ID_MAX_SLUG_LENGTH)
  return slug.replace(/-+$/g, ``) || `worker`
}

function descriptiveWorkerId(opts: {
  name?: string
  systemPrompt: string
  initialMessage: string
}): string {
  const slug =
    typeof opts.name === `string` && opts.name.trim().length > 0
      ? workerIdSlug(opts.name)
      : workerIdSlug(opts.systemPrompt, opts.initialMessage)
  return `${slug}-${workerIdSuffix()}`
}

function selectedMarkdownDocuments(
  ctx: HandlerContext,
  ids: ReadonlyArray<string> | undefined
): { documents: Array<ManifestDocumentEntry>; missing: Array<string> } {
  if (!ids || ids.length === 0) return { documents: [], missing: [] }
  const docsById = new Map(
    manifestMarkdownDocuments(ctx).map((document) => [document.id, document])
  )
  const documents: Array<ManifestDocumentEntry> = []
  const missing: Array<string> = []
  for (const id of [...new Set(ids)]) {
    const document = docsById.get(id)
    if (document) {
      documents.push(document)
    } else {
      missing.push(id)
    }
  }
  return { documents, missing }
}

export function createSpawnWorkerTool(
  ctx: HandlerContext,
  modelConfig?: BuiltinAgentModelConfig
): AgentTool {
  return {
    name: `spawn_worker`,
    label: `Spawn Worker`,
    description: `Dispatch a subagent (worker) to perform an isolated subtask. Provide a brief system prompt to give it its role and then a detailed initialMessage which briefs the worker like a colleague who just walked into the room (file paths, line numbers, what specifically to do, what form of answer you want back) and pick the subset of tools the worker needs.`,
    executionMode: `sequential`,
    parameters: Type.Object({
      systemPrompt: Type.String({
        description: `System prompt for the worker.`,
      }),
      name: Type.Optional(
        Type.String({
          description: `Optional short descriptive worker name. It is sanitized for the worker URL and a random suffix is added automatically.`,
        })
      ),
      tools: Type.Array(
        Type.Union(WORKER_TOOL_NAMES.map((n) => Type.Literal(n))),
        {
          description: `Subset of tool names to enable for the worker. Must include at least one.`,
        }
      ),
      initialMessage: Type.String({
        description: `First user message sent to the worker. Be concrete: include file paths, line numbers, and the form of answer you want back. This is what kicks off its run — without it the worker will idle. Describe the concrete task to perform and what form of message you want back.`,
      }),
      markdownDocIds: Type.Optional(
        Type.Array(Type.String(), {
          description: `Optional collaborative markdown document ids from this entity's manifest to make available to the worker. If omitted, current markdown docs are automatically made available when the worker has tools that read or edit existing markdown docs. Include the matching markdown tools in tools when the worker should read or edit them.`,
        })
      ),
    }),
    execute: async (_toolCallId, params) => {
      const { systemPrompt, name, tools, initialMessage, markdownDocIds } =
        params as {
          systemPrompt: string
          name?: string
          tools: Array<WorkerToolName>
          initialMessage: string
          markdownDocIds?: Array<string>
        }
      if (!Array.isArray(tools) || tools.length === 0) {
        return {
          content: [
            {
              type: `text` as const,
              text: `Error: provide at least one tool for the worker.`,
            },
          ],
          details: { spawned: false },
        }
      }
      if (typeof initialMessage !== `string` || initialMessage.length === 0) {
        return {
          content: [
            {
              type: `text` as const,
              text: `Error: initialMessage is required and must be a non-empty string.`,
            },
          ],
          details: { spawned: false },
        }
      }
      const { documents: markdownDocs, missing: missingMarkdownDocIds } =
        markdownDocIds
          ? selectedMarkdownDocuments(ctx, markdownDocIds)
          : {
              documents: usesExistingMarkdownDocumentTool(tools)
                ? manifestMarkdownDocuments(ctx)
                : [],
              missing: [],
            }
      if (missingMarkdownDocIds.length > 0) {
        return {
          content: [
            {
              type: `text` as const,
              text: `Error: markdown document ids not found in this entity's manifest: ${missingMarkdownDocIds.join(`, `)}.`,
            },
          ],
          details: {
            spawned: false,
            missingMarkdownDocIds,
          },
        }
      }

      const id = descriptiveWorkerId({ name, systemPrompt, initialMessage })
      const workerModelArgs = modelConfig
        ? {
            provider: modelConfig.provider,
            model: modelConfig.model,
            ...(modelConfig.reasoningEffort && {
              reasoningEffort: modelConfig.reasoningEffort,
            }),
          }
        : {}
      try {
        const handle = await ctx.spawn(
          `worker`,
          id,
          {
            systemPrompt,
            tools,
            ...(markdownDocs.length > 0 ? { markdownDocs } : {}),
            ...workerModelArgs,
          },
          {
            initialMessage,
            wake: { on: `runFinished`, includeResponse: true },
            // Run the worker in the parent's sandbox so they share one
            // filesystem. No-op when the parent has no shareable sandbox.
            sandbox: `inherit`,
          }
        )
        const workerUrl = handle.entityUrl

        return {
          content: [
            {
              type: `text` as const,
              text: `Worker dispatched at ${workerUrl}. End your turn — when you next wake, the wake message will tell you the worker has finished and include its response.`,
            },
          ],
          details: { spawned: true, workerUrl },
        }
      } catch (err) {
        serverLog.warn(
          `[spawn_worker tool] failed to spawn worker ${id}: ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err : undefined
        )
        return {
          content: [
            {
              type: `text` as const,
              text: `Error spawning worker: ${err instanceof Error ? err.message : `Unknown error`}`,
            },
          ],
          details: { spawned: false },
        }
      }
    },
  }
}
