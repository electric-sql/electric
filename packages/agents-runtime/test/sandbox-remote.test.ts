import { describe, expect, it, vi } from 'vitest'
import { remoteSandbox } from '../src/sandbox/remote'
import { SandboxError } from '../src/sandbox/types'
import {
  adaptE2B,
  connectOrCreateE2BSandbox,
  e2bNetworkCreateOpts,
  type E2BSandboxClass,
} from '../src/sandbox/remote/e2b'
import type { RemoteSandboxClient } from '../src/sandbox/remote/types'

/**
 * Minimal e2b Sandbox instance recording the lifecycle calls the adapter
 * makes. Only `setTimeout`/`kill` matter for the heartbeat tests; the rest are
 * stubs so it satisfies the adapter's parameter type.
 */
function makeFakeSbx() {
  const calls = { setTimeout: [] as Array<number>, killed: 0 }
  const sbx = {
    sandboxId: `sbx-test`,
    commands: { run: async () => ({ stdout: ``, stderr: ``, exitCode: 0 }) },
    files: {
      read: async () => new Uint8Array(),
      write: async () => undefined,
      makeDir: async () => undefined,
    },
    async setTimeout(ms: number) {
      calls.setTimeout.push(ms)
    },
    async kill() {
      calls.killed++
    },
  }
  return {
    sbx: sbx as unknown as Parameters<typeof adaptE2B>[0],
    calls,
  }
}

function makeFakeClient(): RemoteSandboxClient & {
  __calls: {
    exec: Array<{ cmd: string; cwd?: string }>
    read: Array<string>
    write: Array<{ path: string; size: number }>
    mkdir: Array<string>
    killed: boolean
    suspended: boolean
  }
} {
  const calls = {
    exec: [] as Array<{ cmd: string; cwd?: string }>,
    read: [] as Array<string>,
    write: [] as Array<{ path: string; size: number }>,
    mkdir: [] as Array<string>,
    killed: false,
    suspended: false,
  }
  const files = new Map<string, Buffer>()
  return {
    __calls: calls,
    async exec(opts) {
      calls.exec.push({ cmd: opts.command, cwd: opts.cwd })
      return {
        stdout: Buffer.from(`stdout for ${opts.command}`),
        stderr: Buffer.from(``),
        exitCode: 0,
      }
    },
    async readFile(path) {
      calls.read.push(path)
      const buf = files.get(path)
      if (!buf) throw new Error(`ENOENT: ${path}`)
      return buf
    },
    async writeFile(path, content) {
      const buf = Buffer.isBuffer(content) ? content : Buffer.from(content)
      calls.write.push({ path, size: buf.length })
      files.set(path, buf)
    },
    async mkdir(path) {
      calls.mkdir.push(path)
    },
    async readdir() {
      return []
    },
    async exists(path) {
      return files.has(path)
    },
    async remove(path) {
      files.delete(path)
    },
    async stat(path) {
      const buf = files.get(path)
      if (!buf) {
        const e: NodeJS.ErrnoException = new Error(`ENOENT: ${path}`)
        e.code = `ENOENT`
        throw e
      }
      return { type: `file` as const, size: buf.length, mtimeMs: 0 }
    },
    async kill() {
      calls.killed = true
    },
    async suspend() {
      calls.suspended = true
    },
  }
}

/**
 * In-memory stand-in for the e2b `Sandbox` class statics. Persists created
 * sandboxes (keyed by id) across calls so we can assert reattach-by-key: a
 * later call for the same key connect()s to the existing one instead of
 * creating a second.
 */
