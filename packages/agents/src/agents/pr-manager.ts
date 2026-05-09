import path from 'node:path'
import fs from 'node:fs'
import { db } from '@electric-ax/agents-runtime'
import type {
  EntityRegistry,
  HandlerContext,
  SharedStateSchemaMap,
  WakeEvent,
} from '@electric-ax/agents-runtime'
import type { StreamFn } from '@mariozechner/pi-agent-core'
import { insertSignal } from './pr-shared/signals'
import { parseSlashCommand } from './pr-shared/slash-commands'
import {
  PrBlackboardSchema,
  type AgentStateRow,
  type CheckRow,
  type CommitRow,
  type DocPlanRow,
  type GatesRow,
  type PrMetaRow,
  type ReviewThreadRow,
  type SignalRow,
} from './pr-shared/blackboard-schema'
import {
  createWorktree as defaultCreateWorktree,
  worktreePathFor,
} from './pr-shared/worktree'
import { createGithubClient } from './pr-shared/github'
import { renderStatusComment } from './pr-shared/status-comment'
import { evalGates } from './pr-shared/gates'
import { buildWorkerPrelude } from './pr-shared/prelude'
import {
  resolveBuiltinModelConfig,
  type BuiltinModelCatalog,
} from '../model-catalog'
import { createSkillTools } from '../skills/tools'
import type { SkillsRegistry } from '../skills/types'
import type { GithubComment, GithubPr } from './pr-shared/github'

interface BoardCollections {
  pr_meta: {
    toArray: PrMetaRow[]
    update: (k: string, fn: (d: PrMetaRow) => void) => void
    insert: (r: PrMetaRow) => void
  }
  signals: {
    insert: (r: SignalRow) => void
    toArray: SignalRow[]
    update: (k: string, fn: (d: SignalRow) => void) => void
  }
  checks: {
    toArray: CheckRow[]
    insert: (r: CheckRow) => void
    update: (k: string, fn: (d: CheckRow) => void) => void
    delete: (k: string) => void
  }
}

interface GhClientShape {
  fetchPr: (repo: string, number: number) => Promise<GithubPr>
  fetchChecks: (repo: string, sha: string) => Promise<CheckRow[]>
  fetchCommentsSince: (
    repo: string,
    number: number,
    sinceIso: string
  ) => Promise<GithubComment[]>
}

export interface SyncPollDeps {
  board: BoardCollections
  gh: GhClientShape
  repo: string
  number: number
}

