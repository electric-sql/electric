import { createBashTool } from '../tools/bash'
import { braveSearchTool } from '../tools/brave-search'
import { createEditTool } from '../tools/edit'
import { fetchUrlTool } from '../tools/fetch-url'
import { createReadFileTool } from '../tools/read-file'
import { WORKER_TOOL_NAMES, createSpawnWorkerTool } from '../tools/spawn-worker'
import { createWriteTool } from '../tools/write'
import { HORTON_MODEL } from './horton'
import type { WorkerToolName } from '../tools/spawn-worker'
import type { AgentTool, StreamFn } from '@mariozechner/pi-agent-core'
import type { EntityRegistry, HandlerContext } from '@electric-ax/agent-runtime'

interface WorkerArgs {
  systemPrompt: string
  tools: Array<WorkerToolName>
}

function isWorkerToolName(value: unknown): value is WorkerToolName {
  return (
    typeof value === `string` &&
    (WORKER_TOOL_NAMES as ReadonlyArray<string>).includes(value)
  )
}

function parseWorkerArgs(value: Readonly<Record<string, unknown>>): WorkerArgs {
  if (
    typeof value.systemPrompt !== `string` ||
    value.systemPrompt.length === 0
  ) {
    throw new Error(`[worker] systemPrompt is required`)
  }
  if (!Array.isArray(value.tools) || value.tools.length === 0) {
    throw new Error(`[worker] tools must be a non-empty array`)
  }
  const tools: Array<WorkerToolName> = []
  for (const t of value.tools) {
    if (!isWorkerToolName(t)) {
      throw new Error(
        `[worker] unknown tool name: ${JSON.stringify(t)}. Valid tools: ${WORKER_TOOL_NAMES.join(`, `)}`
      )
    }
    if (!tools.includes(t)) tools.push(t)
  }
  return { systemPrompt: value.systemPrompt, tools }
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
      case `brave_search`:
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

export function registerWorker(
  registry: EntityRegistry,
  options: { workingDirectory: string; streamFn?: StreamFn }
): void {
  const { workingDirectory, streamFn } = options
  registry.define(`worker`, {
    description: `Internal — generic worker spawned by other agents. Configure via spawn args (systemPrompt + tools).`,
    async handler(ctx) {
      const args = parseWorkerArgs(ctx.args)
      const readSet = new Set<string>()
      const tools = buildToolsForWorker(
        args.tools,
        workingDirectory,
        ctx,
        readSet
      )
      // SECURITY: Workers are sandboxed — they get only the tool subset the
      // spawner chose. ctx.electricTools (cron/send/schedule primitives) are
      // deliberately omitted; the spawner already decided the worker's scope,
      // and granting entity-runtime primitives would let a worker schedule
      // crons, send to arbitrary entities, etc. If a worker needs that, it
      // must spawn its own subagent or report back to the spawner. The
      // `worker-least-privilege.test.ts` regression test asserts this.
      ctx.useAgent({
        systemPrompt: `${args.systemPrompt}${WORKER_PROMPT_FOOTER}`,
        model: HORTON_MODEL,
        tools,
        ...(streamFn && { streamFn }),
      })
      await ctx.agent.run()
    },
  })
}
