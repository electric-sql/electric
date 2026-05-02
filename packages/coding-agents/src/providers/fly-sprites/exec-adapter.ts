import type { ExecHandle } from '../../types'

export interface CreateExecHandleArgs {
  ws: WebSocket
  cmd: ReadonlyArray<string>
  stdin?: `pipe` | `ignore`
  cwd?: string
  env?: Record<string, string>
}

interface PendingFrame {
  resolve: (value: IteratorResult<string>) => void
}

class StreamQueue {
  private readonly buf: Array<string> = []
  private pending: PendingFrame | null = null
  private done = false

  push(line: string): void {
    if (this.done) return
    if (this.pending) {
      const p = this.pending
      this.pending = null
      p.resolve({ value: line, done: false })
      return
    }
    this.buf.push(line)
  }

  end(): void {
    this.done = true
    if (this.pending) {
      this.pending.resolve({
        value: undefined as unknown as string,
        done: true,
      })
      this.pending = null
    }
  }

  iterator(): AsyncIterator<string> {
    return {
      next: () => {
        if (this.buf.length > 0) {
          return Promise.resolve({ value: this.buf.shift()!, done: false })
        }
        if (this.done) {
          return Promise.resolve({
            value: undefined as unknown as string,
            done: true,
          })
        }
        return new Promise((resolve) => {
          this.pending = { resolve }
        })
      },
    }
  }
}

function makeAsyncIterable(q: StreamQueue): AsyncIterable<string> {
  return {
    [Symbol.asyncIterator]: () => q.iterator(),
  }
}

function feedFrameData(q: StreamQueue, data: string): void {
  // Split on newlines; keep any incomplete trailing line for the next frame.
  // For simplicity, push each newline-terminated segment as its own line and
  // the trailing remainder (if any) as a final partial line at end().
  const lines = data.split(`\n`)
  // Last element is the unterminated tail; push the rest as full lines.
  for (let i = 0; i < lines.length - 1; i++) {
    q.push(lines[i]!)
  }
  // Tail: if non-empty, also push (caller emits flush via end() when stream closes).
  if (lines[lines.length - 1] !== ``) {
    q.push(lines[lines.length - 1]!)
  }
}

export function createExecHandle(args: CreateExecHandleArgs): ExecHandle {
  const stdoutQ = new StreamQueue()
  const stderrQ = new StreamQueue()

  let exitInfo: { exitCode: number } | null = null
  let exitResolve: ((info: { exitCode: number }) => void) | null = null
  const exitPromise = new Promise<{ exitCode: number }>((resolve) => {
    exitResolve = resolve
  })

  const send = (frame: unknown) => args.ws.send(JSON.stringify(frame))

  args.ws.addEventListener(`open`, () => {
    send({
      type: `start`,
      cmd: args.cmd,
      cwd: args.cwd,
      env: args.env,
      stdin: args.stdin === `pipe`,
    })
  })

  args.ws.addEventListener(`message`, (event: MessageEvent) => {
    const data = typeof event.data === `string` ? event.data : ``
    let frame: any
    try {
      frame = JSON.parse(data)
    } catch {
      // Raw text message → stdout. Sprites streams stdout as plain text
      // WebSocket messages, not JSON frames.
      feedFrameData(stdoutQ, data)
      return
    }
    if (frame.type === `debug` && typeof frame.msg === `string`) {
      // Sprites' stderr / lifecycle log channel.
      feedFrameData(stderrQ, frame.msg)
    } else if (frame.type === `exit` && typeof frame.exit_code === `number`) {
      exitInfo = { exitCode: frame.exit_code }
    } else if (frame.type === `session_info`) {
      // No-op: session metadata; logged elsewhere if desired.
    }
    // Unknown frame types ignored.
  })

  args.ws.addEventListener(`close`, () => {
    stdoutQ.end()
    stderrQ.end()
    if (!exitInfo) exitInfo = { exitCode: -1 }
    if (exitResolve) exitResolve(exitInfo)
  })

  args.ws.addEventListener(`error`, () => {
    stdoutQ.end()
    stderrQ.end()
    if (!exitInfo) exitInfo = { exitCode: -1 }
    if (exitResolve) exitResolve(exitInfo)
  })

  const handle: ExecHandle = {
    stdout: makeAsyncIterable(stdoutQ),
    stderr: makeAsyncIterable(stderrQ),
    wait: () => exitPromise,
    kill: () => {
      try {
        args.ws.close()
      } catch {
        // best-effort
      }
    },
    ...(args.stdin === `pipe`
      ? {
          writeStdin: async (chunk: string) => {
            send({ type: `stdin`, data: chunk })
          },
          closeStdin: async () => {
            send({ type: `stdin_close` })
          },
        }
      : {}),
  }
  return handle
}
