# Desktop Sleep/Resume Pull-Wake Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconnect only the stale pull-wake Durable Streams subscription when Electron reports system resume, without restarting the built-in runtime or interrupting active wake handlers.

**Architecture:** Add an idempotent `reconnect()` command to the pull-wake runner's existing XState lifecycle, expose it narrowly as `BuiltinAgentsServer.reconnectPullWake()`, and route Electron `powerMonitor` suspend/resume events through a focused desktop power-monitor controller. Desktop resume selection remains in runtime lifecycle code, where each eligible runtime is reconnected independently.

**Tech Stack:** TypeScript, XState, Electron `powerMonitor`, Vitest, pnpm workspaces

## Global Constraints

- Limit changes to the Electric repository; do not modify the Durable Streams repository or dependency.
- Reconnect the pull-wake stream without restarting `BuiltinAgentsServer`.
- Do not abort active wakes, LLM calls, tool calls, or child runs.
- Preserve the pull-wake runner's current offset across reconnection.
- Repeated or overlapping resume/reconnect signals must not create parallel stream readers.
- Keep the existing heartbeat-gap stream reset as a platform-independent fallback.
- Do not add timeout escalation, runtime health supervision, wake-routing changes, claim-lease changes, or server recovery-policy changes.
- Use Node `>=22.19.0` when installing dependencies because `@earendil-works/pi-agent-core@0.80.5` declares that engine floor.

## File Structure

- Modify `packages/agents-runtime/src/pull-wake-runner.ts` — expose an explicit runner reconnect command that delegates to the existing lifecycle machine.
- Modify `packages/agents-runtime/test/pull-wake-runner.test.ts` — prove hung-stream cancellation, offset continuity, idempotency, and active-wake preservation.
- Modify `packages/agents/src/server.ts` — expose a narrow embedder-facing `reconnectPullWake()` method.
- Modify `packages/agents/test/builtin-pull-wake-registration.test.ts` — verify delegation and lifecycle-safe no-op behavior.
- Modify `packages/agents-desktop/src/runtime/lifecycle.ts` — select eligible connected/running local runtimes and isolate reconnect failures.
- Modify `packages/agents-desktop/src/runtime/lifecycle.test.ts` — verify eligibility filtering and per-runtime failure isolation.
- Create `packages/agents-desktop/src/app/power-monitor.ts` — own idempotent Electron suspend/resume listener registration and cleanup.
- Create `packages/agents-desktop/src/app/power-monitor.test.ts` — verify suspend/resume behavior, error reporting, and duplicate-listener prevention.
- Modify `packages/agents-desktop/src/app/controller.ts` — compose the power-monitor controller with runtime lifecycle recovery and stop it during shutdown.
- Modify `packages/agents-desktop/src/main.ts` — start power-monitor recovery after Electron is ready.
- Modify `.changeset/reliable-repeated-wakes-and-desktop-restart.md` — describe explicit sleep/resume pull-wake recovery.

---

### Task 1: Explicit Pull-Wake Runner Reconnect

**Files:**

- Modify: `packages/agents-runtime/src/pull-wake-runner.ts:57-65,650-700`
- Test: `packages/agents-runtime/test/pull-wake-runner.test.ts:90-180`

**Interfaces:**

- Consumes: existing `PullWakeMachineEvent` `{ type: 'STREAM_RESET'; error: Error }` and the machine's streaming/connecting/reconnecting guards.
- Produces: `PullWakeRunner.reconnect(): void`, safe in every lifecycle state.

- [ ] **Step 1: Write the failing runner regression test**

Add a test near the other lifecycle/reconnect tests. It must establish a first response that advances the runner offset and then hangs until `cancel()` is called, issue two reconnect requests, and verify only one replacement stream is created from the committed offset:

