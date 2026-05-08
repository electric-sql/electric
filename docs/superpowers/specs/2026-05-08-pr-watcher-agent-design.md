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

### 3.1 Entities and roles

Two new entity types live in `packages/agents/src/agents/` alongside `horton.ts` and `worker.ts`:

| Entity       | Cardinality  | Purpose                                                                                                                                                                                                                                                                                           |
| ------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pr-watcher` | one per repo | Discovers PRs labeled `agents`. On scan, spawns a `pr-manager` for any newly-labeled PR it has not yet seen. Phase 1 is manually triggered (user sends a `scan` message); phase 2 receives webhook events.                                                                                        |
| `pr-manager` | one per PR   | Owns the PR's worktree at `.worktrees/pr-<n>`. Observes the `signals` collection on the blackboard and **dispatches generic `worker` entities, each loaded with the skill for one role**. Posts and maintains a single status comment on the PR. Tears everything down when the PR closes/merges. |

Both are first-class registered entity types.

The seven roles (`sync`, `reviewer`, `address-comments`, `ci-fixer`, `docs-impact`, `description-updater`, `gate-evaluator`) are **not** their own entity types. Each role is a **skill** under `packages/agents/skills/pr/<role>.md`. A role runs as a one-shot generic `worker` (the existing `worker.ts` entity) spawned by `pr-manager` with a system prompt that immediately loads the role skill via the `use_skill` tool.

This means: there are no always-alive observer processes. Every role-execution is a fresh worker spawn. Per-role state (iteration counters, last-reviewed sha, etc.) lives in the shared `agent_state` collection and persists across spawns.

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

### 3.4 Dispatch mechanism

`pr-manager` owns the only persistent subscription. It observes the shared DB's `signals` collection. On each new signal, the manager:

1. Reads the signal type and looks it up in a static `signal → roles` routing table (the inverse of the consumer column in §3.3).
2. For each matching role, checks: is `pr_meta.agents_disabled` true? Is the role already paused (`agent_state.paused == true`)? Has a worker for this signal+role pair already been spawned (debounce window: 2s)? If any of those, skip.
3. Otherwise spawns a generic `worker` entity (the existing `worker.ts`) with:
   - `systemPrompt`: a short prelude (see §3.5) that names the role, the blackboard id, and the signal that triggered it, then instructs the worker to immediately call `use_skill('pr-<role>')` and follow it.
   - `tools`: `bash`, `read`, `write`, `edit`, plus the shared-DB read/write/update tools for the PR blackboard (via `worker.ts`'s `sharedDb` arg). Plus `use_skill`/`remove_skill`.
   - `sharedDb`: `{ id: 'pr-<repo>-<number>', schema: <blackboardSchema> }`.
4. Records the spawn in a transient in-memory map for debounce (does not need to be persisted; lost on manager restart, which only causes one duplicate spawn at most).

Workers are one-shot: they run, do their work, write their results to the blackboard (which emits new signals as a side-effect of the writes that matter), and exit. The framework's at-least-once dispatch combined with idempotency checks at the start of every skill mean duplicate spawns are safe.

### 3.5 Worker spawn prelude

Every worker spawned by `pr-manager` receives this system prompt template:

```
You are a one-shot agent executing the {role} role for PR {repo}#{number}.

Your shared blackboard is `pr-{repo}-{number}`. Read and write its
collections via the shared-DB tools. The signal that triggered you is:
{signal_type} (key: {signal_key}).

Step 1 — load your role skill: call use_skill('pr-{role}').
Step 2 — follow that skill's instructions exactly. Do not improvise.
Step 3 — when finished, exit.

You may load additional supporting skills via use_skill if the role skill
points you at them (e.g. 'gh-cli-fallback'). Always remove_skill when done
to keep context lean.