function makeFakeE2B() {
  interface Stored {
    sandboxId: string
    metadata?: Record<string, string>
    state: string
    startedAt: Date
  }
  const store = new Map<string, Stored>()
  let idSeq = 0
  const calls = {
    create: [] as Array<{ template?: string; opts?: Record<string, unknown> }>,
    connect: [] as Array<string>,
    list: 0,
  }
  const Sandbox = {
    async create(arg1?: unknown, arg2?: unknown) {
      const template = typeof arg1 === `string` ? arg1 : undefined
      const opts = (typeof arg1 === `string` ? arg2 : arg1) as
        | Record<string, unknown>
        | undefined
      calls.create.push({ template, opts })
      const sandboxId = `sbx-${++idSeq}`
      store.set(sandboxId, {
        sandboxId,
        metadata: opts?.metadata as Record<string, string> | undefined,
        state: `running`,
        // Monotonic so the "oldest wins" tiebreak is deterministic.
        startedAt: new Date(1_000 + idSeq),
      })
      return { sandboxId }
    },
    async connect(sandboxId: string) {
      calls.connect.push(sandboxId)
      const info = store.get(sandboxId)
      if (info) info.state = `running` // connect() auto-resumes a paused VM
      return { sandboxId }
    },
    list(opts?: {
      query?: { metadata?: Record<string, string>; state?: Array<string> }
    }) {
      calls.list++
      const wantMeta = opts?.query?.metadata ?? {}
      const wantStates = opts?.query?.state
      return {
        async nextItems() {
          return [...store.values()].filter(
            (s) =>
              Object.entries(wantMeta).every(
                ([k, v]) => s.metadata?.[k] === v
              ) &&
              (wantStates === undefined || wantStates.includes(s.state))
          )
        },
      }
    },
  }
  return { Sandbox: Sandbox as unknown as E2BSandboxClass, store, calls }
}