```ts
it(`explicitly reconnects a stalled stream without aborting active wakes`, async () => {
  vi.useFakeTimers()
  const firstCancelled = deferred<void>()
  const secondCancelled = deferred<void>()
  let firstOffset = `-1`
  const firstResponse: PullWakeStreamResponse = {
    get offset() {
      return firstOffset
    },
    async *jsonStream() {
      firstOffset = `42`
      yield wakeEvent(`one`)
      await firstCancelled.promise
    },
    cancel: vi.fn(() => firstCancelled.resolve()),
    closed: firstCancelled.promise,
  }
  const secondResponse: PullWakeStreamResponse = {
    offset: `42`,
    async *jsonStream() {
      await secondCancelled.promise
    },
    cancel: vi.fn(() => secondCancelled.resolve()),
    closed: secondCancelled.promise,
  }
  const streamFactory = vi
    .fn()
    .mockResolvedValueOnce(firstResponse)
    .mockResolvedValueOnce(secondResponse)
  vi.stubGlobal(
    `fetch`,
    vi.fn(async () => new Response(null, { status: 204 }))
  )
  const testRuntime = runtime()
  const runner = createPullWakeRunner({
    baseUrl: `http://server`,
    runnerId: `runner-1`,
    runtime: testRuntime,
    heartbeatIntervalMs: 0,
    streamFactory,
  })

  runner.start()
  await vi.waitFor(() => expect(runner.offset).toBe(`42`))

  runner.reconnect()
  runner.reconnect()
  await vi.waitFor(() => expect(firstResponse.cancel).toHaveBeenCalledTimes(1))
  await vi.advanceTimersByTimeAsync(1_000)
  await vi.waitFor(() => expect(streamFactory).toHaveBeenCalledTimes(2))

  expect(streamFactory).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({ offset: `42` })
  )
  expect(testRuntime.abortWakes).not.toHaveBeenCalled()
  expect(testRuntime.drainWakes).not.toHaveBeenCalled()

  await runner.stop()
})
```

If `vi.waitFor` and fake timers conflict in this Vitest version, replace each wait with `await Promise.resolve()` plus `await vi.advanceTimersByTimeAsync(...)`; do not weaken the assertions.

- [ ] **Step 2: Run the focused test to verify RED**

Run:

```bash
pnpm --dir packages/agents-runtime test --run test/pull-wake-runner.test.ts -t "explicitly reconnects"
```

Expected: TypeScript/test transform failure or runtime failure because `PullWakeRunner` has no `reconnect()` method.

- [ ] **Step 3: Add the minimal runner API**

Extend the interface:

```ts
export interface PullWakeRunner {
  start: () => void
  reconnect: () => void
  stop: () => Promise<void>
  waitForStopped: () => Promise<void>
  readonly running: boolean
  readonly offset: string | undefined
  getHealth: () => PullWakeRunnerHealth
}
```

Add the method to the returned object immediately after `start()`:

```ts
reconnect() {
  if (!isRunningState()) return
  actor.send({
    type: `STREAM_RESET`,
    error: new Error(`Pull-wake runner reconnect requested`),
  })
},
```

Do not call `controller.abort()`, clear deferred events, or invoke runtime shutdown APIs. The existing XState machine ignores repeated reset events once `streamResetError` is set and ignores reset events in `reconnecting`, preventing parallel readers.

- [ ] **Step 4: Run runner regression and full runner suite to verify GREEN**

Run:

```bash
pnpm --dir packages/agents-runtime test --run test/pull-wake-runner.test.ts -t "explicitly reconnects"
pnpm --dir packages/agents-runtime test --run test/pull-wake-runner.test.ts
pnpm --dir packages/agents-runtime typecheck
```

Expected: focused test passes; all pull-wake runner tests pass; typecheck exits 0.

- [ ] **Step 5: Commit the runner change**

```bash
git add packages/agents-runtime/src/pull-wake-runner.ts \
  packages/agents-runtime/test/pull-wake-runner.test.ts
