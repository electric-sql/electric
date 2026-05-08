# PR Shepherds — Design

**Status:** Draft for review
**Date:** 2026-05-08
**Author:** Claude + Valter (brainstorm)
**Phase:** 1 (manual / polling). Phase 2 = webhooks.

## 1. Goal

The primary goal is to **exercise the Electric Agents framework end-to-end on a real workload, find bugs in the platform, and surface improvements** before we tackle harder agentic systems. PR Shepherds is the first non-trivial multi-agent system built on the framework's reactive blackboard pattern.

PR Shepherds shepherd a GitHub PR through a fixed set of gates (template, CI, conflicts, review threads, docs) until it is "ready to merge." Work is divided across independent reactive agents (reviewer, build-doctor, doc-editor, manager) that read and write a shared blackboard and wake on signals.

This design is **deliberately limited**:

- **No coding agent.** PR Shepherds operate on PRs that already exist — they do not originate the substantive feature work. They review the diff, push small fixes for must-fix review threads (often via a `suggested_patch` they generated themselves), repair CI failures with targeted diffs, and keep documentation in sync. A human (or a separate coding agent) authors the feature.
- **One repo per watcher.** No fan-out across repos in this phase.
- **No webhooks.** Phase 1 polls GitHub on a cadence; phase 2 swaps in webhook ingestion.
- **No automerge.** When all gates pass, the system applies an `agents:ready` label and updates the status comment. The human still drives the merge.

The system must be safe to enable on a real repo: it only operates on PRs explicitly opted-in via the `agents` label, asks for human go-ahead after a per-agent iteration cap, and tags every commit it authors with `[agent:<role>]`.

## 2. Non-goals

(See also the deliberate limits called out in §1.)

- A bespoke web UI; the existing `agents-server-ui` is the surface.
- Replacing human review for sensitive areas — this is a co-pilot, not a substitute.
- A general-purpose framework for arbitrary multi-agent orchestration; the design is shaped to the PR-shepherding workload specifically.

## 3. Architecture

### 3.1 Entities and roles

Five new entity types live in `packages/agents/src/agents/` alongside `horton.ts` and `worker.ts`. All five are **hybrid**: a small TypeScript entity shell that wires up the entity (subscriptions, tools, prelude) and an LLM agent whose reasoning is loaded from a markdown **skill** at `packages/agents/skills/pr/<role>.md`.

