import { Type, type Static } from '@sinclair/typebox'

export const PrMetaRow = Type.Object({
  key: Type.String(), // 'meta'
  number: Type.Integer(),
  repo: Type.String(),
  title: Type.String(),
  base_branch: Type.String(),
  base_sha: Type.String(),
  head_branch: Type.String(),
  head_sha: Type.String(),
  description: Type.String(),
  state: Type.Union([
    Type.Literal(`open`),
    Type.Literal(`closed`),
    Type.Literal(`merged`),
  ]),
  labels: Type.Array(Type.String()),
  mergeable: Type.Union([Type.Boolean(), Type.Null()]),
  status_comment_id: Type.Union([Type.String(), Type.Null()]),
  agents_disabled: Type.Boolean(),
  last_synced_at: Type.String(),
})
export type PrMetaRow = Static<typeof PrMetaRow>

export const CheckRow = Type.Object({
  key: Type.String(), // `${name}@${head_sha}`
  name: Type.String(),
  status: Type.Union([
    Type.Literal(`queued`),
    Type.Literal(`in_progress`),
    Type.Literal(`completed`),
  ]),
  conclusion: Type.Union([
    Type.Literal(`success`),
    Type.Literal(`failure`),
    Type.Literal(`cancelled`),
    Type.Literal(`skipped`),
    Type.Null(),
  ]),
  log_url: Type.Union([Type.String(), Type.Null()]),
  head_sha: Type.String(),
})
export type CheckRow = Static<typeof CheckRow>

export const ReviewThreadRow = Type.Object({
  key: Type.String(),
  file: Type.String(),
  line: Type.Integer(),
  severity: Type.Union([
    Type.Literal(`must-fix`),
    Type.Literal(`suggestion`),
    Type.Literal(`nit`),
  ]),
  category: Type.String(),
  body: Type.String(),
  suggested_patch: Type.Union([Type.String(), Type.Null()]),
  status: Type.Union([
    Type.Literal(`open`),
    Type.Literal(`addressed`),
    Type.Literal(`wontfix`),
  ]),
  addressed_by_sha: Type.Union([Type.String(), Type.Null()]),
  source: Type.Union([Type.Literal(`agent`), Type.Literal(`human`)]),
})
export type ReviewThreadRow = Static<typeof ReviewThreadRow>

export const DocPlanRow = Type.Object({
  key: Type.String(),
  doc_path: Type.String(),
  change: Type.Union([Type.Literal(`add`), Type.Literal(`update`)]),
  status: Type.Union([
    Type.Literal(`needed`),
    Type.Literal(`in-progress`),
    Type.Literal(`done`),
  ]),
  notes: Type.String(),
})
export type DocPlanRow = Static<typeof DocPlanRow>

export const CommitRow = Type.Object({
  key: Type.String(), // sha
  sha: Type.String(),
  author_agent: Type.String(), // 'pr-reviewer' | 'pr-build-doctor' | 'pr-doc-editor'
  message: Type.String(),
  parent_sha: Type.String(),
  ts: Type.String(),
})
export type CommitRow = Static<typeof CommitRow>

export const GatesRow = Type.Object({
  key: Type.Literal(`gates`),
  template_ok: Type.Boolean(),
  ci_green: Type.Boolean(),
  no_conflicts: Type.Boolean(),
  threads_resolved: Type.Boolean(),
  docs_ok: Type.Boolean(),
  ready_to_merge: Type.Boolean(),
  last_evaluated_at: Type.String(),
})
export type GatesRow = Static<typeof GatesRow>

export const AgentStateRow = Type.Object({
  key: Type.String(), // 'reviewer' | 'build-doctor' | 'doc-editor'
  role: Type.Union([
    Type.Literal(`reviewer`),
    Type.Literal(`build-doctor`),
    Type.Literal(`doc-editor`),
  ]),
  iterations: Type.Integer(),
  cap: Type.Integer(),
  paused: Type.Boolean(),
  pause_reason: Type.Union([Type.String(), Type.Null()]),
  last_continue_grant_at: Type.Union([Type.String(), Type.Null()]),
  last_reviewed_sha: Type.Union([Type.String(), Type.Null()]),
  last_substantive_signature: Type.Union([Type.String(), Type.Null()]),
  iterations_skipped_since_review: Type.Integer(),
  worktree_lock_holder: Type.Union([Type.String(), Type.Null()]),
})
export type AgentStateRow = Static<typeof AgentStateRow>

export const SignalRow = Type.Object({
  key: Type.String(), // ulid/nanoid
  type: Type.String(),
  payload: Type.Record(Type.String(), Type.Unknown()),
  ts: Type.String(),
  consumed_by: Type.Array(Type.String()),
})
export type SignalRow = Static<typeof SignalRow>

export const PrBlackboardSchema = {
  pr_meta: {
    schema: PrMetaRow,
    type: `pr:meta`,
    primaryKey: `key` as const,
  },
  checks: {
    schema: CheckRow,
    type: `pr:check`,
    primaryKey: `key` as const,
  },
  review_threads: {
    schema: ReviewThreadRow,
    type: `pr:review_thread`,
    primaryKey: `key` as const,
  },
  doc_plan: {
    schema: DocPlanRow,
    type: `pr:doc_plan`,
    primaryKey: `key` as const,
  },
  commits: {
    schema: CommitRow,
    type: `pr:commit`,
    primaryKey: `key` as const,
  },
  gates: {
    schema: GatesRow,
    type: `pr:gates`,
    primaryKey: `key` as const,
  },
  agent_state: {
    schema: AgentStateRow,
    type: `pr:agent_state`,
    primaryKey: `key` as const,
  },
  signals: {
    schema: SignalRow,
    type: `pr:signal`,
    primaryKey: `key` as const,
  },
}