Working directory: {worktree_path}
```

The skill itself contains the role's actual logic — what state to read, what idempotency check to run, what action to take, what signals to emit (via the side-effect of writing to the blackboard), and how to handle the iteration cap.

## 4. Roles — detailed specifications

Each role below is implemented as a **skill** at `packages/agents/skills/pr/<role>.md`. The skill body contains the role's prompt, behavior, and decision tree. A worker loads it with `use_skill('pr-<role>')` and follows it.

All role skills share these protocol invariants, enforced by an opening checklist in the skill body:

- Read `pr_meta.agents_disabled` first; if true, exit without acting.
- Increment `agent_state.iterations` for this role. If `iterations >= cap`, write a `human_input_required` signal with `{ agent, reason, summary }` and exit.
- For roles that push: acquire the worktree lock (`agent_state.worktree_lock_holder`) before any push; release on exit.
- Mark signals consumed (add the role to `consumed_by`) for any signals the role processed.
- The act of writing to the blackboard (e.g. inserting a `commits` row, flipping a `gates` field) is what emits "downstream signals" — the skill body specifies which writes matter and the manager-side routing turns blackboard mutations into signal entries where appropriate. (Concrete mechanism — direct `signals` insert from the skill, vs. reactive trigger from the schema layer — is decided in the implementation plan.)

### 4.1 `sync` — skill `pr/sync.md`

The only role that polls GitHub. Bridges outside-world changes onto the blackboard.

**Cadence (phase 1):** since workers are one-shot, "polling" is implemented by `pr-manager` scheduling its own periodic wake (`ctx.scheduleWake`) and spawning a fresh sync worker each time:

- Active (a signal fired in last 5 min): manager wakes every 30s, spawns sync worker.
- Idle: manager wakes every 5 min.
- `pr_meta.state != 'open'`: manager cancels the schedule.

**Per cycle:**

1. Fetch PR meta (number, title, base/head sha, state, labels, description) → diff against `pr_meta` row → emit `head_sha_changed`, `base_advanced`, `label_changed`, `pr_closed`, `agents_label_removed`/`agents_label_restored` as appropriate.
2. Fetch check-runs for `head_sha` → upsert `checks` rows → emit `ci_failed` or `ci_passed`.
3. Fetch issue comments + review comments since `last_synced_at` → for each new comment:
   - If author is human and matches `/continue <agent>`, `/continue all`, or `/stop`: emit `continue_granted` with the agent name (or all roles), or set `pr_meta.agents_disabled = true`.
   - Otherwise: emit `new_human_comment`.
4. Update `pr_meta.last_synced_at`.

**No iteration cap** — sync is the sensor, not an actor. It never pushes commits and never modifies the PR.

### 4.2 `reviewer` — skill `pr/reviewer.md`

**Subscribes:** `head_sha_changed`, manual trigger.
**Cap:** 5 review-runs without human go-ahead.

**On wake:**

1. If `last_reviewed_sha == head_sha`, exit (idempotency).
2. Compute substantive diff: `git diff <last_reviewed_sha>..<head_sha>` minus whitespace-only lines, comment-only lines, lockfiles, generated files, and lines matching the `suggested_patch` of any thread already addressed in this PR.
3. If substantive diff is empty AND `iterations_skipped_since_review < N` (default N=5): increment `iterations_skipped_since_review`, emit `review_skipped`, exit.
4. Otherwise: run a full review pass against the worktree. Output structured `review_threads` rows with `severity`, `category`, `body`, optional `suggested_patch`, `source: 'agent'`. Post each as a GitHub review comment (file/line) so humans see them in the PR UI.
5. Reset `iterations_skipped_since_review = 0`. Update `last_reviewed_sha`, `last_substantive_signature`. Emit `review_complete`.

### 4.3 `address-comments` — skill `pr/address-comments.md`

**Subscribes:** `review_complete`, `new_human_comment`.
**Cap:** 5 push-cycles.

**On wake:**

1. Read open `review_threads` with `severity = 'must-fix'`, plus any human-authored comments tagged as actionable. Ignore `suggestion` and `nit` unless human comment requests action.
2. For each addressable thread: apply `suggested_patch` if present and clean; otherwise generate a fix in the worktree. Stage changes per-thread.
3. If any changes staged: acquire worktree lock, commit (`[agent:address-comments] <thread summary>`), push, release lock. Insert into `commits`. Mark threads `addressed`, set `addressed_by_sha`. Reply to each thread on GitHub: "Addressed in <sha>."
4. Emit `commits_pushed`.

### 4.4 `ci-fixer` — skill `pr/ci-fixer.md`

**Subscribes:** `ci_failed`.
**Cap:** 3 fix-attempts.

**On wake:**

1. Read failing `checks` rows for `head_sha`. Fetch logs (via the agent's GitHub tools).
2. Reproduce in worktree where possible (e.g., run failing test command).
3. Generate a fix in the worktree.
4. Acquire lock, commit (`[agent:ci-fixer] <check name>`), push, release lock. Insert into `commits`.
5. Emit `commits_pushed`.

If a fix attempt does not change the diagnosis after a push, the iteration counter increments; the cap stops runaway loops.

### 4.5 `docs-impact` — skill `pr/docs-impact.md`

**Subscribes:** `head_sha_changed`.
**Cap:** 3 doc-revisions.

**On wake:**

1. Analyze code diff vs base. Decide whether the change requires doc updates (heuristics: changes to public APIs, exported types, CLI flags, env vars, README-referenced behavior, examples).
2. Write/update `doc_plan` rows.
3. For entries with `status = 'needed'`: apply the doc change in the worktree, set `status = 'in-progress'`, commit (`[agent:docs-impact] update docs for <area>`), push, set `status = 'done'`. Acquire/release lock around the push.
4. Emit `commits_pushed`.

If no docs are needed: write a single `doc_plan` row with `change: 'update'`, `status: 'done'`, `notes: 'no doc changes required'` so the gate evaluator sees `docs_ok = true`.

### 4.6 `description-updater` — skill `pr/description-updater.md`

**Subscribes:** `commits_pushed`.
**Cap:** 10 rewrites.

**On wake:**

1. Compute the current PR's effective summary: aggregate commit messages + visible diff structure + any `doc_plan` entries.
2. Re-render the PR description using the project's PR template, preserving any human-edited sections marked with `<!-- agent-managed:summary --> ... <!-- /agent-managed:summary -->` boundaries. Outside those markers, treat content as human-owned and never overwrite.
3. If the rendered description differs from `pr_meta.description`, push the update via GitHub and update `pr_meta.description`.

This worker does not push commits to the branch; it only updates the PR description.

### 4.7 `gate-evaluator` — skill `pr/gate-evaluator.md`

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

A new PR opens with the `agents` label. Initial sha A. "spawn(role)" below means `pr-manager` calls `spawn_worker` with the prelude in §3.5 and skill `pr/<role>`.

```
t=0   pr-watcher: scan → sees PR with `agents` label → spawns pr-manager
      pr-manager: creates worktree at .worktrees/pr-42, posts initial status
                  comment, schedules first sync wake (30s)
