import { normalize } from 'agent-session-protocol'
import type { NormalizedEvent } from 'agent-session-protocol'
import { log } from '../log'
import type { Bridge, RunTurnArgs, RunTurnResult } from '../types'

export class StdioBridge implements Bridge {
  async runTurn(args: RunTurnArgs): Promise<RunTurnResult> {
    if (args.kind !== `claude`) {
      throw new Error(
        `StdioBridge MVP supports only 'claude', got '${args.kind}'`
      )
    }
    const cliArgs: Array<string> = [
      `--print`,
      `--output-format=stream-json`,
      `--verbose`,
      `--dangerously-skip-permissions`,
    ]
    if (args.model) cliArgs.push(`--model`, args.model)
    if (args.nativeSessionId) cliArgs.push(`--resume`, args.nativeSessionId)

    const handle = await args.sandbox.exec({
      cmd: [`claude`, ...cliArgs],
      cwd: args.sandbox.workspaceMount,
      stdin: `pipe`,
    })

    // Pipe prompt on stdin, then close.
    if (!handle.writeStdin || !handle.closeStdin) {
      throw new Error(
        `StdioBridge requires stdin pipe but ExecHandle lacks one`
      )
    }
    await handle.writeStdin(args.prompt)
    await handle.closeStdin()

    const rawLines: Array<string> = []
    const stderrLines: Array<string> = []

    const drainStderr = async () => {
      for await (const line of handle.stderr) {
        stderrLines.push(line)
      }
    }
    const drainStdout = async () => {
      for await (const line of handle.stdout) {
        if (!line) continue
        rawLines.push(line)
        if (args.onNativeLine) args.onNativeLine(line)
      }
    }

    await Promise.all([drainStdout(), drainStderr()])
    const exitInfo = await handle.wait()

    if (exitInfo.exitCode !== 0) {
      const stderrPreview = stderrLines.join(`\n`).slice(0, 800) || `<empty>`
      throw new Error(
        `claude CLI exited ${exitInfo.exitCode}. stderr=${stderrPreview}`
      )
    }

    let events: Array<NormalizedEvent> = []
    try {
      events = normalize(rawLines, `claude`)
    } catch (err) {
      log.error({ err, sample: rawLines.slice(0, 3) }, `normalize failed`)
      throw err
    }

    for (const e of events) args.onEvent(e)

    const lastAssistant = [...events]
      .reverse()
      .find((e) => e.type === `assistant_message`)

    // Extract session_id directly from claude's stream-json output.
    // agent-session-protocol@0.0.2's normalize() reads `entry.sessionId`
    // but claude emits `session_id` (snake_case), so the protocol's
    // SessionInitEvent.sessionId is empty. Read the raw entry instead.
    let nativeSessionId: string | undefined
    for (const line of rawLines) {
      try {
        const entry = JSON.parse(line) as {
          type?: string
          subtype?: string
          session_id?: unknown
        }
        if (
          entry.type === `system` &&
          entry.subtype === `init` &&
          typeof entry.session_id === `string` &&
          entry.session_id.length > 0
        ) {
          nativeSessionId = entry.session_id
          break
        }
      } catch {
        // skip non-JSON lines
      }
    }

    return {
      nativeSessionId,
      exitCode: exitInfo.exitCode,
      finalText:
        lastAssistant && `text` in lastAssistant
          ? (lastAssistant as { text?: string }).text
          : undefined,
    }
  }
}
