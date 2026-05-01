import type { CodingAgentAdapter } from './registry'
import { registerAdapter } from './registry'

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

interface RolloutMeta {
  yyyy: string
  mm: string
  dd: string
  ts: string
}

function todayMeta(): RolloutMeta {
  const now = new Date()
  const yyyy = String(now.getFullYear())
  const mm = String(now.getMonth() + 1).padStart(2, `0`)
  const dd = String(now.getDate()).padStart(2, `0`)
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
  const firstLine = firstNl >= 0 ? content.slice(0, firstNl) : content
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
      yyyy: String(d.getFullYear()),
      mm: String(d.getMonth() + 1).padStart(2, `0`),
      dd: String(d.getDate()).padStart(2, `0`),
      ts: d.toISOString().replace(/[:.]/g, `-`).slice(0, 19),
    }
  } catch {
    return todayMeta()
  }
}

export const CodexAdapter: CodingAgentAdapter = {
  kind: `codex`,
  cliBinary: `codex`,
  defaultEnvVars: [`OPENAI_API_KEY`],

  buildCliInvocation({ prompt, nativeSessionId, model: _model }) {
    const args: Array<string> = [`exec`, `--skip-git-repo-check`, `--json`]
    if (nativeSessionId) args.push(`resume`, nativeSessionId)
    args.push(prompt)
    return { args, promptDelivery: `argv` }
  },

  probeCommand({ homeDir, sessionId }) {
    return [
      `sh`,
      `-c`,
      `[ -n "$(find ${homeDir}/.codex/sessions -name "*-${sessionId}.jsonl" 2>/dev/null | head -1)" ]`,
    ]
  },

  materialiseTargetPath({ homeDir, sessionId, content }) {
    const m = metaFromContent(content)
    return `${homeDir}/.codex/sessions/${m.yyyy}/${m.mm}/${m.dd}/rollout-${m.ts}-${sessionId}.jsonl`
  },

  captureCommand({ homeDir, sessionId }) {
    return [
      `sh`,
      `-c`,
      `f="$(find ${homeDir}/.codex/sessions -name "*-${sessionId}.jsonl" 2>/dev/null | head -1)"; if [ -n "$f" ]; then base64 -w 0 "$f"; fi`,
    ]
  },
}

registerAdapter(CodexAdapter)