git commit -m "fix(agents-runtime): reconnect stalled pull-wake streams"
```

---

### Task 2: Built-in Runtime Reconnect Facade

**Files:**

- Modify: `packages/agents/src/server.ts:105-120`
- Test: `packages/agents/test/builtin-pull-wake-registration.test.ts:1-35,76-170`

**Interfaces:**

- Consumes: `PullWakeRunner.reconnect(): void` from Task 1.
- Produces: `BuiltinAgentsServer.reconnectPullWake(): void`, safe before start, while running, and after stop.

- [ ] **Step 1: Make the mocked runner observable and write failing facade tests**

Replace the test's anonymous runner factory with hoisted spies:

```ts
const pullWakeRunnerMocks = vi.hoisted(() => ({
  start: vi.fn(),
  reconnect: vi.fn(),
  stop: vi.fn(async () => {}),
  waitForStopped: vi.fn(async () => {}),
}))

vi.mock(`@electric-ax/agents-runtime`, async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    createPullWakeRunner: vi.fn(() => ({
      ...pullWakeRunnerMocks,
      get running() {
        return false
      },
      get offset() {
        return undefined
      },
    })),
  }
})
```

Import `beforeEach` from Vitest and reset every shared runner spy before each test so assertions are isolated:

```ts
beforeEach(() => {
  pullWakeRunnerMocks.start.mockClear()
  pullWakeRunnerMocks.reconnect.mockClear()
  pullWakeRunnerMocks.stop.mockClear()
  pullWakeRunnerMocks.waitForStopped.mockClear()
})
```

Then add these tests:

```ts
it(`reconnects the pull-wake runner without restarting the built-in runtime`, async () => {
  agentsServer = await startRecordingAgentsServer()
  builtinServer = new BuiltinAgentsServer({
    agentServerUrl: agentsServer.url,
    mockStreamFn,
    pullWake: { runnerId: `test-runner` },
  })
  await builtinServer.start()

  builtinServer.reconnectPullWake()

  expect(pullWakeRunnerMocks.reconnect).toHaveBeenCalledTimes(1)
  expect(pullWakeRunnerMocks.stop).not.toHaveBeenCalled()
})

