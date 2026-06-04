import { describe, expect, it } from 'vitest'
import { ensureSandboxMaterialized, lazySandbox } from '../src/sandbox/lazy'
import type { Sandbox } from '../src/sandbox/types'

/**
 * lazySandbox defers the provider factory until first use, so trivial wakes
 * (cron ticks, bookkeeping) never pay for — or leak — a provider-side sandbox
 * (e.g. a Docker container).
 */

interface FakeCalls {
  exec: number
  dispose: Array<{ reclaim?: boolean } | undefined>
}

const makeFake = (calls: FakeCalls): Sandbox => ({
  name: `fake:inner`,
  workingDirectory: `/work`,
  exec: async () => {
    calls.exec += 1
    return {
      exitCode: 0,
      signal: null,
      stdout: Buffer.from(`ok`),
      stderr: Buffer.alloc(0),
      timedOut: false,
      aborted: false,
      outputTruncated: false,
    }
  },
  readFile: async () => Buffer.from(`content`),
  writeFile: async () => {},
  mkdir: async () => {},
  readdir: async () => [],
  exists: async () => true,
  remove: async () => {},
  stat: async () => ({ type: `file`, size: 0, mtimeMs: 0 }),
  fetch: async () => new Response(`ok`),
  dispose: async (opts) => {
    calls.dispose.push(opts)
  },
})

const harness = () => {
  const calls: FakeCalls = { exec: 0, dispose: [] }
  let factoryCalls = 0
  const reclaims: Array<true> = []
  const sandbox = lazySandbox({
    name: `fake`,
    workingDirectory: `/work`,
    factory: async () => {
      factoryCalls += 1
      return makeFake(calls)
    },
    reclaim: async () => {
      reclaims.push(true)
    },
  })
  return {
    sandbox,
    calls,
    reclaims,
    factoryCalls: () => factoryCalls,
  }
}

describe(`lazySandbox`, () => {
  it(`does not invoke the factory on construction or property access`, () => {
    const h = harness()
    expect(h.sandbox.name).toBe(`fake`)
    expect(h.sandbox.workingDirectory).toBe(`/work`)
    expect(h.factoryCalls()).toBe(0)
  })

  it(`materializes on first use and reuses the inner sandbox after`, async () => {
    const h = harness()
    await h.sandbox.exec({ command: `echo hi` })
    await h.sandbox.exec({ command: `echo again` })
    await h.sandbox.readFile(`/work/x`)
    expect(h.factoryCalls()).toBe(1)
    expect(h.calls.exec).toBe(2)
    // After materialization the inner provider's name shows through.
    expect(h.sandbox.name).toBe(`fake:inner`)
  })

  it(`single-flights concurrent first calls`, async () => {
    let resolveFactory!: (sb: Sandbox) => void
    const calls: FakeCalls = { exec: 0, dispose: [] }
    let factoryCalls = 0
    const sandbox = lazySandbox({
      workingDirectory: `/work`,
      factory: () => {
        factoryCalls += 1
        return new Promise<Sandbox>((r) => {
          resolveFactory = r
        })
      },
    })
    const a = sandbox.exec({ command: `a` })
    const b = sandbox.exec({ command: `b` })
    resolveFactory(makeFake(calls))
    await Promise.all([a, b])
    expect(factoryCalls).toBe(1)
    expect(calls.exec).toBe(2)
  })

  it(`a failed factory rejects the call and is retried on the next use`, async () => {
    let attempts = 0
    const calls: FakeCalls = { exec: 0, dispose: [] }
    const sandbox = lazySandbox({
      workingDirectory: `/work`,
      factory: async () => {
        attempts += 1
        if (attempts === 1) throw new Error(`daemon hiccup`)
        return makeFake(calls)
      },
    })
    await expect(sandbox.exec({ command: `x` })).rejects.toThrow(
      `daemon hiccup`
    )
    await sandbox.exec({ command: `x` })
    expect(attempts).toBe(2)
    expect(calls.exec).toBe(1)
  })

  it(`dispose without use never invokes the factory`, async () => {
    const h = harness()
    await h.sandbox.dispose()
    expect(h.factoryCalls()).toBe(0)
    expect(h.calls.dispose).toEqual([])
    expect(h.reclaims).toEqual([])
  })

  it(`dispose({reclaim}) without use runs the reclaim callback instead`, async () => {
    // A terminal entity's persistent workspace from an EARLIER wake must not
    // survive just because the final wake never touched the sandbox.
    const h = harness()
    await h.sandbox.dispose({ reclaim: true })
    expect(h.factoryCalls()).toBe(0)
    expect(h.reclaims).toEqual([true])
  })

  it(`dispose({reclaim}) without use is a no-op when no reclaim callback exists`, async () => {
    let factoryCalls = 0
    const calls: FakeCalls = { exec: 0, dispose: [] }
    const sandbox = lazySandbox({
      workingDirectory: `/work`,
      factory: async () => {
        factoryCalls += 1
        return makeFake(calls)
      },
    })
    await sandbox.dispose({ reclaim: true })
    expect(factoryCalls).toBe(0)
  })

  it(`dispose after use forwards to the inner sandbox (reclaim included)`, async () => {
    const h = harness()
    await h.sandbox.exec({ command: `x` })
    await h.sandbox.dispose({ reclaim: true })
    expect(h.calls.dispose).toEqual([{ reclaim: true }])
    // The inner dispose owns reclaim semantics — the callback must not ALSO run.
    expect(h.reclaims).toEqual([])
  })

  it(`operations after dispose are rejected with a runtime SandboxError`, async () => {
    const h = harness()
    await h.sandbox.dispose()
    await expect(h.sandbox.exec({ command: `x` })).rejects.toMatchObject({
      kind: `runtime`,
    })
    expect(h.factoryCalls()).toBe(0)
  })

  it(`repeated dispose is a no-op`, async () => {
    const h = harness()
    await h.sandbox.exec({ command: `x` })
    await h.sandbox.dispose()
    await h.sandbox.dispose()
    expect(h.calls.dispose).toHaveLength(1)
  })
})

describe(`ensureSandboxMaterialized`, () => {
  it(`materializes a lazy sandbox without running any operation`, async () => {
    const h = harness()
    await ensureSandboxMaterialized(h.sandbox)
    expect(h.factoryCalls()).toBe(1)
    expect(h.calls.exec).toBe(0)
  })

  it(`is a no-op for a non-lazy sandbox`, async () => {
    const calls: FakeCalls = { exec: 0, dispose: [] }
    await ensureSandboxMaterialized(makeFake(calls))
    expect(calls.exec).toBe(0)
  })
})
