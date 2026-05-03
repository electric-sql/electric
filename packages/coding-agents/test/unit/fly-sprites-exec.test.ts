import { describe, expect, it, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { createExecHandle } from '../../src/providers/fly-sprites/exec-adapter'

// Minimal WebSocket mock with the WebSocket browser API surface.
class MockWebSocket extends EventEmitter {
  readyState = 0
  binaryType: BinaryType = `arraybuffer`
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
  emitJson(obj: unknown) {
    this.emit(`message`, { data: JSON.stringify(obj) })
  }
  emitBinary(text: string, streamId: number = 0x01) {
    // Sprites multiplexes stdout/stderr/control via a one-byte stream id
    // prefix on each binary frame. Default to stdout (0x01).
    const data = new TextEncoder().encode(text)
    const frame = new Uint8Array(1 + data.length)
    frame[0] = streamId
    frame.set(data, 1)
    this.emit(`message`, { data: frame.buffer.slice(0) })
  }
  emitControlExit(code: number) {
    // Control frame: 0x03 <exit_code_byte>.
    const frame = new Uint8Array([0x03, code])
    this.emit(`message`, { data: frame.buffer.slice(0) })
  }
}

describe(`createExecHandle (sprites api.sprites.dev exec protocol)`, () => {
  let ws: MockWebSocket
  beforeEach(() => {
    ws = new MockWebSocket()
  })

  it(`drains stdout-prefixed binary frames (0x01) as async-iterable lines`, async () => {
    setTimeout(() => {
      ws.emitOpen()
      ws.emitBinary(`hello\n`, 0x01)
      ws.emitBinary(`world\n`, 0x01)
      ws.emitJson({ type: `exit`, exit_code: 0 })
      ws.close()
    }, 5)

    const handle = createExecHandle({ ws: ws as unknown as WebSocket })

    const lines: Array<string> = []
    for await (const line of handle.stdout) lines.push(line)
    const exit = await handle.wait()

    expect(lines).toEqual([`hello`, `world`])
    expect(exit.exitCode).toBe(0)
  })

  it(`demuxes stdout (0x01) vs stderr (0x02) prefixed binary frames`, async () => {
    setTimeout(() => {
      ws.emitOpen()
      ws.emitBinary(`out1\n`, 0x01)
      ws.emitBinary(`err1\n`, 0x02)
      ws.emitBinary(`out2\n`, 0x01)
      ws.emitJson({ type: `debug`, msg: `lifecycle hint` })
      ws.emitJson({ type: `exit`, exit_code: 0 })
      ws.close()
    }, 5)

    const handle = createExecHandle({ ws: ws as unknown as WebSocket })

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
    expect(err).toContain(`err1`)
    expect(err).toContain(`lifecycle hint`)
    expect(exit.exitCode).toBe(0)
  })

  it(`reads exit code from the 0x03 control frame when JSON exit doesn't arrive`, async () => {
    setTimeout(() => {
      ws.emitOpen()
      ws.emitBinary(`out\n`, 0x01)
      ws.emitControlExit(7)
      ws.close()
    }, 5)
    const handle = createExecHandle({ ws: ws as unknown as WebSocket })
    const drain = async (s: AsyncIterable<string>) => {
      for await (const _ of s) {
        // ignore
      }
    }
    await Promise.all([drain(handle.stdout), drain(handle.stderr)])
    const exit = await handle.wait()
    expect(exit.exitCode).toBe(7)
  })

  it(`uses snake_case exit_code from the JSON exit frame`, async () => {
    setTimeout(() => {
      ws.emitOpen()
      ws.emitBinary(`done\n`, 0x01)
      ws.emitJson({ type: `exit`, exit_code: 7 })
      ws.close()
    }, 5)
    const handle = createExecHandle({ ws: ws as unknown as WebSocket })
    const drain = async (s: AsyncIterable<string>) => {
      for await (const _ of s) {
        // ignore
      }
    }
    await Promise.all([drain(handle.stdout), drain(handle.stderr)])
    const exit = await handle.wait()
    expect(exit.exitCode).toBe(7)
  })

  it(`reports exitCode=-1 when WS closes without an exit frame`, async () => {
    setTimeout(() => {
      ws.emitOpen()
      ws.emitBinary(`partial\n`, 0x01)
      ws.close()
    }, 5)
    const handle = createExecHandle({ ws: ws as unknown as WebSocket })
    const drain = async (s: AsyncIterable<string>) => {
      for await (const _ of s) {
        // ignore
      }
    }
    await Promise.all([drain(handle.stdout), drain(handle.stderr)])
    const exit = await handle.wait()
    expect(exit.exitCode).toBe(-1)
  })

  it(`ignores session_info and unknown JSON frame types`, async () => {
    setTimeout(() => {
      ws.emitOpen()
      ws.emitJson({
        type: `session_info`,
        session_id: `4`,
        command: `/bin/sh`,
      })
      ws.emitJson({ type: `port_notification`, port: 8080 })
      ws.emitBinary(`hi\n`, 0x01)
      ws.emitJson({ type: `exit`, exit_code: 0 })
      ws.close()
    }, 5)
    const handle = createExecHandle({ ws: ws as unknown as WebSocket })
    const out: Array<string> = []
    const err: Array<string> = []
    const drainOut = (async () => {
      for await (const l of handle.stdout) out.push(l)
    })()
    const drainErr = (async () => {
      for await (const l of handle.stderr) err.push(l)
    })()
    await handle.wait()
    await Promise.all([drainOut, drainErr])
    expect(out).toEqual([`hi`])
    expect(err).toEqual([])
  })

  it(`does NOT send a 'start' JSON frame on open (cmd is in URL query string)`, async () => {
    setTimeout(() => {
      ws.emitOpen()
      ws.emitJson({ type: `exit`, exit_code: 0 })
      ws.close()
    }, 5)
    const handle = createExecHandle({ ws: ws as unknown as WebSocket })
    await handle.wait()
    expect(ws.send).not.toHaveBeenCalled()
  })
})