it(`treats pull-wake reconnect as a no-op outside the running lifecycle`, async () => {
  agentsServer = await startRecordingAgentsServer()
  builtinServer = new BuiltinAgentsServer({
    agentServerUrl: agentsServer.url,
    mockStreamFn,
    pullWake: { runnerId: `test-runner` },
  })

  builtinServer.reconnectPullWake()
  expect(pullWakeRunnerMocks.reconnect).not.toHaveBeenCalled()

  await builtinServer.start()
  await builtinServer.stop()
  pullWakeRunnerMocks.reconnect.mockClear()
  builtinServer.reconnectPullWake()

  expect(pullWakeRunnerMocks.reconnect).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run the facade tests to verify RED**

Run:

```bash
pnpm --dir packages/agents test --run test/builtin-pull-wake-registration.test.ts -t "pull-wake reconnect|reconnects the pull-wake"
```

Expected: test transform failure because `BuiltinAgentsServer.reconnectPullWake()` does not exist.

- [ ] **Step 3: Add the facade method**

Add beside the `mcpRegistry` getter in `BuiltinAgentsServer`:

```ts
/** Reconnect only the pull-wake subscription, preserving active wake work. */
reconnectPullWake(): void {
  this.pullWakeRunner?.reconnect()
}
```

Do not call `start()`, `stop()`, `runtime.abortWakes()`, or MCP lifecycle methods.

- [ ] **Step 4: Run facade tests and package verification to verify GREEN**

Run:

```bash
pnpm --dir packages/agents test --run test/builtin-pull-wake-registration.test.ts
pnpm --dir packages/agents typecheck
```

Expected: all tests in the file pass and typecheck exits 0.

- [ ] **Step 5: Commit the facade change**

```bash
git add packages/agents/src/server.ts \
  packages/agents/test/builtin-pull-wake-registration.test.ts
git commit -m "feat(agents): expose pull-wake reconnect"
```

---

### Task 3: Desktop Runtime Resume Selection

**Files:**

- Modify: `packages/agents-desktop/src/runtime/lifecycle.ts:115-145`
- Test: `packages/agents-desktop/src/runtime/lifecycle.test.ts:1-105`

**Interfaces:**

- Consumes: `RuntimeLifecycleDeps.runtimeEntries`, `RuntimeLifecycleDeps.findServer()`, and `BuiltinAgentsServer.reconnectPullWake(): void` from Task 2.
- Produces: `reconnectPullWakesAfterResume(deps: RuntimeLifecycleDeps): void`.

- [ ] **Step 1: Generalize the lifecycle test fixture and add failing selection/isolation tests**

Update the `@electric-ax/agents` mock type surface to include `reconnectPullWake`, and add a fixture helper that can append server/entry pairs. Then add:

```ts
it(`reconnects only connected running local runtimes after resume`, () => {
  const { deps, entry } = setup()
  const reconnectRunning = vi.fn()
  entry.status = `connected`
  entry.localRuntimeStatus = `running`
  entry.runtime = {
    reconnectPullWake: reconnectRunning,
  } as RuntimeEntry[`runtime`]

  const disconnected = addRuntime(deps, {
    id: `disconnected`,
    desiredState: `disconnected`,
    localRuntimeEnabled: true,
    localRuntimeStatus: `running`,
  })
  const disabled = addRuntime(deps, {
    id: `disabled`,
    desiredState: `connected`,
    localRuntimeEnabled: false,
    localRuntimeStatus: `disabled`,
  })
  const starting = addRuntime(deps, {
    id: `starting`,
    desiredState: `connected`,
    localRuntimeEnabled: true,
    localRuntimeStatus: `starting`,
  })

  reconnectPullWakesAfterResume(deps)

  expect(reconnectRunning).toHaveBeenCalledTimes(1)
  expect(disconnected.reconnect).not.toHaveBeenCalled()
  expect(disabled.reconnect).not.toHaveBeenCalled()
  expect(starting.reconnect).not.toHaveBeenCalled()
})

it(`isolates pull-wake reconnect failures between runtimes`, () => {
  const { deps, entry } = setup()
  entry.status = `connected`
  entry.localRuntimeStatus = `running`
  entry.runtime = {
    reconnectPullWake: vi.fn(() => {
      throw new Error(`first failed`)
    }),
  } as RuntimeEntry[`runtime`]
  const second = addRuntime(deps, {
    id: `second`,
    desiredState: `connected`,
    localRuntimeEnabled: true,
    localRuntimeStatus: `running`,
  })

  expect(() => reconnectPullWakesAfterResume(deps)).not.toThrow()
  expect(second.reconnect).toHaveBeenCalledTimes(1)
})
```

Add this complete fixture helper above the `describe` block:

```ts
type AddedRuntimeOptions = {
  id: string
  desiredState: ServerConfig[`desiredState`]
  localRuntimeEnabled: boolean
  localRuntimeStatus: RuntimeEntry[`localRuntimeStatus`]
}

function addRuntime(
  deps: RuntimeLifecycleDeps,
  options: AddedRuntimeOptions
): {
  reconnect: ReturnType<typeof vi.fn>
  server: ServerConfig
  entry: RuntimeEntry
} {
  const reconnect = vi.fn()
  const server: ServerConfig = {
    id: options.id,
    name: options.id,
    url: `http://localhost/${options.id}`,
    source: `manual`,
    desiredState: options.desiredState,
    localRuntimeEnabled: options.localRuntimeEnabled,
  }
  const entry: RuntimeEntry = {
    serverId: server.id,
    desiredState: options.desiredState,
    status: options.desiredState === `connected` ? `connected` : `disconnected`,
    localRuntimeStatus: options.localRuntimeStatus,
    runtime: { reconnectPullWake: reconnect } as RuntimeEntry[`runtime`],
    runtimeUrl: null,
    runtimeError: null,
    reconnectTimer: null,
    reconnectAttempt: 0,
    generation: 0,
    lastError: null,
    lastConnectedAt: null,
    mcpUnsubscribe: null,
  }
  deps.settings.servers.push(server)
  deps.runtimeEntries.set(server.id, entry)
  return { reconnect, server, entry }
}
```

In `setup()`, define `deps` first and make `findServer` search the mutable settings collection:

```ts
findServer: (serverId) =>
  deps.settings.servers.find((candidate) => candidate.id === serverId) ?? null,
