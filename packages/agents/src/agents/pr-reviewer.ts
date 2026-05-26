import { db } from '@electric-ax/agents-runtime'
import type {
  EntityRegistry,
  HandlerContext,
  SharedStateSchemaMap,
} from '@electric-ax/agents-runtime'
import {
  createBashTool,
  createEditTool,
  createReadFileTool,
  createWriteTool,
  fetchUrlTool,
} from '@electric-ax/agents-runtime/tools'
import { Type } from '@sinclair/typebox'
import type { AgentTool, StreamFn } from '@mariozechner/pi-agent-core'
import {
  PrBlackboardSchema,
  type PrMetaRow,
  type SignalRow,
} from './pr-shared/blackboard-schema'
import { buildWorkerPrelude } from './pr-shared/prelude'
import {
  resolveBuiltinModelConfig,
  type BuiltinModelCatalog,
} from '../model-catalog'
import { createSkillTools } from '../skills/tools'
import type { SkillsRegistry } from '../skills/types'

export interface PrWorkerArgs {
  repo: string
  number: number
  head_branch: string
  base_branch: string
  worktree_path: string
  blackboard: { id: string }
}

export interface PrWorkerDeps {
  workingDirectory: string
  modelCatalog: BuiltinModelCatalog
  skillsRegistry?: SkillsRegistry | null
  streamFn?: StreamFn
}

interface PrBoardHandle {
  pr_meta: { toArray: ReadonlyArray<PrMetaRow> }
  signals: {
    toArray: ReadonlyArray<SignalRow>
    insert: (row: SignalRow) => void
    update: (key: string, mutate: (draft: SignalRow) => void) => void
    delete: (key: string) => void
  }
  [k: string]: unknown
}

type WorkerRole = `reviewer` | `build-doctor` | `doc-editor`
type WorkerEntityType = `pr-reviewer` | `pr-build-doctor` | `pr-doc-editor`

function pickWakeSignal(
  signals: ReadonlyArray<SignalRow>,
  role: WorkerRole
): SignalRow | null {
  for (let i = signals.length - 1; i >= 0; i--) {
    const s = signals[i]!
    if (!s.consumed_by.includes(role)) return s
  }
  return null
}

interface CollectionHandle {
  toArray: ReadonlyArray<unknown>
  insert: (row: unknown) => void
  update: (
    key: string,
    mutate: (draft: Record<string, unknown>) => void
  ) => void
  delete: (key: string) => void
}

function buildSharedStateTools(board: PrBoardHandle): Array<AgentTool> {
  const tools: Array<AgentTool> = []
  for (const collection of Object.keys(PrBlackboardSchema)) {
    const handle = board[collection] as CollectionHandle | undefined
    if (!handle) continue
    tools.push({
      name: `write_${collection}`,
      label: `Write ${collection}`,
      description: `Insert a row into shared collection "${collection}". Data must include "key".`,
      parameters: Type.Object({
        data: Type.Record(Type.String(), Type.Unknown()),
      }),
      execute: async (_id, params) => {
        const { data } = params as { data: Record<string, unknown> }
        handle.insert(data)
        return {
          content: [
            {
              type: `text` as const,
              text: `Wrote to ${collection}`,
            },
          ],
          details: {},
        }
      },
    })
    tools.push({
      name: `read_${collection}`,
      label: `Read ${collection}`,
      description: `Read all rows from shared collection "${collection}".`,
      parameters: Type.Object({}),
      execute: async () => ({
        content: [
          {
            type: `text` as const,
            text: JSON.stringify(handle.toArray, null, 2),
          },
        ],
        details: {},
      }),
    })
    tools.push({
      name: `update_${collection}`,
      label: `Update ${collection}`,
      description: `Update an existing row in "${collection}" by key.`,
      parameters: Type.Object({
        key: Type.String(),
        data: Type.Record(Type.String(), Type.Unknown()),
      }),
      execute: async (_id, params) => {
        const { key, data } = params as {
          key: string
          data: Record<string, unknown>
        }
        handle.update(key, (draft) => Object.assign(draft, data))
        return {
          content: [
            {
              type: `text` as const,
              text: `Updated ${collection}[${key}]`,
            },
          ],
          details: {},
        }
      },
    })
    tools.push({
      name: `delete_${collection}`,
      label: `Delete ${collection}`,
      description: `Delete a row from "${collection}" by key.`,
      parameters: Type.Object({ key: Type.String() }),
      execute: async (_id, params) => {
        const { key } = params as { key: string }
        handle.delete(key)
        return {
          content: [
            {
              type: `text` as const,
              text: `Deleted ${collection}[${key}]`,
            },
          ],
          details: {},
        }
      },
    })
  }
  return tools
}

export function registerPrReviewer(
  registry: EntityRegistry,
  deps: PrWorkerDeps
): void {
  registerPrWorker(registry, `pr-reviewer`, `reviewer`, deps)
}

export function registerPrWorker(
  registry: EntityRegistry,
  entityType: WorkerEntityType,
  role: WorkerRole,
  deps: PrWorkerDeps
): void {
  const {
    workingDirectory: _workingDirectory,
    modelCatalog,
    skillsRegistry,
    streamFn,
  } = deps
  void _workingDirectory
  registry.define(entityType, {
    description: `PR shepherd ${role} — reactive worker on a per-PR blackboard`,
    async handler(ctx: HandlerContext) {
      const args = ctx.args as unknown as PrWorkerArgs
      const board = (await ctx.observe(
        db(
          args.blackboard.id,
          PrBlackboardSchema as unknown as SharedStateSchemaMap
        ),
        { wake: { on: `change`, collections: [`signals`] } }
      )) as unknown as PrBoardHandle

      const signal = pickWakeSignal(board.signals.toArray, role)
      const meta = board.pr_meta.toArray[0]

      const readSet = new Set<string>()
      const builtin: Array<AgentTool> = [
        createBashTool(args.worktree_path),
        createReadFileTool(args.worktree_path, readSet),
        createWriteTool(args.worktree_path, readSet),
        createEditTool(args.worktree_path, readSet),
        fetchUrlTool,
      ]
      const sharedTools = buildSharedStateTools(board)
      const skillTools = skillsRegistry
        ? createSkillTools(skillsRegistry, ctx)
        : []

      const modelConfig = resolveBuiltinModelConfig(
        modelCatalog,
        args as unknown as Readonly<Record<string, unknown>>
      )

      ctx.useAgent({
        systemPrompt: buildWorkerPrelude({
          role,
          repo: args.repo,
          number: args.number,
          base_branch: args.base_branch,
          head_sha: meta?.head_sha ?? `unknown`,
          signal_type: signal?.type ?? `firstWake`,
          signal_key: signal?.key ?? `n/a`,
          signal_ts: signal?.ts ?? new Date().toISOString(),
          blackboard_id: args.blackboard.id,
          worktree_path: args.worktree_path,
        }),
        ...modelConfig,
        tools: [...builtin, ...sharedTools, ...skillTools],
        ...(streamFn && { streamFn }),
      })
      await ctx.agent.run()
    },
  })
}
