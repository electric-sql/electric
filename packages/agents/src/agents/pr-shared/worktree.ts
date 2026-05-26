import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'

const exec = promisify(execFile)

export function worktreePathFor(repoRoot: string, prNumber: number): string {
  return path.join(repoRoot, `.worktrees`, `pr-${prNumber}`)
}

export async function createWorktree(opts: {
  repoRoot: string
  prNumber: number
  headBranch: string
}): Promise<string> {
  const dir = worktreePathFor(opts.repoRoot, opts.prNumber)
  await exec(`git`, [`worktree`, `add`, dir, opts.headBranch], {
    cwd: opts.repoRoot,
  })
  return dir
}

export async function removeWorktree(opts: {
  repoRoot: string
  prNumber: number
}): Promise<void> {
  const dir = worktreePathFor(opts.repoRoot, opts.prNumber)
  await exec(`git`, [`worktree`, `remove`, `--force`, dir], {
    cwd: opts.repoRoot,
  })
}

interface AgentStateCollection {
  update: (
    key: string,
    mutate: (draft: { worktree_lock_holder: string | null }) => void
  ) => void
}

export function tryAcquireLock(
  agent_state: AgentStateCollection,
  rowKey: string,
  role: string,
  opts: { peek?: () => string | null } = {}
): boolean {
  if (opts.peek && opts.peek() && opts.peek() !== role) return false
  let acquired = true
  agent_state.update(rowKey, (draft) => {
    if (draft.worktree_lock_holder && draft.worktree_lock_holder !== role) {
      acquired = false
      return
    }
    draft.worktree_lock_holder = role
  })
  return acquired
}

export function releaseLock(
  agent_state: AgentStateCollection,
  rowKey: string
): void {
  agent_state.update(rowKey, (draft) => {
    draft.worktree_lock_holder = null
  })
}
