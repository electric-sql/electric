import type { CodingAgentAdapter } from './registry'
import { registerAdapter } from './registry'

/**
 * opencode (sst/opencode-ai) — third coding-agent kind.
 *
 * Headless mode: `opencode run --format json --dangerously-skip-permissions`.
 * Prompt delivery: stdin. opencode silently consumes stdin when no
 * positional argv message is provided. Switching from argv-tail to stdin
 * avoids ARG_MAX (TL-1) for long prompts — confirmed empirically with
 * 200 KB round-trips. (See spec §10 TL-1 for the full story.)
 * Resume: `-s <sessionId>` (or `--continue` for last session — we always pin
 * to a specific sessionId so concurrent agents on the same host don't race).
 *
 * Storage: SQLite at `~/.local/share/opencode/opencode.db`. Round-trip via
 * `opencode export <id>` (read) and `opencode import <file>` (write). The
 * adapter's captureCommand pipes export through base64; postMaterialiseCommand
 * runs import after the handler's copyTo writes the captured JSON to
 * /tmp/opencode-import-<sessionId>.json, then removes the temp file.
 *
 * Auth: env vars only for v1 (ANTHROPIC_API_KEY / OPENAI_API_KEY honored as
 * per-provider fallback when ~/.local/share/opencode/auth.json is missing).
 * No auth.json provisioning; OAuth-only providers deferred to a follow-up.
 */
export const OpencodeAdapter: CodingAgentAdapter = {
  kind: `opencode`,
  cliBinary: `opencode`,
  defaultEnvVars: [`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`],

  buildCliInvocation({ prompt: _prompt, nativeSessionId, model }) {
    const args: Array<string> = [
      `run`,
      `--format`,
      `json`,
      `--dangerously-skip-permissions`,
    ]
    if (model) args.push(`-m`, model)
    if (nativeSessionId) args.push(`-s`, nativeSessionId)
    // No trailing `--` or positional prompt — opencode reads from stdin
    // when argv has no message. The bridge pipes args.prompt in.
    return { args, promptDelivery: `stdin` }
  },

  probeCommand({ sessionId }) {
    // Exits 0 if the session is in opencode's SQLite, 1 otherwise.
    return [
      `sh`,
      `-c`,
      `opencode session list 2>/dev/null | grep -q '${sessionId}'`,
    ]
  },

  captureCommand({ sessionId }) {
    // opencode export prints the session JSON to stdout. base64 to avoid
    // newline / binary corruption on the docker exec stdio pipe.
    return [
      `sh`,
      `-c`,
      `f="$(opencode export ${sessionId} 2>/dev/null)"; ` +
        `if [ -n "$f" ]; then printf '%s' "$f" | base64 -w 0; fi`,
    ]
  },

  materialiseTargetPath({ sessionId }) {
    return `/tmp/opencode-import-${sessionId}.json`
  },

  postMaterialiseCommand({ sessionId }) {
    return [
      `sh`,
      `-c`,
      `opencode import /tmp/opencode-import-${sessionId}.json && ` +
        `rm -f /tmp/opencode-import-${sessionId}.json`,
    ]
  },
}

registerAdapter(OpencodeAdapter)
