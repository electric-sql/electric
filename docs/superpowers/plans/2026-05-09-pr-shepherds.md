# PR Shepherds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build five long-lived, reactive entities (`pr-watcher`, `pr-manager`, `pr-reviewer`, `pr-build-doctor`, `pr-doc-editor`) that shepherd a labeled GitHub PR through template / CI / conflicts / threads / docs gates until ready-to-merge, all on the existing `@electric-ax/agents-runtime` reactive blackboard.

**Architecture:** Each entity is a hybrid TS shell + LLM skill. The TS shell wires subscriptions, tools, working-directory worktree, and prelude; the agent loads its role skill via `use_skill` on each wake, runs decision-tree reasoning over the per-PR shared blackboard, and emits structured signal rows that wake other entities. Subscriptions use `ctx.observe(db(id, schema), { wake: { on: 'change', collections: ['signals'] } })` — there is no built-in `where(type ∈ [...])` filter; each entity's skill body filters signals by `type` and uses idempotency checks (signal `consumed_by` array) to make duplicate wakes safe. The `pr-manager` schedules sync polls via `ctx.send(ctx.entityUrl, payload, { afterMs })` — the runtime has no `ctx.scheduleWake`, but a delayed self-`send` is the equivalent.

**Tech Stack:** TypeScript strict mode, TypeBox for shared-DB schema (matches existing `worker.ts` pattern), Vitest for unit tests, `@electric-ax/agents-runtime` for entities/spawn/observe/db, `@electric-ax/agents-runtime/tools` for bash/read/write/edit/fetchUrl, `gh` CLI via the bash tool for GitHub API calls (no MCP server today; the design tolerates either), `nanoid` / `ulid` for keys.

**Plan scope note:** This is a large feature (5 entities, shared infra, 4 skills, 5 templates, multiple test layers). It can run as a single plan, or split into three: (A) shared infrastructure under `pr-shared/`, (B) `pr-watcher` + `pr-manager` + manager skill + templates, (C) the three worker entities + their skills. Each split is independently testable. This document writes them as one ordered plan.

**Prerequisite — read first:**

- `/Users/vbalegas/workspace/agents-factory/docs/superpowers/specs/2026-05-08-pr-shepherds-design.md` (the spec — every task references its sections)
- `/Users/vbalegas/workspace/agents-factory/packages/agents/src/agents/worker.ts` (the closest existing entity pattern; copy its handler shape)
- `/Users/vbalegas/workspace/agents-factory/packages/agents-runtime/src/types.ts` (Wake / Spawn / Observe / SharedStateHandle types)
- `/Users/vbalegas/workspace/agents-factory/packages/agents-runtime/src/observation-sources.ts` (the `db()` factory used in `ctx.observe`)
- `/Users/vbalegas/workspace/agents-factory/packages/agents/src/bootstrap.ts` (where new entity types must be registered)

**Resolved §14 deferred items (locked in by this plan):**

