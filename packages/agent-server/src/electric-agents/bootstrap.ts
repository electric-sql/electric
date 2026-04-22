/**
 * Bootstrap built-in agent types on dev server startup.
 */

import {
  createEntityRegistry,
  createRuntimeHandler,
} from '@electric-ax/agent-runtime'
import { serverLog } from '../log'
import { registerHorton } from './agents/horton'
import { registerWorker } from './agents/worker'
import type {
  AgentTool,
  EntityRegistry,
  EntityStreamDBWithActions,
  RuntimeHandler,
} from '@electric-ax/agent-runtime'
import type { ChangeEvent } from '@durable-streams/state'
import type { StreamFn } from '@mariozechner/pi-agent-core'
import type { IncomingMessage, ServerResponse } from 'node:http'

export interface AgentHandlerResult {
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
  runtime: RuntimeHandler
  registry: EntityRegistry
  typeNames: Array<string>
}

export function createAgentHandler(
  baseUrl: string,
  workingDirectory?: string,
  streamFn?: StreamFn,
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
): AgentHandlerResult | null {
  if (!streamFn && !process.env.ANTHROPIC_API_KEY) {
    serverLog.warn(
      `[agent-server] ANTHROPIC_API_KEY not set — skipping built-in agent registration`
    )
    return null
  }

  const cwd = workingDirectory ?? process.cwd()
  const registry = createEntityRegistry()
  const typeNames = registerHorton(registry, {
    workingDirectory: cwd,
    streamFn,
  })

  registerWorker(registry, { workingDirectory: cwd, streamFn })
  typeNames.push(`worker`)

  const runtime = createRuntimeHandler({
    baseUrl,
    serveEndpoint: `${baseUrl}/_electric/agent-handler`,
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
  }
}

export async function registerAgentTypes(
  bootstrap: AgentHandlerResult
): Promise<void> {
  await bootstrap.runtime.registerTypes()

  serverLog.info(
    `[agent-server] ${bootstrap.typeNames.length} built-in agent types ready: ${bootstrap.typeNames.join(`, `)}`
  )
}
