# PR Watcher Agent — Design

**Status:** Draft for review
**Date:** 2026-05-08
**Author:** Claude + Valter (brainstorm)
**Phase:** 1 (manual / polling). Phase 2 = webhooks.

## 1. Goal

Build a software-factory feature that watches a GitHub repository for new pull requests and shepherds each one through a fixed set of gates until it is "ready to merge." Work is divided across independent reactive agents that read and write a shared blackboard; agents wake on signals rather than calling each other directly.

The system must be safe to enable on a real repo: it only operates on PRs explicitly opted-in via the `agents` label, asks for human go-ahead after a per-agent iteration cap, and tags every commit it authors.

## 2. Non-goals

- Webhook ingestion (deferred to phase 2).
- Watching multiple repositories from a single watcher (one watcher per repo for now).
- Merging the PR for the human (we only mark `ready_to_merge`; the human or GitHub automerge does the actual merge).
- A bespoke web UI; the existing `agents-server-ui` is the surface.
- Replacing human review for sensitive areas — this is a co-pilot, not a substitute.

## 3. Architecture

### 3.1 Entities

Three new entity types live in `packages/agents/src/agents/` alongside `horton.ts` and `worker.ts`:

| Entity        | Cardinality                                                                                                 | Purpose                                                                                                                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pr-watcher`  | one per repo                                                                                                | Discovers PRs labeled `agents`. On scan, spawns a `pr-manager` for any newly-labeled PR it has not yet seen. Phase 1 is manually triggered (user sends a `scan` message); phase 2 receives webhook events. |
| `pr-manager`  | one per PR                                                                                                  | Owns the PR's worktree at `.worktrees/pr-<n>`. Spawns the observer workers and the gate evaluator. Posts and maintains a single status comment on the PR. Tears everything down when the PR closes/merges. |
| `pr-observer` | seven per PR (sync, reviewer, address-comments, ci-fixer, docs-impact, description-updater, gate-evaluator) | Generic observer entity; behavior selected by a `role` arg. Each subscribes to a subset of signals and acts on the shared blackboard. Always-alive: they sleep between signals.                            |

`pr-watcher` and `pr-manager` are first-class registered entity types. `pr-observer` is one entity type whose handler dispatches on `role`.

### 3.2 Shared blackboard

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
    author_agent: string,            // 'address-comments' | 'ci-fixer' | 'docs-impact'
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

  agent_state: [{                    // one row per observer
    key: string,                     // role name
    role: string,
    iterations: number,
    cap: number,
    paused: boolean,
    pause_reason: string | null,
    last_continue_grant_at: string | null,
    // role-specific fields (sparse):
    last_reviewed_sha: string | null,        // reviewer
    last_substantive_signature: string | null,
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

The `signals` collection is append-only and the central reactive substrate. Workers subscribe to types; a worker is "done" with a signal when it adds its role to `consumed_by`.

### 3.3 Signal vocabulary

| Signal                  | Producer                                  | Consumers                                                 |
| ----------------------- | ----------------------------------------- | --------------------------------------------------------- |
| `pr_synced`             | sync                                      | reviewer, docs-impact, gate-evaluator                     |
| `head_sha_changed`      | sync                                      | reviewer, docs-impact, ci-fixer, description-updater      |
| `ci_failed`             | sync                                      | ci-fixer                                                  |
| `ci_passed`             | sync                                      | gate-evaluator                                            |
| `new_human_comment`     | sync                                      | address-comments, pr-manager                              |
| `review_complete`       | reviewer                                  | address-comments, gate-evaluator                          |
| `review_skipped`        | reviewer                                  | gate-evaluator (heartbeat)                                |
| `commits_pushed`        | ci-fixer / address-comments / docs-impact | sync, description-updater                                 |
| `base_advanced`         | sync                                      | (phase 1: gate-evaluator only; phase 2: conflict-checker) |
| `label_changed`         | sync                                      | pr-manager                                                |
| `agents_label_removed`  | sync                                      | pr-manager (sets `agents_disabled = true`)                |
| `agents_label_restored` | sync                                      | pr-manager (clears `agents_disabled`)                     |
| `pr_closed`             | sync                                      | pr-manager (teardown)                                     |
| `human_input_required`  | any observer                              | pr-manager (update status comment)                        |
| `continue_granted`      | sync (parses `/continue` slash-commands)  | the named observer                                        |
| `agents_disabled`       | pr-manager                                | all observers (no-op gate)                                |
| `gate_state_changed`    | gate-evaluator                            | pr-manager                                                |
| `ready_to_merge`        | gate-evaluator                            | pr-manager                                                |

### 3.4 Wake mechanism

Each observer is registered with a subscription to a subset of signal types via `ctx.observe()` on the shared DB's `signals` collection, filtered to types it cares about. When a matching signal is appended, the observer wakes, runs its handler, and adds its role to `consumed_by` on the signals it processed. The framework's at-least-once wake semantics mean handlers must be idempotent.

## 4. Workers — detailed specifications

Every worker is implemented as a `pr-observer` entity with a `role` arg. The handler dispatches on `role` to one of the seven implementations below. All workers share these protocol invariants:

- Read `pr_meta.agents_disabled` first; if true, exit without acting.
- Increment `agent_state.iterations`. If `iterations >= cap`, emit `human_input_required` with `{ agent, reason, summary }` and exit.
- Acquire the worktree lock (`agent_state.worktree_lock_holder`) before any push; release on exit.
- Tag signals as consumed (`consumed_by`).
- Emit downstream signals on success.

### 4.1 `sync`

The only worker that polls GitHub. Bridges outside-world changes onto the blackboard.

**Cadence (phase 1):**

- Active (a signal fired in last 5 min): wake every 30s.
- Idle: wake every 5 min.
- `pr_meta.state != 'open'`: stop polling.

**Per cycle:**

1. Fetch PR meta (number, title, base/head sha, state, labels, description) → diff against `pr_meta` row → emit `head_sha_changed`, `base_advanced`, `label_changed`, `pr_closed`, `agents_label_removed`/`agents_label_restored` as appropriate.
2. Fetch check-runs for `head_sha` → upsert `checks` rows → emit `ci_failed` or `ci_passed`.
3. Fetch issue comments + review comments since `last_synced_at` → for each new comment:
   - If author is human and matches `/continue <agent>`, `/continue all`, or `/stop`: emit `continue_granted` with the agent name (or all roles), or set `pr_meta.agents_disabled = true`.
   - Otherwise: emit `new_human_comment`.
4. Update `pr_meta.last_synced_at`.

**No iteration cap** — sync is the sensor, not an actor. It never pushes commits and never modifies the PR.

### 4.2 `reviewer`

**Subscribes:** `head_sha_changed`, manual trigger.
**Cap:** 5 review-runs without human go-ahead.

**On wake:**

1. If `last_reviewed_sha == head_sha`, exit (idempotency).
2. Compute substantive diff: `git diff <last_reviewed_sha>..<head_sha>` minus whitespace-only lines, comment-only lines, lockfiles, generated files, and lines matching the `suggested_patch` of any thread already addressed in this PR.
3. If substantive diff is empty AND `iterations_skipped_since_review < N` (default N=5): increment `iterations_skipped_since_review`, emit `review_skipped`, exit.
4. Otherwise: run a full review pass against the worktree. Output structured `review_threads` rows with `severity`, `category`, `body`, optional `suggested_patch`, `source: 'agent'`. Post each as a GitHub review comment (file/line) so humans see them in the PR UI.
5. Reset `iterations_skipped_since_review = 0`. Update `last_reviewed_sha`, `last_substantive_signature`. Emit `review_complete`.

### 4.3 `address-comments`

**Subscribes:** `review_complete`, `new_human_comment`.
**Cap:** 5 push-cycles.

**On wake:**

1. Read open `review_threads` with `severity = 'must-fix'`, plus any human-authored comments tagged as actionable. Ignore `suggestion` and `nit` unless human comment requests action.
2. For each addressable thread: apply `suggested_patch` if present and clean; otherwise generate a fix in the worktree. Stage changes per-thread.
3. If any changes staged: acquire worktree lock, commit (`[agent:address-comments] <thread summary>`), push, release lock. Insert into `commits`. Mark threads `addressed`, set `addressed_by_sha`. Reply to each thread on GitHub: "Addressed in <sha>."
4. Emit `commits_pushed`.

### 4.4 `ci-fixer`

**Subscribes:** `ci_failed`.
**Cap:** 3 fix-attempts.

**On wake:**

1. Read failing `checks` rows for `head_sha`. Fetch logs (via the agent's GitHub tools).
2. Reproduce in worktree where possible (e.g., run failing test command).
3. Generate a fix in the worktree.
4. Acquire lock, commit (`[agent:ci-fixer] <check name>`), push, release lock. Insert into `commits`.
5. Emit `commits_pushed`.

If a fix attempt does not change the diagnosis after a push, the iteration counter increments; the cap stops runaway loops.

### 4.5 `docs-impact`

**Subscribes:** `head_sha_changed`.
**Cap:** 3 doc-revisions.

**On wake:**

1. Analyze code diff vs base. Decide whether the change requires doc updates (heuristics: changes to public APIs, exported types, CLI flags, env vars, README-referenced behavior, examples).
2. Write/update `doc_plan` rows.
3. For entries with `status = 'needed'`: apply the doc change in the worktree, set `status = 'in-progress'`, commit (`[agent:docs-impact] update docs for <area>`), push, set `status = 'done'`. Acquire/release lock around the push.
4. Emit `commits_pushed`.

If no docs are needed: write a single `doc_plan` row with `change: 'update'`, `status: 'done'`, `notes: 'no doc changes required'` so the gate evaluator sees `docs_ok = true`.

### 4.6 `description-updater`

**Subscribes:** `commits_pushed`.
**Cap:** 10 rewrites.

**On wake:**

1. Compute the current PR's effective summary: aggregate commit messages + visible diff structure + any `doc_plan` entries.
2. Re-render the PR description using the project's PR template, preserving any human-edited sections marked with `<!-- agent-managed:summary --> ... <!-- /agent-managed:summary -->` boundaries. Outside those markers, treat content as human-owned and never overwrite.
3. If the rendered description differs from `pr_meta.description`, push the update via GitHub and update `pr_meta.description`.

This worker does not push commits to the branch; it only updates the PR description.

### 4.7 `gate-evaluator`

**Subscribes:** every signal except `human_input_required`, `continue_granted`, `agents_disabled` (those are control plane).
**Cap:** none — it's pure read + small write.

**On wake:**

1. Recompute each gate from current state:
   - `template_ok`: PR description contains all required template sections (configurable).
   - `ci_green`: every check for `head_sha` has `conclusion = 'success' | 'skipped'`.
   - `no_conflicts`: GitHub reports the PR mergeable.
   - `threads_resolved`: no `review_threads` rows have `status = 'open'` AND `severity = 'must-fix'`.
   - `docs_ok`: every `doc_plan` row has `status = 'done'`.
   - `ready_to_merge`: all of the above.
2. If any gate flipped, write the new `gates` row and emit `gate_state_changed`.
3. If `ready_to_merge` flipped from false to true, emit `ready_to_merge`.

## 5. Iteration caps & human-in-the-loop

Defaults (per PR, configurable per-watcher):

| Role                 | Cap  |
| -------------------- | ---- |
| reviewer             | 5    |
| address-comments     | 5    |
| ci-fixer             | 3    |
| docs-impact          | 3    |
| description-updater  | 10   |
| sync, gate-evaluator | none |

**Pause:** when `iterations >= cap`, the worker sets `paused = true`, writes `pause_reason`, emits `human_input_required`, and exits. `pr-manager` updates the PR's status comment with a "paused agents" section.

**Resume:** human posts `/continue <role>`, `/continue all`, or `/stop` in the PR. `sync` parses these. `/continue` resets `iterations = 0`, `paused = false`, sets `last_continue_grant_at`, emits `continue_granted` for the targeted role(s). `/stop` sets `pr_meta.agents_disabled = true`.

**Counter resets** on outside-world signals that change the situation:

- `new_human_comment` resets `address-comments`.
- `head_sha_changed` from a non-agent author resets reviewer, ci-fixer, docs-impact.
- `base_advanced` resets all.

Independent pausing: paused observers do not block other observers.

## 6. Safety gates

1. **Entry label.** `pr-watcher` only spawns a `pr-manager` for PRs with the `agents` label. PRs without the label are invisible to the system.
2. **Live label gate.** If the `agents` label is removed, the manager flips `agents_disabled = true` and posts a comment. Observers all no-op until restored. No commits are pushed while disabled.
3. **`/stop` slash-command.** Same effect as label removal but via comment (doesn't require label perms).
4. **Iteration caps.** No worker takes unbounded action without human go-ahead.
5. **Worktree lock.** Single-writer invariant on the local worktree prevents concurrent pushes from two observers stomping each other.
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
- All observers operate inside this worktree.
- A serialized lock on `agent_state.worktree_lock_holder` ensures one writer at a time. Observers acquire on entry to a push step, release on exit.
- On `pr_closed`, manager removes the worktree.
- `pr-watcher` chooses the worktree root: defaults to `<repo_root>/.worktrees/`, configurable per watcher.

## 9. Convergence example

A new PR opens with the `agents` label. Initial sha A.

```
t=0   pr-watcher: scan → sees PR with `agents` label → spawns pr-manager
      pr-manager: creates worktree at .worktrees/pr-42 → spawns 7 observers
                  → posts initial status comment
