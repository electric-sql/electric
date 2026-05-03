import type { EntityRegistry } from '@electric-ax/agents-runtime'
import { getAdapter } from '../agents/registry'
import { LifecycleManager } from '../lifecycle-manager'
import { WorkspaceRegistry } from '../workspace-registry'
import { SLICE_A_DEFAULTS } from '../types'
import type { Bridge, CodingAgentKind, SandboxProvider } from '../types'
import {
  CODING_AGENT_EVENTS_COLLECTION_TYPE,
  CODING_AGENT_LIFECYCLE_COLLECTION_TYPE,
  CODING_AGENT_NATIVE_JSONL_COLLECTION_TYPE,
  CODING_AGENT_RUNS_COLLECTION_TYPE,
  CODING_AGENT_SESSION_META_COLLECTION_TYPE,
  eventRowSchema,
  lifecycleRowSchema,
  nativeJsonlRowSchema,
  runRowSchema,
  sessionMetaRowSchema,
} from './collections'
import {
  convertKindMessageSchema,
  convertTargetMessageSchema,
  destroyMessageSchema,
  idleEvictionFiredMessageSchema,
  initNudgeMessageSchema,
  pinMessageSchema,
  promptMessageSchema,
  releaseMessageSchema,
  stopMessageSchema,
} from './messages'
import { makeCodingAgentHandler } from './handler'
import { z } from 'zod'

export interface RegisterCodingAgentDeps {
  providers: {
    sandbox: SandboxProvider
    host: SandboxProvider
    sprites?: SandboxProvider
  }
  bridge: Bridge
  /** Override defaults; used by tests. */
  defaults?: Partial<{
    idleTimeoutMs: number
    coldBootBudgetMs: number
    runTimeoutMs: number
  }>
  /**
   * Per-turn env supplier, called once the handler knows the agent's
   * kind. Default forwards each adapter's `defaultEnvVars` from
   * process.env.
   */
  env?: (kind: CodingAgentKind) => Record<string, string>
  /**
   * Posts a self-message to the entity. Used by the idle timer to
   * re-enter the handler after destroying the container, so reconcile
   * flips status idle→cold. Bootstrap supplies this once the runtime
   * is constructed.
   */
  wakeEntity?: (agentId: string) => void
}

// NOTE: Flat shape (no nested objects, no unions). The agents-server-ui's
// SpawnArgsDialog only renders simple JSON-Schema property types
// (string/number/boolean/enum) — nested objects and unions don't render
// at all and the dialog rejects the request. The handler reconstructs
// the nested workspace shape from these flat fields on first-wake init.
const creationArgsSchema = z.object({
  kind: z.enum([`claude`, `codex`, `opencode`]).optional(),
  model: z.string().optional(),
  target: z.enum([`sandbox`, `host`, `sprites`]).optional(),
  workspaceType: z.enum([`volume`, `bindMount`]).optional(),
  /** For workspaceType='volume'. Defaults to slug(agentId) when omitted. */
  workspaceName: z.string().optional(),
  /** For workspaceType='bindMount'. Required when workspaceType='bindMount'. */
  workspaceHostPath: z.string().optional(),
  importNativeSessionId: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/, `session id must be alphanumeric (with - or _)`)
    .optional(),
  idleTimeoutMs: z.number().optional(),
  keepWarm: z.boolean().optional(),
  fromAgentId: z.string().optional(),
  fromWorkspaceMode: z.enum([`share`, `clone`, `fresh`]).optional(),
})

export function registerCodingAgent(
  registry: EntityRegistry,
  deps: RegisterCodingAgentDeps
): void {
  const lm = new LifecycleManager({
    providers: deps.providers,
    bridge: deps.bridge,
  })
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
    ((kind: CodingAgentKind) => {
      const adapter = getAdapter(kind)
      const out: Record<string, string> = {}
      for (const k of adapter.defaultEnvVars) {
        const v = process.env[k]
        if (v) out[k] = v
      }
      return out
    })

  registry.define(`coding-agent`, {
    description: `Runs a Claude Code CLI session via Docker (target='sandbox') or directly on the host (target='host'). Manages lifecycle (cold/idle/running) and workspace lease.`,
    creationSchema: creationArgsSchema,
    inboxSchemas: {
      prompt: promptMessageSchema,
      pin: pinMessageSchema,
      release: releaseMessageSchema,
      stop: stopMessageSchema,
      destroy: destroyMessageSchema,
      'lifecycle/idle-eviction-fired': idleEvictionFiredMessageSchema,
      'lifecycle/init': initNudgeMessageSchema,
      'convert-target': convertTargetMessageSchema,
      'convert-kind': convertKindMessageSchema,
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
      nativeJsonl: {
        schema: nativeJsonlRowSchema,
        type: CODING_AGENT_NATIVE_JSONL_COLLECTION_TYPE,
        primaryKey: `key`,
      },
    },
    handler: makeCodingAgentHandler(lm, wr, {
      defaults,
      env,
      wakeEntity: deps.wakeEntity,
    }),
  })
}
