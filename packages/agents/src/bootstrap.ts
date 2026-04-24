/**
 * Bootstrap built-in agent types on dev server startup.
 */

import {
  createEntityRegistry,
  createRuntimeHandler,
} from '@electric-ax/agents-runtime'
import { createMcpIntegration } from '@electric-ax/agents-mcp'
import { serverLog } from './log'
import { registerHorton } from './agents/horton'
import { registerWorker } from './agents/worker'
import type {
  AgentTool,
  EntityRegistry,
  EntityStreamDBWithActions,
  RuntimeHandler,
} from '@electric-ax/agents-runtime'
import type { McpIntegration } from '@electric-ax/agents-mcp'
import type { ChangeEvent } from '@durable-streams/state'
import type { StreamFn } from '@mariozechner/pi-agent-core'
import type { IncomingMessage, ServerResponse } from 'node:http'

export const DEFAULT_BUILTIN_AGENT_HANDLER_PATH = `/_electric/builtin-agent-handler`

export interface AgentHandlerResult {
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
  runtime: RuntimeHandler
  registry: EntityRegistry
  typeNames: Array<string>
  mcp: McpIntegration
}

export interface BuiltinAgentHandlerOptions {
  agentServerUrl: string
  serveEndpoint?: string
  workingDirectory?: string
  streamFn?: StreamFn
  createElectricTools?: (context: {
    entityUrl: string
    entityType: string
    args: Readonly<Record<string, unknown>>
    db: EntityStreamDBWithActions
    events: Array<ChangeEvent>
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
  }) => Array<AgentTool> | Promise<Array<AgentTool>>
}

export function createBuiltinAgentHandler(
  options: BuiltinAgentHandlerOptions
): AgentHandlerResult | null {
  const {
    agentServerUrl,
    serveEndpoint = `${agentServerUrl}${DEFAULT_BUILTIN_AGENT_HANDLER_PATH}`,
    workingDirectory,
    streamFn,
    createElectricTools,
  } = options

  if (!streamFn && !process.env.ANTHROPIC_API_KEY) {
    serverLog.warn(
      `[builtin-agents] ANTHROPIC_API_KEY not set — skipping built-in agent registration`
    )
    return null
  }

  const cwd = workingDirectory ?? process.cwd()
  const mcp = createMcpIntegration({ workingDirectory: cwd })
  const registry = createEntityRegistry()
  const typeNames = registerHorton(registry, {
    workingDirectory: cwd,
    streamFn,
    mcp,
  })

  registerWorker(registry, { workingDirectory: cwd, streamFn })
  typeNames.push(`worker`)

  const runtime = createRuntimeHandler({
    baseUrl: agentServerUrl,
    serveEndpoint,
    registry,
    subscriptionPathForType: (name) => `/${name}/*/main`,
    idleTimeout: 5_000,
    createElectricTools,
  })

  return {
    handler: runtime.onEnter,
    runtime,
    registry,
    typeNames,
    mcp,
  }
}

export function createAgentHandler(
  agentServerUrl: string,
  workingDirectory?: string,
  streamFn?: StreamFn,
  createElectricTools?: BuiltinAgentHandlerOptions[`createElectricTools`],
  serveEndpoint?: string
): AgentHandlerResult | null {
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