```

Because the function closes over `deps` but is not called until after initialization completes, this is safe and allows the helper's added servers to be discovered.

- [ ] **Step 2: Run the desktop lifecycle tests to verify RED**

Run:

```bash
pnpm --dir packages/agents-desktop test --run src/runtime/lifecycle.test.ts -t "after resume|between runtimes"
```

Expected: test transform failure because `reconnectPullWakesAfterResume` does not exist.

- [ ] **Step 3: Implement runtime eligibility and failure isolation**

Add to `packages/agents-desktop/src/runtime/lifecycle.ts` near `restartConnectedRuntimes`:

```ts
export function reconnectPullWakesAfterResume(
  deps: RuntimeLifecycleDeps
): void {
  for (const entry of deps.runtimeEntries.values()) {
    const server = deps.findServer(entry.serverId)
    if (
      !server?.localRuntimeEnabled ||
      entry.desiredState !== `connected` ||
      entry.localRuntimeStatus !== `running` ||
      !entry.runtime
    ) {
      continue
    }

    try {
      entry.runtime.reconnectPullWake()
    } catch (error) {
      console.warn(
        `[agents-desktop] Failed to reconnect pull-wake after resume for ${entry.serverId}:`,
        error
      )
    }
  }
}
```

Do not call `startRuntime`, `restartRuntime`, `stopRuntimeEntry`, or mutate entry status.

- [ ] **Step 4: Run desktop lifecycle verification to verify GREEN**

Run:

```bash
pnpm --dir packages/agents-desktop test --run src/runtime/lifecycle.test.ts
pnpm --dir packages/agents-desktop typecheck
```

Expected: all lifecycle tests pass and typecheck exits 0.

- [ ] **Step 5: Commit runtime selection**

```bash
git add packages/agents-desktop/src/runtime/lifecycle.ts \
  packages/agents-desktop/src/runtime/lifecycle.test.ts \
  packages/agents-desktop/package.json pnpm-lock.yaml
git commit -m "fix(agents-desktop): select runtimes for resume recovery"
```

---

### Task 4: Idempotent Electron Power-Monitor Controller

**Files:**

- Create: `packages/agents-desktop/src/app/power-monitor.ts`
- Test: `packages/agents-desktop/src/app/power-monitor.test.ts`

**Interfaces:**

- Consumes: an Electron-compatible monitor with `on('suspend' | 'resume', listener)` and `removeListener(...)`, plus `onResume(): void`.
- Produces: `createPowerMonitorRecovery(options): { start(): void; stop(): void }`.

- [ ] **Step 1: Write failing power-monitor controller tests**

Create `packages/agents-desktop/src/app/power-monitor.test.ts` with a small fake event emitter:

```ts
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createPowerMonitorRecovery } from './power-monitor'

class FakePowerMonitor extends EventEmitter {
  listenerCountFor(event: `suspend` | `resume`): number {
    return this.listenerCount(event)
  }
}

describe(`power monitor recovery`, () => {
  it(`runs resume recovery once and does not duplicate listeners`, () => {
    const monitor = new FakePowerMonitor()
    const onResume = vi.fn()
    const recovery = createPowerMonitorRecovery({ monitor, onResume })

    recovery.start()
    recovery.start()
    expect(monitor.listenerCountFor(`suspend`)).toBe(1)
    expect(monitor.listenerCountFor(`resume`)).toBe(1)

    monitor.emit(`suspend`)
    monitor.emit(`resume`)
    expect(onResume).toHaveBeenCalledTimes(1)

    recovery.stop()
    expect(monitor.listenerCountFor(`suspend`)).toBe(0)
    expect(monitor.listenerCountFor(`resume`)).toBe(0)
  })

  it(`reports resume callback failures without throwing from the event`, () => {
    const monitor = new FakePowerMonitor()
    const onError = vi.fn()
    const recovery = createPowerMonitorRecovery({
      monitor,
      onResume: () => {
        throw new Error(`resume failed`)
      },
      onError,
    })
    recovery.start()

    expect(() => monitor.emit(`resume`)).not.toThrow()
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: `resume failed` })
    )
  })
})
```

- [ ] **Step 2: Run the power-monitor tests to verify RED**

Run:

```bash
pnpm --dir packages/agents-desktop test --run src/app/power-monitor.test.ts
```

Expected: module resolution failure because `./power-monitor` does not exist.

- [ ] **Step 3: Implement the focused power-monitor controller**

Create `packages/agents-desktop/src/app/power-monitor.ts`:

```ts
import { powerMonitor } from 'electron'