| Entity            | Cardinality  | Persistent agent? | Skill                | Purpose                                                                                                                                                                                                                                           |
| ----------------- | ------------ | ----------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pr-watcher`      | one per repo | yes               | `pr/watcher.md`      | Discovers PRs labeled `agents`. On scan, spawns a `pr-manager` for any newly-labeled PR it has not yet seen. Phase 1 = manual scan; phase 2 = webhook ingest.                                                                                     |
| `pr-manager`      | one per PR   | yes               | `pr/manager.md`      | Owns the PR's worktree, scheduled-poll loop (sync), gate evaluation, description updates, status comment, slash-command parsing, lifecycle. Spawns the three worker entities once at PR init. Thin TS shell + agent skill for the reasoning bits. |
| `pr-reviewer`     | one per PR   | yes               | `pr/reviewer.md`     | Reads the diff, writes structured `review_threads`, posts GitHub review comments, applies fixes for must-fix threads (its own + addressable human ones), pushes commits, replies to threads.                                                      |
| `pr-build-doctor` | one per PR   | yes               | `pr/build-doctor.md` | Reads failing checks, reproduces in the worktree, fixes & pushes.                                                                                                                                                                                 |
| `pr-doc-editor`   | one per PR   | yes               | `pr/doc-editor.md`   | Decides whether a change requires doc updates, applies them in the worktree, pushes.                                                                                                                                                              |

All five are long-lived. Each has its own persistent timeline that accumulates across wakes — the agent sees what it has previously concluded and done on this PR. Skills are re-loaded fresh on each wake (they're stateless instructions); the entity's _memory of past work_ lives in the entity timeline, not in the skill.

`pr-manager` is split internally between deterministic mechanical work (worktree create/teardown, scheduled GitHub polling, description re-render from a template, slash-command parsing, signal insertion based on diffs) and reasoning work (gate evaluation summary, status-comment composition). The mechanical work lives in the TS handler and runs before the agent each wake; the reasoning work lives in `pr/manager.md` and runs inside the agent.

### 3.2 Shared state

There are two shared-DB scopes:

- **Per-watcher state**, keyed `pr-watcher-<repo>`, holds the watcher's PR-tracking ledger. Schema below as `watcher_state`.
- **Per-PR blackboard**, keyed `pr-<repo>-<number>`, holds everything for one PR. Schema below as the collections starting with `pr_meta`.

The per-watcher ledger is small:

```ts
{
  managed_prs: [
    {
      key: string, // PR number as string
      number: number,
      manager_entity_url: string, // url of the spawned pr-manager
      state: 'active' | 'completed',
      spawned_at: string,
    },
  ]
}
```

`pr-watcher` reads `managed_prs` on each scan and only spawns a `pr-manager` for PRs labeled `agents` whose number is not in the ledger or whose ledger entry is `completed`. When a manager tears down on `pr_closed`, it flips its own ledger row to `completed`.

For each PR, the manager initializes a shared DB instance keyed `pr-<repo>-<number>` with this schema:

```ts
{
  pr_meta: [{
    key: 'meta',                     // singleton row
    number: number,
    repo: string,
    title: string,
    base_branch: string,
    base_sha: string,
    head_branch: string,
    head_sha: string,
    description: string,
    state: 'open' | 'closed' | 'merged',
    labels: string[],
    mergeable: boolean | null,       // GitHub's mergeable flag (null = not yet computed)
    status_comment_id: string | null, // id of the agent-managed status comment
    agents_disabled: boolean,        // /stop or `agents` label removed
    last_synced_at: string,
  }]

  checks: [{                         // one row per check-run on head_sha
    key: string,                     // `${name}@${head_sha}`
    name: string,
    status: 'queued' | 'in_progress' | 'completed',
    conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | null,
    log_url: string | null,
    head_sha: string,
  }]

  review_threads: [{
    key: string,                     // stable id
    file: string,
    line: number,
    severity: 'must-fix' | 'suggestion' | 'nit',
    category: string,                // e.g. 'correctness' | 'security' | 'style' | 'tests' | 'naming'
    body: string,
    suggested_patch: string | null,
    status: 'open' | 'addressed' | 'wontfix',
    addressed_by_sha: string | null,
    source: 'agent' | 'human',
  }]

  doc_plan: [{
    key: string,                     // doc path or change id
    doc_path: string,
    change: 'add' | 'update',
    status: 'needed' | 'in-progress' | 'done',
    notes: string,
  }]

  commits: [{                        // commits authored by agents on this PR
    key: string,                     // sha
    sha: string,
    author_agent: string,            // 'pr-reviewer' | 'pr-build-doctor' | 'pr-doc-editor'
    message: string,
    parent_sha: string,
    ts: string,
  }]

  gates: [{                          // singleton row
    key: 'gates',
    template_ok: boolean,
    ci_green: boolean,
    no_conflicts: boolean,
    threads_resolved: boolean,
    docs_ok: boolean,
    ready_to_merge: boolean,
    last_evaluated_at: string,
  }]

  agent_state: [{                    // one row per worker entity
    key: string,                     // role name (e.g. 'reviewer')
    role: 'reviewer' | 'build-doctor' | 'doc-editor',
    iterations: number,
    cap: number,
    paused: boolean,
    pause_reason: string | null,
    last_continue_grant_at: string | null,
    // role-specific fields (sparse):
    last_reviewed_sha: string | null,        // reviewer
    last_substantive_signature: string | null, // reviewer
    iterations_skipped_since_review: number, // reviewer
    worktree_lock_holder: string | null,     // shared lock; only one writer at a time
  }]

  signals: [{                        // append-only event log
    key: string,                     // ulid
    type: SignalType,
    payload: Record<string, unknown>,
    ts: string,
    consumed_by: string[],           // role names that have processed this signal
  }]
}
```

The `signals` collection is append-only and the central reactive substrate. Each entity subscribes to the types it cares about; an entity marks a signal "consumed" by adding its role name to the signal's `consumed_by` array after handling it.

### 3.3 Signal vocabulary

"Producer" below means the entity (or its skill body) that inserts the signal into the `signals` collection. "Consumers" subscribe via `ctx.observe` and wake on it.

Signal payloads are typed per signal type. Notable shapes:

- `head_sha_changed`: `{ from_sha: string, to_sha: string, author_login: string }`.
- `ci_failed`: `{ head_sha: string, failed_checks: string[] }`.
- `new_human_comment`: `{ comment_id: string, author_login: string, body: string, file?: string, line?: number }`.
- `commits_pushed`: `{ shas: string[], by_role: 'reviewer' | 'build-doctor' | 'doc-editor' }`.
- `human_input_required`: `{ role: string, reason: string, summary: string }`.
- `continue_granted`: `{ role: 'reviewer' | 'build-doctor' | 'doc-editor' | 'all' }`.

Other signals carry an empty payload; the relevant state lives in the blackboard collections.

| Signal                  | Producer                                      | Consumers                                                             |
| ----------------------- | --------------------------------------------- | --------------------------------------------------------------------- |
| `pr_synced`             | pr-manager (sync poll)                        | pr-reviewer, pr-doc-editor, pr-manager (gate eval)                    |
| `head_sha_changed`      | pr-manager (sync poll)                        | pr-reviewer, pr-doc-editor, pr-build-doctor, pr-manager (desc + gate) |
| `ci_failed`             | pr-manager (sync poll)                        | pr-build-doctor, pr-manager (gate eval)                               |
| `ci_passed`             | pr-manager (sync poll)                        | pr-manager (gate eval)                                                |
| `new_human_comment`     | pr-manager (sync poll)                        | pr-reviewer, pr-manager (gate eval if review thread)                  |
| `review_complete`       | pr-reviewer                                   | pr-manager (gate eval)                                                |
| `review_skipped`        | pr-reviewer                                   | pr-manager (heartbeat)                                                |
| `commits_pushed`        | pr-reviewer / pr-build-doctor / pr-doc-editor | pr-manager (description + gate; also triggers next sync poll)         |
| `base_advanced`         | pr-manager (sync poll)                        | pr-manager (gate eval); phase 2 conflict-checker                      |
| `label_changed`         | pr-manager (sync poll)                        | pr-manager                                                            |
| `agents_label_removed`  | pr-manager (sync poll)                        | pr-manager (sets `agents_disabled = true`)                            |
| `agents_label_restored` | pr-manager (sync poll)                        | pr-manager (clears `agents_disabled`)                                 |
| `pr_closed`             | pr-manager (sync poll)                        | pr-manager (teardown)                                                 |
| `human_input_required`  | any worker                                    | pr-manager (update status comment)                                    |
| `continue_granted`      | pr-manager (parses slash-commands)            | the named worker                                                      |
| `agents_disabled`       | pr-manager                                    | all workers (no-op gate; checked at top of every skill)               |
| `gate_state_changed`    | pr-manager                                    | pr-manager (status comment)                                           |
| `ready_to_merge`        | pr-manager                                    | pr-manager (status comment, mark ready)                               |

### 3.4 Subscription mechanism

There is no central dispatcher. Each entity owns its own subscription. **Naming convention**: entity names are `pr-<role>`; role names used in `agent_state.role`, slash-commands, and signal payloads are the short form (`reviewer`, `build-doctor`, `doc-editor`).

- `pr-manager` subscribes to every signal type (it's the gate evaluator + description updater + status-comment poster + slash-command parser); also runs a `ctx.scheduleWake` timer for sync polling (§4.1).
- `pr-reviewer` subscribes to: `head_sha_changed`, `new_human_comment`, `continue_granted` filtered to `payload.role == 'reviewer'`.
- `pr-build-doctor` subscribes to: `ci_failed`, `continue_granted` filtered to `payload.role == 'build-doctor'`.
- `pr-doc-editor` subscribes to: `head_sha_changed`, `continue_granted` filtered to `payload.role == 'doc-editor'`.

Subscriptions are set up by each entity's handler via `ctx.observe` on the shared DB's `signals` collection, filtered to its types (the framework's "Reactive Observers" pattern). When a matching signal is appended, the entity wakes, runs its agent (which loads its skill), takes action, and goes back to sleep.

The framework's at-least-once wake semantics combined with idempotency checks at the start of every skill mean duplicate wakes are safe.

### 3.5 Entity prelude (system prompt template)

Each worker entity's handler builds this system prompt before running its agent on each wake. The prompt is short — the heavy reasoning lives in the loaded skill.

```
You are the {role} agent for PR {repo}#{number}, base {base_branch}, head {head_sha}.

