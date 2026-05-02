import type { NormalizedEvent } from 'agent-session-protocol'

/**
 * Local normalizer for opencode's `run --format json` output, since
 * agent-session-protocol@0.0.2's AgentType is `'claude' | 'codex'` and
 * we don't want to fork asp for v1. A future upstream PR would move
 * this into asp; the function survives the migration unchanged.
 *
 * Event grammar (from opencode 1.14.x reconnaissance):
 *   - step_start: marks the start of a turn or sub-step
 *   - text: assistant text part. metadata.openai.phase === 'final_answer'
 *           is the user-visible reply; other phases are intermediate.
 *   - tool_use: a tool invocation. Only emitted at terminal state
 *               (state.status === 'completed' | 'failed'); we synthesise
 *               tool_call + tool_result from one event.
 *   - reasoning: thinking/CoT text (sometimes encrypted by the provider).
 *   - step_finish: end of a turn (reason: 'stop') or end of a sub-step
 *                  (reason: 'tool-calls'). Only 'stop' produces turn_complete.
 */
export function normalizeOpencode(
  lines: ReadonlyArray<string>
): Array<NormalizedEvent> {
  const events: Array<NormalizedEvent> = []
  let sessionInitEmitted = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let entry: any
    try {
      entry = JSON.parse(trimmed)
    } catch {
      continue
    }
    const ts =
      typeof entry.timestamp === `number` ? entry.timestamp : Date.now()
    const sessionID =
      typeof entry.sessionID === `string` ? entry.sessionID : undefined
    const part = entry.part ?? {}

    switch (entry.type) {
      case `step_start`: {
        if (!sessionInitEmitted && sessionID) {
          events.push({
            type: `session_init`,
            ts,
            sessionId: sessionID,
            cwd: ``,
          } as NormalizedEvent)
          sessionInitEmitted = true
        }
        break
      }
      case `text`: {
        const text = typeof part.text === `string` ? part.text : ``
        if (!text) break
        const phase = part?.metadata?.openai?.phase
        if (phase === `final_answer`) {
          events.push({
            type: `assistant_message`,
            ts,
            text,
          } as NormalizedEvent)
        } else {
          events.push({
            type: `thinking`,
            ts,
            text,
          } as NormalizedEvent)
        }
        break
      }
      case `tool_use`: {
        const status = part?.state?.status
        if (status !== `completed` && status !== `failed`) break
        const callId = typeof part.callID === `string` ? part.callID : ``
        const tool = typeof part.tool === `string` ? part.tool : `unknown`
        const input = part?.state?.input ?? {}
        const output =
          typeof part?.state?.output === `string` ? part.state.output : ``
        const exit = part?.state?.metadata?.exit
        const isError =
          status === `failed` || (typeof exit === `number` && exit !== 0)
        events.push({
          type: `tool_call`,
          ts,
          tool,
          callId,
          input,
        } as NormalizedEvent)
        events.push({
          type: `tool_result`,
          ts,
          callId,
          output,
          isError,
        } as NormalizedEvent)
        break
      }
      case `reasoning`: {
        const text = typeof part.text === `string` ? part.text : ``
        if (!text) break
        events.push({
          type: `thinking`,
          ts,
          text,
        } as NormalizedEvent)
        break
      }
      case `step_finish`: {
        if (part?.reason === `stop`) {
          events.push({
            type: `turn_complete`,
            ts,
          } as NormalizedEvent)
        }
        // 'tool-calls' (intermediate) does not emit turn_complete.
        break
      }
      // Unknown event types (future opencode versions): silently ignored.
      default:
        break
    }
  }
  return events
}