export type PowerMonitorLike = {
  on: (event: `suspend` | `resume`, listener: () => void) => unknown
  removeListener: (event: `suspend` | `resume`, listener: () => void) => unknown
}

export type PowerMonitorRecovery = {
  start: () => void
  stop: () => void
}

export function createPowerMonitorRecovery(options: {
  monitor?: PowerMonitorLike
  onResume: () => void
  onError?: (error: Error) => void
}): PowerMonitorRecovery {
  const monitor = options.monitor ?? powerMonitor
  let started = false
  let suspendedAt: number | null = null

  const handleSuspend = (): void => {
    suspendedAt = Date.now()
    console.info(`[agents-desktop] System suspended.`)
  }
  const handleResume = (): void => {
    const elapsedMs = suspendedAt === null ? null : Date.now() - suspendedAt
    suspendedAt = null
    console.info(
      `[agents-desktop] System resumed${elapsedMs === null ? `` : ` after ${elapsedMs}ms`}; reconnecting pull-wake streams.`
    )
    try {
      options.onResume()
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      if (options.onError) options.onError(error)
      else console.warn(`[agents-desktop] Resume recovery failed:`, error)
    }
  }

  return {
    start(): void {
      if (started) return
      started = true
      monitor.on(`suspend`, handleSuspend)
      monitor.on(`resume`, handleResume)
    },
    stop(): void {
      if (!started) return
      started = false
      monitor.removeListener(`suspend`, handleSuspend)
      monitor.removeListener(`resume`, handleResume)
      suspendedAt = null
    },
  }
}
```

The callback is synchronous because `reconnectPullWake()` only signals an XState actor. Keep asynchronous restart/escalation out of this controller.

- [ ] **Step 4: Run power-monitor verification to verify GREEN**

Run:

```bash
pnpm --dir packages/agents-desktop test --run src/app/power-monitor.test.ts
pnpm --dir packages/agents-desktop typecheck
```

Expected: both power-monitor tests pass and typecheck exits 0.

- [ ] **Step 5: Commit the power-monitor controller**

```bash
git add packages/agents-desktop/src/app/power-monitor.ts \
  packages/agents-desktop/src/app/power-monitor.test.ts
