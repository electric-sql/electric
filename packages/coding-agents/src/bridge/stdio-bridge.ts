import { normalize } from 'agent-session-protocol'
import type { NormalizedEvent } from 'agent-session-protocol'
import { getAdapter } from '../agents/registry'
import { normalizeOpencode } from '../agents/opencode-normalize'
import { log } from '../log'
import type { Bridge, RunTurnArgs, RunTurnResult } from '../types'

// Pre-flight cap on prompt size. Linux ARG_MAX is ~2 MB, macOS ~1 MB; argv
// and envp share that budget. Stdin delivery (the primary mitigation, see
// spec §10 TL-1) sidesteps the kernel limit, but this guard catches
// pathological inputs (multi-MB prompts) with a clear error rather than a
// cryptic E2BIG or — on macOS — the codex npm-shim's RangeError stack
// overflow that fires around ~969 KB. The threshold is conservative so it
// stays safe across both platforms.
const PROMPT_LIMIT_BYTES = 900_000

export class StdioBridge implements Bridge {
  async runTurn(args: RunTurnArgs): Promise<RunTurnResult> {
    // Use byte length, not string.length — multi-byte characters (CJK,
    // emoji) make UTF-16 code units a poor proxy for the kernel's argv
    // budget.
    const promptBytes = Buffer.byteLength(args.prompt, `utf8`)
    if (promptBytes > PROMPT_LIMIT_BYTES) {
      throw new Error(
        `Prompt exceeds ${PROMPT_LIMIT_BYTES} bytes (got ${promptBytes}). ` +
          `Stage long prompts via the workspace; the agent CLI accepts stdin so ` +
          `most cases route through there, but this guard catches pathological inputs.`
      )
    }

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

    // allSettled — not all — so a stdout-callback throw doesn't orphan
    // the stderr iteration. We still need to reap the child either way.
    const [stdoutResult, stderrResult] = await Promise.allSettled([
      drainStdout(),
      drainStderr(),
    ])
    if (stdoutResult.status === `rejected`) {
      handle.kill(`SIGTERM`)
    }
    const exitInfo = await handle.wait()
    if (stdoutResult.status === `rejected`) {
      throw stdoutResult.reason
    }
    if (stderrResult.status === `rejected`) {
      log.warn({ err: stderrResult.reason }, `stderr drain failed`)
    }

    if (exitInfo.exitCode !== 0) {
      const stderrPreview = stderrLines.join(`\n`).slice(0, 800) || `<empty>`
      throw new Error(
        `${args.kind} CLI exited ${exitInfo.exitCode}. stderr=${stderrPreview}`
      )
    }

    let events: Array<NormalizedEvent> = []
    try {
      events =
        args.kind === `opencode`
          ? normalizeOpencode(rawLines)
          : normalize(rawLines, args.kind as `claude` | `codex`)
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
