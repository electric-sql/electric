# Opencode fixtures

Recorded JSONL output from real `opencode run` invocations. Used by
`test/unit/opencode-normalize.test.ts` to exercise `normalizeOpencode`
without spawning the binary in CI.

## Re-recording (when opencode-ai version bumps)

From the repo root, with opencode-ai installed and auth configured:

```bash
TMP=$(mktemp -d)
cd "$TMP"

# first-turn
opencode run --format json --dangerously-skip-permissions \
  -m anthropic/claude-haiku-4-5 \
  -- "Reply with just: ok" \
  > <repo>/packages/coding-agents/test/fixtures/opencode/first-turn.jsonl

SID=$(head -1 <repo>/.../first-turn.jsonl | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['sessionID'])")

# resume-turn (same workspace)
opencode run --format json --dangerously-skip-permissions \
  -m anthropic/claude-haiku-4-5 \
  -s "$SID" \
  -- "What word did you reply with last turn? Answer in one word." \
  > <repo>/.../resume-turn.jsonl

# error (bogus model)
opencode run --format json --dangerously-skip-permissions \
  -m bogus/this-model-does-not-exist \
  -- "anything" \
  > <repo>/.../error.jsonl 2>&1 || true
```

Re-record on opencode-ai bumps if the JSON event grammar changes.