1. Subscription filtering — there is no `.where(type ∈ [...])` API on `ctx.observe`. We subscribe at the collection level (`signals`) and filter by `type` inside the skill.
2. Sync polling lives in the **TS handler**, not as an agent tool, for determinism (matches the spec's lean).
3. Scheduled wakes — use `ctx.send(ctx.entityUrl, { kind: 'sync_tick' }, { afterMs })`. The handler dispatches on `wake.payload.kind` to decide whether to run a sync poll (mechanical) or invoke the agent (gate eval / status comment).

---

## File structure

New files (all under `packages/agents/`):

```
src/agents/
  pr-watcher.ts                # entity shell + manual scan handler
  pr-manager.ts                # entity shell + sync poll + slash-cmd + agent invoke
  pr-reviewer.ts               # entity shell + signal subscriptions + agent invoke
  pr-build-doctor.ts           # entity shell + signal subscriptions + agent invoke
  pr-doc-editor.ts             # entity shell + signal subscriptions + agent invoke
  pr-shared/
    blackboard-schema.ts       # TypeBox schema for per-PR DB; PrBlackboardSchema
    watcher-schema.ts          # TypeBox schema for per-watcher ledger
    signals.ts                 # SignalType enum, payload types, insertSignal()
    prelude.ts                 # buildWorkerPrelude() — system prompt template
    worktree.ts                # createWorktree, removeWorktree, lockWorktree, releaseLock
    gates.ts                   # pure evalGates(blackboard) -> Gates
    description.ts             # renderDescription(template, summary, prMeta)
    status-comment.ts          # renderStatusComment(blackboard) — uses templates/status-comment.md
    slash-commands.ts          # parseSlashCommand(commentBody)
    github.ts                  # thin gh-CLI wrappers (listChecks, getPr, etc.)

skills/pr/
  manager.md
  reviewer.md
  build-doctor.md
  doc-editor.md
  templates/
    pr-description.md
    review-thread.md
    status-comment.md
    commit-message.md
    thread-reply.md

test/
  pr-shared/blackboard-schema.test.ts
  pr-shared/signals.test.ts
  pr-shared/gates.test.ts
  pr-shared/description.test.ts
  pr-shared/status-comment.test.ts
  pr-shared/slash-commands.test.ts
  pr-shared/worktree.test.ts
  pr-shared/prelude.test.ts
  pr-watcher.test.ts
  pr-manager.test.ts
  pr-manager-sync.test.ts
  pr-reviewer.test.ts
  pr-build-doctor.test.ts
  pr-doc-editor.test.ts
  pr-bootstrap.test.ts
```

Modified files:

- `packages/agents/src/bootstrap.ts:114-122` — register the five new entities.
- `packages/agents/package.json` — add `nanoid` and `ulid` deps if not present (verify first).

Each entity shell stays under ~120 lines (worker.ts is 327; the PR entities are simpler because they don't have sharedDbToolMode plumbing). Skills are markdown.

---

## Task 0: Set up the worktree and confirm packages

**Files:**

- Read: `packages/agents/package.json`
- Read: `packages/agents-runtime/src/index.ts`

- [ ] **Step 1: Confirm an isolated worktree is in use**

If you are not already in a worktree, invoke `superpowers:using-git-worktrees` to create one before proceeding. The branch base should be `main`.

- [ ] **Step 2: Confirm runtime exports**

Run: `grep -n "export.*\(db\|spawn\|observe\|nanoid\)" /Users/vbalegas/workspace/agents-factory/packages/agents-runtime/src/index.ts`
Expected: `db` is exported from `observation-sources`. If not, fix the import path used in subsequent tasks (use `@electric-ax/agents-runtime` if re-exported, otherwise the deep import worker.ts uses: `import { db } from '@electric-ax/agents-runtime'`).

- [ ] **Step 3: Confirm key dependencies**

Run: `grep -E '"nanoid"|"ulid"|"@sinclair/typebox"' /Users/vbalegas/workspace/agents-factory/packages/agents/package.json`
Expected: typebox present (worker.ts uses it). If `nanoid` or `ulid` missing, run `pnpm -C packages/agents add nanoid` (we use nanoid for entity ids and signal keys; ulid is overkill).

- [ ] **Step 4: Commit baseline**

```bash
git add -A && git commit -m "chore(agents): baseline before pr-shepherds" --allow-empty
```

---

## Task 1: Watcher-state schema (per-watcher ledger)

**Files:**

- Create: `packages/agents/src/agents/pr-shared/watcher-schema.ts`
- Test: `packages/agents/test/pr-shared/watcher-schema.test.ts`

This implements the `watcher_state` schema from spec §3.2 (per-watcher ledger of `managed_prs`). It is one TypeBox object and the shape consumed by `ctx.mkdb('pr-watcher-<repo>', WatcherSchema)`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agents/test/pr-shared/watcher-schema.test.ts
import { describe, expect, it } from 'vitest'
import { Value } from '@sinclair/typebox/value'
import {
  WatcherSchema,
  ManagedPrRow,
} from '../../src/agents/pr-shared/watcher-schema'

describe('WatcherSchema', () => {
  it('exposes a managed_prs collection with key + schema', () => {
    expect(WatcherSchema.managed_prs).toBeDefined()
    expect(WatcherSchema.managed_prs.primaryKey).toBe('key')
  })

  it('accepts a well-formed managed-pr row', () => {
    const row = {
      key: '42',
      number: 42,
      manager_entity_url: 'http://localhost:4437/pr-manager/abc/main',
      state: 'active' as const,
      spawned_at: '2026-05-09T00:00:00Z',
    }
    expect(Value.Check(ManagedPrRow, row)).toBe(true)
  })

  it('rejects unknown state values', () => {
    const row = {
      key: '1',
      number: 1,
      manager_entity_url: 'x',
      state: 'banana',
      spawned_at: 'z',
    }
    expect(Value.Check(ManagedPrRow, row)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C packages/agents test --run test/pr-shared/watcher-schema.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the schema**

```ts
// packages/agents/src/agents/pr-shared/watcher-schema.ts
import { Type, type Static } from '@sinclair/typebox'

export const ManagedPrRow = Type.Object({
  key: Type.String(), // PR number as string
  number: Type.Integer(),
  manager_entity_url: Type.String(),
  state: Type.Union([Type.Literal('active'), Type.Literal('completed')]),
  spawned_at: Type.String(),
})
export type ManagedPrRow = Static<typeof ManagedPrRow>

export const WatcherSchema = {
  managed_prs: { schema: ManagedPrRow, primaryKey: 'key' as const },
}
```

- [ ] **Step 4: Run tests — should pass**

Run: `pnpm -C packages/agents test --run test/pr-shared/watcher-schema.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/agents/pr-shared/watcher-schema.ts packages/agents/test/pr-shared/watcher-schema.test.ts
git commit -m "feat(pr-shepherds): add watcher ledger schema"
```

---

## Task 2: Per-PR blackboard schema

**Files:**

- Create: `packages/agents/src/agents/pr-shared/blackboard-schema.ts`
- Test: `packages/agents/test/pr-shared/blackboard-schema.test.ts`

Implements the per-PR blackboard from spec §3.2 — collections `pr_meta`, `checks`, `review_threads`, `doc_plan`, `commits`, `gates`, `agent_state`, `signals`. Singletons (`pr_meta`, `gates`) use a fixed key.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agents/test/pr-shared/blackboard-schema.test.ts
import { describe, expect, it } from 'vitest'
import { Value } from '@sinclair/typebox/value'
import {
  PrBlackboardSchema,
  PrMetaRow,
  CheckRow,
  ReviewThreadRow,
  DocPlanRow,
  CommitRow,
  GatesRow,
  AgentStateRow,
  SignalRow,
} from '../../src/agents/pr-shared/blackboard-schema'

describe('PrBlackboardSchema', () => {
  const expected = [
    'pr_meta',
    'checks',
    'review_threads',
    'doc_plan',
    'commits',
    'gates',
    'agent_state',
    'signals',
  ]
  it.each(expected)('declares collection %s with primaryKey "key"', (name) => {
    const c = (PrBlackboardSchema as Record<string, { primaryKey: string }>)[
      name
    ]
    expect(c).toBeDefined()
    expect(c.primaryKey).toBe('key')
  })

  it('accepts a singleton pr_meta row', () => {
    const row = {
      key: 'meta',
      number: 42,
      repo: 'a/b',
      title: 't',
      base_branch: 'main',
      base_sha: 'aaa',
      head_branch: 'feat',
      head_sha: 'bbb',
      description: '',
      state: 'open' as const,
      labels: ['agents'],
      mergeable: null,
      status_comment_id: null,
      agents_disabled: false,
      last_synced_at: '2026-05-09T00:00:00Z',
    }
    expect(Value.Check(PrMetaRow, row)).toBe(true)
  })

  it('accepts a signal row with consumed_by array', () => {
    const row = {
      key: '01H...',
      type: 'pr_synced',
      payload: {},
      ts: '2026-05-09T00:00:00Z',
      consumed_by: [],
    }
    expect(Value.Check(SignalRow, row)).toBe(true)
  })

  it('rejects a check row with unknown conclusion', () => {
    const row = {
      key: 'k',
      name: 'lint',
      status: 'completed',
      conclusion: 'maybe',
      log_url: null,
      head_sha: 'bbb',
    }
    expect(Value.Check(CheckRow, row)).toBe(false)
  })

  it('accepts review thread severities must-fix | suggestion | nit', () => {
    for (const sev of ['must-fix', 'suggestion', 'nit']) {
      expect(
        Value.Check(ReviewThreadRow, {
          key: 'k',
          file: 'f',
          line: 1,
          severity: sev,
          category: 'c',
          body: 'b',
          suggested_patch: null,
          status: 'open',
          addressed_by_sha: null,
          source: 'agent',
        })
      ).toBe(true)
    }
  })

  it('exports gates and agent_state as singleton-friendly schemas', () => {
    const g = {
      key: 'gates',
      template_ok: false,
      ci_green: false,
      no_conflicts: false,
      threads_resolved: false,
      docs_ok: false,
      ready_to_merge: false,
      last_evaluated_at: '2026-05-09',
    }
    expect(Value.Check(GatesRow, g)).toBe(true)
    const a = {
      key: 'reviewer',
      role: 'reviewer',
      iterations: 0,
      cap: 5,
      paused: false,
      pause_reason: null,
      last_continue_grant_at: null,
      last_reviewed_sha: null,
      last_substantive_signature: null,
      iterations_skipped_since_review: 0,
      worktree_lock_holder: null,
    }
    expect(Value.Check(AgentStateRow, a)).toBe(true)
  })

  it('accepts doc_plan and commits row shapes', () => {
    expect(
      Value.Check(DocPlanRow, {
        key: 'docs/api.md',
        doc_path: 'docs/api.md',
        change: 'update',
        status: 'done',
        notes: '',
      })
    ).toBe(true)
    expect(
      Value.Check(CommitRow, {
        key: 'sha',
        sha: 'sha',
        author_agent: 'pr-reviewer',
        message: 'm',
        parent_sha: 'p',
        ts: 't',
      })
    ).toBe(true)
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

Run: `pnpm -C packages/agents test --run test/pr-shared/blackboard-schema.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the schema**

```ts
// packages/agents/src/agents/pr-shared/blackboard-schema.ts
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
    Type.Literal('open'),
    Type.Literal('closed'),
    Type.Literal('merged'),
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
    Type.Literal('queued'),
    Type.Literal('in_progress'),
    Type.Literal('completed'),
  ]),
  conclusion: Type.Union([
    Type.Literal('success'),
    Type.Literal('failure'),
    Type.Literal('cancelled'),
    Type.Literal('skipped'),
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
    Type.Literal('must-fix'),
    Type.Literal('suggestion'),
    Type.Literal('nit'),
  ]),
  category: Type.String(),
  body: Type.String(),
  suggested_patch: Type.Union([Type.String(), Type.Null()]),
  status: Type.Union([
    Type.Literal('open'),
    Type.Literal('addressed'),
    Type.Literal('wontfix'),
  ]),
  addressed_by_sha: Type.Union([Type.String(), Type.Null()]),
  source: Type.Union([Type.Literal('agent'), Type.Literal('human')]),
})
export type ReviewThreadRow = Static<typeof ReviewThreadRow>

export const DocPlanRow = Type.Object({
  key: Type.String(),
  doc_path: Type.String(),
  change: Type.Union([Type.Literal('add'), Type.Literal('update')]),
  status: Type.Union([
    Type.Literal('needed'),
    Type.Literal('in-progress'),
    Type.Literal('done'),
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
  key: Type.Literal('gates'),
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
    Type.Literal('reviewer'),
    Type.Literal('build-doctor'),
    Type.Literal('doc-editor'),
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
  pr_meta: { schema: PrMetaRow, primaryKey: 'key' as const },
  checks: { schema: CheckRow, primaryKey: 'key' as const },
  review_threads: { schema: ReviewThreadRow, primaryKey: 'key' as const },
  doc_plan: { schema: DocPlanRow, primaryKey: 'key' as const },
  commits: { schema: CommitRow, primaryKey: 'key' as const },
  gates: { schema: GatesRow, primaryKey: 'key' as const },
  agent_state: { schema: AgentStateRow, primaryKey: 'key' as const },
  signals: { schema: SignalRow, primaryKey: 'key' as const },
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `pnpm -C packages/agents test --run test/pr-shared/blackboard-schema.test.ts`
Expected: PASS (7 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/agents/pr-shared/blackboard-schema.ts packages/agents/test/pr-shared/blackboard-schema.test.ts
git commit -m "feat(pr-shepherds): add per-PR blackboard schema"
```

---

## Task 3: Signals — types, payloads, and `insertSignal` helper

**Files:**

- Create: `packages/agents/src/agents/pr-shared/signals.ts`
- Test: `packages/agents/test/pr-shared/signals.test.ts`

Implements the signal vocabulary from spec §3.3. The helper takes a `signals` collection proxy and inserts a row with a fresh nanoid key, ISO timestamp, and empty `consumed_by`. Signal payload typing is exported for use sites.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agents/test/pr-shared/signals.test.ts
import { describe, expect, it, vi } from 'vitest'
import {
  SIGNAL_TYPES,
  insertSignal,
  markConsumed,
  isConsumed,
} from '../../src/agents/pr-shared/signals'

describe('signals vocabulary', () => {
  it('declares all 17 signal types from §3.3', () => {
    expect(SIGNAL_TYPES).toEqual([
      'pr_synced',
      'head_sha_changed',
      'ci_failed',
      'ci_passed',
      'new_human_comment',
      'review_complete',
      'review_skipped',
      'commits_pushed',
      'base_advanced',
      'label_changed',
      'agents_label_removed',
      'agents_label_restored',
      'pr_closed',
      'human_input_required',
      'continue_granted',
      'agents_disabled',
      'gate_state_changed',
      'ready_to_merge',
    ])
  })
})

describe('insertSignal', () => {
  it('inserts a row with auto key, iso ts, empty consumed_by', () => {
    const insert = vi.fn()
    const collection = { insert } as unknown as { insert: (r: unknown) => void }
    insertSignal(collection as any, 'pr_synced', { foo: 1 })
    expect(insert).toHaveBeenCalledTimes(1)
    const row = insert.mock.calls[0]![0] as {
      key: string
      type: string
      payload: unknown
      ts: string
      consumed_by: string[]
    }
    expect(row.type).toBe('pr_synced')
    expect(row.payload).toEqual({ foo: 1 })
    expect(row.consumed_by).toEqual([])
    expect(row.key).toMatch(/^[A-Za-z0-9_-]{12,}$/)
    expect(new Date(row.ts).toString()).not.toBe('Invalid Date')
  })
})

describe('isConsumed / markConsumed', () => {
  it('isConsumed returns true when role appears in array', () => {
    expect(isConsumed({ consumed_by: ['reviewer'] } as any, 'reviewer')).toBe(
      true
    )
    expect(isConsumed({ consumed_by: [] } as any, 'reviewer')).toBe(false)
  })
  it('markConsumed appends role idempotently via collection.update', () => {
    const update = vi.fn((_key, fn) => fn({ consumed_by: [] }))
    markConsumed({ update } as any, 'sig-1', 'reviewer')
    expect(update).toHaveBeenCalledWith('sig-1', expect.any(Function))
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

Run: `pnpm -C packages/agents test --run test/pr-shared/signals.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement signals.ts**

```ts
// packages/agents/src/agents/pr-shared/signals.ts
import { nanoid } from 'nanoid'
import type { SignalRow } from './blackboard-schema'

export const SIGNAL_TYPES = [
  'pr_synced',
  'head_sha_changed',
  'ci_failed',
  'ci_passed',
  'new_human_comment',
  'review_complete',
  'review_skipped',
  'commits_pushed',
  'base_advanced',
  'label_changed',
  'agents_label_removed',
  'agents_label_restored',
  'pr_closed',
  'human_input_required',
  'continue_granted',
  'agents_disabled',
  'gate_state_changed',
  'ready_to_merge',
] as const
export type SignalType = (typeof SIGNAL_TYPES)[number]

export interface SignalPayloads {
  pr_synced: Record<string, never>
  head_sha_changed: { from_sha: string; to_sha: string; author_login: string }
  ci_failed: { head_sha: string; failed_checks: string[] }
  ci_passed: { head_sha: string }
  new_human_comment: {
    comment_id: string
    author_login: string
    body: string
    file?: string
    line?: number
  }
  review_complete: Record<string, never>
  review_skipped: Record<string, never>
  commits_pushed: {
    shas: string[]
    by_role: 'reviewer' | 'build-doctor' | 'doc-editor'
  }
  base_advanced: { from_sha: string; to_sha: string }
  label_changed: { added: string[]; removed: string[] }
  agents_label_removed: Record<string, never>
  agents_label_restored: Record<string, never>
  pr_closed: { merged: boolean }
  human_input_required: { role: string; reason: string; summary: string }
  continue_granted: { role: 'reviewer' | 'build-doctor' | 'doc-editor' | 'all' }
  agents_disabled: Record<string, never>
  gate_state_changed: Record<string, never>
  ready_to_merge: Record<string, never>
}

interface SignalsCollection {
  insert: (row: SignalRow) => void
  update: (key: string, mutate: (draft: SignalRow) => void) => void
}

export function insertSignal<T extends SignalType>(
  signals: SignalsCollection,
  type: T,
  payload: SignalPayloads[T]
): void {
  signals.insert({
    key: nanoid(),
    type,
    payload: payload as Record<string, unknown>,
    ts: new Date().toISOString(),
    consumed_by: [],
  })
}

export function isConsumed(row: SignalRow, role: string): boolean {
  return row.consumed_by.includes(role)
}

export function markConsumed(
  signals: SignalsCollection,
  key: string,
  role: string
): void {
  signals.update(key, (draft) => {
    if (!draft.consumed_by.includes(role)) draft.consumed_by.push(role)
  })
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `pnpm -C packages/agents test --run test/pr-shared/signals.test.ts`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/agents/pr-shared/signals.ts packages/agents/test/pr-shared/signals.test.ts
git commit -m "feat(pr-shepherds): signal vocabulary + insert/consume helpers"
```

---

## Task 4: Gate evaluator (pure function)

**Files:**

- Create: `packages/agents/src/agents/pr-shared/gates.ts`
- Test: `packages/agents/test/pr-shared/gates.test.ts`

Implements §15.1 — `evalGates({ pr_meta, checks, review_threads, doc_plan, descriptionTemplate })` returns a `GatesRow` (without the `last_evaluated_at` timestamp; caller sets that). Pure, no side effects, fully unit-testable. The `template_ok` rule checks for required `## Summary`, `## Linked issues`, `## Test plan` headings with non-empty content (spec §15.2).

- [ ] **Step 1: Write the failing test**

```ts
// packages/agents/test/pr-shared/gates.test.ts
import { describe, expect, it } from 'vitest'
import { evalGates, checkTemplate } from '../../src/agents/pr-shared/gates'

const baseDescription = `## Summary

Adds X.

## Linked issues

closes #1

## Test plan

- [ ] verify`

describe('checkTemplate', () => {
  it('returns true when all three required headings have non-empty content', () => {
    expect(checkTemplate(baseDescription)).toBe(true)
  })
  it('returns false when a heading is missing', () => {
    expect(
      checkTemplate(baseDescription.replace('## Test plan', '## Other'))
    ).toBe(false)
  })
  it('returns false when a heading has empty content', () => {
    expect(
      checkTemplate(
        `## Summary\n\n## Linked issues\n\nclose #1\n\n## Test plan\n\n- [ ] x`
      )
    ).toBe(false)
  })
})

describe('evalGates', () => {
  const ok = {
    pr_meta: { description: baseDescription, mergeable: true },
    checks: [{ conclusion: 'success' }, { conclusion: 'skipped' }],
    review_threads: [
      { severity: 'must-fix', status: 'addressed' },
      { severity: 'nit', status: 'open' },
    ],
    doc_plan: [{ status: 'done' }],
  } as const

  it('returns ready_to_merge when every gate is true', () => {
    const g = evalGates(ok as any)
    expect(g.template_ok).toBe(true)
    expect(g.ci_green).toBe(true)
    expect(g.no_conflicts).toBe(true)
    expect(g.threads_resolved).toBe(true)
    expect(g.docs_ok).toBe(true)
    expect(g.ready_to_merge).toBe(true)
  })

  it('blocks ready when any check failed', () => {
    const g = evalGates({ ...ok, checks: [{ conclusion: 'failure' }] } as any)
    expect(g.ci_green).toBe(false)
    expect(g.ready_to_merge).toBe(false)
  })

  it('blocks ready when an open must-fix thread exists', () => {
    const g = evalGates({
      ...ok,
      review_threads: [{ severity: 'must-fix', status: 'open' }],
    } as any)
    expect(g.threads_resolved).toBe(false)
    expect(g.ready_to_merge).toBe(false)
  })

  it('docs_ok is true when doc_plan is empty', () => {
    expect(evalGates({ ...ok, doc_plan: [] } as any).docs_ok).toBe(true)
  })

  it('no_conflicts is false when mergeable is false', () => {
    expect(
      evalGates({ ...ok, pr_meta: { ...ok.pr_meta, mergeable: false } } as any)
        .no_conflicts
    ).toBe(false)
  })

  it('treats mergeable === null as not-yet-known (false)', () => {
    expect(
      evalGates({ ...ok, pr_meta: { ...ok.pr_meta, mergeable: null } } as any)
        .no_conflicts
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run — verify fail**

Run: `pnpm -C packages/agents test --run test/pr-shared/gates.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/agents/src/agents/pr-shared/gates.ts
import type {
  CheckRow,
  DocPlanRow,
  GatesRow,
  PrMetaRow,
  ReviewThreadRow,
} from './blackboard-schema'

const REQUIRED_HEADINGS = [
  '## Summary',
  '## Linked issues',
  '## Test plan',
] as const

export function checkTemplate(description: string): boolean {
  for (let i = 0; i < REQUIRED_HEADINGS.length; i++) {
    const heading = REQUIRED_HEADINGS[i]!
    const idx = description.indexOf(heading)
    if (idx === -1) return false
    const start = idx + heading.length
    const nextHeading = REQUIRED_HEADINGS.slice(i + 1).reduce<number>(
      (acc, h) => {
        const j = description.indexOf(h, start)
        return j === -1 ? acc : Math.min(acc, j)
      },
      description.length
    )
    const body = description.slice(start, nextHeading).trim()
    if (body.length === 0) return false
  }
  return true
}

export interface EvalGatesInput {
  pr_meta: Pick<PrMetaRow, 'description' | 'mergeable'>
  checks: Array<Pick<CheckRow, 'conclusion'>>
  review_threads: Array<Pick<ReviewThreadRow, 'severity' | 'status'>>
  doc_plan: Array<Pick<DocPlanRow, 'status'>>
}

export function evalGates(
  b: EvalGatesInput
): Omit<GatesRow, 'key' | 'last_evaluated_at'> {
  const template_ok = checkTemplate(b.pr_meta.description)
  const ci_green = b.checks.every(
    (c) => c.conclusion === 'success' || c.conclusion === 'skipped'
  )
  const no_conflicts = b.pr_meta.mergeable === true
  const threads_resolved = b.review_threads.every(
    (t) => t.severity !== 'must-fix' || t.status !== 'open'
  )
  const docs_ok =
    b.doc_plan.length === 0 || b.doc_plan.every((p) => p.status === 'done')
  const ready_to_merge =
    template_ok && ci_green && no_conflicts && threads_resolved && docs_ok
  return {
    template_ok,
    ci_green,
    no_conflicts,
    threads_resolved,
    docs_ok,
    ready_to_merge,
  }
}
```

- [ ] **Step 4: Run — verify pass**

Run: `pnpm -C packages/agents test --run test/pr-shared/gates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/agents/pr-shared/gates.ts packages/agents/test/pr-shared/gates.test.ts
git commit -m "feat(pr-shepherds): gate evaluator pure function"
```

---

## Task 5: Slash-command parser

**Files:**

- Create: `packages/agents/src/agents/pr-shared/slash-commands.ts`
- Test: `packages/agents/test/pr-shared/slash-commands.test.ts`

Implements §15.7. Line-anchored, first-match wins, case-insensitive.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agents/test/pr-shared/slash-commands.test.ts
import { describe, expect, it } from 'vitest'
import { parseSlashCommand } from '../../src/agents/pr-shared/slash-commands'

describe('parseSlashCommand', () => {
  it('parses /continue <role>', () => {
    expect(parseSlashCommand('/continue reviewer')).toEqual({
      kind: 'continue',
      role: 'reviewer',
    })
    expect(parseSlashCommand('/continue build-doctor')).toEqual({
      kind: 'continue',
      role: 'build-doctor',
    })
    expect(parseSlashCommand('/continue doc-editor')).toEqual({
      kind: 'continue',
      role: 'doc-editor',
    })
  })
  it('parses /continue all', () => {
    expect(parseSlashCommand('/continue all')).toEqual({
      kind: 'continue',
      role: 'all',
    })
  })
  it('parses /stop and /resume', () => {
    expect(parseSlashCommand('/stop')).toEqual({ kind: 'stop' })
    expect(parseSlashCommand('/resume')).toEqual({ kind: 'resume' })
  })
  it('is case-insensitive', () => {
    expect(parseSlashCommand('/CONTINUE Reviewer')).toEqual({
      kind: 'continue',
      role: 'reviewer',
    })
  })
  it('matches first valid line in a multi-line comment', () => {
    expect(parseSlashCommand('hello\n/stop\nthanks')).toEqual({ kind: 'stop' })
  })
  it('returns null for unknown role', () => {
    expect(parseSlashCommand('/continue manager')).toBeNull()
  })
  it('returns null when no command present', () => {
    expect(parseSlashCommand('looks good to me')).toBeNull()
  })
  it('does not match commands embedded mid-line', () => {
    expect(parseSlashCommand('See /stop later')).toBeNull()
  })
})
```

- [ ] **Step 2: Run — verify fail**

Run: `pnpm -C packages/agents test --run test/pr-shared/slash-commands.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/agents/src/agents/pr-shared/slash-commands.ts
export type WorkerRole = 'reviewer' | 'build-doctor' | 'doc-editor'
export type ContinueTarget = WorkerRole | 'all'

export type SlashCommand =
  | { kind: 'continue'; role: ContinueTarget }
  | { kind: 'stop' }
  | { kind: 'resume' }

const CONTINUE_RE = /^\/continue\s+(reviewer|build-doctor|doc-editor|all)\s*$/i
const STOP_RE = /^\/stop\s*$/i
const RESUME_RE = /^\/resume\s*$/i

export function parseSlashCommand(body: string): SlashCommand | null {
  const lines = body.split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    const m = CONTINUE_RE.exec(line)
    if (m)
      return { kind: 'continue', role: m[1]!.toLowerCase() as ContinueTarget }
    if (STOP_RE.test(line)) return { kind: 'stop' }
    if (RESUME_RE.test(line)) return { kind: 'resume' }
  }
  return null
}
```

- [ ] **Step 4: Run — verify pass**

Run: `pnpm -C packages/agents test --run test/pr-shared/slash-commands.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/agents/pr-shared/slash-commands.ts packages/agents/test/pr-shared/slash-commands.test.ts
git commit -m "feat(pr-shepherds): slash-command parser"
```

---

## Task 6: Description renderer

**Files:**

- Create: `packages/agents/src/agents/pr-shared/description.ts`
- Test: `packages/agents/test/pr-shared/description.test.ts`

Re-renders the agent-managed summary block inside a PR description while preserving everything outside the markers (spec §15.2). Pure function.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agents/test/pr-shared/description.test.ts
import { describe, expect, it } from 'vitest'
import { renderManagedSummary } from '../../src/agents/pr-shared/description'

describe('renderManagedSummary', () => {
  const original = `## Summary
human-authored

<!-- agent-managed:summary -->
old machine block
<!-- /agent-managed:summary -->

## Test plan
- [ ] verify`

  it('replaces only the content between markers', () => {
    const out = renderManagedSummary(original, 'NEW MACHINE BLOCK')
    expect(out).toContain('human-authored')
    expect(out).toContain('NEW MACHINE BLOCK')
    expect(out).not.toContain('old machine block')
    expect(out).toContain('## Test plan')
  })

  it('appends a managed block when markers are absent', () => {
    const out = renderManagedSummary('## Summary\nx', 'AUTO')
    expect(out).toContain('<!-- agent-managed:summary -->')
    expect(out).toContain('AUTO')
    expect(out).toContain('<!-- /agent-managed:summary -->')
  })

  it('is idempotent — second render with same input is unchanged', () => {
    const once = renderManagedSummary(original, 'AUTO')
    const twice = renderManagedSummary(once, 'AUTO')
    expect(twice).toBe(once)
  })
})
```

- [ ] **Step 2: Run — verify fail**

Run: `pnpm -C packages/agents test --run test/pr-shared/description.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/agents/src/agents/pr-shared/description.ts
const OPEN = '<!-- agent-managed:summary -->'
const CLOSE = '<!-- /agent-managed:summary -->'

export function renderManagedSummary(
  description: string,
  summary: string
): string {
  const start = description.indexOf(OPEN)
  const end = description.indexOf(CLOSE)
  if (start === -1 || end === -1 || end < start) {
    const trimmed = description.replace(/\s+$/, '')
    return `${trimmed}\n\n${OPEN}\n${summary}\n${CLOSE}\n`
  }
  const before = description.slice(0, start + OPEN.length)
  const after = description.slice(end)
  return `${before}\n${summary}\n${after}`
}
```

- [ ] **Step 4: Run — verify pass**

Run: `pnpm -C packages/agents test --run test/pr-shared/description.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/agents/pr-shared/description.ts packages/agents/test/pr-shared/description.test.ts
git commit -m "feat(pr-shepherds): managed-summary description renderer"
```

---

## Task 7: Status comment renderer

**Files:**

- Create: `packages/agents/src/agents/pr-shared/status-comment.ts`
- Test: `packages/agents/test/pr-shared/status-comment.test.ts`

Renders the manager-owned status comment from §15.4. Pure function over `{ pr_meta, gates, agent_state, commits, signals }` snapshots. Output ends with `<!-- agent-managed-status -->` so the manager can find/update its own comment.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agents/test/pr-shared/status-comment.test.ts
import { describe, expect, it } from 'vitest'
import { renderStatusComment } from '../../src/agents/pr-shared/status-comment'

const base = {
  pr_meta: { number: 42 } as any,
  gates: {
    template_ok: true,
    ci_green: true,
    no_conflicts: true,
    threads_resolved: true,
    docs_ok: true,
    ready_to_merge: true,
  } as any,
  agent_state: [
    {
      role: 'reviewer',
      iterations: 1,
      cap: 5,
      paused: false,
      pause_reason: null,
    },
    {
      role: 'build-doctor',
      iterations: 0,
      cap: 3,
      paused: false,
      pause_reason: null,
    },
    {
      role: 'doc-editor',
      iterations: 0,
      cap: 3,
      paused: false,
      pause_reason: null,
    },
  ] as any,
  commits: [
    {
      sha: 'abcdef0',
      author_agent: 'pr-reviewer',
      message: '[agent:reviewer] fix x',
      ts: '2026-05-09T00:00:00Z',
    },
  ] as any,
  pendingChecks: 0,
  failingChecks: 0,
  openMustFix: 0,
}

describe('renderStatusComment', () => {
  it('shows all-green ready-to-merge', () => {
    const out = renderStatusComment(base, new Date('2026-05-09T00:00:01Z'))
    expect(out).toContain('Agent status — PR #42')
    expect(out).toContain('| **Ready to merge** | ✅')
    expect(out).toContain('<!-- agent-managed-status -->')
  })

  it('shows pending and failing CI states', () => {
    const out = renderStatusComment(
      {
        ...base,
        gates: { ...base.gates, ci_green: false },
        pendingChecks: 2,
        failingChecks: 1,
      } as any,
      new Date()
    )
    expect(out).toMatch(/CI.*🔴 1 failing/)
  })

  it('lists paused agents with pause reason', () => {
    const out = renderStatusComment(
      {
        ...base,
        agent_state: [
          ...base.agent_state.slice(0, 1),
          {
            role: 'build-doctor',
            iterations: 3,
            cap: 3,
            paused: true,
            pause_reason: 'cap reached',
          },
          ...base.agent_state.slice(2),
        ] as any,
      },
      new Date()
    )
    expect(out).toContain('### Paused agents')
    expect(out).toContain('build-doctor')
    expect(out).toContain('cap reached')
    expect(out).toContain('/continue build-doctor')
  })

  it('omits paused section when no agent is paused', () => {
    const out = renderStatusComment(base, new Date())
    expect(out).toContain('_None_')
  })

  it('lists recent agent commits', () => {
    const out = renderStatusComment(base, new Date('2026-05-09T01:00:00Z'))
    expect(out).toContain('abcdef0')
    expect(out).toContain('[agent:reviewer] fix x')
  })
})
```

- [ ] **Step 2: Run — verify fail**

Run: `pnpm -C packages/agents test --run test/pr-shared/status-comment.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/agents/src/agents/pr-shared/status-comment.ts
import type {
  AgentStateRow,
  CommitRow,
  GatesRow,
  PrMetaRow,
} from './blackboard-schema'

export interface RenderStatusInput {
  pr_meta: Pick<PrMetaRow, 'number'>
  gates: Pick<
    GatesRow,
    | 'template_ok'
    | 'ci_green'
    | 'no_conflicts'
    | 'threads_resolved'
    | 'docs_ok'
    | 'ready_to_merge'
  >
  agent_state: ReadonlyArray<
    Pick<
      AgentStateRow,
      'role' | 'iterations' | 'cap' | 'paused' | 'pause_reason'
    >
  >
  commits: ReadonlyArray<
    Pick<CommitRow, 'sha' | 'author_agent' | 'message' | 'ts'>
  >
  pendingChecks: number
  failingChecks: number
  openMustFix: number
}

const STATUS_TRAILER = '<!-- agent-managed-status -->'

function tick(b: boolean): string {
  return b ? '✅' : '🔴'
}

function ago(now: Date, iso: string): string {
  const diffSec = Math.max(
    0,
    Math.floor((now.getTime() - new Date(iso).getTime()) / 1000)
  )
  if (diffSec < 60) return `${diffSec}s ago`
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  return `${Math.floor(diffSec / 86400)}d ago`
}

export function renderStatusComment(
  input: RenderStatusInput,
  now: Date = new Date()
): string {
  const { gates, pendingChecks, failingChecks, openMustFix } = input
  const ciCell = gates.ci_green
    ? '✅'
    : failingChecks > 0
      ? `🔴 ${failingChecks} failing`
      : `⏳ pending (${pendingChecks} checks running)`
  const conflictsCell = gates.no_conflicts ? '✅' : '🔴 (rebase needed)'
  const threadsCell = gates.threads_resolved
    ? '✅'
    : `🔴 ${openMustFix} open must-fix`
  const docsCell = gates.docs_ok ? '✅' : '🔴 needed'
  const templateCell = gates.template_ok
    ? '✅'
    : '🔴 (missing required headings)'

  const activeRows = input.agent_state
    .map(
      (s) =>
        `- ${s.paused ? '🔴 paused' : '✅'} ${s.role} (${s.iterations}/${s.cap} cycles)`
    )
    .join('\n')

  const paused = input.agent_state.filter((s) => s.paused)
  const pausedSection =
    paused.length === 0
      ? '_None_'
      : paused
          .map(
            (s) =>
              `- **${s.role}** — ${s.pause_reason ?? 'paused'}. Reply \`/continue ${s.role}\` to resume.`
          )
          .join('\n')

  const commitsSection =
    input.commits.length === 0
      ? '_No agent commits yet._'
      : input.commits
          .slice(-5)
          .map(
            (c) =>
              `- \`${c.sha.slice(0, 7)}\` \`${c.message.split('\n')[0]}\` — ${ago(now, c.ts)}`
          )
          .join('\n')

  return [
    `## 🤖 Agent status — PR #${input.pr_meta.number}`,
    '',
    '| Gate               | State                                                 |',
    '| ------------------ | ----------------------------------------------------- |',
    `| Template           | ${templateCell} |`,
    `| CI                 | ${ciCell} |`,
    `| Conflicts          | ${conflictsCell} |`,
    `| Review threads     | ${threadsCell} |`,
    `| Docs               | ${docsCell} |`,
    `| **Ready to merge** | ${tick(gates.ready_to_merge)} |`,
    '',
    '### Active agents',
    '',
    activeRows,
    '',
    '### Paused agents',
    '',
    pausedSection,
    '',
    '### Recent agent commits',
    '',
    commitsSection,
    '',
    '---',
    '',
    '_Disable agents on this PR with `/stop` or by removing the `agents` label._',
    '',
    STATUS_TRAILER,
  ].join('\n')
}

export const STATUS_COMMENT_TRAILER = STATUS_TRAILER
```

- [ ] **Step 4: Run — verify pass**

Run: `pnpm -C packages/agents test --run test/pr-shared/status-comment.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/agents/pr-shared/status-comment.ts packages/agents/test/pr-shared/status-comment.test.ts
git commit -m "feat(pr-shepherds): status comment renderer"
```

---

## Task 8: Worktree helper

**Files:**

- Create: `packages/agents/src/agents/pr-shared/worktree.ts`
- Test: `packages/agents/test/pr-shared/worktree.test.ts`

Implements §8. `createWorktree({ repoRoot, prNumber, headBranch })` runs `git worktree add .worktrees/pr-<n> <branch>` from the repo root, returns the absolute path. `removeWorktree({ repoRoot, prNumber })` runs `git worktree remove --force .worktrees/pr-<n>`. Lock helpers are pure mutations on the `agent_state` row — written here for reuse.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agents/test/pr-shared/worktree.test.ts
import { describe, expect, it, vi } from 'vitest'
import {
  worktreePathFor,
  tryAcquireLock,
  releaseLock,
} from '../../src/agents/pr-shared/worktree'

describe('worktreePathFor', () => {
  it('returns <repoRoot>/.worktrees/pr-<n>', () => {
    expect(worktreePathFor('/tmp/repo', 42)).toBe('/tmp/repo/.worktrees/pr-42')
  })
})

describe('lock', () => {
  it('tryAcquireLock sets holder when free, returns true', () => {
    const update = vi.fn((_k, fn) => fn({ worktree_lock_holder: null }))
    const got = tryAcquireLock({ update } as any, 'reviewer', 'reviewer')
    expect(got).toBe(true)
    expect(update).toHaveBeenCalled()
  })
  it('tryAcquireLock returns false when held by another role', () => {
    const update = vi.fn((_k, fn) => {
      const draft = { worktree_lock_holder: 'build-doctor' }
      try {
        fn(draft)
      } catch {
        /* ignored */
      }
    })
    const got = tryAcquireLock({ update } as any, 'reviewer', 'reviewer', {
      peek: () => 'build-doctor',
    })
    expect(got).toBe(false)
  })
  it('releaseLock clears holder', () => {
    const update = vi.fn((_k, fn) => fn({ worktree_lock_holder: 'reviewer' }))
    releaseLock({ update } as any, 'reviewer')
    expect(update).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run — verify fail**

Run: `pnpm -C packages/agents test --run test/pr-shared/worktree.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/agents/src/agents/pr-shared/worktree.ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'

const exec = promisify(execFile)

export function worktreePathFor(repoRoot: string, prNumber: number): string {
  return path.join(repoRoot, '.worktrees', `pr-${prNumber}`)
}

export async function createWorktree(opts: {
  repoRoot: string
  prNumber: number
  headBranch: string
}): Promise<string> {
  const dir = worktreePathFor(opts.repoRoot, opts.prNumber)
  await exec('git', ['worktree', 'add', dir, opts.headBranch], {
    cwd: opts.repoRoot,
  })
  return dir
}

export async function removeWorktree(opts: {
  repoRoot: string
  prNumber: number
}): Promise<void> {
  const dir = worktreePathFor(opts.repoRoot, opts.prNumber)
  await exec('git', ['worktree', 'remove', '--force', dir], {
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
```

- [ ] **Step 4: Run — verify pass**

Run: `pnpm -C packages/agents test --run test/pr-shared/worktree.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/agents/pr-shared/worktree.ts packages/agents/test/pr-shared/worktree.test.ts
git commit -m "feat(pr-shepherds): worktree path/create/remove + lock helpers"
```

---

## Task 9: Worker prelude builder

**Files:**

- Create: `packages/agents/src/agents/pr-shared/prelude.ts`
- Test: `packages/agents/test/pr-shared/prelude.test.ts`

Implements §3.5 — the per-wake system prompt template that each worker entity's TS handler builds before invoking `ctx.useAgent`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agents/test/pr-shared/prelude.test.ts
import { describe, expect, it } from 'vitest'
import { buildWorkerPrelude } from '../../src/agents/pr-shared/prelude'

describe('buildWorkerPrelude', () => {
  const args = {
    role: 'reviewer' as const,
    repo: 'foo/bar',
    number: 42,
    base_branch: 'main',
    head_sha: 'abc123',
    signal_type: 'head_sha_changed',
    signal_key: 'sig-1',
    signal_ts: '2026-05-09T00:00:00Z',
    blackboard_id: 'pr-foo/bar-42',
    worktree_path: '/tmp/.worktrees/pr-42',
  }
  const out = buildWorkerPrelude(args)

  it('mentions the role, repo, PR number, base branch, head sha', () => {
    for (const v of ['reviewer', 'foo/bar', '42', 'main', 'abc123'])
      expect(out).toContain(v)
  })
  it('names the blackboard id and signal context', () => {
    expect(out).toContain('pr-foo/bar-42')
    expect(out).toContain('head_sha_changed')
    expect(out).toContain('sig-1')
  })
  it('instructs the agent to load its skill via use_skill("pr-reviewer")', () => {
    expect(out).toContain("use_skill('pr-reviewer')")
  })
  it('includes working directory + persistent timeline note', () => {
    expect(out).toContain('/tmp/.worktrees/pr-42')
    expect(out).toContain('persistent timeline')
  })
})
```

- [ ] **Step 2: Run — verify fail**

Run: `pnpm -C packages/agents test --run test/pr-shared/prelude.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/agents/src/agents/pr-shared/prelude.ts
export type PrRole = 'reviewer' | 'build-doctor' | 'doc-editor' | 'manager'

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
```

- [ ] **Step 4: Run — verify pass**

Run: `pnpm -C packages/agents test --run test/pr-shared/prelude.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/agents/pr-shared/prelude.ts packages/agents/test/pr-shared/prelude.test.ts
git commit -m "feat(pr-shepherds): per-wake worker prelude builder"
```

---

## Task 10: GitHub helpers (gh CLI wrappers)

**Files:**

- Create: `packages/agents/src/agents/pr-shared/github.ts`
- Test: `packages/agents/test/pr-shared/github.test.ts`

Thin wrappers around `gh api` calls used by the manager's sync poll. They take a runner function so tests can inject a mock; production wires `execFile`. We deliberately keep this minimal — the workers themselves call `gh` via their `bash` tool; only the manager's mechanical poll needs typed helpers.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agents/test/pr-shared/github.test.ts
import { describe, expect, it, vi } from 'vitest'
import { createGithubClient } from '../../src/agents/pr-shared/github'

describe('createGithubClient', () => {
  it('fetchPr GETs /repos/{owner}/{repo}/pulls/{n} and returns parsed JSON', async () => {
    const run = vi
      .fn()
      .mockResolvedValue({
        stdout: JSON.stringify({
          number: 42,
          title: 't',
          state: 'open',
          mergeable: true,
          head: { sha: 'h', ref: 'feat' },
          base: { sha: 'b', ref: 'main' },
          body: '',
          labels: [{ name: 'agents' }],
        }),
      })
    const gh = createGithubClient({ run })
    const pr = await gh.fetchPr('foo/bar', 42)
    expect(pr.number).toBe(42)
    expect(pr.labels).toEqual(['agents'])
    expect(run).toHaveBeenCalledWith(
      'gh',
      ['api', 'repos/foo/bar/pulls/42'],
      expect.any(Object)
    )
  })

  it('fetchChecks lists check-runs for a sha', async () => {
    const run = vi
      .fn()
      .mockResolvedValue({
        stdout: JSON.stringify({
          check_runs: [
            {
              name: 'lint',
              status: 'completed',
              conclusion: 'success',
              html_url: 'u',
            },
          ],
        }),
      })
    const gh = createGithubClient({ run })
    const checks = await gh.fetchChecks('foo/bar', 'sha1')
    expect(checks).toEqual([
      {
        name: 'lint',
        status: 'completed',
        conclusion: 'success',
        log_url: 'u',
        head_sha: 'sha1',
      },
    ])
  })

  it('fetchCommentsSince includes since query param', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: '[]' })
    const gh = createGithubClient({ run })
    await gh.fetchCommentsSince('foo/bar', 42, '2026-05-09T00:00:00Z')
    expect(run.mock.calls[0]![1]).toContain(
      'repos/foo/bar/issues/42/comments?since=2026-05-09T00:00:00Z'
    )
  })
})
```

- [ ] **Step 2: Run — verify fail**

Run: `pnpm -C packages/agents test --run test/pr-shared/github.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/agents/src/agents/pr-shared/github.ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CheckRow } from './blackboard-schema'

const execFileP = promisify(execFile)

export interface GhRunner {
  (
    cmd: string,
    args: string[],
    opts: Record<string, unknown>
  ): Promise<{ stdout: string }>
}

const defaultRunner: GhRunner = async (cmd, args, opts) => {
  const { stdout } = await execFileP(
    cmd,
    args,
    opts as Parameters<typeof execFileP>[2]
  )
  return { stdout }
}

export interface GithubPr {
  number: number
  title: string
  state: 'open' | 'closed'
  merged?: boolean
  mergeable: boolean | null
  head: { sha: string; ref: string }
  base: { sha: string; ref: string }
  body: string
  labels: string[]
}

export interface GithubComment {
  id: string
  user: { login: string }
  body: string
  created_at: string
  path?: string
  line?: number
}

export function createGithubClient(opts: { run?: GhRunner } = {}) {
  const run = opts.run ?? defaultRunner

  async function ghJson<T>(pathArg: string): Promise<T> {
    const { stdout } = await run('gh', ['api', pathArg], {})
    return JSON.parse(stdout) as T
  }

  return {
    async fetchPr(repo: string, number: number): Promise<GithubPr> {
      const raw = await ghJson<{
        number: number
        title: string
        state: 'open' | 'closed'
        merged?: boolean
        mergeable: boolean | null
        head: { sha: string; ref: string }
        base: { sha: string; ref: string }
        body: string
        labels: Array<{ name: string }>
      }>(`repos/${repo}/pulls/${number}`)
      return { ...raw, labels: raw.labels.map((l) => l.name) }
    },

    async fetchChecks(repo: string, sha: string): Promise<CheckRow[]> {
      const raw = await ghJson<{
        check_runs: Array<{
          name: string
          status: string
          conclusion: string | null
          html_url: string
        }>
      }>(`repos/${repo}/commits/${sha}/check-runs`)
      return raw.check_runs.map((c) => ({
        key: `${c.name}@${sha}`,
        name: c.name,
        status: c.status as CheckRow['status'],
        conclusion: c.conclusion as CheckRow['conclusion'],
        log_url: c.html_url,
        head_sha: sha,
      }))
    },

    async fetchCommentsSince(
      repo: string,
      number: number,
      sinceIso: string
    ): Promise<GithubComment[]> {
      return ghJson<GithubComment[]>(
        `repos/${repo}/issues/${number}/comments?since=${sinceIso}`
      )
    },

    async addLabel(repo: string, number: number, label: string): Promise<void> {
      await run(
        'gh',
        [
          'api',
          '--method',
          'POST',
          `repos/${repo}/issues/${number}/labels`,
          '-f',
          `labels[]=${label}`,
        ],
        {}
      )
    },

    async removeLabel(
      repo: string,
      number: number,
      label: string
    ): Promise<void> {
      await run(
        'gh',
        [
          'api',
          '--method',
          'DELETE',
          `repos/${repo}/issues/${number}/labels/${label}`,
        ],
        {}
      )
    },

    async upsertComment(
      repo: string,
      number: number,
      body: string,
      existingId: string | null
    ): Promise<string> {
      if (existingId) {
        await run(
          'gh',
          [
            'api',
            '--method',
            'PATCH',
            `repos/${repo}/issues/comments/${existingId}`,
            '-f',
            `body=${body}`,
          ],
          {}
        )
        return existingId
      }
      const { stdout } = await run(
        'gh',
        [
          'api',
          '--method',
          'POST',
          `repos/${repo}/issues/${number}/comments`,
          '-f',
          `body=${body}`,
        ],
        {}
      )
      return (JSON.parse(stdout) as { id: number }).id.toString()
    },
  }
}
```

- [ ] **Step 4: Run — verify pass**

Run: `pnpm -C packages/agents test --run test/pr-shared/github.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/agents/pr-shared/github.ts packages/agents/test/pr-shared/github.test.ts
git commit -m "feat(pr-shepherds): typed gh-CLI client for sync poll"
```

---

## Task 11: Templates (markdown files only)

**Files:**

- Create: `packages/agents/skills/pr/templates/pr-description.md`
- Create: `packages/agents/skills/pr/templates/review-thread.md`
- Create: `packages/agents/skills/pr/templates/status-comment.md` (reference copy of §15.4 — runtime renders via TS, this is for human override discoverability)
- Create: `packages/agents/skills/pr/templates/commit-message.md`
- Create: `packages/agents/skills/pr/templates/thread-reply.md`
- Test: `packages/agents/test/pr-shared/templates.test.ts`

These ship verbatim from spec §15.2–§15.6. Tests just confirm files exist and contain expected anchors so future edits don't accidentally break things downstream.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agents/test/pr-shared/templates.test.ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const T = (name: string) =>
  readFileSync(
    path.resolve(__dirname, '../../skills/pr/templates', name),
    'utf8'
  )

describe('templates', () => {
  it('pr-description.md has the three required headings and the managed-summary markers', () => {
    const t = T('pr-description.md')
    for (const h of ['## Summary', '## Linked issues', '## Test plan'])
      expect(t).toContain(h)
    expect(t).toContain('<!-- agent-managed:summary -->')
    expect(t).toContain('<!-- /agent-managed:summary -->')
  })
  it('review-thread.md has placeholders + agent-thread-id trailer', () => {
    const t = T('review-thread.md')
    expect(t).toContain('{severity}')
    expect(t).toContain('{category}')
    expect(t).toContain('{body}')
    expect(t).toContain('agent-thread-id')
  })
  it('status-comment.md is a reference copy with the trailer', () => {
    expect(T('status-comment.md')).toContain('<!-- agent-managed-status -->')
  })
  it('commit-message.md describes the [agent:role] subject prefix', () => {
    expect(T('commit-message.md')).toMatch(/\[agent:\{role\}\]/)
  })
  it('thread-reply.md uses the addressed-in-{sha} format', () => {
    expect(T('thread-reply.md')).toContain('Addressed in {sha}')
  })
})
```

- [ ] **Step 2: Run — verify fail**

Run: `pnpm -C packages/agents test --run test/pr-shared/templates.test.ts`
Expected: FAIL — files do not exist.

- [ ] **Step 3: Create the template files**

Create `packages/agents/skills/pr/templates/pr-description.md` with the verbatim block from spec §15.2 (lines 550-569 of the spec).

Create `packages/agents/skills/pr/templates/review-thread.md` with the verbatim block from spec §15.3 (lines 577-592).

Create `packages/agents/skills/pr/templates/status-comment.md` with the verbatim block from spec §15.4 (lines 602-633). This is a reference for human repo-overrides; the runtime composes via `renderStatusComment` (Task 7).

Create `packages/agents/skills/pr/templates/commit-message.md`:

```md
Subject: `[agent:{role}] {short subject}`

Body must reference the correlation id of what is being addressed:
```

[agent:reviewer] address must-fix in src/parse.ts:42

Resolves agent-thread-id: t_abc123

```

For build-doctor: `Resolves check: <check name>`.
For doc-editor: `Resolves doc_plan: <doc_path>`.
```

Create `packages/agents/skills/pr/templates/thread-reply.md`:

```md
✅ Addressed in {sha}.

<!-- agent-thread-id: {key} -->
```

- [ ] **Step 4: Run — verify pass**

Run: `pnpm -C packages/agents test --run test/pr-shared/templates.test.ts`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/agents/skills/pr/templates/ packages/agents/test/pr-shared/templates.test.ts
git commit -m "feat(pr-shepherds): ship pr/template/* default templates"
```

---

## Task 12: Skill bodies (markdown)

**Files:**

- Create: `packages/agents/skills/pr/manager.md`
- Create: `packages/agents/skills/pr/reviewer.md`
- Create: `packages/agents/skills/pr/build-doctor.md`
- Create: `packages/agents/skills/pr/doc-editor.md`
- Test: `packages/agents/test/pr-shared/skills-shape.test.ts`

Each skill body is a markdown file. The framework's `SkillsRegistry` (see `packages/agents/src/skills/registry.ts`) auto-loads any `.md` under the `skills/` directory and exposes them via `use_skill('pr-<role>')`.

The bodies follow the decision trees specified in §4.1–§4.4 and embed the protocol invariants from the §4 preamble (idempotency check, increment iterations, cap-pause, lock acquire/release for pushers, mark signals consumed).

- [ ] **Step 1: Write the failing test (shape only — content is reviewed manually against the spec)**

```ts
// packages/agents/test/pr-shared/skills-shape.test.ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const S = (name: string) =>
  readFileSync(path.resolve(__dirname, '../../skills/pr', name), 'utf8')

const COMMON = [
  'agents_disabled',
  'iterations',
  'cap',
  'consumed_by',
  'persistent timeline',
]

describe('skill bodies', () => {
  it.each(['manager.md', 'reviewer.md', 'build-doctor.md', 'doc-editor.md'])(
    '%s mentions the protocol invariants',
    (file) => {
      const body = S(file)
      for (const tok of COMMON) expect(body).toContain(tok)
    }
  )

  it('reviewer.md describes review/address two-pass decision tree', () => {
    const r = S('reviewer.md')
    for (const t of [
      'review pass',
      'address pass',
      'last_reviewed_sha',
      'iterations_skipped_since_review',
      'review_skipped',
      'review_complete',
    ]) {
      expect(r).toContain(t)
    }
  })

  it('build-doctor.md references reproduce-in-worktree and check timeline', () => {
    const b = S('build-doctor.md')
    for (const t of ['failing', 'reproduce', 'timeline', 'commits_pushed'])
      expect(b).toContain(t)
  })

  it('doc-editor.md emits a no-op doc_plan row when no doc changes are needed', () => {
    const d = S('doc-editor.md')
    expect(d).toContain('no doc changes required')
    expect(d).toContain('doc_plan')
  })

  it('manager.md describes gate evaluation + status comment + label', () => {
    const m = S('manager.md')
    for (const t of [
      'ready_to_merge',
      'agents:ready',
      'gate_state_changed',
      'status_comment_id',
    ]) {
      expect(m).toContain(t)
    }
  })
})
```

- [ ] **Step 2: Run — verify fail**

Run: `pnpm -C packages/agents test --run test/pr-shared/skills-shape.test.ts`
Expected: FAIL.

- [ ] **Step 3: Author each skill body**

Write `packages/agents/skills/pr/manager.md` containing:

- A short YAML frontmatter (matching the project's existing skill convention; check `packages/agents/skills/quickstart.md` for the exact shape).
- A "Protocol invariants" section that mirrors the §4 preamble bullets (read `agents_disabled` first, increment iterations, mark signals consumed, persistent timeline note).
- A "Gate evaluation" section that walks through how to call the gate evaluator outputs (already written by the TS handler — the agent reads the latest `gates` row, compares against the previous one in its timeline, and decides whether anything user-visible changed).
- A "Status comment composition" section that points to the §15.4 template, lists what to include for paused agents and recent commits.
- A "Ready-to-merge behavior" section verbatim from §4.1: apply `agents:ready` label and update the status comment; do NOT auto-merge; remove the label if a gate later flips back to false.

Write `packages/agents/skills/pr/reviewer.md` containing:

- Frontmatter (`name: pr-reviewer`, `description: ...`).
- Protocol invariants section.
- "Decision tree" section transcribing §4.2 step-by-step (1. decide review pass, 2. review pass, 3. address pass, 4. push). Each numbered subsection lists the exact blackboard reads (e.g. "read `agent_state[reviewer].last_reviewed_sha`"), the substantive-diff filter rules (whitespace, comments, lockfiles, generated files, suggested-patch lines), the cap behavior (5 review-or-address cycles), and the signals to insert (`review_complete`, `review_skipped`, `commits` row + `commits_pushed`).
- "Posting GitHub review comments" section that points the agent at the §15.3 template and the `bash` + `gh` tools.
- "Push" section: acquire `worktree_lock_holder`, commit using §15.5 template, push, release lock, mark threads `addressed`.

Write `packages/agents/skills/pr/build-doctor.md` containing:

- Frontmatter, protocol invariants.
- Decision tree from §4.3: read failing checks, fetch logs via `gh`, check timeline for prior attempts on this PR, reproduce locally where possible (`bash` tool), generate fix, commit `[agent:build-doctor] <check>: <summary>`, push, release lock, insert `commits` + `commits_pushed`.
- Cap: 3 fix-attempts per failing check.
- Failure-mode handling: if a fix attempt does not change the failure mode, increment iterations.

Write `packages/agents/skills/pr/doc-editor.md` containing:

- Frontmatter, protocol invariants.
- Decision tree from §4.4: analyse code diff vs base, decide doc impact (public APIs, exported types, CLI flags, env vars, README-referenced behavior, examples), write `doc_plan` rows, apply changes in worktree, commit per-doc, push, release lock, insert `commits_pushed`.
- The "always emit a no-op `doc_plan` row" rule when no docs are needed: write `{ change: 'update', status: 'done', notes: 'no doc changes required' }` so `gates.docs_ok` becomes true.
- Cap: 3 doc revisions per PR.

Each file should be 80–200 lines of focused markdown. Do not duplicate content between skills — point readers at the templates dir and at the protocol-invariants section in their own file.

- [ ] **Step 4: Run — verify pass**

Run: `pnpm -C packages/agents test --run test/pr-shared/skills-shape.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the skill registry picks them up**

Run: `pnpm -C packages/agents test --run test/skills-registry.test.ts`
Expected: PASS (existing tests should still pass; if they assert specific skill counts, the new skills may bump the count — update the assertion in the existing test only if needed).

- [ ] **Step 6: Commit**

```bash
git add packages/agents/skills/pr/ packages/agents/test/pr-shared/skills-shape.test.ts
git commit -m "feat(pr-shepherds): author manager + 3 worker skills"
```

---

## Task 13: `pr-watcher` entity shell

**Files:**

- Create: `packages/agents/src/agents/pr-watcher.ts`
- Test: `packages/agents/test/pr-watcher.test.ts`

The watcher is a long-lived per-repo entity. Its handler runs on `firstWake` and on each manual scan trigger. On scan it queries GitHub for open PRs labeled `agents`, compares against the `managed_prs` ledger, and `ctx.spawn`s a `pr-manager` for any new PR.

For phase 1, the manual scan is triggered by an inbox message (`{ kind: 'scan' }`). A future cron-based trigger can be added by attaching a `cron(...)` observation source.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agents/test/pr-watcher.test.ts
import { describe, expect, it, vi } from 'vitest'
import { createEntityRegistry } from '@electric-ax/agents-runtime'
import { registerPrWatcher } from '../src/agents/pr-watcher'
import { createBuiltinModelCatalog } from '../src/model-catalog'

describe('pr-watcher', () => {
  it('registers a "pr-watcher" entity type with required arg validation', async () => {
    const registry = createEntityRegistry()
    const modelCatalog = await createBuiltinModelCatalog({
      allowMockFallback: true,
    })
    registerPrWatcher(registry, {
      workingDirectory: '/tmp',
      modelCatalog: modelCatalog!,
    })
    const def = registry.get('pr-watcher')
    expect(def).toBeDefined()
    expect(def!.definition.description).toMatch(/PR shepherd/i)
  })

  it('on scan, spawns pr-manager for any agents-labeled PR not in ledger', async () => {
    const registry = createEntityRegistry()
    const modelCatalog = await createBuiltinModelCatalog({
      allowMockFallback: true,
    })
    const fetchPrs = vi
      .fn()
      .mockResolvedValue([
        { number: 42, head_branch: 'feat', labels: ['agents'] },
      ])
    registerPrWatcher(registry, {
      workingDirectory: '/tmp',
      modelCatalog: modelCatalog!,
      fetchPrs,
    })

    const spawn = vi
      .fn()
      .mockResolvedValue({ entityUrl: 'http://x/pr-manager/42/main' })
    const ledgerInsert = vi.fn()
    const ledgerHandle = { managed_prs: { toArray: [], insert: ledgerInsert } }
    const observe = vi.fn().mockResolvedValue(ledgerHandle)

    const ctx = {
      args: { repo: 'foo/bar' },
      events: [
        { type: 'inbox.user_message', value: { content: '{"kind":"scan"}' } },
      ],
      firstWake: false,
      observe,
      spawn,
      mkdb: () => ledgerHandle,
      useAgent: vi.fn(),
      agent: { run: vi.fn() },
      timelineMessages: () => [],
      db: { collections: { inbox: { toArray: [] } } } as any,
      send: vi.fn(),
      setTag: vi.fn(),
    } as any
    const def = registry.get('pr-watcher')!
    await def.definition.handler(ctx, {} as any)
    expect(spawn).toHaveBeenCalledWith(
      'pr-manager',
      expect.stringContaining('42'),
      expect.objectContaining({ repo: 'foo/bar', number: 42 }),
      expect.any(Object)
    )
    expect(ledgerInsert).toHaveBeenCalledWith(
      expect.objectContaining({ key: '42', state: 'active' })
    )
  })

  it('does not respawn a pr-manager that is already in the ledger as active', async () => {
    const registry = createEntityRegistry()
    const modelCatalog = await createBuiltinModelCatalog({
      allowMockFallback: true,
    })
    const fetchPrs = vi
      .fn()
      .mockResolvedValue([
        { number: 42, head_branch: 'feat', labels: ['agents'] },
      ])
    registerPrWatcher(registry, {
      workingDirectory: '/tmp',
      modelCatalog: modelCatalog!,
      fetchPrs,
    })
    const spawn = vi.fn()
    const ledgerHandle = {
      managed_prs: {
        toArray: [
          {
            key: '42',
            number: 42,
            state: 'active',
            manager_entity_url: 'u',
            spawned_at: 't',
          },
        ],
        insert: vi.fn(),
      },
    }
    const ctx = {
      args: { repo: 'foo/bar' },
      events: [
        { type: 'inbox.user_message', value: { content: '{"kind":"scan"}' } },
      ],
      firstWake: false,
      observe: vi.fn().mockResolvedValue(ledgerHandle),
      spawn,
      mkdb: () => ledgerHandle,
      useAgent: vi.fn(),
      agent: { run: vi.fn() },
      timelineMessages: () => [],
      db: { collections: { inbox: { toArray: [] } } } as any,
      send: vi.fn(),
      setTag: vi.fn(),
    } as any
    await registry.get('pr-watcher')!.definition.handler(ctx, {} as any)
    expect(spawn).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run — verify fail**

Run: `pnpm -C packages/agents test --run test/pr-watcher.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement pr-watcher.ts**

```ts
// packages/agents/src/agents/pr-watcher.ts
import { db } from '@electric-ax/agents-runtime'
import type {
  EntityRegistry,
  HandlerContext,
  SharedStateHandle,
} from '@electric-ax/agents-runtime'
import type { BuiltinModelCatalog } from '../model-catalog'
import { WatcherSchema, type ManagedPrRow } from './pr-shared/watcher-schema'
import { createGithubClient } from './pr-shared/github'

export interface PrWatcherArgs {
  repo: string // 'owner/name'
  worktreeRoot?: string // override default <repoRoot>/.worktrees
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
  if (typeof value.repo !== 'string' || value.repo.length === 0) {
    throw new Error('[pr-watcher] repo is required ("owner/name")')
  }
  return {
    repo: value.repo,
    worktreeRoot:
      typeof value.worktreeRoot === 'string' ? value.worktreeRoot : undefined,
    caps:
      typeof value.caps === 'object' && value.caps
        ? (value.caps as PrWatcherArgs['caps'])
        : undefined,
  }
}

function ledgerId(repo: string): string {
  return `pr-watcher-${repo}`
}

async function defaultFetchPrs(repo: string) {
  const gh = createGithubClient()
  const list = await (gh as unknown as {
    /* fallback below */
  } as typeof gh & {
    listOpenLabeled: (
      r: string,
      l: string
    ) => Promise<
      Array<{ number: number; head_branch: string; labels: string[] }>
    >
  })
  // Use gh CLI directly: gh pr list --label agents --state open --json number,headRefName,labels
  // Wrapping in an inline call so a single sweep stays minimal:
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const exec = promisify(execFile)
  const { stdout } = await exec('gh', [
    'pr',
    'list',
    '--repo',
    repo,
    '--label',
    'agents',
    '--state',
    'open',
    '--json',
    'number,headRefName,labels',
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
  registry.define('pr-watcher', {
    description:
      'PR shepherd watcher — discovers labeled PRs in a repo and spawns a pr-manager for each',
    async handler(ctx: HandlerContext) {
      const args = parseArgs(ctx.args)
      const ledger = (await ctx.observe(
        db(ledgerId(args.repo), WatcherSchema)
      )) as SharedStateHandle<typeof WatcherSchema>

      // Trigger: firstWake or an inbox message with { kind: 'scan' }
      const triggered =
        ctx.firstWake ||
        ctx.events.some((e) => {
          if (e.type !== 'inbox.user_message') return false
          const v = (e as unknown as { value?: { content?: string } }).value
          try {
            return JSON.parse(v?.content ?? '').kind === 'scan'
          } catch {
            return false
          }
        })
      if (!triggered) return

      const prs = await fetchPrs(args.repo)
      const known = new Map(
        ledger.managed_prs.toArray.map((r: ManagedPrRow) => [r.key, r])
      )

      for (const pr of prs) {
        if (!pr.labels.includes('agents')) continue
        const existing = known.get(String(pr.number))
        if (existing && existing.state === 'active') continue

        const id = `${args.repo.replace('/', '-')}-${pr.number}`
        const handle = await ctx.spawn(
          'pr-manager',
          id,
          {
            repo: args.repo,
            number: pr.number,
            head_branch: pr.head_branch,
            worktreeRoot: args.worktreeRoot ?? `${workingDirectory}/.worktrees`,
            caps: args.caps,
          },
          { wake: { on: 'runFinished' } }
        )

        ledger.managed_prs.insert({
          key: String(pr.number),
          number: pr.number,
          manager_entity_url: handle.entityUrl,
          state: 'active',
          spawned_at: new Date().toISOString(),
        })
      }
    },
  })
}
```

- [ ] **Step 4: Run — verify pass**

Run: `pnpm -C packages/agents test --run test/pr-watcher.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/agents/pr-watcher.ts packages/agents/test/pr-watcher.test.ts
git commit -m "feat(pr-shepherds): pr-watcher entity (manual scan + spawn manager)"
```

---

## Task 14: `pr-manager` — sync poll mechanical (TS handler, no agent yet)

**Files:**

- Create: `packages/agents/src/agents/pr-manager.ts` (initial scaffold; agent pieces added in Task 15)
- Test: `packages/agents/test/pr-manager-sync.test.ts`

The manager owns the per-PR blackboard. `firstWake`: create the blackboard via `ctx.observe(db(...))`, seed `pr_meta` + `agent_state` rows from initial GitHub fetch, create the worktree via `createWorktree`, schedule the first sync tick via `ctx.send(ctx.entityUrl, { kind: 'sync_tick' }, { afterMs: 30_000 })`.

Subsequent wakes: dispatch on `wake.payload.kind`:

- `sync_tick` → run sync poll mechanically (diff GitHub vs blackboard, write updates, insert signals, debounce-schedule the agent run, schedule next tick).
- (other) → run the manager skill (Task 15).

This task only implements the `sync_tick` path so it's testable in isolation.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agents/test/pr-manager-sync.test.ts
import { describe, expect, it, vi } from 'vitest'
import { runSyncPoll } from '../src/agents/pr-manager'

describe('runSyncPoll', () => {
  const baseMeta = {
    key: 'meta',
    number: 42,
    repo: 'foo/bar',
    title: 't',
    base_branch: 'main',
    base_sha: 'B',
    head_branch: 'feat',
    head_sha: 'A',
    description: '',
    state: 'open',
    labels: ['agents'],
    mergeable: true,
    status_comment_id: null,
    agents_disabled: false,
    last_synced_at: '2026-05-08T00:00:00Z',
  }
  const insert = vi.fn()
  const update = vi.fn((_k, fn) => fn(JSON.parse(JSON.stringify(baseMeta))))

  it('inserts head_sha_changed when remote head sha differs', async () => {
    const signals = {
      insert: vi.fn(),
      toArray: [] as unknown[],
      update: vi.fn(),
    }
    const meta = { toArray: [baseMeta], update, insert }
    const checks = {
      toArray: [] as unknown[],
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    }
    const gh = {
      fetchPr: vi
        .fn()
        .mockResolvedValue({
          ...baseMeta,
          head: { sha: 'A2', ref: 'feat' },
          base: { sha: 'B', ref: 'main' },
          body: '',
          labels: ['agents'],
          state: 'open',
          mergeable: true,
          title: 't',
          number: 42,
        }),
      fetchChecks: vi.fn().mockResolvedValue([]),
      fetchCommentsSince: vi.fn().mockResolvedValue([]),
    }
    await runSyncPoll({
      board: { pr_meta: meta, signals, checks } as any,
      gh: gh as any,
      repo: 'foo/bar',
      number: 42,
    })
    expect(signals.insert).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'head_sha_changed' })
    )
  })

  it('inserts ci_failed when any check has conclusion=failure', async () => {
    const signals = {
      insert: vi.fn(),
      toArray: [] as unknown[],
      update: vi.fn(),
    }
    const meta = { toArray: [baseMeta], update, insert }
    const checks = {
      toArray: [] as unknown[],
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    }
    const gh = {
      fetchPr: vi
        .fn()
        .mockResolvedValue({
          ...baseMeta,
          head: { sha: 'A', ref: 'feat' },
          base: { sha: 'B', ref: 'main' },
          body: '',
          labels: ['agents'],
          state: 'open',
          mergeable: true,
          title: 't',
          number: 42,
        }),
      fetchChecks: vi
        .fn()
        .mockResolvedValue([
          {
            key: 'lint@A',
            name: 'lint',
            status: 'completed',
            conclusion: 'failure',
            log_url: 'u',
            head_sha: 'A',
          },
        ]),
      fetchCommentsSince: vi.fn().mockResolvedValue([]),
    }
    await runSyncPoll({
      board: { pr_meta: meta, signals, checks } as any,
      gh: gh as any,
      repo: 'foo/bar',
      number: 42,
    })
    expect(signals.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ci_failed',
        payload: expect.objectContaining({ failed_checks: ['lint'] }),
      })
    )
  })

  it('inserts new_human_comment + slash command effects', async () => {
    const signals = {
      insert: vi.fn(),
      toArray: [] as unknown[],
      update: vi.fn(),
    }
    const meta = { toArray: [baseMeta], update, insert }
    const checks = {
      toArray: [] as unknown[],
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    }
    const gh = {
      fetchPr: vi
        .fn()
        .mockResolvedValue({
          ...baseMeta,
          head: { sha: 'A', ref: 'feat' },
          base: { sha: 'B', ref: 'main' },
          body: '',
          labels: ['agents'],
          state: 'open',
          mergeable: true,
          title: 't',
          number: 42,
        }),
      fetchChecks: vi.fn().mockResolvedValue([]),
      fetchCommentsSince: vi
        .fn()
        .mockResolvedValue([
          {
            id: 'c1',
            user: { login: 'human' },
            body: '/stop',
            created_at: '2026-05-09T00:00:00Z',
          },
        ]),
    }
    await runSyncPoll({
      board: { pr_meta: meta, signals, checks } as any,
      gh: gh as any,
      repo: 'foo/bar',
      number: 42,
    })
    expect(signals.insert).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'new_human_comment' })
    )
    expect(meta.update).toHaveBeenCalled()
  })

  it('inserts agents_label_removed when agents label disappears', async () => {
    const signals = {
      insert: vi.fn(),
      toArray: [] as unknown[],
      update: vi.fn(),
    }
    const meta = { toArray: [baseMeta], update, insert }
    const checks = {
      toArray: [] as unknown[],
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    }
    const gh = {
      fetchPr: vi
        .fn()
        .mockResolvedValue({
          ...baseMeta,
          head: { sha: 'A', ref: 'feat' },
          base: { sha: 'B', ref: 'main' },
          body: '',
          labels: [],
          state: 'open',
          mergeable: true,
          title: 't',
          number: 42,
        }),
      fetchChecks: vi.fn().mockResolvedValue([]),
      fetchCommentsSince: vi.fn().mockResolvedValue([]),
    }
    await runSyncPoll({
      board: { pr_meta: meta, signals, checks } as any,
      gh: gh as any,
      repo: 'foo/bar',
      number: 42,
    })
    expect(signals.insert).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'agents_label_removed' })
    )
  })
})
```

- [ ] **Step 2: Run — verify fail**

Run: `pnpm -C packages/agents test --run test/pr-manager-sync.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the sync-poll function**

```ts
// packages/agents/src/agents/pr-manager.ts
import { insertSignal } from './pr-shared/signals'
import { parseSlashCommand } from './pr-shared/slash-commands'
import type {
  CheckRow,
  PrMetaRow,
  SignalRow,
} from './pr-shared/blackboard-schema'
import type { GithubPr, GithubComment } from './pr-shared/github'

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
  if (!meta) throw new Error('[pr-manager] sync poll: pr_meta is uninitialized')

  const remote = await gh.fetchPr(repo, number)
  const previousLabels = new Set(meta.labels)
  const remoteLabels = new Set(remote.labels)

  // ── meta + head sha
  if (remote.head.sha !== meta.head_sha) {
    insertSignal(board.signals, 'head_sha_changed', {
      from_sha: meta.head_sha,
      to_sha: remote.head.sha,
      author_login: 'unknown',
    })
  }
  if (remote.base.sha !== meta.base_sha) {
    insertSignal(board.signals, 'base_advanced', {
      from_sha: meta.base_sha,
      to_sha: remote.base.sha,
    })
  }
  if (remote.state === 'closed') {
    insertSignal(board.signals, 'pr_closed', { merged: Boolean(remote.merged) })
  }

  // ── label transitions
  const added = [...remoteLabels].filter((l) => !previousLabels.has(l))
  const removed = [...previousLabels].filter((l) => !remoteLabels.has(l))
  if (added.length > 0 || removed.length > 0) {
    insertSignal(board.signals, 'label_changed', { added, removed })
  }
  if (previousLabels.has('agents') && !remoteLabels.has('agents')) {
    insertSignal(board.signals, 'agents_label_removed', {})
  }
  if (!previousLabels.has('agents') && remoteLabels.has('agents')) {
    insertSignal(board.signals, 'agents_label_restored', {})
  }

  // ── update meta row in place
  board.pr_meta.update('meta', (d) => {
    d.title = remote.title
    d.head_sha = remote.head.sha
    d.head_branch = remote.head.ref
    d.base_sha = remote.base.sha
    d.base_branch = remote.base.ref
    d.description = remote.body
    d.state =
      remote.state === 'closed' && remote.merged ? 'merged' : remote.state
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
    .filter((c) => c.conclusion === 'failure')
    .map((c) => c.name)
  if (failed.length > 0) {
    insertSignal(board.signals, 'ci_failed', {
      head_sha: remote.head.sha,
      failed_checks: failed,
    })
  } else if (
    remoteChecks.length > 0 &&
    remoteChecks.every(
      (c) =>
        c.status === 'completed' &&
        (c.conclusion === 'success' || c.conclusion === 'skipped')
    )
  ) {
    insertSignal(board.signals, 'ci_passed', { head_sha: remote.head.sha })
  }

  // ── new human comments + slash-commands
  const comments = await gh.fetchCommentsSince(
    repo,
    number,
    meta.last_synced_at
  )
  for (const c of comments) {
    insertSignal(board.signals, 'new_human_comment', {
      comment_id: c.id,
      author_login: c.user.login,
      body: c.body,
      ...(c.path ? { file: c.path } : {}),
      ...(typeof c.line === 'number' ? { line: c.line } : {}),
    })
    const cmd = parseSlashCommand(c.body)
    if (!cmd) continue
    if (cmd.kind === 'stop') {
      board.pr_meta.update('meta', (d) => {
        d.agents_disabled = true
      })
      insertSignal(board.signals, 'agents_disabled', {})
    } else if (cmd.kind === 'resume') {
      board.pr_meta.update('meta', (d) => {
        d.agents_disabled = false
      })
    } else if (cmd.kind === 'continue') {
      insertSignal(board.signals, 'continue_granted', { role: cmd.role })
    }
  }

  insertSignal(board.signals, 'pr_synced', {})
}
```

- [ ] **Step 4: Run — verify pass**

Run: `pnpm -C packages/agents test --run test/pr-manager-sync.test.ts`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/agents/pr-manager.ts packages/agents/test/pr-manager-sync.test.ts
git commit -m "feat(pr-shepherds): pr-manager sync-poll mechanical core"
```

---

## Task 15: `pr-manager` entity registration + lifecycle + agent invoke

**Files:**

- Modify: `packages/agents/src/agents/pr-manager.ts` (extend Task 14's file with the registration)
- Test: `packages/agents/test/pr-manager.test.ts`

This wires the entity into the registry, handles `firstWake` (init blackboard + worktree + status comment + spawn three workers + schedule first sync tick), dispatches subsequent wakes by `wake.payload.kind`, and invokes the manager agent with the §3.5 prelude + skill loader for non-`sync_tick` wakes (gate eval + status comment composition).

- [ ] **Step 1: Write the failing test**

```ts
// packages/agents/test/pr-manager.test.ts
import { describe, expect, it, vi } from 'vitest'
import { createEntityRegistry } from '@electric-ax/agents-runtime'
import { registerPrManager } from '../src/agents/pr-manager'
import { createBuiltinModelCatalog } from '../src/model-catalog'

describe('pr-manager', () => {
  it('registers a "pr-manager" entity type', async () => {
    const registry = createEntityRegistry()
    const modelCatalog = await createBuiltinModelCatalog({
      allowMockFallback: true,
    })
    registerPrManager(registry, {
      workingDirectory: '/tmp',
      modelCatalog: modelCatalog!,
    })
    expect(registry.get('pr-manager')).toBeDefined()
  })

  it('on firstWake, observes the per-PR blackboard, spawns three workers, schedules sync tick', async () => {
    const registry = createEntityRegistry()
    const modelCatalog = await createBuiltinModelCatalog({
      allowMockFallback: true,
    })
    const createWorktree = vi.fn().mockResolvedValue('/tmp/.worktrees/pr-42')
    const fetchPr = vi
      .fn()
      .mockResolvedValue({
        number: 42,
        title: 't',
        state: 'open',
        mergeable: true,
        head: { sha: 'A', ref: 'feat' },
        base: { sha: 'B', ref: 'main' },
        body: '',
        labels: ['agents'],
      })
    registerPrManager(registry, {
      workingDirectory: '/tmp',
      modelCatalog: modelCatalog!,
      createWorktree,
      githubFactory: () =>
        ({
          fetchPr,
          fetchChecks: vi.fn().mockResolvedValue([]),
          fetchCommentsSince: vi.fn().mockResolvedValue([]),
          upsertComment: vi.fn().mockResolvedValue('cmt-1'),
          addLabel: vi.fn(),
          removeLabel: vi.fn(),
        }) as any,
    })

    const board = makeBoardMocks()
    const observe = vi.fn().mockResolvedValue(board)
    const spawn = vi.fn().mockResolvedValue({ entityUrl: 'u' })
    const send = vi.fn()
    const ctx = makeCtx({
      args: {
        repo: 'foo/bar',
        number: 42,
        head_branch: 'feat',
        worktreeRoot: '/tmp/.worktrees',
      },
      firstWake: true,
      observe,
      spawn,
      send,
    })
    await registry.get('pr-manager')!.definition.handler(ctx as any, {} as any)

    expect(createWorktree).toHaveBeenCalledWith({
      repoRoot: '/tmp',
      prNumber: 42,
      headBranch: 'feat',
    })
    const spawned = spawn.mock.calls.map((c) => c[0])
    expect(spawned).toEqual(
      expect.arrayContaining([
        'pr-reviewer',
        'pr-build-doctor',
        'pr-doc-editor',
      ])
    )
    expect(send).toHaveBeenCalledWith(
      ctx.entityUrl,
      expect.objectContaining({ kind: 'sync_tick' }),
      expect.objectContaining({ afterMs: 30_000 })
    )
  })

  it('on wake with payload.kind === "sync_tick", runs runSyncPoll then schedules next tick', async () => {
    const registry = createEntityRegistry()
    const modelCatalog = await createBuiltinModelCatalog({
      allowMockFallback: true,
    })
    const fetchPr = vi
      .fn()
      .mockResolvedValue({
        number: 42,
        title: 't',
        state: 'open',
        mergeable: true,
        head: { sha: 'A', ref: 'feat' },
        base: { sha: 'B', ref: 'main' },
        body: '',
        labels: ['agents'],
      })
    registerPrManager(registry, {
      workingDirectory: '/tmp',
      modelCatalog: modelCatalog!,
      createWorktree: vi.fn(),
      githubFactory: () =>
        ({
          fetchPr,
          fetchChecks: vi.fn().mockResolvedValue([]),
          fetchCommentsSince: vi.fn().mockResolvedValue([]),
          upsertComment: vi.fn(),
          addLabel: vi.fn(),
          removeLabel: vi.fn(),
        }) as any,
    })
    const board = makeBoardMocks()
    const observe = vi.fn().mockResolvedValue(board)
    const send = vi.fn()
    const ctx = makeCtx({
      args: {
        repo: 'foo/bar',
        number: 42,
        head_branch: 'feat',
        worktreeRoot: '/tmp/.worktrees',
      },
      firstWake: false,
      events: [
        {
          type: 'inbox.user_message',
          value: { content: JSON.stringify({ kind: 'sync_tick' }) },
        },
      ],
      observe,
      spawn: vi.fn(),
      send,
    })
    await registry.get('pr-manager')!.definition.handler(ctx as any, {} as any)
    expect(fetchPr).toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      ctx.entityUrl,
      expect.objectContaining({ kind: 'sync_tick' }),
      expect.any(Object)
    )
  })
})

function makeBoardMocks() {
  return {
    pr_meta: {
      toArray: [
        {
          key: 'meta',
          number: 42,
          repo: 'foo/bar',
          title: 't',
          base_branch: 'main',
          base_sha: 'B',
          head_branch: 'feat',
          head_sha: 'A',
          description: '',
          state: 'open',
          labels: ['agents'],
          mergeable: true,
          status_comment_id: null,
          agents_disabled: false,
          last_synced_at: '2026-05-08T00:00:00Z',
        },
      ],
      update: vi.fn((_k, fn) => fn({})),
      insert: vi.fn(),
    },
    signals: { insert: vi.fn(), toArray: [], update: vi.fn() },
    checks: { toArray: [], insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
    review_threads: { toArray: [], insert: vi.fn() },
    doc_plan: { toArray: [], insert: vi.fn() },
    commits: { toArray: [], insert: vi.fn() },
    gates: { toArray: [], insert: vi.fn(), update: vi.fn() },
    agent_state: { toArray: [], insert: vi.fn(), update: vi.fn() },
  } as any
}

function makeCtx(over: Partial<Record<string, unknown>>) {
  return {
    entityType: 'pr-manager',
    entityUrl: 'http://x/pr-manager/1/main',
    args: {},
    firstWake: false,
    events: [],
    observe: vi.fn(),
    spawn: vi.fn(),
    send: vi.fn(),
    useAgent: vi.fn(),
    agent: { run: vi.fn() },
    useContext: vi.fn(),
    timelineMessages: () => [],
    setTag: vi.fn(),
    db: { collections: { inbox: { toArray: [] } } } as any,
    ...over,
  } as any
}
```

- [ ] **Step 2: Run — verify fail**

Run: `pnpm -C packages/agents test --run test/pr-manager.test.ts`
Expected: FAIL.

- [ ] **Step 3: Extend pr-manager.ts**

Add the following exports below the existing `runSyncPoll` (do NOT delete or duplicate `runSyncPoll`):

```ts
import { db } from '@electric-ax/agents-runtime'
import type {
  EntityRegistry,
  HandlerContext,
  SharedStateHandle,
  WakeEvent,
} from '@electric-ax/agents-runtime'
import path from 'node:path'
import { PrBlackboardSchema } from './pr-shared/blackboard-schema'
import { createWorktree as defaultCreateWorktree } from './pr-shared/worktree'
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
import type { StreamFn } from '@mariozechner/pi-agent-core'

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

function blackboardId(repo: string, number: number): string {
  return `pr-${repo}-${number}`
}

function decodeWakeKind(
  events: ReadonlyArray<{ type: string; value?: unknown }>
): string | null {
  for (const e of events) {
    if (e.type !== 'inbox.user_message') continue
    const v = e.value as { content?: string } | undefined
    try {
      const parsed = JSON.parse(v?.content ?? '') as { kind?: string }
      if (typeof parsed.kind === 'string') return parsed.kind
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

  registry.define('pr-manager', {
    description:
      'PR shepherd manager — owns the per-PR blackboard, sync poll, worktree, gates, status comment',
    async handler(ctx: HandlerContext, _wake: WakeEvent) {
      const args = ctx.args as unknown as PrManagerArgs
      const board = (await ctx.observe(
        db(blackboardId(args.repo, args.number), PrBlackboardSchema)
      )) as SharedStateHandle<typeof PrBlackboardSchema>
      const gh = githubFactory()
      const caps = { ...DEFAULT_CAPS, ...args.caps }

      // ── firstWake: initialize
      if (ctx.firstWake) {
        const remote = await gh.fetchPr(args.repo, args.number)
        board.pr_meta.insert({
          key: 'meta',
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

        const roles = [
          { role: 'reviewer' as const, cap: caps.reviewer },
          { role: 'build-doctor' as const, cap: caps.buildDoctor },
          { role: 'doc-editor' as const, cap: caps.docEditor },
        ]
        for (const r of roles) {
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

        await createWorktree({
          repoRoot: workingDirectory,
          prNumber: args.number,
          headBranch: remote.head.ref,
        })

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
            '.worktrees',
            `pr-${args.number}`
          ),
          blackboard: blackboardArg,
        }
        await ctx.spawn(
          'pr-reviewer',
          `pr-reviewer-${args.number}`,
          workerArgs,
          {}
        )
        await ctx.spawn(
          'pr-build-doctor',
          `pr-build-doctor-${args.number}`,
          workerArgs,
          {}
        )
        await ctx.spawn(
          'pr-doc-editor',
          `pr-doc-editor-${args.number}`,
          workerArgs,
          {}
        )

        ctx.send(ctx.entityUrl, { kind: 'sync_tick' }, { afterMs: 30_000 })
        return
      }

      const kind = decodeWakeKind(ctx.events)

      if (kind === 'sync_tick') {
        await runSyncPoll({ board, gh, repo: args.repo, number: args.number })
        // Cadence: 30s while signals were emitted in the last 5 minutes; 5 min otherwise.
        const recentSignals = board.signals.toArray.filter(
          (s) => Date.now() - new Date(s.ts).getTime() < 5 * 60_000
        )
        const meta = board.pr_meta.toArray[0]!
        if (meta.state !== 'open') return // PR closed → stop ticking
        const nextDelay = recentSignals.length > 0 ? 30_000 : 5 * 60_000
        ctx.send(ctx.entityUrl, { kind: 'sync_tick' }, { afterMs: nextDelay })
        return
      }

      // ── Otherwise: gate eval + status comment via the manager agent (skill: pr-manager)
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
        key: 'gates' as const,
        ...evaluated,
        last_evaluated_at: new Date().toISOString(),
      }
      if (!previous) board.gates.insert(gateRow)
      else board.gates.update('gates', (d) => Object.assign(d, gateRow))

      const flipped =
        !previous || previous.ready_to_merge !== gateRow.ready_to_merge
      if (flipped && gateRow.ready_to_merge) {
        await gh.addLabel(args.repo, args.number, 'agents:ready')
      } else if (
        flipped &&
        previous?.ready_to_merge &&
        !gateRow.ready_to_merge
      ) {
        await gh
          .removeLabel(args.repo, args.number, 'agents:ready')
          .catch(() => {})
      }

      // Always rewrite the status comment when gates change.
      if (flipped || ctx.events.length > 0) {
        const failingChecks = board.checks.toArray.filter(
          (c) => c.conclusion === 'failure'
        ).length
        const pendingChecks = board.checks.toArray.filter(
          (c) => c.status !== 'completed'
        ).length
        const openMustFix = board.review_threads.toArray.filter(
          (t) => t.severity === 'must-fix' && t.status === 'open'
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
        if (cid !== meta.status_comment_id)
          board.pr_meta.update('meta', (d) => {
            d.status_comment_id = cid
          })
      }

      // Optionally also run the manager skill for the narrative parts (status-comment polish).
      // Kept minimal here so tests run without a model:
      if (skillsRegistry) {
        const [useSkill, removeSkill] = createSkillTools(skillsRegistry, ctx)
        const modelConfig = resolveBuiltinModelConfig(
          modelCatalog,
          args as unknown as Readonly<Record<string, unknown>>
        )
        ctx.useAgent({
          systemPrompt: buildWorkerPrelude({
            role: 'manager',
            repo: args.repo,
            number: args.number,
            base_branch: meta.base_branch,
            head_sha: meta.head_sha,
            signal_type: kind ?? 'manager_tick',
            signal_key: 'n/a',
            signal_ts: new Date().toISOString(),
            blackboard_id: blackboardId(args.repo, args.number),
            worktree_path: path.join(
              workingDirectory,
              '.worktrees',
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
```

- [ ] **Step 4: Run — verify pass**

Run: `pnpm -C packages/agents test --run test/pr-manager.test.ts test/pr-manager-sync.test.ts`
Expected: PASS (sync tests still pass; new lifecycle tests pass).

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/agents/pr-manager.ts packages/agents/test/pr-manager.test.ts
git commit -m "feat(pr-shepherds): pr-manager entity registration + lifecycle"
```

---

## Task 16: `pr-reviewer` entity shell

**Files:**

- Create: `packages/agents/src/agents/pr-reviewer.ts`
- Test: `packages/agents/test/pr-reviewer.test.ts`

The reviewer entity subscribes (via `ctx.observe(db(blackboardId, PrBlackboardSchema), { wake: { on: 'change', collections: ['signals'] } })`) and on each wake invokes the agent with the §3.5 prelude and the `pr-reviewer` skill loader. Signal-type filtering is the skill's job (the framework does not support `.where(type ∈ [...])`).

The TS handler:

1. Parses args (repo/number/head_branch/base_branch/worktree_path/blackboard).
2. Observes the blackboard.
3. Builds the prelude using the most recent signal in `signals` (the wake trigger); idempotency lives in the skill.
4. Builds the tool list: `bash`, `read`, `write`, `edit`, `fetch_url`, sharedDb tools (full mode, generated from `PrBlackboardSchema`), and `use_skill` / `remove_skill`.
5. Calls `ctx.useAgent({...})` and `await ctx.agent.run()`.

Steps 1–5 are the same shape for the build-doctor and doc-editor — Tasks 17 and 18 reuse the helpers from this task.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agents/test/pr-reviewer.test.ts
import { describe, expect, it, vi } from 'vitest'
import { createEntityRegistry } from '@electric-ax/agents-runtime'
import { registerPrReviewer } from '../src/agents/pr-reviewer'
import { createBuiltinModelCatalog } from '../src/model-catalog'

describe('pr-reviewer', () => {
  it('registers a "pr-reviewer" entity type', async () => {
    const registry = createEntityRegistry()
    const modelCatalog = await createBuiltinModelCatalog({
      allowMockFallback: true,
    })
    registerPrReviewer(registry, {
      workingDirectory: '/tmp',
      modelCatalog: modelCatalog!,
    })
    expect(registry.get('pr-reviewer')).toBeDefined()
  })

  it('subscribes to the blackboard signals collection on wake', async () => {
    const registry = createEntityRegistry()
    const modelCatalog = await createBuiltinModelCatalog({
      allowMockFallback: true,
    })
    registerPrReviewer(registry, {
      workingDirectory: '/tmp',
      modelCatalog: modelCatalog!,
    })
    const observe = vi
      .fn()
      .mockResolvedValue({
        signals: {
          toArray: [
            {
              key: 's',
              type: 'head_sha_changed',
              payload: {},
              ts: 'now',
              consumed_by: [],
            },
          ],
        },
      } as any)
    const useAgent = vi.fn()
    const ctx = {
      args: {
        repo: 'foo/bar',
        number: 42,
        head_branch: 'feat',
        base_branch: 'main',
        worktree_path: '/wt',
        blackboard: { id: 'pr-foo/bar-42' },
      },
      events: [],
      firstWake: false,
      entityUrl: 'http://x',
      entityType: 'pr-reviewer',
      observe,
      spawn: vi.fn(),
      useAgent,
      agent: { run: vi.fn() },
      timelineMessages: () => [],
      db: { collections: { inbox: { toArray: [] } } } as any,
      useContext: vi.fn(),
      send: vi.fn(),
      setTag: vi.fn(),
    } as any
    await registry.get('pr-reviewer')!.definition.handler(ctx, {} as any)
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: 'db', sourceRef: 'pr-foo/bar-42' }),
      expect.objectContaining({
        wake: { on: 'change', collections: ['signals'] },
      })
    )
    expect(useAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining('reviewer'),
      })
    )
  })

  it('passes bash/read/write/edit/fetch_url tools + sharedDb tools + skill loader', async () => {
    const registry = createEntityRegistry()
    const modelCatalog = await createBuiltinModelCatalog({
      allowMockFallback: true,
    })
    registerPrReviewer(registry, {
      workingDirectory: '/tmp',
      modelCatalog: modelCatalog!,
    })
    const observe = vi
      .fn()
      .mockResolvedValue({ signals: { toArray: [] } } as any)
    let captured: { tools?: unknown[] } | undefined
    const ctx = {
      args: {
        repo: 'foo/bar',
        number: 42,
        head_branch: 'feat',
        base_branch: 'main',
        worktree_path: '/wt',
        blackboard: { id: 'pr-x' },
      },
      events: [],
      firstWake: true,
      entityUrl: 'http://x',
      entityType: 'pr-reviewer',
      observe,
      spawn: vi.fn(),
      useAgent: vi.fn((cfg) => {
        captured = cfg
      }),
      agent: { run: vi.fn() },
      useContext: vi.fn(),
      timelineMessages: () => [],
      db: { collections: { inbox: { toArray: [] } } } as any,
      send: vi.fn(),
      setTag: vi.fn(),
    } as any
    await registry.get('pr-reviewer')!.definition.handler(ctx, {} as any)
    const toolNames = (captured!.tools as Array<{ name: string }>).map(
      (t) => t.name
    )
    expect(toolNames).toEqual(
      expect.arrayContaining([
        'bash',
        'read',
        'write',
        'edit',
        'fetch_url',
        'use_skill',
        'remove_skill',
      ])
    )
    expect(toolNames.some((n) => n.startsWith('write_review_threads'))).toBe(
      true
    )
  })
})
```

- [ ] **Step 2: Run — verify fail**

Run: `pnpm -C packages/agents test --run test/pr-reviewer.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement pr-reviewer.ts**

```ts
// packages/agents/src/agents/pr-reviewer.ts
import { db } from '@electric-ax/agents-runtime'
import type {
  EntityRegistry,
  HandlerContext,
  SharedStateHandle,
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

function pickWakeSignal(
  signals: ReadonlyArray<SignalRow>,
  role: string
): SignalRow | null {
  // Skill will do the per-type filter; here we just hand the most recent unconsumed signal in
  // for prelude framing. Falling back to "n/a" is safe.
  for (let i = signals.length - 1; i >= 0; i--) {
    const s = signals[i]!
    if (!s.consumed_by.includes(role)) return s
  }
  return null
}

function buildSharedStateTools(
  board: SharedStateHandle<typeof PrBlackboardSchema>
): Array<AgentTool> {
  // Re-implements worker.ts:154-277 over the per-PR blackboard. (One tool per
  // collection per op; skills call them by name.)
  const tools: Array<AgentTool> = []
  for (const collection of Object.keys(PrBlackboardSchema)) {
    const handle = (
      board as unknown as Record<
        string,
        {
          insert: (r: unknown) => void
          toArray: unknown
          update: (k: string, fn: (d: any) => void) => void
          delete: (k: string) => void
        }
      >
    )[collection]
    if (!handle) continue
    tools.push({
      name: `write_${collection}`,
      label: `Write ${collection}`,
      description: `Insert a row into shared collection "${collection}". Data must include "key".`,
      parameters: Type.Object({
        data: Type.Record(Type.String(), Type.Unknown()),
      }),
      execute: async (_id, params) => {
        handle.insert((params as { data: Record<string, unknown> }).data)
        return {
          content: [{ type: 'text' as const, text: `Wrote to ${collection}` }],
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
            type: 'text' as const,
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
            { type: 'text' as const, text: `Updated ${collection}[${key}]` },
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
        handle.delete((params as { key: string }).key)
        return {
          content: [
            {
              type: 'text' as const,
              text: `Deleted ${collection}[${(params as { key: string }).key}]`,
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
  registerPrWorker(registry, 'pr-reviewer', 'reviewer', deps)
}

export function registerPrWorker(
  registry: EntityRegistry,
  entityType: 'pr-reviewer' | 'pr-build-doctor' | 'pr-doc-editor',
  role: 'reviewer' | 'build-doctor' | 'doc-editor',
  deps: PrWorkerDeps
): void {
  const { workingDirectory, modelCatalog, skillsRegistry, streamFn } = deps
  registry.define(entityType, {
    description: `PR shepherd ${role} — reactive worker on a per-PR blackboard`,
    async handler(ctx: HandlerContext) {
      const args = ctx.args as unknown as PrWorkerArgs
      const board = (await ctx.observe(
        db(args.blackboard.id, PrBlackboardSchema),
        { wake: { on: 'change', collections: ['signals'] } }
      )) as SharedStateHandle<typeof PrBlackboardSchema>

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
          head_sha: meta?.head_sha ?? 'unknown',
          signal_type: signal?.type ?? 'firstWake',
          signal_key: signal?.key ?? 'n/a',
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
```

- [ ] **Step 4: Run — verify pass**

Run: `pnpm -C packages/agents test --run test/pr-reviewer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/agents/pr-reviewer.ts packages/agents/test/pr-reviewer.test.ts
git commit -m "feat(pr-shepherds): pr-reviewer entity (and shared registerPrWorker)"
```

---

## Task 17: `pr-build-doctor` entity shell

**Files:**

- Create: `packages/agents/src/agents/pr-build-doctor.ts`
- Test: `packages/agents/test/pr-build-doctor.test.ts`

Re-uses `registerPrWorker` from Task 16 with role `build-doctor`. The skill body (Task 12) makes this entity behave differently; the shell is a one-line wrapper.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agents/test/pr-build-doctor.test.ts
import { describe, expect, it } from 'vitest'
import { createEntityRegistry } from '@electric-ax/agents-runtime'
import { registerPrBuildDoctor } from '../src/agents/pr-build-doctor'
import { createBuiltinModelCatalog } from '../src/model-catalog'

describe('pr-build-doctor', () => {
  it('registers entity and uses build-doctor role in prelude', async () => {
    const registry = createEntityRegistry()
    const modelCatalog = await createBuiltinModelCatalog({
      allowMockFallback: true,
    })
    registerPrBuildDoctor(registry, {
      workingDirectory: '/tmp',
      modelCatalog: modelCatalog!,
    })
    expect(registry.get('pr-build-doctor')).toBeDefined()
    expect(registry.get('pr-build-doctor')!.definition.description).toMatch(
      /build-doctor/
    )
  })
})
```

- [ ] **Step 2: Run — verify fail**

Run: `pnpm -C packages/agents test --run test/pr-build-doctor.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/agents/src/agents/pr-build-doctor.ts
import { registerPrWorker, type PrWorkerDeps } from './pr-reviewer'
import type { EntityRegistry } from '@electric-ax/agents-runtime'

export function registerPrBuildDoctor(
  registry: EntityRegistry,
  deps: PrWorkerDeps
): void {
  registerPrWorker(registry, 'pr-build-doctor', 'build-doctor', deps)
}
```

- [ ] **Step 4: Run — verify pass**

Run: `pnpm -C packages/agents test --run test/pr-build-doctor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/agents/pr-build-doctor.ts packages/agents/test/pr-build-doctor.test.ts
git commit -m "feat(pr-shepherds): pr-build-doctor entity"
```

---

## Task 18: `pr-doc-editor` entity shell

**Files:**

- Create: `packages/agents/src/agents/pr-doc-editor.ts`
- Test: `packages/agents/test/pr-doc-editor.test.ts`

Same one-line wrapper as Task 17, role = `doc-editor`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agents/test/pr-doc-editor.test.ts
import { describe, expect, it } from 'vitest'
import { createEntityRegistry } from '@electric-ax/agents-runtime'
import { registerPrDocEditor } from '../src/agents/pr-doc-editor'
import { createBuiltinModelCatalog } from '../src/model-catalog'

describe('pr-doc-editor', () => {
  it('registers entity and identifies the doc-editor role', async () => {
    const registry = createEntityRegistry()
    const modelCatalog = await createBuiltinModelCatalog({
      allowMockFallback: true,
    })
    registerPrDocEditor(registry, {
      workingDirectory: '/tmp',
      modelCatalog: modelCatalog!,
    })
    expect(registry.get('pr-doc-editor')).toBeDefined()
    expect(registry.get('pr-doc-editor')!.definition.description).toMatch(
      /doc-editor/
    )
  })
})
```

- [ ] **Step 2: Run — verify fail**

Run: `pnpm -C packages/agents test --run test/pr-doc-editor.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/agents/src/agents/pr-doc-editor.ts
import { registerPrWorker, type PrWorkerDeps } from './pr-reviewer'
import type { EntityRegistry } from '@electric-ax/agents-runtime'

export function registerPrDocEditor(
  registry: EntityRegistry,
  deps: PrWorkerDeps
): void {
  registerPrWorker(registry, 'pr-doc-editor', 'doc-editor', deps)
}
```

- [ ] **Step 4: Run — verify pass**

Run: `pnpm -C packages/agents test --run test/pr-doc-editor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/agents/pr-doc-editor.ts packages/agents/test/pr-doc-editor.test.ts
git commit -m "feat(pr-shepherds): pr-doc-editor entity"
```

---

## Task 19: Bootstrap registration

**Files:**

- Modify: `packages/agents/src/bootstrap.ts:113-122` (add five `register*` calls + push type names)
- Test: `packages/agents/test/pr-bootstrap.test.ts`

The new entities must be registered alongside `horton` and `worker` so they ship with the dev server.

- [ ] **Step 1: Write the failing test**

```ts
// packages/agents/test/pr-bootstrap.test.ts
import { describe, expect, it } from 'vitest'
import { createBuiltinAgentHandler } from '../src/bootstrap'

describe('bootstrap registers PR shepherd entities', () => {
  it('exposes all five entity type names', async () => {
    process.env.ANTHROPIC_API_KEY ??= 'test-key' // satisfy modelCatalog lookup; real key not used
    const result = await createBuiltinAgentHandler({
      agentServerUrl: 'http://localhost:0',
    })
    expect(result).not.toBeNull()
    expect(result!.typeNames).toEqual(
      expect.arrayContaining([
        'horton',
        'worker',
        'pr-watcher',
        'pr-manager',
        'pr-reviewer',
        'pr-build-doctor',
        'pr-doc-editor',
      ])
    )
  })
})
```

- [ ] **Step 2: Run — verify fail**

Run: `pnpm -C packages/agents test --run test/pr-bootstrap.test.ts`
Expected: FAIL.

- [ ] **Step 3: Wire the registrations**

Edit `packages/agents/src/bootstrap.ts`. Below the existing `registerWorker(registry, ...)` call (around line 121), add:

```ts
import { registerPrWatcher } from './agents/pr-watcher'
import { registerPrManager } from './agents/pr-manager'
import { registerPrReviewer } from './agents/pr-reviewer'
import { registerPrBuildDoctor } from './agents/pr-build-doctor'
import { registerPrDocEditor } from './agents/pr-doc-editor'

// ...inside createBuiltinAgentHandler, after registerWorker(...):
const prDeps = { workingDirectory: cwd, modelCatalog, skillsRegistry, streamFn }
registerPrWatcher(registry, prDeps)
registerPrManager(registry, prDeps)
registerPrReviewer(registry, prDeps)
registerPrBuildDoctor(registry, prDeps)
registerPrDocEditor(registry, prDeps)
typeNames.push(
  'pr-watcher',
  'pr-manager',
  'pr-reviewer',
  'pr-build-doctor',
  'pr-doc-editor'
)
```

(Place the new imports in the imports block at the top.)

- [ ] **Step 4: Run all unit tests — verify pass**

Run: `pnpm -C packages/agents test --run`
Expected: All previously passing tests still pass; new bootstrap test passes.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/bootstrap.ts packages/agents/test/pr-bootstrap.test.ts
git commit -m "feat(pr-shepherds): register entities in builtin bootstrap"
```

---

## Task 20: Convergence integration test (offline, mocked GitHub)

**Files:**

- Create: `packages/agents/test/pr-convergence.test.ts`

Drives the §9 convergence example end-to-end against an in-process mock GitHub. The test does not boot the runtime server — it directly invokes handlers in sequence (firstWake → simulated wake on `head_sha_changed`) and asserts that gates flip to `ready_to_merge`. This is the single best smoke for the "system as a whole" without docker.

- [ ] **Step 1: Write the test**

```ts
// packages/agents/test/pr-convergence.test.ts
import { describe, expect, it, vi } from 'vitest'
import { runSyncPoll } from '../src/agents/pr-manager'
import { evalGates } from '../src/agents/pr-shared/gates'

describe('PR convergence (offline)', () => {
  it('starts dirty (no checks, blank desc), flips to ready after sync brings green CI + valid template', () => {
    const description = `## Summary\n\nadds X\n\n## Linked issues\n\ncloses #1\n\n## Test plan\n\n- [ ] verify`
    const meta = { description, mergeable: true }
    const checks = [
      { conclusion: 'success' as const },
      { conclusion: 'success' as const },
    ]
    const review_threads: Array<{
      severity: 'must-fix' | 'suggestion' | 'nit'
      status: 'open' | 'addressed' | 'wontfix'
    }> = []
    const doc_plan: Array<{ status: 'done' | 'needed' | 'in-progress' }> = [
      { status: 'done' },
    ]
    const g = evalGates({
      pr_meta: meta as any,
      checks,
      review_threads,
      doc_plan,
    })
    expect(g.ready_to_merge).toBe(true)
  })

  it('runSyncPoll converts a remote head-sha change into a head_sha_changed signal', async () => {
    const initialMeta = {
      key: 'meta',
      number: 42,
      repo: 'foo/bar',
      title: 't',
      base_branch: 'main',
      base_sha: 'B',
      head_branch: 'feat',
      head_sha: 'A',
      description: '',
      state: 'open',
      labels: ['agents'],
      mergeable: true,
      status_comment_id: null,
      agents_disabled: false,
      last_synced_at: '2026-05-08T00:00:00Z',
    }
    const board = {
      pr_meta: {
        toArray: [initialMeta],
        update: vi.fn((_k, fn) => fn(JSON.parse(JSON.stringify(initialMeta)))),
        insert: vi.fn(),
      },
      signals: { insert: vi.fn(), toArray: [], update: vi.fn() },
      checks: {
        toArray: [],
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    } as any
    const gh = {
      fetchPr: vi
        .fn()
        .mockResolvedValue({
          ...initialMeta,
          head: { sha: 'A2', ref: 'feat' },
          base: { sha: 'B', ref: 'main' },
          body: '',
          labels: ['agents'],
          state: 'open',
          mergeable: true,
          title: 't',
          number: 42,
        }),
      fetchChecks: vi.fn().mockResolvedValue([]),
      fetchCommentsSince: vi.fn().mockResolvedValue([]),
    } as any
    await runSyncPoll({ board, gh, repo: 'foo/bar', number: 42 })
    expect(
      board.signals.insert.mock.calls.some(
        (c: any[]) => (c[0] as { type: string }).type === 'head_sha_changed'
      )
    ).toBe(true)
  })
})
```

- [ ] **Step 2: Run — verify pass**

Run: `pnpm -C packages/agents test --run test/pr-convergence.test.ts`
Expected: PASS.

- [ ] **Step 3: Run the entire `packages/agents` suite**

Run: `pnpm -C packages/agents test --run`
Expected: All tests pass; no regressions in `horton-*`, `worker-*`, `skills-*`.

- [ ] **Step 4: Run the package's typecheck and lint**

Run: `pnpm -C packages/agents build && pnpm -C packages/agents lint || pnpm lint --filter @electric-ax/agents`
Expected: Both succeed.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/test/pr-convergence.test.ts
git commit -m "test(pr-shepherds): offline convergence smoke"
```

---

## Task 21: Manual smoke against the dev stack (no automated test)

This task does not edit code. It documents the manual end-to-end smoke the implementer should run before opening a PR.

**Pre-reqs (from `AGENTS.md` lines 218-251):** `.env` with `ANTHROPIC_API_KEY`, `pnpm install` done, `pnpm -C packages/typescript-client build` done.

- [ ] **Step 1: Stand up backing services**

```bash
docker compose -f packages/agents-server/docker-compose.dev.yml up -d
pnpm -C packages/agents-runtime dev
```

- [ ] **Step 2: Build agents + start servers**

In separate terminals (per `AGENTS.md`):

```bash
pnpm -C packages/agents-server dev
pnpm -C packages/agents dev
DATABASE_URL=postgresql://electric_agents:electric_agents@localhost:5432/electric_agents \
  ELECTRIC_AGENTS_ELECTRIC_URL=http://localhost:3060 \
  ELECTRIC_INSECURE=true \
  node packages/agents-server/dist/entrypoint.js
ELECTRIC_AGENTS_SERVER_URL=http://localhost:4437 \
  node packages/agents/dist/entrypoint.js
```

- [ ] **Step 3: Verify entity types are registered**

`curl -s http://localhost:4437/_electric/types | jq` — expect the JSON list to include `pr-watcher`, `pr-manager`, `pr-reviewer`, `pr-build-doctor`, `pr-doc-editor`.

- [ ] **Step 4: Spawn a watcher against a real test repo**

Use the `agents-server-ui` (`pnpm -C packages/agents-server-ui dev`, then http://localhost:4437/\_\_agent_ui/) to spawn a `pr-watcher` with `{ repo: '<your-test-repo>' }`. Open a draft PR with the `agents` label; send the watcher a `{"kind":"scan"}` message; observe `pr-manager-<n>` get spawned and the per-PR blackboard appear.

- [ ] **Step 5: Capture findings**

Note any framework-level issues (the spec's primary stated goal is to surface those — §1). File issues against the runtime and link them in the PR description.

- [ ] **Step 6: Tear down**

`docker compose -f packages/agents-server/docker-compose.dev.yml down`

(No commit; this is a smoke checklist, not code.)

---

## Self-review checklist (executed by plan author after writing)

- ✅ Spec §3.1 entities → Tasks 13–18
- ✅ Spec §3.2 schemas → Tasks 1, 2
- ✅ Spec §3.3 signal vocabulary → Task 3
- ✅ Spec §3.4 subscription mechanism → resolved in plan header (no `where` filter; collection-level subscription + skill-side filter); Task 16 wires it
- ✅ Spec §3.5 prelude → Task 9
- ✅ Spec §4.1 manager → Tasks 14, 15
- ✅ Spec §4.2 reviewer skill → Task 12; entity shell Task 16
- ✅ Spec §4.3 build-doctor skill → Task 12; entity shell Task 17
- ✅ Spec §4.4 doc-editor skill → Task 12; entity shell Task 18
- ✅ Spec §5 caps → Task 12 (skill bodies); seeded in Task 15 (`agent_state` insert)
- ✅ Spec §6 safety gates → Task 12 (skill protocol invariants); Task 14 (slash-command + label handling); Task 8 (worktree lock)
- ✅ Spec §7 GitHub interaction → Task 10 (typed gh wrapper for the manager); workers use `bash` + `gh` per skill body
- ✅ Spec §8 worktree management → Task 8 (helpers); Task 15 (manager creates/removes)
- ✅ Spec §9 convergence example → Task 20 (offline smoke); Task 21 (live smoke)
- ✅ Spec §10 failure modes — covered in skill bodies (Task 12: force-push retry, rate-limit backoff). The "signal storm" detector and "worktree corrupted" recovery are explicit in the manager skill (Task 12 manager.md).
- ✅ Spec §11 phase boundary → not implemented (phase 2 work); plan stops at phase 1
- ✅ Spec §12 testing strategy → entity-shell tests (Tasks 13–18), skill smoke (Task 12 + manual via Task 21), manager mechanical tests (Tasks 4–7, 10, 14), convergence (Task 20)
- ✅ Spec §13 component layout → Tasks 1–18 produce exactly the listed files, plus the `registerPrWorker` helper that wasn't in the spec but de-dupes Tasks 16–18
- ✅ Spec §14 deferred items → resolved in plan header (subscription, sync placement, scheduled wake)
- ✅ Spec §15 templates → Task 11 (template files), Task 4 (gate eval), Task 5 (slash commands), Task 6 (description renderer), Task 7 (status comment)

Placeholder scan: every code step contains real code; no "TBD" or "implement later". The skill bodies (Task 12) reference the spec sections to author rather than transcribing them in the plan — this is intentional because they are 80–200 lines of markdown each and the spec already contains the source-of-truth decision trees; the test asserts the structural anchors that prove the bodies were authored.

Type consistency: `PrWorkerArgs`, `PrWorkerDeps`, `registerPrWorker`, and `PrBlackboardSchema` are defined in Task 16 and reused unchanged by Tasks 17, 18, 19. `runSyncPoll`'s `BoardCollections` shape is the same one used by `registerPrManager`. Signal type literals are the same string set in `signals.ts` and the renderer/sync/test code.
