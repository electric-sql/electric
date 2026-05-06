import { afterEach, describe, expect, it } from 'vitest'
import { createRegistry, type Registry } from '../../src/registry'
import { createMcpTools } from '../../src/tools'
import { FIXTURE_PATH, defaultTransportFactory, noopVault } from '../helpers'

/**
 * E2E coverage for scenarios that the official `server-everything` reference
 * server cannot easily simulate. Happy-path protocol coverage lives in
 * `everything.e2e.test.ts`. This suite uses the trimmed mock fixture
 * (`fixtures/mock-mcp-server.ts`) spawned as a stdio subprocess.
 *
 *   - `auth-required`: the mock returns a JSON-RPC `Unauthorized` error on
 *     `tools/call` (initialize and `tools/list` succeed). We assert the
 *     bridge surfaces that as `auth_unavailable` per
 *     `bridge/tool-bridge.ts`'s `/auth/i` heuristic.
 *
 *   - `tools-changed`: the mock returns a different tool list on each
 *     `tools/list` call. Re-running `applyConfig` (which always re-fetches)
 *     should pick up the new shape.
 */
describe(`E2E: edge cases (mock fixture)`, () => {
  const registries: Registry[] = []

  afterEach(async () => {
    while (registries.length > 0) {
      const reg = registries.pop()!
      for (const s of reg.list()) {
        try {
          await s.transport?.close()
        } catch {
          // best-effort teardown
        }
      }
    }
  })

  it(`auth-required: tool call surfaces auth_unavailable error`, async () => {
    const reg = createRegistry({
      vault: noopVault(),
      transportFactory: defaultTransportFactory,
    })
    registries.push(reg)
    await reg.applyConfig({
      servers: {
        locked: {
          transport: `stdio`,
          command: `npx`,
          args: [`tsx`, FIXTURE_PATH, `auth-required`],
        },
      },
    })

    const tools = createMcpTools(reg, [`locked`]).tools()
    const echo = tools.find((t) => t.name === `mcp__locked__echo`)!
    expect(echo).toBeDefined()
    const result = (await echo.run({ msg: `x` })) as {
      error?: { kind: string; server: string; detail?: string }
    }
    expect(result.error).toBeDefined()
    expect(result.error?.server).toBe(`locked`)
    // The mock's "Unauthorized" message is matched by tool-bridge's
    // `/auth/i` heuristic and surfaces as `auth_unavailable`.
    expect(result.error?.kind).toBe(`auth_unavailable`)
  }, 30_000)

  it(`tools-changed: a follow-up tools/list returns the updated set`, async () => {
    const reg = createRegistry({
      vault: noopVault(),
      transportFactory: defaultTransportFactory,
    })
    registries.push(reg)
    await reg.applyConfig({
      servers: {
        shifty: {
          transport: `stdio`,
          command: `npx`,
          args: [`tsx`, FIXTURE_PATH, `tools-changed`],
        },
      },
    })

    // `applyConfig` -> eagerConnect already issued the first `tools/list`,
    // which the mock answered with the initial set. Verify that.
    const initialTools = createMcpTools(reg, [`shifty`])
      .tools()
      .map((t) => t.name)
    expect(initialTools).toContain(`mcp__shifty__echo`)
    expect(initialTools).not.toContain(`mcp__shifty__echo2`)

    // A second `tools/list` against the same subprocess now returns the
    // changed set (the mock advances its counter on each `tools/list`
    // call). This models a server whose tool inventory changes at
    // runtime — e.g. after an internal reload or capability shift.
    const fresh = (await reg.invokeMethod(
      `shifty`,
      `tools/list`,
      {},
      5_000
    )) as { tools: Array<{ name: string }> }
    const freshNames = fresh.tools.map((t) => t.name)
    expect(freshNames).toContain(`echo2`)
    expect(freshNames).not.toContain(`echo`)
  }, 30_000)
})
