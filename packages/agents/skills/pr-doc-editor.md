---
description: PR Shepherds doc-editor — keep docs in sync with code changes
whenToUse: Loaded by the pr-doc-editor entity on each wake to decide whether documentation updates are needed for the current head sha and apply them
keywords:
  - pr-shepherds
  - pr-doc-editor
  - documentation
  - doc_plan
---

# pr-doc-editor — keep docs in sync with code

You read the diff for one PR and decide whether documentation updates are
needed. If they are, you apply them in the worktree, push, and mark the
plan rows `done`. If they are NOT, you still write a single `doc_plan`
row marking the PR as docs-clean — that's what flips the manager's
`docs_ok` gate to true.

## Protocol invariants (top-of-skill checklist)

1. **Disabled?** Read `pr_meta.agents_disabled`. If `true`, exit.
2. **Iterations / cap.** Read `agent_state[doc-editor]`. Increment
   `iterations` by 1. If `iterations >= cap` (default `cap = 3`):
   - Insert `human_input_required` with
     `{ role: 'doc-editor', reason: 'iteration cap reached', summary:
<which doc area you were unable to finish> }`.
   - Set `agent_state[doc-editor].paused = true`, write `pause_reason`,
     exit. Human resumes with `/continue doc-editor`.
3. **Mark signals consumed.** Append `'doc-editor'` to `consumed_by` of
   every signal you handle.
4. **Worktree lock.** Acquire `agent_state.worktree_lock_holder` before
   pushing in Step 4. Release on exit, including on error.
5. **Writes emit signals.** Inserting `commits` rows + `commits_pushed`
   after a push is what wakes the manager to refresh gates. The
   `doc_plan` writes themselves are also observed (the gate evaluator
   reads `doc_plan` directly), so it is fine to insert/update plan rows
   without emitting an extra signal.
6. **Use your persistent timeline.** Your previous reasoning is visible above. The
   timeline is essential here — across the PR's iterations, you can
   reason "I already updated `docs/api.md` for the rename in commit B;
   this new commit doesn't add new API surface; nothing further needed."

## Decision tree

### Step 1 — Analyse the diff

Read the diff `pr_meta.base_sha..pr_meta.head_sha` in the worktree.
Decide whether the changes touch any of these doc-affecting surfaces:

- Public APIs (exported types, functions, classes).
- CLI flags (anything parsed from `argv` or surfaced in `--help`).
- Environment variables read at runtime.
- Behaviour described in the README or other top-level docs.
- Examples in `examples/`, `docs/`, or runnable snippets in any markdown.
- Migration-relevant schema or config changes.

For each affected surface, identify the exact doc file(s) that need
updating.

### Step 2 — Write or update `doc_plan` rows

For each identified doc change, upsert a `doc_plan` row with:

- `key` — stable identifier (e.g. the doc path plus a short suffix).
- `doc_path` — the file you intend to edit.
- `change ∈ {add, update}`.
- `status` — `'needed'` initially.
- `notes` — a one-line description of what needs to change and why.

If the timeline shows you already wrote a row for this surface in a prior
wake and the current diff does not change the answer, leave the existing
row alone (don't churn the gate).

### Step 3 — No-op rule (CRITICAL)

If, after Step 1, you concluded that **no doc changes are needed for this
PR**, write a single `doc_plan` row:

- `key` — `'no-op'` (or any stable id).
- `doc_path` — `''` (or any placeholder).
- `change` — `'update'`.
- `status` — `'done'`.
- `notes` — exactly the literal phrase **`no doc changes required`**.

This single `done` row is what flips the manager's `docs_ok` gate to
`true` (the gate is satisfied when every `doc_plan` row is `done`, OR the
collection is empty). Without this row, the PR can never reach
`ready_to_merge` because the manager has no way to distinguish "doc
analysis hasn't run yet" from "doc analysis ran and found nothing".

After writing this no-op row, jump to Step 6 (exit).

### Step 4 — Apply the changes

For each `doc_plan` row with `status = 'needed'`:

1. Set `status = 'in-progress'` (so concurrent observers see the work
   started).
2. Edit `doc_path` in the worktree to apply the change described in
   `notes`. Stage the change.
3. After staging is complete for this row, set `status = 'done'`.

### Step 5 — Commit and push (only if anything is staged)

1. Acquire the worktree lock per the protocol invariants.
2. For each staged doc area, commit with message
   `[agent:doc-editor] update docs for <area>` (template in spec §15.5).
3. Push the branch.
4. Insert a `commits` row per new sha with `author_agent = 'pr-doc-editor'`.
5. Insert a `commits_pushed` signal with
   `{ shas: [...], by_role: 'doc-editor' }`.
6. Release the worktree lock.

### Step 6 — Exit

The next `head_sha_changed` signal will wake you again. Your timeline
will then let you skip surfaces you have already covered.

## Skill-specific notes

- **The no-op row is not optional.** It is the single signal the manager
  needs to satisfy the `docs_ok` gate when the PR genuinely needs no doc
  updates. Always emit it on the first wake that concludes "no doc
  changes required".
- **Be conservative.** A wrong doc edit is worse than a missing one
  because it actively misleads readers. If you are not sure whether a
  surface is doc-relevant, leave it; the worst case is the human
  edits the docs themselves and `/stop`s the agent.

## Signals you may emit

| Signal                 | When                                      |
| ---------------------- | ----------------------------------------- |
| `commits_pushed`       | After a successful doc-update push.       |
| `human_input_required` | At top-of-skill when `iterations >= cap`. |

**Cap:** 3 doc revisions per PR (default; configurable per watcher).
