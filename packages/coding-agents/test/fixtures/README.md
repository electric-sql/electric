# Test fixtures

Recorded JSONL transcripts driving unit-level bridge tests. Captured once
from real CLIs; re-record only when the upstream CLI's stream format
changes.

## Layout

`<kind>/<scenario>.jsonl` — one fixture per (kind, scenario) pair.

Scenarios:

- `first-turn.jsonl` — minimal session (init + assistant_message + result),
  no resume.
- `resume-turn.jsonl` — session_init carrying a prior session id, plus
  a follow-up assistant_message.
- `error.jsonl` — non-zero exit case (CLI prints a partial transcript
  before failing).

## Recording recipes

### Claude

```sh
# first-turn
claude --print --output-format=stream-json --verbose \
  --dangerously-skip-permissions \
  <<<"reply with the single word: ok" \
  > test/fixtures/claude/first-turn.jsonl

# resume-turn (use session_id from first-turn's session_init line)
SID=$(jq -r 'select(.type=="system" and .subtype=="init") | .session_id' \
       test/fixtures/claude/first-turn.jsonl | head -1)
claude --print --output-format=stream-json --verbose \
  --dangerously-skip-permissions --resume "$SID" \
  <<<"and the second word: yes" \
  > test/fixtures/claude/resume-turn.jsonl

# error fixture (invalid key)
ANTHROPIC_API_KEY=invalid claude --print --output-format=stream-json \
  --verbose --dangerously-skip-permissions \
  <<<"hi" \
  > test/fixtures/claude/error.jsonl 2>&1 || true
```

### Codex

```sh
# first-turn
codex exec --skip-git-repo-check --json \
  "reply with the single word: ok" \
  > test/fixtures/codex/first-turn.jsonl

# resume-turn (codex's first JSONL line carries session_id under payload.id)
SID=$(jq -r 'select(.payload.id) | .payload.id' \
       test/fixtures/codex/first-turn.jsonl | head -1)
codex exec --skip-git-repo-check --json resume "$SID" \
  "and the second word: yes" \
  > test/fixtures/codex/resume-turn.jsonl

# error fixture (invalid key)
OPENAI_API_KEY=invalid codex exec --skip-git-repo-check --json \
  "hi" \
  > test/fixtures/codex/error.jsonl 2>&1 || true
```

## Adding a new agent

1. `mkdir test/fixtures/<new-kind>`.
2. Capture three fixtures with the recipes above (substitute the new CLI's
   stream-json invocation).
3. The unit `describe.each(listAdapters())` blocks in future tasks pick them up
   automatically once the adapter is registered.
