import { insertSignal } from './pr-shared/signals'
import { parseSlashCommand } from './pr-shared/slash-commands'
import type {
  CheckRow,
  PrMetaRow,
  SignalRow,
} from './pr-shared/blackboard-schema'
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
