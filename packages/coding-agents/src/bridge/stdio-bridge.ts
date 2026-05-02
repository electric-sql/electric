import { normalize } from 'agent-session-protocol'
import type { NormalizedEvent } from 'agent-session-protocol'
import { getAdapter } from '../agents/registry'
import { log } from '../log'
import type { Bridge, RunTurnArgs, RunTurnResult } from '../types'

export class StdioBridge implements Bridge {
  async runTurn(args: RunTurnArgs): Promise<RunTurnResult> {
    const adapter = getAdapter(args.kind)
    const { args: cliArgs, promptDelivery } = adapter.buildCliInvocation({
      prompt: args.prompt,
      nativeSessionId: args.nativeSessionId,
      model: args.model,
    })

    const handle = await args.sandbox.exec({
      cmd: [adapter.cliBinary, ...cliArgs],
      cwd: args.sandbox.workspaceMount,
      stdin: promptDelivery === `stdin` ? `pipe` : `ignore`,
    })

    if (promptDelivery === `stdin`) {
      if (!handle.writeStdin || !handle.closeStdin) {
        throw new Error(
          `StdioBridge requires stdin pipe but ExecHandle lacks one`
        )
      }
      await handle.writeStdin(args.prompt)
      await handle.closeStdin()
    }

    const rawLines: Array<string> = []
    const stderrLines: Array<string> = []

    const drainStderr = async () => {
      for await (const line of handle.stderr) stderrLines.push(line)
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
        `${args.kind} CLI exited ${exitInfo.exitCode}. stderr=${stderrPreview}`
      )
    }

    let events: Array<NormalizedEvent> = []
    try {
      // opencode is normalized by a local normalizer (Task 8 wires it in);
      // narrow to AgentType for asp's normalize until then.
      if (args.kind === `opencode`) {
        throw new Error(`opencode normalize not yet wired (Task 8)`)
      }
      events = normalize(rawLines, args.kind)
    } catch (err) {
      log.error({ err, sample: rawLines.slice(0, 3) }, `normalize failed`)
      throw err
    }

    for (const e of events) args.onEvent(e)

    const sessionInit = events.find((e) => e.type === `session_init`)
    const lastAssistant = [...events]
      .reverse()
      .find((e) => e.type === `assistant_message`)

    return {
      nativeSessionId:
        sessionInit && `sessionId` in sessionInit
          ? (sessionInit as { sessionId?: string }).sessionId || undefined
          : undefined,
      exitCode: exitInfo.exitCode,
      finalText:
        lastAssistant && `text` in lastAssistant
          ? (lastAssistant as { text?: string }).text
          : undefined,
    }
  }
}