Your shared blackboard is `pr-{repo}-{number}`. Read and write its
collections via the shared-DB tools. You woke because of signal:
{signal_type} (key: {signal_key}, ts: {ts}).

You have a persistent timeline across wakes — your previous reasoning,
tool calls, and conclusions on this PR are visible to you above. Use them.
Do not redo work you already did unless something has changed.

Step 1 — load your role skill: call use_skill('pr-{role}'). The skill
         contains your decision tree, idempotency checks, cap rules,
         and signal-emit guidance.
Step 2 — follow that skill exactly.
Step 3 — when this wake's work is done, exit so the entity can sleep.

You may load additional supporting skills via use_skill if the role skill
points you at them. Always remove_skill when done to keep context lean.

Working directory: {worktree_path}
```

Note the explicit reference to the persistent timeline — this is what differentiates these long-lived agents from one-shot workers. Each agent reads its own past work as part of its context.

## 4. Agents — detailed specifications

Three worker entities + the manager. Each is a **hybrid**: a TS entity shell handling subscriptions, tools, prelude, and lifecycle; an LLM agent loaded with the role's skill for reasoning.

All worker skills share these protocol invariants, enforced by an opening checklist at the top of every skill body:

- Read `pr_meta.agents_disabled` first; if true, exit without acting.
- Increment `agent_state.iterations` for this role. If `iterations >= cap`, insert a `human_input_required` signal with `{ agent, reason, summary }`, set `paused = true`, exit.
- For agents that push: acquire the worktree lock (`agent_state.worktree_lock_holder`) before any push; release on exit (always, even on error).
- Mark signals consumed (add the role to `consumed_by`) for any signals processed this wake.
- The act of writing to the blackboard (e.g. inserting a `commits` row, flipping a thread's `status`) is what emits downstream signals. The skill body lists which writes matter and what signal type to insert.
- Use your persistent timeline. The agent prelude tells you "your previous reasoning is visible above" — read it before re-doing analysis.

### 4.1 `pr-manager` — skill `pr/manager.md`

The PR's steward. Mostly mechanical; agent-driven for the parts that benefit from reasoning.

**Subscribes:** all signal types (it owns gate evaluation, status comment, description, slash-commands).
**Scheduled wake:** for sync polling.
**Cap:** none — manager is the control plane.

**Mechanical responsibilities (TS handler):**

- Lifecycle: on first wake, create `.worktrees/pr-<n>` and check out the head branch; on `pr_closed`, remove the worktree.
- Sync polling. On scheduled wake, queries GitHub for: PR meta diff, check-runs, comments since `last_synced_at`, labels, base sha. Diffs against blackboard, writes updates, inserts the right signals (`head_sha_changed`, `ci_failed`/`ci_passed`, `new_human_comment`, `base_advanced`, `label_changed`, `agents_label_removed`/`agents_label_restored`, `pr_closed`).
- Cadence: 30s when active (signal in last 5 min), 5 min when idle, cancel on `pr_closed`.
- Slash-command parsing: when sync sees a comment matching `/continue <role>` / `/continue all` / `/stop`, emit `continue_granted` (resets the named role's `agent_state` counter) or set `pr_meta.agents_disabled = true`.
- Description re-render: deterministic template renderer; preserves `<!-- agent-managed:summary --> ... <!-- /agent-managed:summary -->` boundaries.

**Agent-driven responsibilities (skill `pr/manager.md`):**

- Gate evaluation. After signal-driven wake, recompute the gates (definitions in §15.1). If any gate flipped, write `gates`, insert `gate_state_changed`. If `ready_to_merge` newly true, insert `ready_to_merge` and apply the `agents:ready` label to the PR.
- Status comment composition. On `gate_state_changed`, `human_input_required`, `commits_pushed`: rewrite the single status comment on the PR using the template in §15.4. The comment id is stored in `pr_meta.status_comment_id` (singleton).

**Ready-to-merge behavior.** When `ready_to_merge` first becomes true, the manager:

- Applies the `agents:ready` label to the PR.
- Updates the status comment to show the green `Ready to merge` row.

It does NOT enable auto-merge, post a fake LGTM, remove draft status, or merge the PR. The human still drives the merge — the system only signals readiness. If the gate later flips back to false (e.g., new push introduces a must-fix), the manager removes the `agents:ready` label.

**Wake debounce.** The manager subscribes to all signals and a chatty PR can produce many in a short interval. To avoid running the gate-eval/status-rewrite agent dozens of times per minute, the manager's TS handler debounces: when a signal lands, schedule a 2s timer; if more signals land before it fires, reset the timer. Only when the 2s of quiet elapses does the agent run, processing all accumulated signals at once.

The manager has its own persistent timeline so the gate-evaluation reasoning can reference past evaluations ("ci_green has flipped 3 times this PR — looks flaky"), and the status-comment author can pick up tonal continuity.

### 4.2 `pr-reviewer` — skill `pr/reviewer.md`

Reviews the diff and addresses must-fix threads (its own + actionable human comments).

**Subscribes:** `head_sha_changed`, `new_human_comment`, `continue_granted` (when role = `reviewer`).
**Cap:** 5 review-or-address cycles per PR.

**On wake (skill decision tree):**

The skill decides whether to run a review pass, an address pass, or both, based on the triggering signal and current state. Address always runs after review when both apply.

1. **Decide review pass.**
   - If signal is `head_sha_changed` AND `last_reviewed_sha != head_sha`: candidate.
   - Compute substantive diff `last_reviewed_sha..head_sha` minus whitespace, comment-only, lockfiles, generated files, and lines matching `suggested_patch` of already-addressed threads.
   - If candidate AND substantive diff is empty AND `iterations_skipped_since_review < 5`: increment `iterations_skipped_since_review`, insert `review_skipped`, do NOT run the review pass (but proceed to step 3).
   - If candidate AND (substantive diff non-empty OR `iterations_skipped_since_review >= 5`): run review pass.
   - If signal is `new_human_comment` or `continue_granted`: do NOT run review pass; proceed to step 3.
2. **Review pass.** Read worktree diff. Emit structured `review_threads` rows with `severity` ∈ {must-fix, suggestion, nit}, `category`, `body`, optional `suggested_patch`, `source: 'agent'`. Post each as a GitHub review comment (file/line). Reset `iterations_skipped_since_review = 0`. Update `last_reviewed_sha`. Insert `review_complete`.
3. **Address pass.** Read open `review_threads` with `severity == 'must-fix'` (own + actionable human-tagged threads). If none: skip to exit. For each: apply `suggested_patch` if clean, otherwise generate a fix in the worktree. Stage per-thread.
4. **Push.** If anything staged: acquire lock, commit `[agent:reviewer] <thread summary>`, push, release. Insert `commits` row + `commits_pushed`. Mark threads `addressed`, set `addressed_by_sha`. Reply to each GitHub thread: "Addressed in <sha>."

The two passes live in the same agent so it has full memory: when re-reviewing after its own fix push, it knows which threads were "responses to me" and skips re-flagging them.

### 4.3 `pr-build-doctor` — skill `pr/build-doctor.md`

**Subscribes:** `ci_failed`, `continue_granted` (when role = `build-doctor`).
**Cap:** 3 fix-attempts per failing check.

**On wake (skill decision tree):**

1. Read failing `checks` for `head_sha`. Fetch logs via GitHub tools.
2. Check timeline: have I seen this exact failure on this PR before? If so, reference the previous attempt and try a different approach.
3. Reproduce in worktree where possible (e.g., run the failing test command locally).
4. Generate a fix in the worktree.
5. Acquire lock, commit `[agent:build-doctor] <check name>: <fix summary>`, push, release. Insert `commits` row + `commits_pushed`.

If a fix attempt does not change the failure mode after the next sync, the iteration counter increments; the cap stops runaway loops on stubborn failures.

### 4.4 `pr-doc-editor` — skill `pr/doc-editor.md`

**Subscribes:** `head_sha_changed`, `continue_granted` (when role = `doc-editor`).
**Cap:** 3 doc revisions per PR.

**On wake (skill decision tree):**

1. Analyze the code diff vs base. Decide whether changes require doc updates: public APIs, exported types, CLI flags, env vars, README-referenced behavior, examples.
2. Write/update `doc_plan` rows reflecting the analysis.
3. For entries with `status = 'needed'`: apply the doc change in the worktree, set `status = 'in-progress'`, commit `[agent:doc-editor] update docs for <area>`, push, set `status = 'done'`. Acquire/release lock around the push.
4. Insert `commits_pushed`.

If no docs are needed, write a single `doc_plan` row with `change: 'update'`, `status: 'done'`, `notes: 'no doc changes required'` so the manager's gate evaluator sees `docs_ok = true`.

The agent's persistent timeline is critical here: across the PR's iterations, it can reason "I already updated `docs/api.md` for the rename in commit B; this new commit doesn't add new API surface; nothing further needed."

## 5. Iteration caps & human-in-the-loop

Defaults (per PR, configurable per-watcher):

| Agent             | Cap  |
| ----------------- | ---- |
| `pr-reviewer`     | 5    |
| `pr-build-doctor` | 3    |
| `pr-doc-editor`   | 3    |
| `pr-manager`      | none |

**Pause:** when an agent's `iterations >= cap`, its skill sets `paused = true` on its `agent_state` row, writes `pause_reason`, inserts `human_input_required`, and exits. `pr-manager` wakes on `human_input_required` and updates the PR status comment with a "paused agents" section.

**Resume:** human posts a slash-command in the PR (full grammar in §15.7). `/continue <role>` or `/continue all` resets the named agent's `iterations = 0`, `paused = false`, sets `last_continue_grant_at`, inserts `continue_granted` with `payload: { role }`. `/stop` sets `pr_meta.agents_disabled = true`. `/resume` clears it.

**Counter resets** on outside-world events that change the situation:

- `new_human_comment` resets `reviewer` (a human comment may add a new actionable thread).
- `head_sha_changed` where the new head_sha is not in the `commits` table (i.e., not authored by an agent in this PR) resets all three workers.
- `base_advanced` resets all three.

Independent pausing: each worker pauses/resumes on its own. A paused reviewer does not block the doc-editor.

## 6. Safety gates

1. **Entry label.** `pr-watcher` only spawns a `pr-manager` for PRs with the `agents` label. PRs without the label are invisible to the system.
2. **Live label gate.** If the `agents` label is removed, the manager flips `agents_disabled = true` and posts a comment. Workers all no-op until restored. No commits are pushed while disabled.
3. **`/stop` slash-command.** Same effect as label removal but via comment (doesn't require label perms).
4. **Iteration caps.** No worker takes unbounded action without human go-ahead.
5. **Worktree lock.** Single-writer invariant on the local worktree prevents concurrent pushes from two workers stomping each other.
6. **No force-push.** Workers only fast-forward. If the push fails (author force-pushed), the worker rebases its commit onto the new head, retries once, and otherwise emits `human_input_required` with reason `force_push_conflict`.
7. **Commit tagging.** Every agent commit message is prefixed `[agent:<role>]`. `commits` table is the audit log.
8. **Bounded blast radius.** All writes go to the PR's head branch (never base, never other branches). No tag creation, no release publishing, no repo settings changes.

## 7. GitHub interaction

Every agent that talks to GitHub gets:

- The GitHub MCP server's tools loaded (if installed in the runtime).
- The bash tool (with `gh` CLI available on PATH).

System-prompt guidance: "Prefer GitHub MCP tools when available. Fall back to `gh` CLI via bash. Never use direct REST without one of those."

No probe, no state flag — the agent decides per call.

## 8. Worktree management

- `pr-manager` creates `.worktrees/pr-<n>` on first wake, checked out to the PR's head branch with the PR remote configured.
- All three worker entities operate inside this worktree.
- A serialized lock on `agent_state.worktree_lock_holder` ensures one writer at a time. Workers acquire on entry to a push step, release on exit.
- On `pr_closed`, manager removes the worktree.
- `pr-watcher` chooses the worktree root: defaults to `<repo_root>/.worktrees/`, configurable per watcher.

## 9. Convergence example

A new PR opens with the `agents` label. Initial sha A. Each entity is long-lived; "wakes" mean a signal subscription fired or (for manager) a scheduled timer fired.

```
t=0   pr-watcher: manual scan → sees PR with `agents` label →
                  spawns pr-manager + pr-reviewer + pr-build-doctor +
                  pr-doc-editor (workers subscribe to signals and sleep)
      pr-manager: creates worktree at .worktrees/pr-42, posts initial status
                  comment, schedules first sync wake (30s)

