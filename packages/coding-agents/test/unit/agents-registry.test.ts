import { describe, it, expect } from 'vitest'
import { listAdapters, getAdapter } from '../../src'

describe(`agents registry`, () => {
  it(`registers at least one adapter on import`, () => {
    expect(listAdapters().length).toBeGreaterThan(0)
  })

  it.each(listAdapters().map((a) => [a.kind, a] as const))(
    `%s adapter satisfies the contract`,
    (_kind, adapter) => {
      expect(adapter.cliBinary.length).toBeGreaterThan(0)
      expect(adapter.defaultEnvVars.length).toBeGreaterThan(0)

      const inv = adapter.buildCliInvocation({ prompt: `hi` })
      expect(Array.isArray(inv.args)).toBe(true)
      expect([`stdin`, `argv`]).toContain(inv.promptDelivery)

      const probe = adapter.probeCommand({
        homeDir: `/home/agent`,
        cwd: `/workspace`,
        sessionId: `abc`,
      })
      expect(Array.isArray(probe)).toBe(true)
      expect(probe.length).toBeGreaterThan(0)

      const target = adapter.materialiseTargetPath({
        homeDir: `/home/agent`,
        cwd: `/workspace`,
        sessionId: `abc`,
      })
      expect(typeof target).toBe(`string`)
      expect(target.length).toBeGreaterThan(0)

      const capture = adapter.captureCommand({
        homeDir: `/home/agent`,
        cwd: `/workspace`,
        sessionId: `abc`,
      })
      expect(Array.isArray(capture)).toBe(true)
      expect(capture.length).toBeGreaterThan(0)
    }
  )

  it(`getAdapter('claude') returns the claude adapter`, () => {
    expect(getAdapter(`claude`).kind).toBe(`claude`)
  })

  it(`getAdapter throws on unknown kinds`, () => {
    // @ts-expect-error intentional: testing runtime behaviour
    expect(() => getAdapter(`nope`)).toThrow(/unknown coding-agent kind/)
  })
})
