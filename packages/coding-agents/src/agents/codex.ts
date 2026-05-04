import type { CodingAgentAdapter } from './registry'
import { registerAdapter } from './registry'
import { shellQuote } from './shell-quote'

/**
 * Codex stores transcripts at:
 *   ~/.codex/sessions/YYYY/MM/DD/rollout-<ISOts>-<sessionId>.jsonl
 * The date subdir embeds wall-clock time at session creation. We can't
 * reconstruct the original date from sessionId alone, so:
 *   - probe = scan with `find` (sessionId is a UUID, no collisions)
 *   - capture = same scan, then base64
 *   - materialise = best-effort: parse the captured blob's first JSONL
 *     line for a timestamp; fall back to today's date. Codex's resume
 *     looks up by sessionId via a scan, so the date subdir only has
 *     to exist on disk — it doesn't have to match the original.
 */

// Codex model identifiers. Examples seen in the wild: "gpt-4",
// "gpt-5-codex-latest", "openai/gpt-5", "anthropic/claude-sonnet-4-6:fp8".
// Reject anything outside this charset to defend against config-injection
// through the `-c model="..."` arg (e.g. `gpt-4";evil="x` would close
// the value and inject a new key).
const SAFE_MODEL = /^[A-Za-z0-9._/:-]+$/

// Codex sessionIds are UUIDs in practice. The probe/capture commands
// glob with `*-${sessionId}.jsonl` (`*` is allowed inside shellQuote'd
// arguments), so a sessionId containing `*` or `?` would broaden the
// match silently and could pick up an unrelated transcript.
const SAFE_SESSION_ID = /^[A-Za-z0-9-]+$/

interface RolloutMeta {
  yyyy: string
  mm: string
  dd: string
  ts: string
}

function todayMeta(): RolloutMeta {
  const now = new Date()
  const yyyy = String(now.getUTCFullYear())
  const mm = String(now.getUTCMonth() + 1).padStart(2, `0`)
  const dd = String(now.getUTCDate()).padStart(2, `0`)
  const ts = now.toISOString().replace(/[:.]/g, `-`).slice(0, 19)
  return { yyyy, mm, dd, ts }
}

/**
 * Try to extract a timestamp from the captured transcript's first line.
 * Codex's first line is a session-init record carrying the rollout
 * timestamp; parse failures fall back to today.
 */
function metaFromContent(content?: string): RolloutMeta {
  if (!content) return todayMeta()
  const firstNl = content.indexOf(`\n`)
  const firstLine = (firstNl >= 0 ? content.slice(0, firstNl) : content).trim()
  if (!firstLine) return todayMeta()
  try {
    const parsed = JSON.parse(firstLine) as Record<string, unknown>
    const candidate =
      (typeof parsed.timestamp === `string` && parsed.timestamp) ||
      (typeof parsed.ts === `string` && parsed.ts) ||
      (typeof parsed.created_at === `string` && parsed.created_at) ||
      null
    if (!candidate) return todayMeta()
    const d = new Date(candidate)
    if (Number.isNaN(d.getTime())) return todayMeta()
    return {
      yyyy: String(d.getUTCFullYear()),
      mm: String(d.getUTCMonth() + 1).padStart(2, `0`),
      dd: String(d.getUTCDate()).padStart(2, `0`),
      ts: d.toISOString().replace(/[:.]/g, `-`).slice(0, 19),
    }
  } catch {
    return todayMeta()
  }
}

// Codex 0.128.0 doesn't read OPENAI_API_KEY for HTTP auth; it requires
// `codex login --with-api-key` (reading from stdin) which persists creds
// to ~/.codex/auth.json. Wrap the invocation in a shell that runs login
// first, then exec'd codex. Login is idempotent — re-storing the same
// key on every turn is cheap (~150ms) and safe.
//
// We use `sh -c '<script>' -- <argv>` so positional args pass through as
// `"$@"` without any shell escaping of the prompt.
const CODEX_BOOTSTRAP_SCRIPT = `if [ -n "\${OPENAI_API_KEY:-}" ]; then printenv OPENAI_API_KEY | codex login --with-api-key >/dev/null 2>&1 || true; fi; exec codex "$@"`