describe(`remoteSandbox`, () => {
  describe(`identity`, () => {
    it(`reports name 'remote:e2b' when constructed with an e2b client`, async () => {
      const client = makeFakeClient()
      const sandbox = await remoteSandbox({
        provider: `e2b`,
        client,
        workingDirectory: `/work`,
      })
      try {
        expect(sandbox.name).toBe(`remote:e2b`)
        expect(sandbox.workingDirectory).toBe(`/work`)
      } finally {
        await sandbox.dispose()
      }
    })
  })

  describe(`exec`, () => {
    it(`delegates to the client with the configured cwd`, async () => {
      const client = makeFakeClient()
      const sandbox = await remoteSandbox({
        provider: `e2b`,
        client,
        workingDirectory: `/work`,
      })
      try {
        const result = await sandbox.exec({ command: `ls -la` })
        expect(result.exitCode).toBe(0)
        expect(result.stdout.toString()).toBe(`stdout for ls -la`)
        expect(client.__calls.exec).toEqual([{ cmd: `ls -la`, cwd: `/work` }])
      } finally {
        await sandbox.dispose()
      }
    })

    it(`overrides cwd from opts`, async () => {
      const client = makeFakeClient()
      const sandbox = await remoteSandbox({
        provider: `e2b`,
        client,
        workingDirectory: `/work`,
      })
      try {
        await sandbox.exec({ command: `pwd`, cwd: `/tmp` })
        expect(client.__calls.exec[0].cwd).toBe(`/tmp`)
      } finally {
        await sandbox.dispose()
      }
    })
  })

  describe(`filesystem`, () => {
    it(`writeFile + readFile roundtrip via the client`, async () => {
      const client = makeFakeClient()
      const sandbox = await remoteSandbox({
        provider: `e2b`,
        client,
        workingDirectory: `/work`,
      })
      try {
        await sandbox.writeFile(`/work/x.txt`, `hello`)
        const buf = await sandbox.readFile(`/work/x.txt`)
        expect(buf.toString(`utf-8`)).toBe(`hello`)
      } finally {
        await sandbox.dispose()
      }
    })

    it(`writeFile rejects paths outside the working directory`, async () => {
      const client = makeFakeClient()
      const sandbox = await remoteSandbox({
        provider: `e2b`,
        client,
        workingDirectory: `/work`,
      })
      try {
        await expect(
          sandbox.writeFile(`/etc/passwd`, `nope`)
        ).rejects.toBeInstanceOf(SandboxError)
      } finally {
        await sandbox.dispose()
      }
    })

    it(`mkdir delegates to the client`, async () => {
      const client = makeFakeClient()
      const sandbox = await remoteSandbox({
        provider: `e2b`,
        client,
        workingDirectory: `/work`,
      })
      try {
        await sandbox.mkdir(`/work/nested/deep`, { recursive: true })
        expect(client.__calls.mkdir).toContain(`/work/nested/deep`)
      } finally {
        await sandbox.dispose()
      }
    })
  })

  describe(`fetch`, () => {
    it(`runs the request inside the VM via exec and returns a Response`, async () => {
      // A client whose exec emulates the in-sandbox HTTP client: it frames
      // status + content-type + base64 body the way fetchInSandbox expects.
      const execCalls: Array<{
        command: string
        env?: Record<string, string>
      }> = []
      const client: RemoteSandboxClient = {
        ...makeFakeClient(),
        async exec(opts) {
          execCalls.push({ command: opts.command, env: opts.env })
          const url = opts.env?.FETCH_URL ?? ``
          const body = `<h1>served from inside the VM for ${url}</h1>`
          return {
            stdout: Buffer.from(
              `200\ttext/html; charset=utf-8\n` +
                Buffer.from(body).toString(`base64`)
            ),
            stderr: Buffer.from(``),
            exitCode: 0,
          }
        },
      }
      const sandbox = await remoteSandbox({
        provider: `e2b`,
        client,
        workingDirectory: `/work`,
      })
      try {
        const res = await sandbox.fetch(`https://example.com/`)
        expect(res.status).toBe(200)
        expect(res.headers.get(`content-type`)).toContain(`text/html`)
        expect(await res.text()).toContain(`served from inside the VM`)
        // It egressed via exec inside the VM — not from the host process.
        expect(execCalls).toHaveLength(1)
        expect(execCalls[0]!.env?.FETCH_URL).toBe(`https://example.com/`)
      } finally {
        await sandbox.dispose()
      }
    })

    it(`surfaces a failed in-sandbox request as a SandboxError`, async () => {
      // status 000 ⇒ no response (egress blocked by the VM policy, or the
      // host is unreachable) ⇒ the fetch rejects.
      const client: RemoteSandboxClient = {
        ...makeFakeClient(),
        async exec() {
          return {
            stdout: Buffer.from(`000\t\n`),
            stderr: Buffer.from(``),
            exitCode: 0,
          }
        },
      }
      const sandbox = await remoteSandbox({
        provider: `e2b`,
        client,
        workingDirectory: `/work`,
      })
      try {
        await expect(
          sandbox.fetch(`https://blocked.invalid/`)
        ).rejects.toBeInstanceOf(SandboxError)
      } finally {
        await sandbox.dispose()
      }
    })
  })

  describe(`e2b network policy`, () => {
    it(`maps a NetworkPolicy to e2b create-time egress opts`, () => {
      expect(e2bNetworkCreateOpts({ mode: `allow-all` })).toEqual({
        allowInternetAccess: true,
      })
      expect(e2bNetworkCreateOpts({ mode: `deny-all` })).toEqual({
        allowInternetAccess: false,
      })
      expect(
        e2bNetworkCreateOpts({
          mode: `allowlist`,
          allow: [`example.com`, `api.test`],
        })
      ).toEqual({ network: { allowOut: [`example.com`, `api.test`] } })
    })

    it(`applies the egress policy to a freshly created (keyless) VM`, async () => {
      const { Sandbox, calls } = makeFakeE2B()
      await connectOrCreateE2BSandbox(Sandbox, {
        persistent: false,
        keepAliveMs: 1000,
        network: e2bNetworkCreateOpts({
          mode: `allowlist`,
          allow: [`example.com`],
        }),
      })
      expect(calls.create).toHaveLength(1)
      expect(calls.create[0].opts?.network).toEqual({
        allowOut: [`example.com`],
      })
    })

    it(`applies the egress policy to a persistent created VM (alongside lifecycle)`, async () => {
      const { Sandbox, calls } = makeFakeE2B()
      await connectOrCreateE2BSandbox(Sandbox, {
        persistent: true,
        sandboxKey: `s1`,
        keepAliveMs: 1000,
        network: e2bNetworkCreateOpts({ mode: `deny-all` }),
      })
      expect(calls.create).toHaveLength(1)
      expect(calls.create[0].opts?.allowInternetAccess).toBe(false)
      // Egress opts don't clobber the reattach lifecycle config.
      expect(calls.create[0].opts?.lifecycle).toEqual({
        onTimeout: `pause`,
        autoResume: true,
      })
    })
  })

  describe(`lifecycle`, () => {
    it(`dispose kills the underlying remote workspace exactly once`, async () => {
      const client = makeFakeClient()
      const killSpy = vi.spyOn(client, `kill`)
      const sandbox = await remoteSandbox({
        provider: `e2b`,
        client,
        workingDirectory: `/work`,
      })
      await sandbox.dispose()
      expect(killSpy).toHaveBeenCalledTimes(1)
      // Second dispose is a no-op — kill is not called again.
      await sandbox.dispose()
      expect(killSpy).toHaveBeenCalledTimes(1)
    })

    it(`ephemeral (non-persistent) sandbox dispose kills, never suspends`, async () => {
      const client = makeFakeClient()
      const killSpy = vi.spyOn(client, `kill`)
      const suspendSpy = vi.spyOn(client, `suspend`)
      const sandbox = await remoteSandbox({
        provider: `e2b`,
        client,
        workingDirectory: `/work`,
        // persistent defaults false
      })
      await sandbox.dispose()
      expect(killSpy).toHaveBeenCalledTimes(1)
      expect(suspendSpy).not.toHaveBeenCalled()
    })

    it(`persistent sandbox dispose suspends (preserves state), never kills`, async () => {
      const client = makeFakeClient()
      const killSpy = vi.spyOn(client, `kill`)
      const suspendSpy = vi.spyOn(client, `suspend`)
      const sandbox = await remoteSandbox({
        provider: `e2b`,
        client,
        workingDirectory: `/work`,
        persistent: true,
      })
      await sandbox.dispose()
      expect(suspendSpy).toHaveBeenCalledTimes(1)
      expect(killSpy).not.toHaveBeenCalled()
      // Idempotent — neither runs again.
      await sandbox.dispose()
      expect(suspendSpy).toHaveBeenCalledTimes(1)
      expect(killSpy).not.toHaveBeenCalled()
    })

    it(`persistent sandbox falls back to kill when the client has no suspend()`, async () => {
      const client = makeFakeClient()
      delete (client as { suspend?: unknown }).suspend
      const killSpy = vi.spyOn(client, `kill`)
      const sandbox = await remoteSandbox({
        provider: `e2b`,
        client,
        workingDirectory: `/work`,
        persistent: true,
      })
      await sandbox.dispose()
      expect(killSpy).toHaveBeenCalledTimes(1)
    })

    it(`an attacher dispose detaches (suspend), never kills — even when ephemeral`, async () => {
      const client = makeFakeClient()
      const killSpy = vi.spyOn(client, `kill`)
      const suspendSpy = vi.spyOn(client, `suspend`)
      const sandbox = await remoteSandbox({
        provider: `e2b`,
        client,
        workingDirectory: `/work`,
        persistent: false,
        owner: false, // attacher: must never kill the owner's VM
      })
      await sandbox.dispose()
      expect(suspendSpy).toHaveBeenCalledTimes(1)
      expect(killSpy).not.toHaveBeenCalled()
    })

    it(`owner reclaim kills even a persistent VM (terminal ⇒ wipe)`, async () => {
      const client = makeFakeClient()
      const killSpy = vi.spyOn(client, `kill`)
      const suspendSpy = vi.spyOn(client, `suspend`)
      const sandbox = await remoteSandbox({
        provider: `e2b`,
        client,
        workingDirectory: `/work`,
        persistent: true,
      })
      await sandbox.dispose({ reclaim: true })
      expect(killSpy).toHaveBeenCalledTimes(1)
      expect(suspendSpy).not.toHaveBeenCalled()
    })
  })

  describe(`e2b reattach by key`, () => {
    it(`keyless sandbox is created fresh with no metadata or reattach`, async () => {
      const { Sandbox, calls } = makeFakeE2B()
      await connectOrCreateE2BSandbox(Sandbox, {
        persistent: false,
        keepAliveMs: 1000,
      })
      expect(calls.create).toHaveLength(1)
      expect(calls.list).toBe(0)
      expect(calls.connect).toHaveLength(0)
      // No reuse metadata without an identity to reattach by.
      expect(calls.create[0].opts?.metadata).toBeUndefined()
    })

    it(`an ephemeral keyed sandbox is tagged + reattachable but killed on idle`, async () => {
      const { Sandbox, calls } = makeFakeE2B()
      await connectOrCreateE2BSandbox(Sandbox, {
        persistent: false,
        sandboxKey: `/horton/solo#wake-1`,
        keepAliveMs: 1000,
      })
      // Reattach is by key regardless of durability — it looked up first.
      expect(calls.list).toBe(1)
      expect(calls.connect).toHaveLength(0)
      expect(calls.create).toHaveLength(1)
      const opts = calls.create[0].opts!
      // Tagged so an in-window collaborator can reattach by key…
      expect(Object.keys(opts.metadata as Record<string, string>)).toHaveLength(
        1
      )
      // …but idle-collected by killing (wiped), not pausing.
      expect(opts.lifecycle).toEqual({ onTimeout: `kill` })
    })

    it(`a persistent sandbox with no live VM creates one tagged + pause-on-idle`, async () => {
      const { Sandbox, calls } = makeFakeE2B()
      await connectOrCreateE2BSandbox(Sandbox, {
        persistent: true,
        sandboxKey: `session-1`,
        keepAliveMs: 1000,
      })
      expect(calls.connect).toHaveLength(0)
      expect(calls.create).toHaveLength(1)
      const opts = calls.create[0].opts!
      const metadata = opts.metadata as Record<string, string>
      // Tagged with exactly one reuse-key entry (the hashed key).
      expect(Object.keys(metadata)).toHaveLength(1)
      expect(opts.timeoutMs).toBe(1000)
      // Idle-collected by suspending, not killing, so it stays reattachable.
      expect(opts.lifecycle).toEqual({ onTimeout: `pause`, autoResume: true })
    })

    it(`reconnects to the same identity for the same key`, async () => {
      const { Sandbox, calls } = makeFakeE2B()
      const first = await connectOrCreateE2BSandbox(Sandbox, {
        persistent: true,
        sandboxKey: `session-1`,
        keepAliveMs: 1000,
      })
      const second = await connectOrCreateE2BSandbox(Sandbox, {
        persistent: true,
        sandboxKey: `session-1`,
        keepAliveMs: 1000,
      })
      // Second resolution reattaches rather than creating a new VM.
      expect(calls.create).toHaveLength(1)
      expect(calls.connect).toEqual([first.sandboxId])
      expect(second.sandboxId).toBe(first.sandboxId)
    })

    it(`reconnects to a paused VM (connect auto-resumes it)`, async () => {
      const { Sandbox, store } = makeFakeE2B()
      const first = await connectOrCreateE2BSandbox(Sandbox, {
        persistent: true,
        sandboxKey: `session-1`,
        keepAliveMs: 1000,
      })
      store.get(first.sandboxId)!.state = `paused`
      const second = await connectOrCreateE2BSandbox(Sandbox, {
        persistent: true,
        sandboxKey: `session-1`,
        keepAliveMs: 1000,
      })
      expect(second.sandboxId).toBe(first.sandboxId)
      expect(store.get(first.sandboxId)!.state).toBe(`running`)
    })

    it(`distinct keys get distinct workspaces`, async () => {
      const { Sandbox, calls } = makeFakeE2B()
      const a = await connectOrCreateE2BSandbox(Sandbox, {
        persistent: true,
        sandboxKey: `session-1`,
        keepAliveMs: 1000,
      })
      const b = await connectOrCreateE2BSandbox(Sandbox, {
        persistent: true,
        sandboxKey: `session-2`,
        keepAliveMs: 1000,
      })
      expect(calls.create).toHaveLength(2)
      expect(calls.connect).toHaveLength(0)
      expect(a.sandboxId).not.toBe(b.sandboxId)
    })

    it(`an attacher reconnects to the owner's live VM (never creates)`, async () => {
      const { Sandbox, calls } = makeFakeE2B()
      const owner = await connectOrCreateE2BSandbox(Sandbox, {
        persistent: true,
        sandboxKey: `session-1`,
        keepAliveMs: 1000,
      })
      const attacher = await connectOrCreateE2BSandbox(Sandbox, {
        persistent: true,
        owner: false,
        sandboxKey: `session-1`,
        keepAliveMs: 1000,
      })
      expect(calls.create).toHaveLength(1) // only the owner created
      expect(calls.connect).toEqual([owner.sandboxId])
      expect(attacher.sandboxId).toBe(owner.sandboxId)
    })

    it(`an attacher rejects with 'unavailable' when no VM exists for the key`, async () => {
      const { Sandbox, calls } = makeFakeE2B()
      await expect(
        connectOrCreateE2BSandbox(Sandbox, {
          persistent: true,
          owner: false,
          sandboxKey: `nobody-home`,
          keepAliveMs: 1000,
        })
      ).rejects.toMatchObject({ kind: `unavailable` })
      // It must NOT have conjured a fresh, empty VM.
      expect(calls.create).toHaveLength(0)
    })
  })

  describe(`e2b keep-alive (Model C)`, () => {
    it(`heartbeats setTimeout while held and stops on suspend (no kill)`, async () => {
      vi.useFakeTimers()
      try {
        const { sbx, calls } = makeFakeSbx()
        const client = adaptE2B(sbx, `/work`, {
          keepAliveMs: 1000,
          heartbeatIntervalMs: 100,
        })
        await vi.advanceTimersByTimeAsync(350)
        // Several refreshes, each to the full keep-alive window.
        expect(calls.setTimeout.length).toBeGreaterThanOrEqual(3)
        expect(calls.setTimeout.every((ms) => ms === 1000)).toBe(true)

        const ticksBeforeSuspend = calls.setTimeout.length
        await client.suspend!()
        await vi.advanceTimersByTimeAsync(500)
        // Heartbeat stopped; the platform is left to auto-suspend. No kill.
        expect(calls.setTimeout.length).toBe(ticksBeforeSuspend)
        expect(calls.killed).toBe(0)
      } finally {
        vi.useRealTimers()
      }
    })

    it(`heartbeats regardless of durability (keeps the VM alive during a wake)`, async () => {
      // The heartbeat keeps any held VM alive for the duration of the wake; an
      // ephemeral VM is only reaped (killed) once every holder stops.
      vi.useFakeTimers()
      try {
        const { sbx, calls } = makeFakeSbx()
        const client = adaptE2B(sbx, `/work`, {
          keepAliveMs: 1000,
          heartbeatIntervalMs: 100,
        })
        await vi.advanceTimersByTimeAsync(350)
        expect(calls.setTimeout.length).toBeGreaterThanOrEqual(3)
        await client.kill()
        expect(calls.killed).toBe(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it(`kill() also stops the heartbeat`, async () => {
      vi.useFakeTimers()
      try {
        const { sbx, calls } = makeFakeSbx()
        const client = adaptE2B(sbx, `/work`, {
          keepAliveMs: 1000,
          heartbeatIntervalMs: 100,
        })
        await vi.advanceTimersByTimeAsync(150)
        const ticksBeforeKill = calls.setTimeout.length
        await client.kill()
        await vi.advanceTimersByTimeAsync(500)
        expect(calls.setTimeout.length).toBe(ticksBeforeKill)
        expect(calls.killed).toBe(1)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe(`provider loading`, () => {
    it(`throws unavailable when no client and e2b is not installed`, async () => {
      // Force the dynamic loader to fail by passing an unknown provider.
      await expect(
        remoteSandbox({
          provider: `unknown` as never,
          workingDirectory: `/work`,
        })
      ).rejects.toBeInstanceOf(SandboxError)
    })
  })
})