t=5s  pr-manager: scheduled wake → spawn(sync)
      sync worker: first poll → writes pr_meta, checks → inserts pr_synced
                   and head_sha_changed signals → exits
t=10s pr-manager: observes new signals → spawn(reviewer), spawn(docs-impact),
                  spawn(gate-evaluator) in parallel
      reviewer worker: loads pr/reviewer skill → no last_reviewed_sha →
                       full review → writes 3 must-fix threads, posts GH
                       comments → inserts review_complete signal → exits
      docs-impact worker: loads pr/docs-impact → analyses A → no docs needed
                          → writes doc_plan=[done] → exits
      gate-evaluator worker: ci pending, threads open → writes gates → exits
t=20s pr-manager: observes review_complete → spawn(address-comments)
      address-comments worker: loads pr/address-comments → applies 3 patches
                                → pushes sha B → inserts commits row +
                                commits_pushed signal → exits
t=30s pr-manager: scheduled wake → spawn(sync)
      sync worker: detects B → inserts head_sha_changed → exits
t=35s pr-manager: spawn(reviewer), spawn(docs-impact), spawn(description-updater)
      reviewer worker: substantive diff empty AND iterations_skipped<5 →
                       inserts review_skipped → exits
      ...
t=2m  sync detects ci_passed → inserts ci_passed
      pr-manager: spawn(gate-evaluator)
      gate-evaluator worker: all gates true → inserts ready_to_merge signal
      pr-manager: observes ready_to_merge → updates status comment to
                  "Ready to merge."
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