t=5s  pr-manager: scheduled wake → polls GitHub → diffs vs blackboard →
                  inserts pr_synced + head_sha_changed → schedules next wake

t=5s+ pr-reviewer wakes on head_sha_changed → loads pr/reviewer →
              no last_reviewed_sha → full review pass → writes 3 must-fix
              threads, posts GH comments → review_complete inserted →
              continues into address pass → applies 3 patches →
              pushes sha B → inserts commits + commits_pushed →
              replies to threads → sleeps
      pr-doc-editor wakes on head_sha_changed → loads pr/doc-editor →
              no doc impact → doc_plan=[done] → sleeps
      pr-manager wakes on review_complete + commits_pushed →
              recomputes gates (ci pending, threads addressed, docs ok) →
              updates status comment

t=30s pr-manager: scheduled wake → sees sha B → inserts head_sha_changed
      pr-reviewer wakes → reads its own timeline ("I just pushed B addressing
              my own threads") → substantive diff filter detects this →
              inserts review_skipped → sleeps
      pr-doc-editor wakes → no new impact → sleeps

t=2m  pr-manager: scheduled wake → ci_passed for B → inserts ci_passed →
              recomputes gates → all true → inserts ready_to_merge →
              updates status comment to "Ready to merge."
```

The reviewer's persistent timeline is what lets it confidently say "I just pushed this; it's addressing my own findings" — no false re-flagging on the next iteration.

## 10. Failure modes & error handling

- **Push rejected (force-push by author):** the worker rebases its prepared commit once; on second failure inserts `human_input_required` with reason `force_push_conflict`.
- **GitHub API rate-limited:** the manager's sync poll backs off (exponential up to 10 min) and updates the status comment; workers continue acting on cached blackboard state.
- **Worker exception:** caught by handler, logged, and a `human_input_required` signal is inserted with reason `worker_error: <message>` so it surfaces in the status comment. Iteration counter increments to prevent infinite retries.
- **Worktree corrupted:** manager detects on lock acquire (e.g., dirty state, missing); blows it away and re-creates; updates the status comment with a "worktree reset" note.
- **Conflicting concurrent workers:** prevented by the worktree lock. Lock contention is rare because workers' acting paths are short.
- **Signal storm:** if the same signal type fires more than 20 times in 60 seconds, manager flips `agents_disabled = true` and posts an alert in the status comment. Catastrophic loop detector.

## 11. Phase 1 / Phase 2 boundary

**Phase 1 (this spec):** manual scan, polling sync, single repo per watcher.

**Phase 2 (next):**

- Webhook receiver replaces the manager's polling sync (same signals inserted into the blackboard).
- Watcher accepts multiple repos.
- Optional `pr-conflict-checker` worker entity to attempt rebase on `base_advanced`.
- Horton tool to spawn watchers conversationally.

The blackboard schema, signal vocabulary, worker entity shells, and skill bodies are designed to be unchanged across phases — only the manager's sync mechanism rewires (polling → webhook intake).

## 12. Testing strategy

- **Entity-shell unit tests:** each entity's TS handler tested for subscription wiring, prelude construction, tool list, lifecycle (worktree create/teardown). No agent run required.
- **Skill smoke tests:** each skill loaded into a real agent against a pre-populated blackboard fixture; assert resulting state writes and signal inserts.
- **Manager mechanical tests:** sync-poll diffing logic, slash-command parser, gate-eval pure function, description-renderer template — all directly testable as functions.
- **Integration:** docker-compose stack (postgres + Electric + agents-server) plus a fake GitHub API (a small Express server implementing the `gh` REST surface we use). Drive a synthetic PR through the convergence example end-to-end.
- **Loop & cap tests:** seed a scenario that forces the reviewer to find a new issue every wake; verify `agent_state.iterations` accumulates across wakes and the cap pauses the agent at 5.
- **Idempotency tests:** insert the same `head_sha_changed` signal twice in quick succession; verify only one effective wake produces side-effects (the second wake's idempotency check exits cleanly).
- **Safety tests:** remove the `agents` label mid-flight; verify all worker wakes no-op until restored.
- **Persistent-memory tests:** assert that on a second wake, an entity's prior conclusions are visible in its timeline and the skill's "do not redo work" instruction takes effect.

## 13. Component layout

```
packages/agents/src/agents/
  pr-watcher.ts                # registers `pr-watcher` entity
  pr-manager.ts                # registers `pr-manager` entity:
                               #   - subscribes to all signals
                               #   - schedules sync polls
                               #   - runs deterministic ops (worktree, sync,
                               #     description render, slash-command parse)
                               #   - runs the agent for gate-eval + status
                               #     comment composition (loads pr/manager skill)
  pr-reviewer.ts               # ~50-line entity shell:
                               #   - subscribes to head_sha_changed,
                               #     new_human_comment, continue_granted
                               #   - builds prelude
                               #   - loads pr/reviewer skill
                               #   - tools: bash, read, write, edit, sharedDb,
                               #     use_skill, remove_skill, GH MCP if avail
  pr-build-doctor.ts           # ~50-line entity shell (pattern as above)
  pr-doc-editor.ts             # ~50-line entity shell (pattern as above)

  pr-shared/
    blackboard-schema.ts       # shared DB schema (Zod/TypeBox)
    signals.ts                 # signal types + insert helpers
    prelude.ts                 # builds the per-wake system prompt template
    worktree.ts                # per-PR worktree create/remove/lock
    github-tools.ts            # MCP-or-CLI prompt fragment for skills

packages/agents/skills/pr/
  manager.md                   # gate-eval reasoning + status comment
  reviewer.md                  # review + thread-addressing decision tree
  build-doctor.md              # CI-fix decision tree
  doc-editor.md                # doc-impact decision tree
  templates/
    pr-description.md          # §15.2 (override at .github/agent-pr/)
    review-thread.md           # §15.3
    status-comment.md          # §15.4
    commit-message.md          # §15.5
    thread-reply.md            # §15.6
```

All five entity files follow the registration shape used by `horton.ts` (creation schema + handler). The handler:

1. Configures `ctx.observe(sharedDb.signals).where(type ∈ [...])` for the entity's signal subscriptions.
2. Builds tools: bash, read, write, edit, sharedDb (read/update on `pr_meta`, `agent_state`, etc., write to `signals`, `commits`, `review_threads`, `doc_plan`, `gates`), `use_skill` / `remove_skill` for skill loading, plus the GitHub MCP tools if installed at runtime.
3. Builds the per-wake system prompt from the prelude template (§3.5).
4. Calls `ctx.useAgent({...})` and `await ctx.agent.run()`.

A small extension to the framework is required to pass `use_skill` / `remove_skill` tools to these entities (Horton already has them; the pattern is `createSkillTools(skillsRegistry, ctx)` from `packages/agents/src/skills/tools`). The PR worker entities reuse it.

## 14. Items deferred to the implementation plan

- The full body of each skill in `packages/agents/skills/pr/`.
- Confirming the framework's `ctx.observe(...).where(...)` API shape on the shared DB's `signals` collection (Reactive Observers pattern).
- Whether the manager does its sync polling in the TS handler before the agent runs each wake, or whether sync is one of the agent's tools the skill calls. Design leans "TS handler before agent" for determinism; plan confirms.

## 15. Templates

All templates ship as files under `packages/agents/skills/pr/templates/` so they're versioned, easy to override per-repo (by placing a same-named file under `.github/agent-pr/`), and reusable from skills.

### 15.1 Gate definitions

Each gate's truth is computed deterministically from the blackboard, except `template_ok` which compares the PR description against the active PR-description template (§15.2).

```ts
template_ok       = renderTemplateChecksum(pr_meta.description) matches all
                    required headings in the active PR template (§15.2)
ci_green          = checks.every(c => c.conclusion === 'success' || 'skipped')
no_conflicts      = sync poll fetched mergeable === true (stored on pr_meta)
threads_resolved  = review_threads.every(t => t.severity !== 'must-fix' || t.status !== 'open')
docs_ok           = doc_plan.every(p => p.status === 'done') OR doc_plan is empty
ready_to_merge    = template_ok && ci_green && no_conflicts &&
                    threads_resolved && docs_ok
```

### 15.2 PR description template

Default at `packages/agents/skills/pr/templates/pr-description.md`. Repo override at `.github/agent-pr/pr-description.md`.

```md
## Summary

<one paragraph: what this PR does and why>

## Linked issues

<closes #1234>

## Test plan

- [ ] <how to verify this works>

<!-- agent-managed:summary -->

<!-- This block is rewritten by pr-doc-editor when the implementation
     changes. Edit OUTSIDE the markers; agents preserve human content there. -->

<!-- /agent-managed:summary -->
```

`template_ok` requires all three top-level `##` headings to be present and have non-empty content beneath them. The `<!-- agent-managed:summary -->` block is optional but, if present, fully owned by agents.

### 15.3 Review-thread comment template (posted to GitHub)

Used by `pr-reviewer` when posting each `review_threads` row as a GitHub review comment.

````md
**🤖 Reviewer · {severity} · {category}**

{body}

<details><summary>Suggested fix</summary>

```diff
{suggested_patch}
```

</details>

<!-- agent-thread-id: {key} -->
<!-- agent-thread-source: agent -->
````

The hidden HTML comment trailers are how the address pass correlates threads across pushes (humans can also tag a thread for the agent by adding `<!-- agent-thread-id: <new-key> -->` to a review comment they author; the reviewer then treats it as actionable).

The `<details>` block is omitted entirely if `suggested_patch` is null.

### 15.4 Status comment template (single comment, rewritten by manager)

The PR carries one agent-authored comment, identified by the `<!-- agent-managed-status -->` trailer. Manager rewrites its body each time gates change.

```md
## 🤖 Agent status — PR #{number}

| Gate               | State                                                 |
| ------------------ | ----------------------------------------------------- |
| Template           | {✅ \| ⏳ \| 🔴 (reason)}                             |
| CI                 | {✅ \| ⏳ pending (n checks running) \| 🔴 n failing} |
| Conflicts          | {✅ \| 🔴 (rebase needed)}                            |
| Review threads     | {✅ \| 🔴 n open must-fix}                            |
| Docs               | {✅ \| ⏳ in-progress \| 🔴 needed}                   |
| **Ready to merge** | {✅ \| ⏳}                                            |

### Active agents

- {✅ \| 🔴 paused} reviewer ({iterations}/{cap} cycles)
- {✅ \| 🔴 paused} build-doctor ({iterations}/{cap} cycles)
- {✅ \| 🔴 paused} doc-editor ({iterations}/{cap} cycles)

### Paused agents

{- **{role}** — {pause*reason}. Reply `/continue {role}` to resume.}
{\_None* if no paused agents}

### Recent agent commits

{- `{sha}` `[agent:{role}] {subject}` — {ago}}

---

_Disable agents on this PR with `/stop` or by removing the `agents` label._

<!-- agent-managed-status -->
```

### 15.5 Agent commit message template

Subject line: `[agent:{role}] {short subject}`.

Body must include the correlation id of what's being addressed:

```
[agent:reviewer] address must-fix in src/parse.ts:42

Resolves agent-thread-id: t_abc123
```

For build-doctor: `Resolves check: <check name>`.
For doc-editor: `Resolves doc_plan: <doc_path>`.

### 15.6 Thread-reply template

What the reviewer posts on a GitHub review thread once it has addressed that thread.

```md
✅ Addressed in {sha}.

<!-- agent-thread-id: {key} -->
```

### 15.7 Slash-command grammar

The manager parses comments authored by humans (not the agent itself) for these patterns. Match is line-anchored; first match wins; case-insensitive.

| Pattern            | Effect                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| `/continue {role}` | Reset `agent_state` for `role` ∈ {`reviewer`, `build-doctor`, `doc-editor`}; insert `continue_granted`. |
| `/continue all`    | Reset all three workers' `agent_state`; insert `continue_granted` with `role: 'all'`.                   |
| `/stop`            | Set `pr_meta.agents_disabled = true`. Workers' next wakes no-op.                                        |
| `/resume`          | Clear `pr_meta.agents_disabled`. (Inverse of `/stop`.)                                                  |
