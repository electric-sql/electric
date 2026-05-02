import { describe, expect, it, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { createExecHandle } from '../../src/providers/fly-sprites/exec-adapter'

// Minimal WebSocket mock with the WebSocket browser API surface.
class MockWebSocket extends EventEmitter {
  readyState = 0
  static OPEN = 1
  static CLOSED = 3
  send = vi.fn()
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED
    this.emit(`close`, { code: 1000 })
  })
  // Bridge browser WebSocket API → Node EventEmitter so the adapter (which
  // uses addEventListener) works against this mock.
  addEventListener(event: string, listener: (...args: Array<any>) => void) {
    this.on(event, listener)
  }
  removeEventListener(event: string, listener: (...args: Array<any>) => void) {
    this.off(event, listener)
  }
  emitOpen() {
    this.readyState = MockWebSocket.OPEN
    this.emit(`open`)
  }
  emitFrame(data: any) {
    this.emit(`message`, { data: JSON.stringify(data) })
  }
  emitText(data: string) {
    this.emit(`message`, { data })
  }
}

describe(`createExecHandle`, () => {
  let ws: MockWebSocket
  beforeEach(() => {
    ws = new MockWebSocket()
  })

  it(`drains stdout frames as async-iterable lines`, async () => {
    // Per live recon: stdout is RAW TEXT WebSocket messages (NOT JSON-wrapped).
    // stderr/lifecycle uses {type:'debug', msg:'...'}, exit uses snake_case
    // {type:'exit', exit_code:N}.
    setTimeout(() => {
      ws.emitOpen()
      ws.emitText(`hello\n`)
      ws.emitText(`world\n`)
      ws.emitFrame({ type: `exit`, exit_code: 0 })
      ws.close()
    }, 5)

    const handle = createExecHandle({
      ws: ws as unknown as WebSocket,
      cmd: [`echo`, `test`],
    })

    const lines: Array<string> = []
    for await (const line of handle.stdout) lines.push(line)
    const exit = await handle.wait()

    expect(lines).toEqual([`hello`, `world`])
    expect(exit.exitCode).toBe(0)
  })

  it(`drains stderr separately from stdout`, async () => {
    setTimeout(() => {
      ws.emitOpen()
      ws.emitText(`out1\n`)
      ws.emitFrame({ type: `debug`, msg: `err1` })
      ws.emitText(`out2\n`)
      ws.emitFrame({ type: `exit`, exit_code: 1 })
      ws.close()
    }, 5)

    const handle = createExecHandle({
      ws: ws as unknown as WebSocket,
      cmd: [`bad`, `cmd`],
    })

    const out: Array<string> = []
    const err: Array<string> = []
    const drainOut = (async () => {
      for await (const l of handle.stdout) out.push(l)
    })()
    const drainErr = (async () => {
      for await (const l of handle.stderr) err.push(l)
    })()
    const exit = await handle.wait()
    await Promise.all([drainOut, drainErr])

    expect(out).toEqual([`out1`, `out2`])
    expect(err).toEqual([`err1`])
    expect(exit.exitCode).toBe(1)
  })

  it(`supports stdin via writeStdin / closeStdin when stdin: 'pipe'`, async () => {
    setTimeout(() => {
      ws.emitOpen()
      ws.emitFrame({ type: `exit`, exit_code: 0 })
      ws.close()
    }, 5)

    const handle = createExecHandle({
      ws: ws as unknown as WebSocket,
      cmd: [`cat`],
      stdin: `pipe`,
    })

    expect(handle.writeStdin).toBeDefined()
    expect(handle.closeStdin).toBeDefined()
    await handle.writeStdin!(`some prompt\n`)
    await handle.closeStdin!()
    await handle.wait()

    // Verify the WS received the stdin frame.
    expect(ws.send).toHaveBeenCalledWith(expect.stringContaining(`"stdin"`))
  })

  it(`emits start frame with cmd argv on open`, async () => {
    setTimeout(() => {
      ws.emitOpen()
      ws.emitFrame({ type: `exit`, exit_code: 0 })
      ws.close()
    }, 5)

    const handle = createExecHandle({
      ws: ws as unknown as WebSocket,
      cmd: [`ls`, `-la`, `/tmp`],
    })
    const drainOut = (async () => {
      for await (const _ of handle.stdout) {
        // discard
      }
    })()
    const drainErr = (async () => {
      for await (const _ of handle.stderr) {
        // discard
      }
    })()
    await handle.wait()
    await Promise.all([drainOut, drainErr])

    const startFrame = ws.send.mock.calls[0]![0] as string
    const parsed = JSON.parse(startFrame)
    expect(parsed.type).toBe(`start`)
    expect(parsed.cmd).toEqual([`ls`, `-la`, `/tmp`])
  })
})