git commit -m "feat(agents-desktop): monitor system resume"
```

---

### Task 5: Wire Resume Recovery Into Desktop Startup and Shutdown

**Files:**

- Modify: `packages/agents-desktop/src/app/controller.ts:1-70,300-330,575-625`
- Modify: `packages/agents-desktop/src/main.ts:95-135`
- Modify: `.changeset/reliable-repeated-wakes-and-desktop-restart.md`

**Interfaces:**

- Consumes: `createPowerMonitorRecovery()` from Task 4 and `reconnectPullWakesAfterResume()` from Task 3.
- Produces: `DesktopMainController.startPowerMonitorRecovery(): void`; shutdown removes registered listeners.

- [ ] **Step 1: Add a composition-level test assertion before wiring**

Extend `packages/agents-desktop/src/app/power-monitor.test.ts` with a test using a real callback that invokes a spy named like the lifecycle operation:

```ts
it(`routes resume through the supplied runtime recovery boundary`, () => {
  const monitor = new FakePowerMonitor()
  const reconnectPullWakesAfterResume = vi.fn()
  const recovery = createPowerMonitorRecovery({
    monitor,
    onResume: reconnectPullWakesAfterResume,
  })
  recovery.start()

  monitor.emit(`resume`)

  expect(reconnectPullWakesAfterResume).toHaveBeenCalledTimes(1)
})
```

This passes at the module boundary after Task 4; the RED gate for final wiring is the TypeScript compiler after adding the new controller return member call in `main.ts` before defining it.

- [ ] **Step 2: Add the startup call first and verify wiring is RED**

In `packages/agents-desktop/src/main.ts`, after settings/cloud initialization and immediately before `controller.connectConfiguredServers()`, add:

```ts
controller.startPowerMonitorRecovery()
```

Run:

```bash
pnpm --dir packages/agents-desktop typecheck
```

Expected: FAIL because `DesktopMainController` does not yet expose `startPowerMonitorRecovery`.

- [ ] **Step 3: Compose and expose power-monitor recovery in the controller**

Import the factory and add the lifecycle function to the existing lifecycle import:

```ts
import { createPowerMonitorRecovery } from './power-monitor'
import {
  desktopSkillDirectories,
  reconnectPullWakesAfterResume,
} from '../runtime/lifecycle'
```

After `const runtime = createRuntimeController(...)`, construct exactly one process-lifetime recovery object:

```ts
const powerMonitorRecovery = createPowerMonitorRecovery({
  onResume: () => reconnectPullWakesAfterResume(runtime.lifecycleDeps),
})
```

Add this returned controller method:

```ts
startPowerMonitorRecovery: powerMonitorRecovery.start,
```

At the beginning of the returned `quitApp` method, before stopping runtimes, add:

```ts
powerMonitorRecovery.stop()
```

This keeps listener ownership in the controller and ensures repeated `startPowerMonitorRecovery()` calls remain idempotent through Task 4's controller.

- [ ] **Step 4: Update the changeset**

Append to `.changeset/reliable-repeated-wakes-and-desktop-restart.md`:

```md
Reconnect the pull-wake Durable Streams subscription when Electron reports system resume, preserving active agent work while replacing stale long-poll connections.
```

Do not add a Durable Streams package changeset.

- [ ] **Step 5: Run complete verification**

Run:

```bash
pnpm --dir packages/agents-runtime test --run test/pull-wake-runner.test.ts
pnpm --dir packages/agents test --run test/builtin-pull-wake-registration.test.ts
pnpm --dir packages/agents-desktop test --run src/runtime/lifecycle.test.ts src/app/power-monitor.test.ts
pnpm --dir packages/agents-runtime typecheck
pnpm --dir packages/agents typecheck
pnpm --dir packages/agents-desktop typecheck
pnpm prettier --check \
  packages/agents-runtime/src/pull-wake-runner.ts \
  packages/agents-runtime/test/pull-wake-runner.test.ts \
  packages/agents/src/server.ts \
  packages/agents/test/builtin-pull-wake-registration.test.ts \
  packages/agents-desktop/src/runtime/lifecycle.ts \
  packages/agents-desktop/src/runtime/lifecycle.test.ts \
  packages/agents-desktop/src/app/power-monitor.ts \
  packages/agents-desktop/src/app/power-monitor.test.ts \
  packages/agents-desktop/src/app/controller.ts \
  packages/agents-desktop/src/main.ts \
  .changeset/reliable-repeated-wakes-and-desktop-restart.md
git diff --check
```

Expected: all focused suites and typechecks pass; Prettier reports all files formatted; `git diff --check` exits 0.

Also run the agents build because the desktop consumes the built package boundary:

```bash
./scripts/dev.sh build
```

Expected: all agents packages build successfully. If installation fails solely because the shell's Node version is below `22.19.0`, switch to a compliant Node version and rerun; do not bypass the package engine requirement.

- [ ] **Step 6: Commit final desktop wiring**

```bash
git add packages/agents-desktop/src/app/controller.ts \
  packages/agents-desktop/src/main.ts \
  packages/agents-desktop/src/app/power-monitor.test.ts \
  .changeset/reliable-repeated-wakes-and-desktop-restart.md
git commit -m "fix(agents-desktop): reconnect pull wakes on resume"
```

- [ ] **Step 7: Review branch state without pushing**

Run:

```bash
git status --short
git log --oneline --decorate -6
```

Expected: only pre-existing/unrelated intended work remains uncommitted; the implementation commits are local. Do not push implementation commits unless the user explicitly asks.
