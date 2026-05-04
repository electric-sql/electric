import { denormalize } from 'agent-session-protocol'
import type { NormalizedEvent } from 'agent-session-protocol'
import type { CodingAgentKind } from '../types'

export interface ConvertNativeJsonlOptions {
  sessionId: string
  cwd: string
}

export interface ConvertNativeJsonlResult {
  /** New nativeSessionId (echoed from input). */
  sessionId: string
  /** Newline-joined JSONL content; '' for empty input. */
  content: string
}

/**
 * Pure: produces the kind-specific JSONL transcript that the new CLI
 * will consume on `--resume <sessionId>`. Returns `{ sessionId, content }`
 * so callers can persist both atomically into nativeJsonl + meta.
 */
export function convertNativeJsonl(
  events: ReadonlyArray<NormalizedEvent>,
  newKind: CodingAgentKind,
  opts: ConvertNativeJsonlOptions
): ConvertNativeJsonlResult {
  if (events.length === 0) {
    return { sessionId: opts.sessionId, content: `` }
  }
  // opencode denormalize is handled by a local path (later tasks); asp's
  // denormalize only knows 'claude' | 'codex'. Narrow defensively.
  if (newKind === `opencode`) {
    throw new Error(`opencode denormalize not yet wired (Task 7+)`)
  }
  const lines = denormalize(events as Array<NormalizedEvent>, newKind, {
    sessionId: opts.sessionId,
    cwd: opts.cwd,
  })
  // denormalize returns Array<string> of JSONL lines; join with newlines
  // and add a trailing newline for round-trip compatibility.
  const content = lines.length === 0 ? `` : lines.join(`\n`) + `\n`
  return { sessionId: opts.sessionId, content }
}
