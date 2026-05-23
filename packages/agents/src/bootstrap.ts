/**
 * Bootstrap built-in agent types on dev server startup.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createEntityRegistry,
  createRuntimeHandler,
} from '@electric-ax/agents-runtime'
import { createEventSourceTools } from '@electric-ax/agents-runtime/tools'
import { serverLog } from './log'
import { registerHorton } from './agents/horton'
import { registerWorker } from './agents/worker'
import { createBuiltinModelCatalog } from './model-catalog'
import { createSkillsRegistry } from '@electric-ax/agents-runtime'
import type {
  AgentTool,
  DispatchPolicy,
  EntityRegistry,
  HeadersProvider,
  ProcessWakeConfig,
  RuntimeHandler,
} from '@electric-ax/agents-runtime'
import type { StreamFn } from '@mariozechner/pi-agent-core'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SkillsRegistry } from '@electric-ax/agents-runtime'

export const DEFAULT_BUILTIN_AGENT_HANDLER_PATH = `/_electric/builtin-agent-handler`

export interface AgentHandlerResult {
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
  runtime: RuntimeHandler
  registry: EntityRegistry
  typeNames: Array<string>
  skillsRegistry: SkillsRegistry | null
}

export type BuiltinElectricToolsFactory = NonNullable<
  ProcessWakeConfig[`createElectricTools`]
>

export interface BuiltinAgentHandlerOptions {
  agentServerUrl: string
  serveEndpoint?: string
  workingDirectory?: string
  streamFn?: StreamFn
  publicUrl?: string
  runtimeName?: string
  /** Override for the built-in skills directory; required when embedders bundle this package. */
  baseSkillsDir?: string
  serverHeaders?: HeadersProvider
  defaultDispatchPolicyForType?: (
    typeName: string
  ) => DispatchPolicy | undefined
  createElectricTools?: BuiltinElectricToolsFactory
}

function toolName(tool: AgentTool): string | null {
  return typeof tool.name === `string` ? tool.name : null
}

function dedupeToolsByName(tools: Array<AgentTool>): Array<AgentTool> {
  const seen = new Set<string>()
  const deduped: Array<AgentTool> = []

  for (const tool of tools) {
    const name = toolName(tool)
    if (name && seen.has(name)) continue
    if (name) seen.add(name)
    deduped.push(tool)
  }

  return deduped
}

export function createBuiltinElectricTools(
  custom?: BuiltinElectricToolsFactory
): BuiltinElectricToolsFactory {
  return async (context) => {
    const builtinTools = createEventSourceTools(context)
    const customTools = custom ? await custom(context) : []
    return dedupeToolsByName([...builtinTools, ...customTools])
  }
}

export async function createBuiltinAgentHandler(
  options: BuiltinAgentHandlerOptions
): Promise<AgentHandlerResult | null> {
  const {
    agentServerUrl,
    serveEndpoint,
    workingDirectory,
    streamFn,
    createElectricTools,
    publicUrl,
    runtimeName,
    baseSkillsDir: baseSkillsDirOverride,
    serverHeaders,
    defaultDispatchPolicyForType,
  } = options

  const modelCatalog = await createBuiltinModelCatalog({
    allowMockFallback: Boolean(streamFn),
  })

  if (!modelCatalog) {
    serverLog.warn(
      `[builtin-agents] no supported model provider API key found — set ANTHROPIC_API_KEY or OPENAI_API_KEY`
    )
    return null
  }

  const cwd = workingDirectory ?? process.cwd()

  const here = path.dirname(fileURLToPath(import.meta.url))
  const baseSkillsDir = baseSkillsDirOverride ?? path.resolve(here, `../skills`)

  let skillsRegistry: SkillsRegistry | null = null
  try {
    skillsRegistry = await createSkillsRegistry({
      baseSkillsDir,
      appSkillsDir: path.resolve(cwd, `skills`),
      cacheDir: path.resolve(cwd, `.electric-agents`),
    })
    if (skillsRegistry.catalog.size > 0) {
      serverLog.info(
        `[electric-agents] ${skillsRegistry.catalog.size} skill(s) loaded: ${Array.from(skillsRegistry.catalog.keys()).join(`, `)}`
      )
    }
  } catch (err) {
    serverLog.warn(
      `[electric-agents] skills registry failed to initialize: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  const registry = createEntityRegistry()
  const typeNames = registerHorton(registry, {
    workingDirectory: cwd,
    streamFn,
    skillsRegistry,
    modelCatalog,
  })

  registerWorker(registry, { workingDirectory: cwd, streamFn, modelCatalog })
  typeNames.push(`worker`)

  const runtime = createRuntimeHandler({
    baseUrl: agentServerUrl,
    serveEndpoint,
    registry,
    subscriptionPathForType: (name) => `/${name}/*/main`,
    defaultDispatchPolicyForType,
    serverHeaders,
    idleTimeout: 5 * 60_000,
    createElectricTools: createBuiltinElectricTools(createElectricTools),
    publicUrl,
    name: runtimeName ?? `builtin-agents`,
  })

  return {
    handler: runtime.onEnter,
    runtime,
    registry,
    typeNames,
    skillsRegistry,
  }
}

export async function createAgentHandler(
  agentServerUrl: string,
  workingDirectory?: string,
  streamFn?: StreamFn,
  createElectricTools?: BuiltinAgentHandlerOptions[`createElectricTools`],
  serveEndpoint?: string
): Promise<AgentHandlerResult | null> {
  return createBuiltinAgentHandler({
    agentServerUrl,
    serveEndpoint,
    workingDirectory,
    streamFn,
    createElectricTools,
  })
}

export async function registerBuiltinAgentTypes(
  bootstrap: AgentHandlerResult
): Promise<void> {
  await bootstrap.runtime.registerTypes()

  serverLog.info(
    `[builtin-agents] ${bootstrap.typeNames.length} built-in agent types ready: ${bootstrap.typeNames.join(`, `)}`
  )
}

export const registerAgentTypes = registerBuiltinAgentTypes
