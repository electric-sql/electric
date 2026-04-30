import type { EntityRegistry } from '@electric-ax/agents-runtime'
import { LifecycleManager } from '../lifecycle-manager'
import { WorkspaceRegistry } from '../workspace-registry'
import { SLICE_A_DEFAULTS } from '../types'
import type { Bridge, SandboxProvider } from '../types'
import {
  CODING_AGENT_EVENTS_COLLECTION_TYPE,
  CODING_AGENT_LIFECYCLE_COLLECTION_TYPE,
  CODING_AGENT_RUNS_COLLECTION_TYPE,
  CODING_AGENT_SESSION_META_COLLECTION_TYPE,
  eventRowSchema,
  lifecycleRowSchema,
  runRowSchema,
  sessionMetaRowSchema,
} from './collections'
import {
  destroyMessageSchema,
  pinMessageSchema,
  promptMessageSchema,
  releaseMessageSchema,
  stopMessageSchema,
} from './messages'
import { makeCodingAgentHandler } from './handler'
import { z } from 'zod'

export interface RegisterCodingAgentDeps {
  provider: SandboxProvider
  bridge: Bridge
  /** Override defaults; used by tests. */
  defaults?: Partial<{
    idleTimeoutMs: number
    coldBootBudgetMs: number
    runTimeoutMs: number
  }>
  /** Per-turn env supplier. Defaults to forwarding ANTHROPIC_API_KEY from process.env. */
  env?: () => Record<string, string>
}

const creationArgsSchema = z.object({
  kind: z.enum([`claude`]).optional(),
  workspace: z
    .union([
      z.object({
        type: z.literal(`volume`),
        name: z.string().optional(),
      }),
      z.object({
        type: z.literal(`bindMount`),
        hostPath: z.string(),
      }),
    ])
    .optional(),
  lifecycle: z
    .object({
      idleTimeoutMs: z.number().optional(),
      keepWarm: z.boolean().optional(),
    })
    .optional(),
})

export function registerCodingAgent(
  registry: EntityRegistry,
  deps: RegisterCodingAgentDeps
): void {
  const lm = new LifecycleManager(deps)
  const wr = new WorkspaceRegistry()
  const defaults = {
    idleTimeoutMs:
      deps.defaults?.idleTimeoutMs ?? SLICE_A_DEFAULTS.idleTimeoutMs,
    coldBootBudgetMs:
      deps.defaults?.coldBootBudgetMs ?? SLICE_A_DEFAULTS.coldBootBudgetMs,
    runTimeoutMs: deps.defaults?.runTimeoutMs ?? SLICE_A_DEFAULTS.runTimeoutMs,
  }
  const env =
    deps.env ??
    (() => {
      const out: Record<string, string> = {}
      const k = process.env.ANTHROPIC_API_KEY
      if (k) out.ANTHROPIC_API_KEY = k
      return out
    })

  registry.define(`coding-agent`, {
    description: `Runs a Claude Code CLI session inside a Docker sandbox. Manages lifecycle (cold/idle/running) and workspace lease.`,
    creationSchema: creationArgsSchema,
    inboxSchemas: {
      prompt: promptMessageSchema,
      pin: pinMessageSchema,
      release: releaseMessageSchema,
      stop: stopMessageSchema,
      destroy: destroyMessageSchema,
    },
    state: {
      sessionMeta: {
        schema: sessionMetaRowSchema,
        type: CODING_AGENT_SESSION_META_COLLECTION_TYPE,
        primaryKey: `key`,
      },
      runs: {
        schema: runRowSchema,
        type: CODING_AGENT_RUNS_COLLECTION_TYPE,
        primaryKey: `key`,
      },
      events: {
        schema: eventRowSchema,
        type: CODING_AGENT_EVENTS_COLLECTION_TYPE,
        primaryKey: `key`,
      },
      lifecycle: {
        schema: lifecycleRowSchema,
        type: CODING_AGENT_LIFECYCLE_COLLECTION_TYPE,
        primaryKey: `key`,
      },
    },
    handler: makeCodingAgentHandler(lm, wr, { defaults, env }),
  })
}
