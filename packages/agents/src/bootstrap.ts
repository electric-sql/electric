/**
 * Bootstrap built-in agent types on dev server startup.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createEntityRegistry,
  createRuntimeHandler,
  createRuntimeServerClient,
} from '@electric-ax/agents-runtime'
import { serverLog } from './log'
import {
  LocalDockerProvider,
  HostProvider,
  StdioBridge,
  createSpritesProviderIfConfigured,
  registerCodingAgent,
} from '@electric-ax/coding-agents'
import { registerHorton } from './agents/horton'
import { registerWorker } from './agents/worker'
import { createSkillsRegistry } from './skills/registry'
import type {
  AgentTool,
  EntityRegistry,
  EntityStreamDBWithActions,
  RuntimeHandler,
} from '@electric-ax/agents-runtime'
import type { ChangeEvent } from '@durable-streams/state'
import type { StreamFn } from '@mariozechner/pi-agent-core'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SkillsRegistry } from './skills/types'

export const DEFAULT_BUILTIN_AGENT_HANDLER_PATH = `/_electric/builtin-agent-handler`

export interface AgentHandlerResult {
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
  runtime: RuntimeHandler
  registry: EntityRegistry
  typeNames: Array<string>
  skillsRegistry: SkillsRegistry | null
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

export async function createBuiltinAgentHandler(
  options: BuiltinAgentHandlerOptions
): Promise<AgentHandlerResult | null> {
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

  const here = path.dirname(fileURLToPath(import.meta.url))
  const baseSkillsDir = path.resolve(here, `../skills`)

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
  })

  registerWorker(registry, { workingDirectory: cwd, streamFn })
  typeNames.push(`worker`)

  // NEW for Slice A: built-in coding-agent entity (Docker sandbox + lifecycle).
  // The wakeEntity callback (Slice C₁) re-enters the handler after the idle
  // timer destroys the container, so reconcile flips status idle→cold.
  // We use the same RuntimeServerClient HTTP path that user-initiated
  // Pin/Release/Stop traverse — no temporal coupling with createRuntimeHandler.
  const codingAgentClient = createRuntimeServerClient({
    baseUrl: agentServerUrl,
  })
  const spritesProvider = createSpritesProviderIfConfigured()
  if (spritesProvider) {
    serverLog.info(
      `[coding-agent] FlySpriteProvider registered (SPRITES_TOKEN found)`
    )
  }
  registerCodingAgent(registry, {
    providers: {
      sandbox: new LocalDockerProvider(),
      host: new HostProvider(),
      ...(spritesProvider ? { sprites: spritesProvider } : {}),
    },
    bridge: new StdioBridge(),
    wakeEntity: (agentId: string) => {
      void codingAgentClient
        .sendEntityMessage({
          targetUrl: agentId,
          from: `system`,
          type: `lifecycle/idle-eviction-fired`,
          payload: {},
        })
        .catch((err) =>
          serverLog.warn(
            `[coding-agent] wakeEntity(${agentId}) failed: ${err instanceof Error ? err.message : String(err)}`
          )
        )
    },
  })
  typeNames.push(`coding-agent`)

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