The blackboard schema, signal vocabulary, role skills, and worker prelude are designed to be unchanged across phases — only the `sync` skill (and the manager's scheduled-wake polling that drives it) rewires.

## 12. Testing strategy

- **Skill smoke tests:** each role skill gets a small fixture-based test that loads it into a worker against a pre-populated blackboard and asserts the resulting state writes (no live GitHub).
- **Routing tests:** unit-test the signal-to-roles routing table and the manager's debounce logic.
- **Integration:** docker-compose stack (postgres + Electric + agents-server) plus a fake GitHub API (a small Express server implementing the `gh` REST surface we use). Drive a synthetic PR through the convergence example end-to-end with real worker spawns.
- **Loop & cap tests:** force the reviewer skill to find an issue every run; verify the iteration counter persists across spawns and that the cap pauses the role.
- **Idempotency tests:** insert the same `head_sha_changed` signal 10x; verify only one effective worker run produces side-effects (the rest no-op via the skill's opening idempotency check).
- **Safety tests:** remove the `agents` label mid-flight; verify subsequently-spawned workers all no-op until restored.

## 13. Component layout

```
packages/agents/src/agents/
  pr-watcher.ts                # registers `pr-watcher` entity
  pr-manager.ts                # registers `pr-manager` entity (signal observer
                               # + worker dispatcher); imports the routing table
                               # and worker prelude from pr-shared/
  pr-shared/
    blackboard-schema.ts       # the shared DB schema (Zod/TypeBox)
    signals.ts                 # signal types and helpers
    routing.ts                 # signal → roles routing table
    worker-prelude.ts          # builds the spawn-worker systemPrompt template
    worktree.ts                # per-PR worktree create/remove/lock
    github-tools.ts            # MCP-or-CLI prompt fragment

packages/agents/skills/pr/
  sync.md
  reviewer.md
  address-comments.md
  ci-fixer.md
  docs-impact.md
  description-updater.md
  gate-evaluator.md
```

`pr-watcher.ts` and `pr-manager.ts` follow the registration shape used by `horton.ts` (creation schema + handler). `pr-manager.ts` is the only place that calls `spawn_worker` for role workers; it imports the routing table and the prelude builder from `pr-shared/`.

A small extension to `packages/agents/src/agents/worker.ts` (or a sibling registration) is required so that workers spawned by `pr-manager` receive `use_skill` / `remove_skill` tools and can resolve skills from `packages/agents/skills/pr/`. Either:

- Extend the existing `worker` entity to optionally receive a skills registry handle (preferred — single entity type, simpler), or
- Register a new `pr-worker` entity that wraps `worker` with skills support pre-wired.

The implementation plan picks one.

## 14. Items deferred to the implementation plan

- The full body of each role skill in `packages/agents/skills/pr/`.
- Exact format of the status comment (markdown layout).
- Whether `description-updater` runs against a draft template stored in the repo (e.g., `.github/agent-pr-template.md`) or a built-in default. Design assumes built-in default with optional override file.
- How to add skills support to spawned workers: extend the existing `worker` entity vs. register a sibling `pr-worker` entity. Design recommends extending; plan confirms.
- Mechanism for blackboard writes to produce `signals` rows: skills do it directly with explicit `signals.insert(...)` calls vs. a schema-layer trigger that turns interesting writes into signals automatically. Design leaves both viable; plan picks one.
