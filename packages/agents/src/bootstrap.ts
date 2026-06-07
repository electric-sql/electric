/**
 * Bootstrap built-in agent types on dev server startup.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createEntityRegistry,
  createRuntimeHandler,
} from '@electric-ax/agents-runtime'
import {
  createEventSourceTools,
  createMarkdownDocumentTools,
} from '@electric-ax/agents-runtime/tools'
import {
  chooseDefaultSandbox,
  isE2BAvailable,
  remoteSandbox,
  type SandboxProfile,
} from '@electric-ax/agents-runtime/sandbox'
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
  enabledModelValues?: ReadonlyArray<string> | null
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
    const builtinTools = [
      ...createEventSourceTools(context),
      ...createMarkdownDocumentTools(context),
    ]
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
    enabledModelValues,
    createElectricTools,
    publicUrl,
    runtimeName,
    baseSkillsDir: baseSkillsDirOverride,
    serverHeaders,
    defaultDispatchPolicyForType,
  } = options

  const modelCatalog = await createBuiltinModelCatalog({
    allowMockFallback: Boolean(streamFn),
    enabledModelValues,
  })

  if (!modelCatalog) {
    serverLog.warn(
      `[builtin-agents] no supported model provider API key found — set ANTHROPIC_API_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY, or MOONSHOT_API_KEY`
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

  const sandboxProfiles = await buildBuiltinSandboxProfiles(cwd)

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
    sandboxProfiles,
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

/**
 * Guard so repeated `buildBuiltinSandboxProfiles` calls in one process don't
 * re-run the boot sweep.
 */
let dockerSweptOnBoot = false

type SweepOrphanedDockerSandboxes =
  // eslint-disable-next-line quotes -- type-position import() requires a string literal
  (typeof import('@electric-ax/agents-runtime/sandbox/docker'))['sweepOrphanedDockerSandboxes']

function sweepOrphanedDockerSandboxesOnce(
  sweep: SweepOrphanedDockerSandboxes
): void {
  if (dockerSweptOnBoot) return
  dockerSweptOnBoot = true
  // One-shot, at boot: reclaim any sandbox containers a previous (crashed)
  // process left behind. Fire-and-forget — nothing is acquired yet, and within
  // a live process shared containers are stopped (not removed) when idle.
  sweep()
    .then((removed) => {
      if (removed.length > 0) {
        serverLog.info(
          `[builtin-agents] docker sandbox boot sweep removed ${removed.length} leftover container(s)`
        )
      }
    })
    .catch((err) =>
      serverLog.warn(
        `[builtin-agents] docker sandbox boot sweep error: ${err instanceof Error ? err.message : String(err)}`
      )
    )
}

/**
 * Built-in sandbox profiles. `local` is always available. `docker` is
 * gated on Docker being reachable so a user without Docker installed
 * sees only what works — the UI never offers a non-functional choice.
 */
async function buildBuiltinSandboxProfiles(
  workingDirectory: string
): Promise<Array<SandboxProfile>> {
  const profiles: Array<SandboxProfile> = [
    {
      name: `local`,
      label: `Local`,
      description: `Runs on the host without isolation. Full filesystem access.`,
      factory: ({ args }) =>
        chooseDefaultSandbox(resolveCwd(args, workingDirectory)),
    },
  ]

  try {
    const { isDockerAvailable } = await import(
      `@electric-ax/agents-runtime/sandbox/docker`
    )
    if (await isDockerAvailable()) {
      const { dockerSandbox, sweepOrphanedDockerSandboxes } = await import(
        `@electric-ax/agents-runtime/sandbox/docker`
      )
      // Reclaim containers a previous crashed process may have left running.
      // No periodic reaper: within a live process, shared containers stop
      // themselves a short while after their last lease disposes (debounced
      // idle-stop), and ephemeral ones are killed on dispose.
      sweepOrphanedDockerSandboxesOnce(sweepOrphanedDockerSandboxes)
      profiles.push({
        name: `docker`,
        label: `Docker`,
        description: `Runs in a hardened Docker container: dropped capabilities, no privilege escalation, and CPU/memory/process limits. The chosen working directory is mounted read-write and, by default, network egress is unrestricted (allow-all).`,
        factory: ({
          args,
          sandboxKey,
          persistent,
          owner,
          entityType,
          entityUrl,
        }) => {
          const cwd = readWorkingDirectoryArg(args)
          return dockerSandbox({
            // Default to open egress for local development. Network policy is a
            // capability of this profile, not a separate profile: like the
            // working directory above, it can be made a per-spawn arg later so a
            // single `docker` profile spans permissive → fully-isolated rather
            // than splitting into `docker-permissive` / `docker-isolated`.
            initialNetworkPolicy: { mode: `allow-all` },
            extraMounts: cwd
              ? [{ hostPath: cwd, containerPath: `/work`, readOnly: false }]
              : undefined,
            // The container is always named-by-key and reattachable; `persistent`
            // chooses idle teardown (stop vs remove) and `owner` gates creation
            // (an attacher reattaches only). All resolved upstream from config.
            sandboxKey,
            persistent,
            owner,
            // Observability: tag the container/labels with who spawned it.
            entityType,
            entityUrl,
          })
        },
      })
    } else {
      serverLog.info(
        `[builtin-agents] docker daemon not reachable — docker sandbox profile not registered`
      )
    }
  } catch (err) {
    serverLog.warn(
      `[builtin-agents] failed to probe docker availability: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  // e2b is a remote provider: gated on an API key (the same way docker is
  // gated on a reachable daemon) plus the optional `e2b` peer dep being
  // installed, so we never advertise a profile that can't run.
  if (process.env.E2B_API_KEY) {
    if (await isE2BAvailable()) {
      profiles.push({
        name: `e2b`,
        label: `E2B`,
        description: `Runs in a remote E2B microVM. Persistent sandboxes survive across wakes and are reachable from any runner.`,
        // Off-host: the server skips the single-runner co-location guard for
        // keyed sandboxes on this profile (any runner can reach the VM).
        remote: true,
        factory: ({ sandboxKey, persistent, owner }) =>
          remoteSandbox({
            provider: `e2b`,
            apiKey: process.env.E2B_API_KEY,
            // Always reattachable by key; `persistent` chooses whether dispose
            // suspends (preserves) or kills, and `owner` gates creation (an
            // attacher reconnects only).
            sandboxKey,
            persistent,
            owner,
            initialNetworkPolicy: { mode: `allow-all` },
          }),
      })
    } else {
      serverLog.info(
        `[builtin-agents] E2B_API_KEY set but the "e2b" package is not installed — e2b sandbox profile not registered`
      )
    }
  }

  // console.log (not serverLog): visible in the Electron main process, where
  // the pino-based serverLog transport doesn't render.
  console.log(
    `[builtin-agents] sandbox profiles advertised: ${profiles.map((p) => p.name).join(`, `)}`
  )
  return profiles
}

function readWorkingDirectoryArg(
  args: Readonly<Record<string, unknown>>
): string | null {
  const v = args.workingDirectory
  return typeof v === `string` && v.trim().length > 0 ? v : null
}

function resolveCwd(
  args: Readonly<Record<string, unknown>>,
  fallback: string
): string {
  return readWorkingDirectoryArg(args) ?? fallback
}
