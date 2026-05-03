import type { ExecHandle } from '../../types'

// Sprites exec WebSocket protocol (api.sprites.dev/v1/sprites/{name}/exec):
//   - cmd is passed via query params on the WS URL — no `start` frame.
//   - JSON text frames: { type: 'debug', msg } (internal lifecycle),
//                        { type: 'session_info', ... }
//                        { type: 'exit', exit_code }
//                        { type: 'port_notification', ... }
//   - Binary frames: multiplexed output — first byte is the stream id:
//        0x01 = stdout payload (rest is bytes)
//        0x02 = stderr payload
//        0x03 = control (next byte is exit code)
//     The 'debug' JSON channel is informational; real stdout/stderr come
//     here. Without de-mux, claude's stream-json output gets mixed with
//     stderr and the bridge can't parse it.
//   - On close without an exit frame → exitCode = -1.
export interface CreateExecHandleArgs {
  ws: WebSocket
}

const STREAM_STDOUT = 0x01
const STREAM_STDERR = 0x02
const STREAM_CONTROL = 0x03

interface PendingFrame {
  resolve: (value: IteratorResult<string>) => void
}

export class StreamQueue {
  private readonly buf: Array<string> = []
  // Holds the unterminated tail of the last frame. Frames split mid-line
  // (e.g. "a\nbcd" then "ef\n") must not push "bcd" as its own line — the
  // next frame's first segment continues it. Cleared whenever the prior
  // tail is folded into a complete line, or flushed at end().
  private tail = ``
  private pending: PendingFrame | null = null
  private done = false

  feed(data: string): void {
    if (this.done) return
    const merged = this.tail + data
    const lines = merged.split(`\n`)
    // All but the last entry are newline-terminated; the last is the
    // (possibly empty) tail to carry over.
    for (let i = 0; i < lines.length - 1; i++) {
      this.deliver(lines[i]!)
    }
    this.tail = lines[lines.length - 1]!
  }

  private deliver(line: string): void {
    if (this.pending) {
      const p = this.pending
      this.pending = null
      p.resolve({ value: line, done: false })
      return
    }
    this.buf.push(line)
  }

  end(): void {
    if (this.tail !== ``) {
      this.deliver(this.tail)
      this.tail = ``
    }
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

export function createExecHandle(args: CreateExecHandleArgs): ExecHandle {
  const stdoutQ = new StreamQueue()
  const stderrQ = new StreamQueue()

  let exitInfo: { exitCode: number } | null = null
  let exitResolve: ((info: { exitCode: number }) => void) | null = null
  const exitPromise = new Promise<{ exitCode: number }>((resolve) => {
    exitResolve = resolve
  })

  // Binary frame mode: ws.binaryType is set on the caller-provided WS.
  args.ws.addEventListener(`message`, (event: MessageEvent) => {
    if (typeof event.data === `string`) {
      // Text frame → JSON metadata.
      let frame: any
      try {
        frame = JSON.parse(event.data)
      } catch {
        // Unexpected non-JSON text — push to stdout for visibility.
        stdoutQ.feed(event.data)
        return
      }
      if (frame.type === `debug` && typeof frame.msg === `string`) {
        // Sprites' lifecycle log channel — informational, not user stderr.
        stderrQ.feed(frame.msg)
      } else if (frame.type === `exit` && typeof frame.exit_code === `number`) {
        exitInfo = { exitCode: frame.exit_code }
      }
      // session_info, port_notification, and unknown frame types ignored.
      return
    }
    // Binary frame → multiplexed output. Demux by first byte.
    let buf: Uint8Array
    if (event.data instanceof ArrayBuffer) {
      buf = new Uint8Array(event.data)
    } else if (typeof Buffer !== `undefined` && event.data instanceof Buffer) {
      buf = new Uint8Array(
        event.data.buffer,
        event.data.byteOffset,
        event.data.byteLength
      )
    } else {
      // Blob (browser) or other — best-effort.
      return
    }
    if (buf.length === 0) return
    const streamId = buf[0]
    if (streamId === STREAM_CONTROL) {
      // Control frame: 0x03 <exit_code_byte>. JSON exit frame may arrive
      // separately and authoritatively; both paths converge on exitInfo.
      if (!exitInfo && buf.length >= 2) {
        exitInfo = { exitCode: buf[1]! }
      }
      return
    }
    const text = new TextDecoder().decode(buf.subarray(1))
    if (streamId === STREAM_STDOUT) {
      stdoutQ.feed(text)
    } else if (streamId === STREAM_STDERR) {
      stderrQ.feed(text)
    }
    // Unknown stream IDs are dropped.
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
    // stdin support deferred — current callers (bootstrap, env-write,
    // user execs) don't need it; if they do, encode the input into the
    // cmd args (e.g. `printf '...' | tee ...`).
  }
  return handle
}
