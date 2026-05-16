export type PrRole = `reviewer` | `build-doctor` | `doc-editor` | `manager`

export interface PreludeArgs {
  role: PrRole
  repo: string
  number: number
  base_branch: string
  head_sha: string
  signal_type: string
  signal_key: string
  signal_ts: string
  blackboard_id: string
  worktree_path: string
}

export function buildWorkerPrelude(a: PreludeArgs): string {
  return `You are the ${a.role} agent for PR ${a.repo}#${a.number}, base ${a.base_branch}, head ${a.head_sha}.

Your shared blackboard is \`${a.blackboard_id}\`. Read and write its
collections via the shared-DB tools. You woke because of signal:
${a.signal_type} (key: ${a.signal_key}, ts: ${a.signal_ts}).

You have a persistent timeline across wakes — your previous reasoning,
tool calls, and conclusions on this PR are visible to you above. Use them.
Do not redo work you already did unless something has changed.

Step 1 — load your role skill: call use_skill('pr-${a.role}'). The skill
         contains your decision tree, idempotency checks, cap rules,
         and signal-emit guidance.
Step 2 — follow that skill exactly.
Step 3 — when this wake's work is done, exit so the entity can sleep.

You may load additional supporting skills via use_skill if the role skill
points you at them. Always remove_skill when done to keep context lean.

Working directory: ${a.worktree_path}
`
}