export async function runSyncPoll(deps: SyncPollDeps): Promise<void> {
  const { board, gh, repo, number } = deps
  const meta = board.pr_meta.toArray[0]
  if (!meta) throw new Error(`[pr-manager] sync poll: pr_meta is uninitialized`)

  const remote = await gh.fetchPr(repo, number)
  const previousLabels = new Set(meta.labels)
  const remoteLabels = new Set(remote.labels)

  // ── meta + head sha
  if (remote.head.sha !== meta.head_sha) {
    insertSignal(board.signals, `head_sha_changed`, {
      from_sha: meta.head_sha,
      to_sha: remote.head.sha,
      author_login: `unknown`,
    })
  }
  if (remote.base.sha !== meta.base_sha) {
    insertSignal(board.signals, `base_advanced`, {})
  }
  if (remote.state === `closed`) {
    insertSignal(board.signals, `pr_closed`, {})
  }

  // ── label transitions
  const added = [...remoteLabels].filter((l) => !previousLabels.has(l))
  const removed = [...previousLabels].filter((l) => !remoteLabels.has(l))
  if (added.length > 0 || removed.length > 0) {
    insertSignal(board.signals, `label_changed`, {})
  }
  if (previousLabels.has(`agents`) && !remoteLabels.has(`agents`)) {
    insertSignal(board.signals, `agents_label_removed`, {})
  }
  if (!previousLabels.has(`agents`) && remoteLabels.has(`agents`)) {
    insertSignal(board.signals, `agents_label_restored`, {})
  }

  // ── update meta row in place
  board.pr_meta.update(`meta`, (d) => {
    d.title = remote.title
    d.head_sha = remote.head.sha
    d.head_branch = remote.head.ref
    d.base_sha = remote.base.sha
    d.base_branch = remote.base.ref
    d.description = remote.body
    d.state =
      remote.state === `closed` && remote.merged ? `merged` : remote.state
    d.labels = remote.labels
    d.mergeable = remote.mergeable
    d.last_synced_at = new Date().toISOString()
  })

  // ── checks
  const remoteChecks = await gh.fetchChecks(repo, remote.head.sha)
  const knownByKey = new Map(board.checks.toArray.map((c) => [c.key, c]))
  for (const c of remoteChecks) {
    const prev = knownByKey.get(c.key)
    if (!prev) board.checks.insert(c)
    else if (prev.status !== c.status || prev.conclusion !== c.conclusion) {
      board.checks.update(c.key, (d) => {
        Object.assign(d, c)
      })
    }
  }
  const failed = remoteChecks
    .filter((c) => c.conclusion === `failure`)
    .map((c) => c.name)
  if (failed.length > 0) {
    insertSignal(board.signals, `ci_failed`, {
      head_sha: remote.head.sha,
      failed_checks: failed,
    })
  } else if (
    remoteChecks.length > 0 &&
    remoteChecks.every(
      (c) =>
        c.status === `completed` &&
        (c.conclusion === `success` || c.conclusion === `skipped`)
    )
  ) {
    insertSignal(board.signals, `ci_passed`, {})
  }

  // ── new human comments + slash-commands
  const comments = await gh.fetchCommentsSince(
    repo,
    number,
    meta.last_synced_at
  )
  for (const c of comments) {
    insertSignal(board.signals, `new_human_comment`, {
      comment_id: c.id,
      author_login: c.user.login,
      body: c.body,
      ...(c.path ? { file: c.path } : {}),
      ...(typeof c.line === `number` ? { line: c.line } : {}),
    })
    const cmd = parseSlashCommand(c.body)
    if (!cmd) continue
    if (cmd.kind === `stop`) {
      board.pr_meta.update(`meta`, (d) => {
        d.agents_disabled = true
      })
      insertSignal(board.signals, `agents_disabled`, {})
    } else if (cmd.kind === `resume`) {
      board.pr_meta.update(`meta`, (d) => {
        d.agents_disabled = false
      })
    } else if (cmd.kind === `continue`) {
      insertSignal(board.signals, `continue_granted`, { role: cmd.role })
    }
  }

  insertSignal(board.signals, `pr_synced`, {})
}

export interface PrManagerArgs {
  repo: string
  number: number
  head_branch: string
  worktreeRoot: string
  caps?: { reviewer?: number; buildDoctor?: number; docEditor?: number }
}

export interface PrManagerDeps {
  workingDirectory: string
  modelCatalog: BuiltinModelCatalog
  skillsRegistry?: SkillsRegistry | null
  streamFn?: StreamFn
  createWorktree?: typeof defaultCreateWorktree
  githubFactory?: () => ReturnType<typeof createGithubClient>
}

const DEFAULT_CAPS = { reviewer: 5, buildDoctor: 3, docEditor: 3 } as const

interface PrBoardHandle {
  pr_meta: {
    toArray: PrMetaRow[]
    insert: (row: PrMetaRow) => void
    update: (key: string, fn: (draft: PrMetaRow) => void) => void
  }
  signals: {
    toArray: SignalRow[]
    insert: (row: SignalRow) => void
    update: (key: string, fn: (draft: SignalRow) => void) => void
  }
  checks: {
    toArray: CheckRow[]
    insert: (row: CheckRow) => void
    update: (key: string, fn: (draft: CheckRow) => void) => void
    delete: (key: string) => void
  }
  review_threads: {
    toArray: ReviewThreadRow[]
    insert: (row: ReviewThreadRow) => void
  }
  doc_plan: {
    toArray: DocPlanRow[]
    insert: (row: DocPlanRow) => void
  }
  commits: {
    toArray: CommitRow[]
    insert: (row: CommitRow) => void
  }
  gates: {
    toArray: GatesRow[]
    insert: (row: GatesRow) => void
    update: (key: string, fn: (draft: GatesRow) => void) => void
  }
  agent_state: {
    toArray: AgentStateRow[]
    insert: (row: AgentStateRow) => void
    update: (key: string, fn: (draft: AgentStateRow) => void) => void
  }
}