export const CodexAdapter: CodingAgentAdapter = {
  kind: `codex`,
  // Wrapper shell; the codex binary still runs at exec time via the script.
  cliBinary: `sh`,
  defaultEnvVars: [`OPENAI_API_KEY`],

  buildCliInvocation({ prompt: _prompt, nativeSessionId, model, target }) {
    // Global `-c model="..."` override goes BEFORE the `exec` subcommand
    // because codex's clap parser scopes `-c` flags at the top-level.
    // Codex 0.128.0 does NOT read OPENAI_MODEL — the only ways to pin a
    // model are config.toml or this `-c` flag.
    const globalArgs: Array<string> = []
    if (model) {
      if (!SAFE_MODEL.test(model)) {
        throw new Error(
          `codex model must match ${SAFE_MODEL}; got ${JSON.stringify(model)}`
        )
      }
      globalArgs.push(`-c`, `model="${model}"`)
    }
    if (nativeSessionId && !SAFE_SESSION_ID.test(nativeSessionId)) {
      throw new Error(
        `codex nativeSessionId must match ${SAFE_SESSION_ID}; got ${JSON.stringify(nativeSessionId)}`
      )
    }
    const codexArgs: Array<string> = [
      ...globalArgs,
      `exec`,
      `--skip-git-repo-check`,
      `--json`,
    ]
    // For target=sandbox/sprites the agent already runs inside a Docker
    // container or sprite — codex's inner bwrap-based command sandbox is
    // (a) redundant, (b) broken on macOS Docker Desktop where the kernel
    // disallows non-privileged user namespaces. Without this flag every
    // shell tool call dies with "bwrap: No permissions to create a new
    // namespace" and the agent silently produces no useful output.
    // For target=host we leave codex's normal sandbox engaged.
    if (target === `sandbox` || target === `sprites`) {
      codexArgs.push(`--dangerously-bypass-approvals-and-sandbox`)
    }
    if (nativeSessionId) codexArgs.push(`resume`, nativeSessionId)
    // Use `-` as the positional prompt to tell codex to read the prompt
    // from stdin. From `codex exec --help`: "If not provided as an
    // argument (or if `-` is used), instructions are read from stdin."
    // The bridge pipes args.prompt into stdin via promptDelivery: 'stdin'.
    // The `--` keeps clap from misparsing the trailing `-` as a flag.
    // Stdin avoids ARG_MAX (TL-1) and the Node-shim ~969 KB call-stack
    // crash on macOS that surfaces below the kernel's E2BIG. The
    // CODEX_BOOTSTRAP_SCRIPT uses `exec`, which preserves stdin into
    // the codex child process.
    codexArgs.push(`--`, `-`)
    // sh -c '<script>' -- <codex argv ...> — positional args become "$@".
    const args: Array<string> = [
      `-c`,
      CODEX_BOOTSTRAP_SCRIPT,
      `--`,
      ...codexArgs,
    ]
    return { args, promptDelivery: `stdin` }
  },

  probeCommand({ homeDir, sessionId }) {
    if (!SAFE_SESSION_ID.test(sessionId)) {
      throw new Error(
        `codex sessionId must match ${SAFE_SESSION_ID}; got ${JSON.stringify(sessionId)}`
      )
    }
    const dir = shellQuote(`${homeDir}/.codex/sessions`)
    const pattern = shellQuote(`*-${sessionId}.jsonl`)
    return [
      `sh`,
      `-c`,
      `[ -n "$(find ${dir} -name ${pattern} 2>/dev/null | head -1)" ]`,
    ]
  },

  materialiseTargetPath({ homeDir, sessionId, content }) {
    const m = metaFromContent(content)
    return `${homeDir}/.codex/sessions/${m.yyyy}/${m.mm}/${m.dd}/rollout-${m.ts}-${sessionId}.jsonl`
  },

  captureCommand({ homeDir, sessionId }) {
    if (!SAFE_SESSION_ID.test(sessionId)) {
      throw new Error(
        `codex sessionId must match ${SAFE_SESSION_ID}; got ${JSON.stringify(sessionId)}`
      )
    }
    const dir = shellQuote(`${homeDir}/.codex/sessions`)
    const pattern = shellQuote(`*-${sessionId}.jsonl`)
    return [
      `sh`,
      `-c`,
      `f="$(find ${dir} -name ${pattern} 2>/dev/null | head -1)"; if [ -n "$f" ]; then base64 -w 0 "$f"; fi`,
    ]
  },
}

registerAdapter(CodexAdapter)
