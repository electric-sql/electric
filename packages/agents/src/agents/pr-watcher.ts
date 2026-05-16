import { db } from '@electric-ax/agents-runtime'
import type {
  EntityRegistry,
  HandlerContext,
  SharedStateHandle,
  SharedStateSchemaMap,
} from '@electric-ax/agents-runtime'
import type { BuiltinModelCatalog } from '../model-catalog'
import { WatcherSchema, type ManagedPrRow } from './pr-shared/watcher-schema'

export interface PrWatcherArgs {
  repo: string
  worktreeRoot?: string
  caps?: { reviewer?: number; buildDoctor?: number; docEditor?: number }
}

export interface PrWatcherDeps {
  workingDirectory: string
  modelCatalog: BuiltinModelCatalog
  fetchPrs?: (
    repo: string
  ) => Promise<Array<{ number: number; head_branch: string; labels: string[] }>>
}

function parseArgs(value: Readonly<Record<string, unknown>>): PrWatcherArgs {
  if (typeof value.repo !== `string` || value.repo.length === 0) {
    throw new Error(`[pr-watcher] repo is required ("owner/name")`)
  }
  return {
    repo: value.repo,
    worktreeRoot:
      typeof value.worktreeRoot === `string` ? value.worktreeRoot : undefined,
    caps:
      typeof value.caps === `object` && value.caps
        ? (value.caps as PrWatcherArgs[`caps`])
        : undefined,
  }
}

function ledgerId(repo: string): string {
  return `pr-watcher-${repo}`
}

async function defaultFetchPrs(repo: string) {
  const { execFile } = await import(`node:child_process`)
  const { promisify } = await import(`node:util`)
  const exec = promisify(execFile)
  const { stdout } = await exec(`gh`, [
    `pr`,
    `list`,
    `--repo`,
    repo,
    `--label`,
    `agents`,
    `--state`,
    `open`,
    `--json`,
    `number,headRefName,labels`,
  ])
  return (
    JSON.parse(stdout) as Array<{
      number: number
      headRefName: string
      labels: Array<{ name: string }>
    }>
  ).map((p) => ({
    number: p.number,
    head_branch: p.headRefName,
    labels: p.labels.map((l) => l.name),
  }))
}

export function registerPrWatcher(
  registry: EntityRegistry,
  deps: PrWatcherDeps
): void {
  const { workingDirectory, fetchPrs = defaultFetchPrs } = deps
  registry.define(`pr-watcher`, {
    description: `PR shepherd watcher — discovers labeled PRs in a repo and spawns a pr-manager for each`,
    async handler(ctx: HandlerContext) {
      const args = parseArgs(ctx.args)
      const ledger = (await ctx.observe(
        db(
          ledgerId(args.repo),
          WatcherSchema as unknown as SharedStateSchemaMap
        )
      )) as unknown as SharedStateHandle & {
        managed_prs: {
          toArray: ManagedPrRow[]
          insert: (row: ManagedPrRow) => void
        }
      }

      const triggered =
        ctx.firstWake ||
        ctx.events.some((e) => {
          if (e.type !== `inbox.user_message`) return false
          const v = (e as unknown as { value?: { content?: string } }).value
          try {
            return (
              (JSON.parse(v?.content ?? ``) as { kind?: string }).kind ===
              `scan`
            )
          } catch {
            return false
          }
        })
      if (!triggered) return

      const prs = await fetchPrs(args.repo)
      const known = new Map<string, ManagedPrRow>(
        ledger.managed_prs.toArray.map((r: ManagedPrRow) => [r.key, r] as const)
      )

      for (const pr of prs) {
        if (!pr.labels.includes(`agents`)) continue
        const existing = known.get(String(pr.number))
        if (existing && existing.state === `active`) continue

        const id = `${args.repo.replace(`/`, `-`)}-${pr.number}`
        const handle = await ctx.spawn(
          `pr-manager`,
          id,
          {
            repo: args.repo,
            number: pr.number,
            head_branch: pr.head_branch,
            worktreeRoot: args.worktreeRoot ?? `${workingDirectory}/.worktrees`,
            caps: args.caps,
          },
          { wake: { on: `runFinished` } }
        )

        ledger.managed_prs.insert({
          key: String(pr.number),
          number: pr.number,
          manager_entity_url: handle.entityUrl,
          state: `active`,
          spawned_at: new Date().toISOString(),
        })
      }
    },
  })
}