function blackboardId(repo: string, number: number): string {
  return `pr-${repo}-${number}`
}

function decodeWakeKind(
  events: ReadonlyArray<{ type: string; value?: unknown }>
): string | null {
  for (const e of events) {
    if (e.type !== `inbox.user_message`) continue
    const v = e.value as { content?: string } | undefined
    try {
      const parsed = JSON.parse(v?.content ?? ``) as { kind?: string }
      if (typeof parsed.kind === `string`) return parsed.kind
    } catch {
      /* not JSON; ignore */
    }
  }
  return null
}

export function registerPrManager(
  registry: EntityRegistry,
  deps: PrManagerDeps
): void {
  const {
    workingDirectory,
    modelCatalog,
    skillsRegistry,
    streamFn,
    createWorktree = defaultCreateWorktree,
    githubFactory = () => createGithubClient(),
  } = deps

  registry.define(`pr-manager`, {
    description: `PR shepherd manager — owns the per-PR blackboard, sync poll, worktree, gates, status comment`,
    async handler(ctx: HandlerContext, _wake: WakeEvent) {
      const args = ctx.args as unknown as PrManagerArgs
      const board = (await ctx.observe(
        db(
          blackboardId(args.repo, args.number),
          PrBlackboardSchema as unknown as SharedStateSchemaMap
        ),
        { wake: { on: `change`, collections: [`signals`] } }
      )) as unknown as PrBoardHandle
      const gh = githubFactory()
      const caps = { ...DEFAULT_CAPS, ...args.caps }

      // ── firstWake: initialize
      if (ctx.firstWake) {
        const remote = await gh.fetchPr(args.repo, args.number)
        if (board.pr_meta.toArray.length === 0) {
          board.pr_meta.insert({
            key: `meta`,
            number: args.number,
            repo: args.repo,
            title: remote.title,
            base_branch: remote.base.ref,
            base_sha: remote.base.sha,
            head_branch: remote.head.ref,
            head_sha: remote.head.sha,
            description: remote.body,
            state: remote.state,
            labels: remote.labels,
            mergeable: remote.mergeable,
            status_comment_id: null,
            agents_disabled: false,
            last_synced_at: new Date(0).toISOString(),
          })
        }

        const roles = [
          { role: `reviewer` as const, cap: caps.reviewer },
          { role: `build-doctor` as const, cap: caps.buildDoctor },
          { role: `doc-editor` as const, cap: caps.docEditor },
        ]
        const existingRoles = new Set(
          board.agent_state.toArray.map((r) => r.key)
        )
        for (const r of roles) {
          if (existingRoles.has(r.role)) continue
          board.agent_state.insert({
            key: r.role,
            role: r.role,
            iterations: 0,
            cap: r.cap,
            paused: false,
            pause_reason: null,
            last_continue_grant_at: null,
            last_reviewed_sha: null,
            last_substantive_signature: null,
            iterations_skipped_since_review: 0,
            worktree_lock_holder: null,
          })
        }

        if (!fs.existsSync(worktreePathFor(workingDirectory, args.number))) {
          await createWorktree({
            repoRoot: workingDirectory,
            prNumber: args.number,
            headBranch: remote.head.ref,
          }).catch(() => {
            /* race: another firstWake delivery may have created it */
          })
        }

        const blackboardArg = {
          id: blackboardId(args.repo, args.number),
          schema: PrBlackboardSchema as unknown as Record<string, unknown>,
        }
        const workerArgs = {
          repo: args.repo,
          number: args.number,
          head_branch: remote.head.ref,
          base_branch: remote.base.ref,
          worktree_path: path.join(
            workingDirectory,
            `.worktrees`,
            `pr-${args.number}`
          ),
          blackboard: blackboardArg,
        }
        await ctx.spawn(
          `pr-reviewer`,
          `pr-reviewer-${args.number}`,
          workerArgs,
          {}
        )
        await ctx.spawn(
          `pr-build-doctor`,
          `pr-build-doctor-${args.number}`,
          workerArgs,
          {}
        )
        await ctx.spawn(
          `pr-doc-editor`,
          `pr-doc-editor-${args.number}`,
          workerArgs,
          {}
        )

        ctx.send(ctx.entityUrl, { kind: `sync_tick` }, { afterMs: 30_000 })
        return
      }

      const kind = decodeWakeKind(ctx.events)

      if (kind === `sync_tick`) {
        await runSyncPoll({
          board,
          gh,
          repo: args.repo,
          number: args.number,
        })
        const recentSignals = board.signals.toArray.filter(
          (s) => Date.now() - new Date(s.ts).getTime() < 5 * 60_000
        )
        const meta = board.pr_meta.toArray[0]!
        if (meta.state !== `open`) return
        const nextDelay = recentSignals.length > 0 ? 30_000 : 5 * 60_000
        ctx.send(ctx.entityUrl, { kind: `sync_tick` }, { afterMs: nextDelay })
        return
      }

      // ── Otherwise: gate eval + status comment via the manager agent
      const meta = board.pr_meta.toArray[0]
      if (!meta) return
      const evaluated = evalGates({
        pr_meta: meta,
        checks: board.checks.toArray,
        review_threads: board.review_threads.toArray,
        doc_plan: board.doc_plan.toArray,
      })
      const previous = board.gates.toArray[0]
      const gateRow = {
        key: `gates` as const,
        ...evaluated,
        last_evaluated_at: new Date().toISOString(),
      }
      if (!previous) board.gates.insert(gateRow)
      else board.gates.update(`gates`, (d) => Object.assign(d, gateRow))

      const flipped =
        !previous || previous.ready_to_merge !== gateRow.ready_to_merge
      if (flipped) {
        insertSignal(board.signals, `gate_state_changed`, {})
      }
      if (gateRow.ready_to_merge && !previous?.ready_to_merge) {
        insertSignal(board.signals, `ready_to_merge`, {})
      }
      if (flipped && gateRow.ready_to_merge) {
        await gh.addLabel(args.repo, args.number, `agents:ready`)
      } else if (
        flipped &&
        previous?.ready_to_merge &&
        !gateRow.ready_to_merge
      ) {
        await gh
          .removeLabel(args.repo, args.number, `agents:ready`)
          .catch(() => {})
      }

      if (flipped || ctx.events.length > 0) {
        const failingChecks = board.checks.toArray.filter(
          (c) => c.conclusion === `failure`
        ).length
        const pendingChecks = board.checks.toArray.filter(
          (c) => c.status !== `completed`
        ).length
        const openMustFix = board.review_threads.toArray.filter(
          (t) => t.severity === `must-fix` && t.status === `open`
        ).length
        const body = renderStatusComment({
          pr_meta: meta,
          gates: gateRow,
          agent_state: board.agent_state.toArray,
          commits: board.commits.toArray,
          pendingChecks,
          failingChecks,
          openMustFix,
        })
        const cid = await gh.upsertComment(
          args.repo,
          args.number,
          body,
          meta.status_comment_id
        )
        if (cid !== meta.status_comment_id) {
          board.pr_meta.update(`meta`, (d) => {
            d.status_comment_id = cid
          })
        }
      }

      // Optionally also run the manager skill for narrative parts.
      if (skillsRegistry) {
        const [useSkill, removeSkill] = createSkillTools(skillsRegistry, ctx)
        const modelConfig = resolveBuiltinModelConfig(
          modelCatalog,
          args as unknown as Readonly<Record<string, unknown>>
        )
        ctx.useAgent({
          systemPrompt: buildWorkerPrelude({
            role: `manager`,
            repo: args.repo,
            number: args.number,
            base_branch: meta.base_branch,
            head_sha: meta.head_sha,
            signal_type: kind ?? `manager_tick`,
            signal_key: `n/a`,
            signal_ts: new Date().toISOString(),
            blackboard_id: blackboardId(args.repo, args.number),
            worktree_path: path.join(
              workingDirectory,
              `.worktrees`,
              `pr-${args.number}`
            ),
          }),
          ...modelConfig,
          tools: [useSkill, removeSkill],
          ...(streamFn && { streamFn }),
        })
        await ctx.agent.run()
      }
    },
  })
}