t=5s  sync: first poll → emits pr_synced, head_sha_changed (A is new to us)
t=10s reviewer: wakes on head_sha_changed → no last_reviewed_sha → full review
                → writes 3 must-fix threads, posts comments → emits review_complete
      docs-impact: wakes → analyses A → no docs needed → doc_plan = [done]
      gate-evaluator: wakes on pr_synced → ci pending; threads open; gates partial
t=20s address-comments: wakes on review_complete → applies 3 patches → pushes B
                → emits commits_pushed
t=30s sync: detects B → emits head_sha_changed
t=35s reviewer: wakes → diff A..B is exactly the suggested patches → substantive
                empty AND iterations_skipped < 5 → emit review_skipped → exit
      ci-fixer: no ci_failed yet → not woken
      gate-evaluator: thread statuses now addressed → threads_resolved = true
                      ci still pending → ready_to_merge = false
t=2m  sync: ci_passed for B → emits ci_passed
      gate-evaluator: ci_green = true → ready_to_merge = true → emits ready_to_merge
      pr-manager: updates status comment to "Ready to merge."
```

## 10. Failure modes & error handling

- **Push rejected (force-push by author):** observer rebases its prepared commit once; on second failure emits `human_input_required` with reason `force_push_conflict`.
- **GitHub API rate-limited:** `sync` backs off (exponential up to 10 min) and emits a status update; other workers continue acting on cached blackboard state.
- **Worker exception:** caught by handler, logged, and a `human_input_required` signal is emitted with reason `worker_error: <message>` so it surfaces in the status comment. Iteration counter increments to prevent infinite retries.
- **Worktree corrupted:** manager detects on lock acquire (e.g., dirty state, missing); blows it away and re-creates; emits `worktree_reset` (informational; no consumers).
- **Conflicting concurrent observers:** prevented by worktree lock. Lock contention is rare because observers' acting paths are short.
- **Signal storm:** if the same signal type fires more than 20 times in 60 seconds, manager flips `agents_disabled = true` and posts an alert in the status comment. Catastrophic loop detector.

## 11. Phase 1 / Phase 2 boundary

**Phase 1 (this spec):** manual scan, polling sync, single repo per watcher.

**Phase 2 (next):**

- Webhook receiver replaces the `sync` worker's polling mode (same signals emitted).
- Watcher accepts multiple repos.
- Optional `conflict-checker` observer to attempt rebase on `base_advanced`.
- Horton tool to spawn watchers conversationally.

The blackboard schema, signal vocabulary, and observer contracts are designed to be unchanged across phases — only `sync` rewires.

## 12. Testing strategy

- **Unit:** each observer handler tested in isolation against a mock blackboard. Inputs: pre-existing state + signal. Outputs: state writes + emitted signals.
- **Integration:** docker-compose stack (postgres + Electric + agents-server) plus a fake GitHub API (a small Express server implementing the `gh` REST surface we use). Drive a synthetic PR through the convergence example end-to-end.
- **Loop & cap tests:** force the reviewer to find an issue every run; verify the iteration cap pauses it.
- **Idempotency tests:** replay the same `head_sha_changed` signal 10x; verify only one push happens.
- **Safety tests:** remove the `agents` label mid-flight; verify all observers no-op until restored.

## 13. Component layout

```
packages/agents/src/agents/
  pr-watcher.ts            # registers `pr-watcher` entity
  pr-manager.ts            # registers `pr-manager` entity
  pr-observers/
    index.ts               # registers `pr-observer` (role-dispatched handler)
    sync.ts
    reviewer.ts
    address-comments.ts
    ci-fixer.ts
    docs-impact.ts
    description-updater.ts
    gate-evaluator.ts
    shared/
      blackboard-schema.ts # the shared DB schema
      signals.ts           # signal types and helpers
      protocol.ts          # cap/lock/idempotency helpers
      github-tools.ts      # MCP-or-CLI prompt fragment
      worktree.ts          # per-PR worktree create/remove/lock
```

`pr-watcher.ts` and `pr-manager.ts` follow the registration shape used by `horton.ts` (creation schema + handler). The observer module is the only one that uses `sharedDb` to subscribe to the blackboard's `signals` collection.

## 14. Items deferred to the implementation plan

- Concrete prompts for each worker role.
- Exact format of the status comment (markdown layout).
- Whether `description-updater` runs against a draft template stored in the repo (e.g., `.github/agent-pr-template.md`) or a built-in default. Design assumes built-in default with optional override file.
- Whether observers register their signal subscriptions via a shared helper or each role wires its own filter on `signals`.
