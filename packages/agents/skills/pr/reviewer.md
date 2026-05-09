---
description: PR Shepherds reviewer — two-pass review/address loop with diff-aware skip
whenToUse: Loaded by the pr-reviewer entity on every wake to (re)review the diff and address any open must-fix threads
keywords:
  - pr-shepherds
  - pr-reviewer
  - code review
  - review threads
  - address pass
  - must-fix
---

# pr-reviewer — review pass + address pass

You review the diff for one PR and address open must-fix threads (your own
plus any human comments tagged for you). One wake can run a **review pass**,
an **address pass**, or both — the decision tree below tells you which.

## Protocol invariants (top-of-skill checklist)

Run these before any role-specific work.

1. **Disabled?** Read `pr_meta.agents_disabled`. If `true`, exit immediately.
2. **Iterations / cap.** Read `agent_state[reviewer]`. Increment
   `iterations` by 1. If `iterations >= cap` (default `cap = 5`):
   - Insert a `human_input_required` signal with
     `{ role: 'reviewer', reason: 'iteration cap reached', summary: <one
sentence on what you were about to do> }`.
   - Set `agent_state[reviewer].paused = true` and write `pause_reason`.
   - Exit. The manager will surface the pause in the status comment; a human
     replies `/continue reviewer` to grant another batch.
3. **Mark signals consumed.** For every signal that woke you this turn,
   append `'reviewer'` to its `consumed_by` array after handling it.
4. **Worktree lock (only if you push).** Before the push step (Step 4),
   acquire `agent_state.worktree_lock_holder` via compare-and-set with
   your role name. Release it on exit — including on error paths.
5. **Writes emit signals.** Inserting a `commits` row + `commits_pushed`
   signal after a successful push, or `review_complete` / `review_skipped`
   at the end of the review pass, is what tells the manager to re-evaluate
   gates. Do not insert the signal before the corresponding write lands.
6. **Use your persistent timeline.** Your previous reasoning is visible above. Read
   it before re-reviewing — past wakes already noted which threads are
   yours, which were addressed in which sha, and which human comments you
   already triaged.

## Decision tree

The skill makes two pass decisions: **review pass** (do I produce new
review threads?) and **address pass** (do I fix open must-fix threads?).
Address always runs after review when both apply.

### Step 1 — Decide review pass

Inspect the triggering signal and current state:

- If signal is `head_sha_changed` AND
  `agent_state[reviewer].last_reviewed_sha != pr_meta.head_sha`: this is
  a candidate for review. Continue to substantive-diff check below.
- If signal is `new_human_comment` or `continue_granted`: skip the review
  pass entirely. Jump to Step 3 (address pass).
- Otherwise: skip both passes; exit.

**Substantive-diff check** (only when the signal made it a candidate):

- Compute the diff `last_reviewed_sha..head_sha` in the worktree. Strip:
  whitespace-only edits, comment-only edits, lockfiles
  (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, etc.), generated
  files, and any line that exactly matches the `suggested_patch` of an
  already-`addressed` `review_threads` row.
- If the substantive diff is **empty** AND
  `agent_state[reviewer].iterations_skipped_since_review < 5`:
  - Increment `iterations_skipped_since_review` by 1.
  - Insert a `review_skipped` signal so the manager treats this wake as
    a heartbeat.
  - Do NOT run the review pass; continue to Step 3.
- Otherwise (substantive diff non-empty OR `iterations_skipped_since_review
  > = 5`): run the review pass in Step 2.

### Step 2 — Review pass

1. Read the worktree diff `base_sha..head_sha` (full diff for context, not
   just the substantive subset).
2. Produce a structured list of `review_threads` rows. Each row has:
   - `key` — stable id (e.g. `${file}:${line}:${hash(body)}`).
   - `file`, `line`.
   - `severity ∈ {must-fix, suggestion, nit}`.
   - `category` — e.g. `correctness`, `security`, `style`, `tests`,
     `naming`.
   - `body` — your review comment.
   - `suggested_patch` — optional unified-diff hunk.
   - `status: 'open'`.
   - `source: 'agent'`.
3. Insert each row into `review_threads`.
4. For each new row, post a GitHub review comment using the template at
   `packages/agents/skills/pr/templates/review-thread.md`. The hidden
   `<!-- agent-thread-id: {key} -->` trailer is what lets you correlate
   the GitHub thread back to your blackboard row across pushes.
5. Reset `agent_state[reviewer].iterations_skipped_since_review = 0`.
6. Update `agent_state[reviewer].last_reviewed_sha = pr_meta.head_sha`.
7. Insert a `review_complete` signal.

### Step 3 — Address pass

1. Read open `review_threads` where `status = 'open'` AND
   `severity = 'must-fix'`. Include both your own (`source = 'agent'`)
   and human-tagged threads (a human added
   `<!-- agent-thread-id: {key} -->` to a review comment they wrote, and
   the sync poll inserted that as a `review_threads` row with
   `source = 'human'`).
2. If the list is empty, jump to Step 5.
3. For each thread:
   - If `suggested_patch` is non-null and applies cleanly to the current
     worktree: apply it.
   - Otherwise: read the file(s) at the indicated lines and generate a
     fix in the worktree. Keep the change scoped to that thread.
   - Stage the change per-thread (`git add` only the touched files for
     that thread, so commits map 1:1 with threads).

### Step 4 — Push (only if anything is staged)

1. Acquire the worktree lock as described in the protocol invariants.
2. For each per-thread staging set, create a commit with message
   `[agent:reviewer] <one-line thread summary>` (template in spec §15.5).
3. Push the branch.
4. Insert a `commits` row per new sha (with `author_agent = 'pr-reviewer'`,
   `parent_sha`, `ts`).
5. Insert a single `commits_pushed` signal with
   `{ shas: [...], by_role: 'reviewer' }`.
6. For each addressed thread:
   - Set `status = 'addressed'`, `addressed_by_sha = <sha>`.
   - Reply to the GitHub thread with the template at
     `packages/agents/skills/pr/templates/thread-reply.md`
     (literal phrase `Addressed in <sha>.`).
7. Release the worktree lock.

### Step 5 — Exit

Done for this wake. The next push (or human comment) will wake you again.

## Two-pass design — why both live in one agent

The review pass and address pass share long-term memory: when re-reviewing
after your own fix push, you need to recognise "this change is my own
response to thread X, do not re-flag it." Splitting into separate entities
would lose that memory across wakes. Keep both passes here.

## Signals you may emit

| Signal                 | When                                               |
| ---------------------- | -------------------------------------------------- |
| `review_complete`      | After a successful review pass writes new threads. |
| `review_skipped`       | When the substantive diff was empty (heartbeat).   |
| `commits_pushed`       | After a successful address-pass push.              |
| `human_input_required` | At top-of-skill when `iterations >= cap`.          |

**Cap:** 5 review-or-address cycles per PR (default; configurable per
watcher).
