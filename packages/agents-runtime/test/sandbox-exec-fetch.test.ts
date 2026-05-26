import { describe, it, expect, vi } from 'vitest'
import { fetchInSandbox } from '../src/sandbox/exec-fetch'
import { SandboxError } from '../src/sandbox/types'
import type { SandboxExecOpts, SandboxExecResult } from '../src/sandbox/types'

/**
 * `fetchInSandbox` runs an HTTP request *inside* the sandbox via `exec` and
 * synthesizes a `Response` from the framed stdout the in-sandbox client emits:
 *   line 1: `<status>\t<content-type>`
 *   rest:   base64 of the response body (whitespace-insensitive)
 * These tests drive the TS parsing/synthesis + the exec wiring with a fake
 * exec; the actual in-sandbox shell is exercised by the live docker tests.
 */

function fakeExec(
  stdout: string,
  over: Partial<SandboxExecResult> = {}
): ReturnType<typeof vi.fn> {
  return vi.fn(
    async (_opts: SandboxExecOpts): Promise<SandboxExecResult> => ({
      exitCode: 0,
      signal: null,
      stdout: Buffer.from(stdout),
      stderr: Buffer.from(``),
      timedOut: false,
      aborted: false,
      outputTruncated: false,
      ...over,
    })
  )
}

function framed(status: number, contentType: string, body: string): string {
  return `${status}\t${contentType}\n` + Buffer.from(body).toString(`base64`)
}

describe(`fetchInSandbox`, () => {
  it(`synthesizes a Response from framed stdout`, async () => {
    const exec = fakeExec(
      framed(200, `text/html; charset=utf-8`, `<h1>hi</h1>`)
    )
    const res = await fetchInSandbox(exec, `https://example.com/`)
    expect(res.ok).toBe(true)
    expect(res.status).toBe(200)
    expect(res.headers.get(`content-type`)).toBe(`text/html; charset=utf-8`)
    expect(await res.text()).toBe(`<h1>hi</h1>`)
  })

  it(`runs the request inside the sandbox (single exec, never globalThis.fetch)`, async () => {
    const exec = fakeExec(framed(200, `text/plain`, `ok`))
    await fetchInSandbox(exec, `https://example.com/page`)
    expect(exec).toHaveBeenCalledTimes(1)
    const opts = exec.mock.calls[0]![0] as SandboxExecOpts
    // The command auto-detects an in-sandbox HTTP client.
    expect(opts.command).toContain(`curl`)
    expect(opts.command).toContain(`node`)
    expect(opts.command).toContain(`wget`)
    // The URL is passed via env, never interpolated into the command string
    // (injection-safe).
    expect(opts.command).not.toContain(`https://example.com/page`)
    expect(opts.env?.FETCH_URL).toBe(`https://example.com/page`)
  })

  it(`forwards User-Agent and Accept headers via env`, async () => {
    const exec = fakeExec(framed(200, `text/html`, `x`))
    await fetchInSandbox(exec, `https://example.com/`, {
      headers: {
        'User-Agent': `MyAgent/1.0`,
        Accept: `text/html,*/*`,
      },
    })
    const opts = exec.mock.calls[0]![0] as SandboxExecOpts
    expect(opts.env?.FETCH_UA).toBe(`MyAgent/1.0`)
    expect(opts.env?.FETCH_ACCEPT).toBe(`text/html,*/*`)
  })

  it(`forwards the abort signal and sets an exec timeout`, async () => {
    const exec = fakeExec(framed(200, `text/plain`, `ok`))
    const ac = new AbortController()
    await fetchInSandbox(exec, `https://example.com/`, { signal: ac.signal })
    const opts = exec.mock.calls[0]![0] as SandboxExecOpts
    expect(opts.signal).toBe(ac.signal)
    expect(opts.timeoutMs).toBeGreaterThan(0)
  })

  it(`decodes base64 bodies even when line-wrapped`, async () => {
    const body =
      `line1\nline2\nline3 with a long tail to force wrapping`.repeat(4)
    const b64 = Buffer.from(body).toString(`base64`)
    // Simulate coreutils `base64` wrapping output at 76 columns.
    const wrapped = b64.replace(/(.{76})/g, `$1\n`)
    const exec = fakeExec(`200\ttext/plain\n` + wrapped)
    const res = await fetchInSandbox(exec, `https://example.com/`)
    expect(await res.text()).toBe(body)
  })

  it(`omits content-type header when the client reports none`, async () => {
    const exec = fakeExec(framed(200, ``, `body`))
    const res = await fetchInSandbox(exec, `https://example.com/`)
    expect(res.headers.get(`content-type`)).toBeNull()
    expect(await res.text()).toBe(`body`)
  })

  it(`preserves non-ok HTTP statuses as a Response (tool reports them)`, async () => {
    const exec = fakeExec(framed(404, `text/html`, `nope`))
    const res = await fetchInSandbox(exec, `https://example.com/missing`)
    expect(res.ok).toBe(false)
    expect(res.status).toBe(404)
  })

  it(`throws SandboxError(runtime) when no HTTP client is present`, async () => {
    const exec = fakeExec(`NOCLIENT\n`)
    await expect(
      fetchInSandbox(exec, `https://example.com/`)
    ).rejects.toMatchObject({ kind: `runtime` })
  })

  it(`throws SandboxError when the request fails / egress is blocked (status 000)`, async () => {
    const exec = fakeExec(`000\t\n`)
    await expect(
      fetchInSandbox(exec, `https://blocked.invalid/`)
    ).rejects.toBeInstanceOf(SandboxError)
  })

  it(`throws SandboxError(runtime) on unparseable output`, async () => {
    const exec = fakeExec(``, { exitCode: 1 })
    await expect(
      fetchInSandbox(exec, `https://example.com/`)
    ).rejects.toMatchObject({ kind: `runtime` })
  })
})
