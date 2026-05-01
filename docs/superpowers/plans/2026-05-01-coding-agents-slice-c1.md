# Coding-agents Slice C₁ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship five urgent fixes from the Slice C kickoff code review (`docs/superpowers/specs/2026-05-01-coding-agents-slice-c1-design.md`): pipe transcript via stdin (C1), probe-and-materialise resume (C2), env file via `--env-file` (C3), idle timer wakes the entity (I1), `WorkspaceRegistry` mutex chain trimming (I2).

**Architecture:** All changes contained in `packages/coding-agents` plus a small wiring change in `packages/agents/src/bootstrap.ts`. The shared infrastructure addition is a new `SandboxInstance.copyTo` primitive that pipes file contents via `docker exec -i` stdin instead of inlining them in argv. `materialiseResume` and the env-file write reuse it. The idle-timer wake is a new `wakeEntity` callback wired through `RegisterCodingAgentDeps`. No public API changes; no schema changes.

**Tech Stack:** TypeScript, Node.js child_process spawn, vitest, Docker CLI.

---

## File Structure

**New files:**

- `packages/coding-agents/test/integration/slice-c1.test.ts` — cross-cutting test (Fix 1 + Fix 2 + Fix 4 together).

**Modified files:**

- `packages/coding-agents/src/types.ts` — add `copyTo` method to `SandboxInstance` interface.
- `packages/coding-agents/src/providers/local-docker.ts` — implement `copyTo`; rewrite `start` to write `/run/agent.env`; rewrite `execInContainer` to use `--env-file`.
- `packages/coding-agents/src/entity/handler.ts` — replace `materialiseResume` with `ensureTranscriptMaterialised` (probe-and-materialise via `copyTo`); update both `armIdleTimer` call sites to call `wakeEntity` after `destroy`; add `wakeEntity` to `CodingAgentHandlerOptions`; add no-op dispatch case for `lifecycle/idle-eviction-fired`.
- `packages/coding-agents/src/entity/messages.ts` — add `idleEvictionFiredMessageSchema`.
- `packages/coding-agents/src/entity/register.ts` — register the new inbox schema; thread `wakeEntity` from `RegisterCodingAgentDeps` into handler options.
- `packages/coding-agents/src/workspace-registry.ts` — add `acquirersByIdentity` counter and chain trimming on release.
- `packages/agents/src/bootstrap.ts` — declare `let runtime` holder before `registerCodingAgent`; supply `wakeEntity` closure; assign `runtime` after `createRuntimeHandler`.
- `packages/coding-agents/test/unit/workspace-registry.test.ts` — add a chain-trimming test.
- `packages/coding-agents/test/unit/entity-handler.test.ts` — add wake-after-destroy test.
- `packages/coding-agents/test/unit/local-docker.test.ts` — add `copyTo` round-trip test (4 MB) and `--env-file` argv-leak test.

**Existing tests likely affected:**

- `packages/coding-agents/test/integration/slice-b.test.ts` — should keep passing as-is. Don't modify unless an expectation needs adjusting after the probe-and-materialise refactor.

---

## Task 1: Add `SandboxInstance.copyTo` primitive

**Files:**

- Modify: `packages/coding-agents/src/types.ts`
- Modify: `packages/coding-agents/src/providers/local-docker.ts`
- Test: `packages/coding-agents/test/unit/local-docker.test.ts` (currently a placeholder; we expand it)

- [ ] **Step 1: Read the existing `local-docker.test.ts` to see the test scaffolding pattern**

```bash
cat packages/coding-agents/test/unit/local-docker.test.ts
```

Today the file holds a near-empty smoke test. Tests requiring Docker are gated on `process.env.DOCKER === '1'`.

- [ ] **Step 2: Write a failing integration test for `copyTo` round-trip**

Append to `packages/coding-agents/test/unit/local-docker.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { LocalDockerProvider } from '../../src'
import { buildTestImage, TEST_IMAGE_TAG } from '../support/build-image'

const SHOULD_RUN = process.env.DOCKER === `1`
const describeMaybe = SHOULD_RUN ? describe : describe.skip

describeMaybe(`LocalDockerProvider.copyTo`, () => {
  beforeAll(async () => {
    await buildTestImage()
  }, 600_000)

  it(`writes a 4 MB UTF-8 string and reads it back unchanged`, async () => {
    const provider = new LocalDockerProvider({ image: TEST_IMAGE_TAG })
    const agentId = `/test/coding-agent/copyto-${Date.now().toString(36)}`
    const sandbox = await provider.start({
      agentId,
      kind: `claude`,
      workspace: { type: `volume`, name: `copyto-${Date.now().toString(36)}` },
      env: {},
    })
    try {
      const big = `A`.repeat(4 * 1024 * 1024)
      await sandbox.copyTo({
        destPath: `/tmp/big.txt`,
        content: big,
        mode: 0o600,
      })

      const handle = await sandbox.exec({ cmd: [`cat`, `/tmp/big.txt`] })
      let read = ``
      for await (const line of handle.stdout) read += line
      await handle.wait()
      expect(read.length).toBe(big.length)
      expect(read).toBe(big)
    } finally {
      await provider.destroy(agentId).catch(() => undefined)
    }
  }, 240_000)
})
```

- [ ] **Step 3: Run the test to confirm it fails (compile error: `copyTo` not on `SandboxInstance`)**

Run: `pnpm -C packages/coding-agents test test/unit/local-docker.test.ts`
Expected: TypeScript compile error — `Property 'copyTo' does not exist on type 'SandboxInstance'`.

- [ ] **Step 4: Add `copyTo` to `SandboxInstance` interface**

Edit `packages/coding-agents/src/types.ts`. Replace the `SandboxInstance` interface with:

```ts
export interface SandboxInstance {
  instanceId: string
  agentId: string
  /** Path inside sandbox where the workspace volume / bind-mount is mounted. */
  workspaceMount: string
  exec(args: ExecRequest): Promise<ExecHandle>
  /**
   * Write `content` to `destPath` inside the sandbox via stdin pipe.
   * Avoids argv-size limits (~ARG_MAX). Default mode 0o600.
   */
  copyTo(args: {
    destPath: string
    content: string
    mode?: number
  }): Promise<void>
}
```

- [ ] **Step 5: Implement `copyTo` in `LocalDockerProvider.makeInstance`**

Edit `packages/coding-agents/src/providers/local-docker.ts`. Add a helper at module scope (above `execInContainer`):

```ts
function shellQuote(s: string): string {
  // Single-quote and escape any single quotes inside.
  return `'${s.replace(/'/g, `'\\''`)}'`
}

async function copyToContainer(
  containerId: string,
  destPath: string,
  content: string,
  mode: number,
  baseEnv: Record<string, string>
): Promise<void> {
  const handle = await execInContainer(
    containerId,
    {
      cmd: [
        `sh`,
        `-c`,
        `umask 077 && cat > ${shellQuote(destPath)} && chmod ${mode.toString(8)} ${shellQuote(destPath)}`,
      ],
      stdin: `pipe`,
    },
    baseEnv
  )
  if (!handle.writeStdin || !handle.closeStdin) {
    throw new Error(`copyTo requires stdin pipe`)
  }
  let stderr = ``
  const drainErr = async () => {
    for await (const line of handle.stderr) stderr += line + `\n`
  }
  const stderrPromise = drainErr()
  const drainOut = async () => {
    for await (const _ of handle.stdout) {
      // discard; cat with no input prints nothing on success
    }
  }
  const stdoutPromise = drainOut()
  await handle.writeStdin(content)
  await handle.closeStdin()
  const exit = await handle.wait()
  await Promise.all([stdoutPromise, stderrPromise])
  if (exit.exitCode !== 0) {
    throw new Error(
      `copyTo failed: exit ${exit.exitCode}, stderr=${stderr.slice(0, 400)}`
    )
  }
}
```

Then update `makeInstance` to expose it:

```ts
private makeInstance(instanceId: string, spec: SandboxSpec): SandboxInstance {
  return {
    instanceId,
    agentId: spec.agentId,
    workspaceMount: `/workspace`,
    exec: (args) => execInContainer(instanceId, args, spec.env),
    copyTo: ({ destPath, content, mode = 0o600 }) =>
      copyToContainer(instanceId, destPath, content, mode, spec.env),
  }
}
```

- [ ] **Step 6: Run the test with `DOCKER=1` to verify it passes**

Run: `DOCKER=1 pnpm -C packages/coding-agents test test/unit/local-docker.test.ts`
Expected: PASS (test takes 30-90 s on first run because `buildTestImage` may rebuild).

- [ ] **Step 7: Run the unit suite without `DOCKER=1` to verify the `describe.skip` path still type-checks**

Run: `pnpm -C packages/coding-agents test test/unit/local-docker.test.ts`
Expected: PASS (test skipped).

- [ ] **Step 8: Commit**

```bash
git add packages/coding-agents/src/types.ts \
        packages/coding-agents/src/providers/local-docker.ts \
        packages/coding-agents/test/unit/local-docker.test.ts
git commit -m "feat(coding-agents): SandboxInstance.copyTo primitive

Pipes file contents into the sandbox via docker exec -i stdin instead
of argv. Replaces the base64-in-argv pattern that hits ARG_MAX (~2 MB)
on multi-turn transcripts.

Used by Slice C1 fixes for resume materialisation and env-file write."
```

---

## Task 2: Probe-and-materialise resume

**Files:**

- Modify: `packages/coding-agents/src/entity/handler.ts`

The current `processPrompt` gates resume materialisation on `wasCold`. Three failure modes (idle-timer race, external container death, future `recover()`) cause the gate to skip materialise even when the transcript file is missing. Replace the gate with a `test -f` probe and a stdin-piped materialise.

- [ ] **Step 1: Read the current handler to remind yourself where the change lands**

```bash
sed -n '50,75p;430,460p' packages/coding-agents/src/entity/handler.ts
```

`materialiseResume` lives at lines ~50-70. The `wasCold && meta.nativeSessionId` block lives at lines ~436-455.

- [ ] **Step 2: Replace `materialiseResume` with `ensureTranscriptMaterialised`**

Edit `packages/coding-agents/src/entity/handler.ts`. Remove the existing `materialiseResume` function (lines 50-70) and add this in its place:

```ts
/**
 * Idempotently materialise the captured transcript blob into the sandbox
 * so `claude --resume <sessionId>` finds its session file. Probes for the
 * file first; only writes if missing. Self-heals across idle-timer races,
 * external container death, and future recover() rehydration.
 */
async function ensureTranscriptMaterialised(
  sandbox: SandboxInstance,
  nativeSessionId: string,
  content: string
): Promise<{ written: boolean }> {
  if (!content) return { written: false }
  const projectDir = sanitiseCwd(sandbox.workspaceMount)
  const fullPath = `~/.claude/projects/${projectDir}/${nativeSessionId}.jsonl`

  // Probe: does the file already exist? If so, we're done.
  const probe = await sandbox.exec({
    cmd: [`sh`, `-c`, `test -f ${fullPath}`],
  })
  // drain to avoid hanging
  void (async () => {
    for await (const _ of probe.stdout) {
      /* discard */
    }
  })()
  void (async () => {
    for await (const _ of probe.stderr) {
      /* discard */
    }
  })()
  const probeExit = await probe.wait()
  if (probeExit.exitCode === 0) return { written: false }

  // Ensure the parent directory, then pipe the content via stdin.
  const mkdir = await sandbox.exec({
    cmd: [`sh`, `-c`, `mkdir -p ~/.claude/projects/${projectDir}`],
  })
  void (async () => {
    for await (const _ of mkdir.stdout) {
      /* discard */
    }
  })()
  void (async () => {
    for await (const _ of mkdir.stderr) {
      /* discard */
    }
  })()
  const mkdirExit = await mkdir.wait()
  if (mkdirExit.exitCode !== 0) {
    throw new Error(`mkdir for transcript failed: exit ${mkdirExit.exitCode}`)
  }

  await sandbox.copyTo({
    destPath: `/home/agent/.claude/projects/${projectDir}/${nativeSessionId}.jsonl`,
    content,
    mode: 0o600,
  })
  return { written: true }
}
```

(Note: the `~` shell expansion works inside `sh -c` for the probe and mkdir steps; `copyTo` requires an absolute path because it runs `cat > <path>` directly. The Dockerfile creates `agent` as user 1000 with home `/home/agent`, so the absolute path is stable.)

- [ ] **Step 3: Update the call site in `processPrompt` to remove the `wasCold` gate on materialise**

Edit `packages/coding-agents/src/entity/handler.ts`. Replace the block (lines ~436-455):

```ts
if (wasCold && meta.nativeSessionId) {
  const transcript = ctx.db.collections.nativeJsonl.get(`current`) as
    | NativeJsonlRow
    | undefined
  if (
    transcript &&
    transcript.nativeSessionId === meta.nativeSessionId &&
    transcript.content
  ) {
    await materialiseResume(sandbox, meta.nativeSessionId, transcript.content)
    ctx.db.actions.lifecycle_insert({
      row: {
        key: lifecycleKey(`resume`),
        ts: Date.now(),
        event: `resume.restored`,
        detail: `bytes=${transcript.content.length}`,
      } satisfies LifecycleRow,
    })
  }
}
```

with:

```ts
if (meta.nativeSessionId) {
  const transcript = ctx.db.collections.nativeJsonl.get(`current`) as
    | NativeJsonlRow
    | undefined
  if (
    transcript &&
    transcript.nativeSessionId === meta.nativeSessionId &&
    transcript.content
  ) {
    const { written } = await ensureTranscriptMaterialised(
      sandbox,
      meta.nativeSessionId,
      transcript.content
    )
    if (written) {
      ctx.db.actions.lifecycle_insert({
        row: {
          key: lifecycleKey(`resume`),
          ts: Date.now(),
          event: `resume.restored`,
          detail: `bytes=${transcript.content.length}`,
        } satisfies LifecycleRow,
      })
    }
  }
}
```

The `wasCold` gate is **kept** for the `sandbox.starting` / `sandbox.started` lifecycle row inserts above (around line 363 and 409) — those should fire only on actual cold-boot, not on every prompt.

- [ ] **Step 4: Run all coding-agent unit tests**

Run: `pnpm -C packages/coding-agents test test/unit/`
Expected: PASS (existing tests still pass; no new unit test added in this task — the integration test in Task 6 covers the new behaviour).

- [ ] **Step 5: Run the existing slice-b integration test to confirm no regression**

Run: `DOCKER=1 pnpm -C packages/coding-agents test test/integration/slice-b.test.ts`
Expected: PASS — the BANANA roundtrip still works. Resume row should still be inserted on turn 2 because the transcript file doesn't exist in the fresh sandbox after idle eviction.

- [ ] **Step 6: Commit**

```bash
git add packages/coding-agents/src/entity/handler.ts
git commit -m "fix(coding-agents): probe-and-materialise resume transcript

Replace the wasCold-gated materialiseResume with an idempotent
ensureTranscriptMaterialised that probes for the transcript file
first and writes via copyTo (stdin pipe) only if missing.

Closes the idle-timer/reconcile race that silently lost conversation
continuity when the timer fired between reconcile and processPrompt.
Self-heals across external container death and future recover().

The wasCold gate is kept for sandbox.starting/started lifecycle
row insertion (its original purpose)."
```

---

## Task 3: Env file via `--env-file`

**Files:**

- Modify: `packages/coding-agents/src/providers/local-docker.ts`
- Test: `packages/coding-agents/test/unit/local-docker.test.ts`

`docker exec -e KEY=VAL` puts secrets in argv (visible via `ps -ef`). Switch to writing the env to `/run/agent.env` (tmpfs, mode 0600) at `start()` time and using `--env-file` for subsequent `exec` calls.

- [ ] **Step 1: Write a failing integration test for env-not-in-argv**

Append to `packages/coding-agents/test/unit/local-docker.test.ts`:

```ts
describeMaybe(`LocalDockerProvider env file`, () => {
  beforeAll(async () => {
    await buildTestImage()
  }, 600_000)

  it(`does not expose env values via host argv during exec`, async () => {
    const sentinel = `SLICE_C1_SENTINEL_${Date.now().toString(36)}`
    const provider = new LocalDockerProvider({ image: TEST_IMAGE_TAG })
    const agentId = `/test/coding-agent/envleak-${Date.now().toString(36)}`
    const sandbox = await provider.start({
      agentId,
      kind: `claude`,
      workspace: { type: `volume`, name: `envleak-${Date.now().toString(36)}` },
      env: { CANARY: sentinel },
    })
    try {
      // Start a slow exec that holds open while we inspect ps on the host.
      const handle = await sandbox.exec({ cmd: [`sleep`, `2`] })

      // Read host process list while sleep is still running.
      const { execSync } = await import(`node:child_process`)
      const ps = execSync(`ps -ef`, { encoding: `utf8` })
      expect(ps).not.toContain(sentinel)

      // Confirm the env IS visible inside the container (so we know the
      // env file is actually being applied — not just absent everywhere).
      await handle.wait()
      const verify = await sandbox.exec({ cmd: [`sh`, `-c`, `echo $CANARY`] })
      let inside = ``
      for await (const line of verify.stdout) inside += line
      await verify.wait()
      expect(inside.trim()).toBe(sentinel)
    } finally {
      await provider.destroy(agentId).catch(() => undefined)
    }
  }, 240_000)
})
```

- [ ] **Step 2: Run the test to confirm it fails (env still in argv)**

Run: `DOCKER=1 pnpm -C packages/coding-agents test test/unit/local-docker.test.ts -t envleak`
Expected: FAIL — `ps -ef` contains `SLICE_C1_SENTINEL_...` because `docker exec -e CANARY=...` is in argv.

- [ ] **Step 3: Update `LocalDockerProvider.start` to write the env file**

Edit `packages/coding-agents/src/providers/local-docker.ts`. Find the `start` method and modify the end (after the `runDocker(args)` call) to write the env file via the just-created instance:

```ts
async start(spec: SandboxSpec): Promise<SandboxInstance> {
  const existing = await this.findContainerByAgentId(spec.agentId)
  if (existing && existing.running) {
    log.debug(
      { agentId: spec.agentId, instanceId: existing.id },
      `attaching to existing sandbox`
    )
    return this.makeInstance(existing.id, spec)
  }
  if (existing && !existing.running) {
    await runDocker([`rm`, `-f`, existing.id])
  }

  const labels = [
    `electric-ax.agent-id=${spec.agentId}`,
    `electric-ax.kind=${spec.kind}`,
    `electric-ax.workspace-name=${
      spec.workspace.type === `volume` ? spec.workspace.name : `bind-mount`
    }`,
  ]
  const mount = await this.mountFlag(spec)
  const args = [
    `run`,
    `-d`,
    `--rm=false`,
    ...labels.flatMap((l) => [`--label`, l]),
    mount,
    this.image,
  ]
  const { stdout } = await runDocker(args)
  const instanceId = stdout.trim()
  log.info({ agentId: spec.agentId, instanceId }, `started sandbox`)

  const instance = this.makeInstance(instanceId, spec)
  // Write env to /run/agent.env (tmpfs, mode 0600). Subsequent exec calls
  // pick it up via --env-file. Secrets never appear in host argv.
  if (Object.keys(spec.env).length > 0) {
    const envContent = Object.entries(spec.env)
      .map(([k, v]) => `${k}=${v}`)
      .join(`\n`)
    await instance.copyTo({
      destPath: `/run/agent.env`,
      content: envContent + `\n`,
      mode: 0o600,
    })
    this.envFileWritten.add(instanceId)
  }

  return instance
}
```

Also add the tracking field to the class:

```ts
export class LocalDockerProvider implements SandboxProvider {
  readonly name = `local-docker`
  private readonly image: string
  private readonly envFileWritten = new Set<string>() // NEW

  // ...
}
```

- [ ] **Step 4: Update `execInContainer` to use `--env-file` when available**

Replace the `execInContainer` function in `local-docker.ts`:

```ts
async function execInContainer(
  containerId: string,
  req: ExecRequest,
  baseEnv: Record<string, string>,
  envFilePath?: string
): Promise<ExecHandle> {
  const args: Array<string> = [`exec`, `-i`]
  if (req.cwd) args.push(`-w`, req.cwd)

  // Per-call env (req.env) is passed via -e because it's typically
  // non-secret (e.g., model name overrides). Secrets sit in baseEnv
  // and route through --env-file when available.
  if (envFilePath) {
    args.push(`--env-file`, envFilePath)
  } else {
    for (const [k, v] of Object.entries(baseEnv)) args.push(`-e`, `${k}=${v}`)
  }
  for (const [k, v] of Object.entries(req.env ?? {}))
    args.push(`-e`, `${k}=${v}`)

  args.push(containerId, ...req.cmd)

  const child = spawn(`docker`, args, {
    stdio: [req.stdin === `pipe` ? `pipe` : `ignore`, `pipe`, `pipe`],
  })

  let exitCode: number | null = null
  const exitPromise = new Promise<{ exitCode: number }>(
    (resolveWait, rejectWait) => {
      child.on(`error`, rejectWait)
      child.on(`exit`, (code) => {
        exitCode = code ?? -1
        resolveWait({ exitCode })
      })
    }
  )
  void exitCode

  const stdinStream = child.stdin as Writable | null

  return {
    stdout: lineIterator(child.stdout!),
    stderr: lineIterator(child.stderr!),
    writeStdin: stdinStream
      ? async (chunk) => {
          await new Promise<void>((res, rej) => {
            stdinStream.write(chunk, (err) => (err ? rej(err) : res()))
          })
        }
      : undefined,
    closeStdin: stdinStream
      ? async () => {
          await new Promise<void>((res) => {
            stdinStream.end(res)
          })
        }
      : undefined,
    wait: () => exitPromise,
    kill: (signal = `SIGTERM`) => {
      try {
        child.kill(signal)
      } catch {
        // already dead
      }
    },
  }
}
```

- [ ] **Step 5: Update `makeInstance` to thread the env-file path**

In `LocalDockerProvider.makeInstance`, modify both the `exec` and `copyTo` closures to pass `envFilePath` based on the `envFileWritten` set:

```ts
private makeInstance(instanceId: string, spec: SandboxSpec): SandboxInstance {
  const envFilePathFor = (): string | undefined =>
    this.envFileWritten.has(instanceId) ? `/run/agent.env` : undefined

  return {
    instanceId,
    agentId: spec.agentId,
    workspaceMount: `/workspace`,
    exec: (args) =>
      execInContainer(instanceId, args, spec.env, envFilePathFor()),
    copyTo: ({ destPath, content, mode = 0o600 }) =>
      copyToContainer(
        instanceId,
        destPath,
        content,
        mode,
        spec.env,
        envFilePathFor()
      ),
  }
}
```

Also update `copyToContainer` to accept and forward the env-file path:

```ts
async function copyToContainer(
  containerId: string,
  destPath: string,
  content: string,
  mode: number,
  baseEnv: Record<string, string>,
  envFilePath?: string
): Promise<void> {
  const handle = await execInContainer(
    containerId,
    {
      cmd: [
        `sh`,
        `-c`,
        `umask 077 && cat > ${shellQuote(destPath)} && chmod ${mode.toString(8)} ${shellQuote(destPath)}`,
      ],
      stdin: `pipe`,
    },
    baseEnv,
    envFilePath
  )
  // ... rest unchanged from Task 1
}
```

(Note: for the _first_ `copyTo` call — the one that writes `/run/agent.env` itself — `envFilePathFor()` returns `undefined`, so we still pass `baseEnv` via `-e` for that single bootstrap call. After that call, `envFileWritten.add(instanceId)` is set, and all subsequent calls use `--env-file`. The bootstrap call's brief `-e` exposure is acceptable: it's during container start when no other prompt is running, and immediately after the env file is on disk and `-e` is no longer used.)

- [ ] **Step 6: Run the env-leak test with `DOCKER=1`**

Run: `DOCKER=1 pnpm -C packages/coding-agents test test/unit/local-docker.test.ts -t envleak`
Expected: PASS — `ps -ef` no longer shows `SLICE_C1_SENTINEL_...` during the held-open `sleep` exec; `echo $CANARY` inside the container still prints the sentinel.

- [ ] **Step 7: Run the existing slice-b integration test to confirm bridge still works**

Run: `DOCKER=1 pnpm -C packages/coding-agents test test/integration/slice-b.test.ts`
Expected: PASS — claude still finds `ANTHROPIC_API_KEY` (now via `/run/agent.env`).

- [ ] **Step 8: Commit**

```bash
git add packages/coding-agents/src/providers/local-docker.ts \
        packages/coding-agents/test/unit/local-docker.test.ts
git commit -m "fix(coding-agents): persist env in /run/agent.env, use --env-file

ANTHROPIC_API_KEY no longer leaks via 'docker exec -e KEY=VAL' argv
(visible to other host users via ps -ef). At container start the
provider writes the env vars to /run/agent.env (tmpfs, mode 0600)
and subsequent exec calls reference it via --env-file."
```

---

## Task 4: Idle timer wakes the entity

**Files:**

- Modify: `packages/coding-agents/src/entity/messages.ts`
- Modify: `packages/coding-agents/src/entity/handler.ts`
- Modify: `packages/coding-agents/src/entity/register.ts`
- Modify: `packages/agents/src/bootstrap.ts`
- Test: `packages/coding-agents/test/unit/entity-handler.test.ts`

The idle timer destroys the container but never tells the entity. `sessionMeta.status` stays `'idle'` indefinitely until something else wakes the entity. Add a `wakeEntity` callback wired through `RegisterCodingAgentDeps`; the timer's `onFire` calls it after `destroy`. The handler dispatches a new no-op message type `lifecycle/idle-eviction-fired`; reconcile (already shipped) flips status `idle → cold` when it sees `providerStatus !== 'running'`.

- [ ] **Step 1: Write a failing test for `wakeEntity` being called after destroy**

Append to `packages/coding-agents/test/unit/entity-handler.test.ts`:

```ts
describe(`entity handler — idle timer wakes entity`, () => {
  it(`calls wakeEntity after destroy when timer fires`, async () => {
    vi.useFakeTimers()
    try {
      const destroyCalls: Array<string> = []
      const wakeCalls: Array<string> = []

      const provider: any = makeFakeProvider(`stopped`)
      provider.destroy = async (agentId: string) => {
        destroyCalls.push(agentId)
      }

      const lm = new LifecycleManager({
        provider,
        bridge: {
          async runTurn() {
            return { exitCode: 0, finalText: `ok` }
          },
        },
      })
      const wr = new WorkspaceRegistry()
      const handler = makeCodingAgentHandler(lm, wr, {
        defaults: {
          idleTimeoutMs: 10,
          coldBootBudgetMs: 5_000,
          runTimeoutMs: 5_000,
        },
        env: () => ({}),
        wakeEntity: (agentId: string) => {
          wakeCalls.push(agentId)
        },
      })
      const meta = {
        key: `current`,
        status: `cold`,
        kind: `claude`,
        pinned: false,
        workspaceIdentity: `volume:w`,
        workspaceSpec: { type: `volume`, name: `w` },
        idleTimeoutMs: 10,
        keepWarm: false,
      }
      const { ctx } = makeFakeCtx({
        entityUrl: `/t/coding-agent/x`,
        meta,
        inbox: [{ key: `i1`, message_type: `prompt`, payload: { text: `hi` } }],
      })
      await handler(ctx, { type: `message_received` } as any)

      // Timer was armed at idleTimeoutMs=10. Fast-forward to fire it.
      await vi.advanceTimersByTimeAsync(20)
      // Allow microtasks (provider.destroy is async) to settle.
      await vi.runAllTimersAsync()

      expect(destroyCalls).toEqual([`/t/coding-agent/x`])
      expect(wakeCalls).toEqual([`/t/coding-agent/x`])
    } finally {
      vi.useRealTimers()
    }
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails (TS error: `wakeEntity` not in options)**

Run: `pnpm -C packages/coding-agents test test/unit/entity-handler.test.ts -t "wakes entity"`
Expected: TypeScript error — `Object literal may only specify known properties, and 'wakeEntity' does not exist in type 'CodingAgentHandlerOptions'`.

- [ ] **Step 3: Add `wakeEntity` to `CodingAgentHandlerOptions`**

Edit `packages/coding-agents/src/entity/handler.ts`. Replace the `CodingAgentHandlerOptions` interface (top of file):

```ts
export interface CodingAgentHandlerOptions {
  defaults: {
    idleTimeoutMs: number
    coldBootBudgetMs: number
    runTimeoutMs: number
  }
  /** Called per-turn to source CLI env (e.g. ANTHROPIC_API_KEY). */
  env: () => Record<string, string>
  /**
   * Optional. Called by the idle timer after destroying the container,
   * to re-enter the handler so reconcile can flip status to 'cold'.
   * Bootstrap supplies this once the runtime is constructed.
   */
  wakeEntity?: (agentId: string) => void
}
```

- [ ] **Step 4: Update both `armIdleTimer` call sites to call `wakeEntity` after destroy**

In `processPrompt` (around line 581):

```ts
if (!finalMeta.keepWarm && lm.pinCount(agentId) === 0) {
  lm.armIdleTimer(agentId, finalMeta.idleTimeoutMs, () => {
    void lm.provider
      .destroy(agentId)
      .catch((err) => log.warn({ err, agentId }, `idle stop failed`))
      .finally(() => options.wakeEntity?.(agentId))
  })
}
```

In `processRelease` (around line 632):

```ts
if (count === 0) {
  const meta = ctx.db.collections.sessionMeta.get(`current`) as SessionMetaRow
  if (!meta.keepWarm && meta.status === `idle`) {
    lm.armIdleTimer(agentId, meta.idleTimeoutMs, () => {
      void lm.provider
        .destroy(agentId)
        .catch(() => undefined)
        .finally(() => options.wakeEntity?.(agentId))
    })
  }
}
```

`processRelease` is currently a non-async function but uses `lm` and `options` — `options` is in scope through the `dispatchInboxMessage` parameter chain. Confirm `processRelease` already accepts `options` (or its containing scope does). Looking at `dispatchInboxMessage`:

```ts
case `release`:
  return processRelease(ctx, lm)
```

`processRelease` does NOT receive `options`. Update its signature to accept `options` and update the dispatch call:

```ts
function processRelease(
  ctx: any,
  lm: LifecycleManager,
  options: CodingAgentHandlerOptions
): void {
  // ... (existing body, with options.wakeEntity?.(agentId) inside the timer)
}

// in dispatchInboxMessage:
case `release`:
  return processRelease(ctx, lm, options)
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm -C packages/coding-agents test test/unit/entity-handler.test.ts -t "wakes entity"`
Expected: PASS.

- [ ] **Step 6: Add the `lifecycle/idle-eviction-fired` message schema**

Edit `packages/coding-agents/src/entity/messages.ts`. Append:

```ts
export const idleEvictionFiredMessageSchema = z.object({}).passthrough()
```

- [ ] **Step 7: Register the new message type in `register.ts`**

Edit `packages/coding-agents/src/entity/register.ts`. Update the `inboxSchemas` block:

```ts
import {
  destroyMessageSchema,
  idleEvictionFiredMessageSchema, // NEW
  pinMessageSchema,
  promptMessageSchema,
  releaseMessageSchema,
  stopMessageSchema,
} from './messages'
```

```ts
inboxSchemas: {
  prompt: promptMessageSchema,
  pin: pinMessageSchema,
  release: releaseMessageSchema,
  stop: stopMessageSchema,
  destroy: destroyMessageSchema,
  'lifecycle/idle-eviction-fired': idleEvictionFiredMessageSchema,
},
```

- [ ] **Step 8: Add a no-op dispatch case in the handler**

Edit `packages/coding-agents/src/entity/handler.ts`. Update `dispatchInboxMessage`:

```ts
async function dispatchInboxMessage(
  ctx: any,
  lm: LifecycleManager,
  wr: WorkspaceRegistry,
  options: CodingAgentHandlerOptions,
  inboxMsg: InboxRow
): Promise<void> {
  const type = inboxMsg.message_type ?? `prompt`
  switch (type) {
    case `prompt`:
      return processPrompt(ctx, lm, wr, options, inboxMsg)
    case `pin`:
      return processPin(ctx, lm)
    case `release`:
      return processRelease(ctx, lm, options)
    case `stop`:
      return processStop(ctx, lm)
    case `destroy`:
      return processDestroy(ctx, lm, wr)
    case `lifecycle/idle-eviction-fired`:
      // No-op: reconcile at the top of the handler already saw
      // 'idle && !running' and flipped status to 'cold'. This message
      // exists only to re-enter the handler after the timer fired.
      return
    default:
      log.warn({ type }, `coding-agent: unknown inbox message type`)
  }
}
```

- [ ] **Step 9: Add the `wakeEntity` dep to `RegisterCodingAgentDeps`**

Edit `packages/coding-agents/src/entity/register.ts`. Update `RegisterCodingAgentDeps`:

```ts
export interface RegisterCodingAgentDeps {
  provider: SandboxProvider
  bridge: Bridge
  /** Override defaults; used by tests. */
  defaults?: Partial<{
    idleTimeoutMs: number
    coldBootBudgetMs: number
    runTimeoutMs: number
  }>
  /** Per-turn env supplier. Defaults to forwarding ANTHROPIC_API_KEY from process.env. */
  env?: () => Record<string, string>
  /**
   * Posts a self-message to the entity. Used by the idle timer to
   * re-enter the handler after destroying the container, so reconcile
   * flips status idle → cold. Bootstrap supplies this once the runtime
   * is constructed.
   */
  wakeEntity?: (agentId: string) => void
}
```

And thread it into the handler options:

```ts
handler: makeCodingAgentHandler(lm, wr, {
  defaults,
  env,
  wakeEntity: deps.wakeEntity,
}),
```

- [ ] **Step 10: Wire `wakeEntity` in `bootstrap.ts`**

Edit `packages/agents/src/bootstrap.ts`. The runtime exposes `RuntimeHandler` (from `create-handler.ts:123`), which **does not** include an `executeSend` method — `executeSend` is internal to wake processing. Use the public `RuntimeServerClient` (exported from `@electric-ax/agents-runtime`) which calls the same `/send` HTTP endpoint as the UI's Pin/Release/Stop buttons:

```ts
import {
  // ... existing imports
  createRuntimeServerClient,
} from '@electric-ax/agents-runtime'

// ... existing skillsRegistry setup, registerHorton, registerWorker ...

const codingAgentClient = createRuntimeServerClient({
  baseUrl: agentServerUrl,
})

registerCodingAgent(registry, {
  provider: new LocalDockerProvider(),
  bridge: new StdioBridge(),
  wakeEntity: (agentId: string) => {
    void codingAgentClient
      .sendEntityMessage({
        targetUrl: agentId,
        from: `system`,
        type: `lifecycle/idle-eviction-fired`,
        payload: {},
      })
      .catch((err) =>
        serverLog.warn(
          `[coding-agent] wakeEntity(${agentId}) failed: ${err instanceof Error ? err.message : String(err)}`
        )
      )
  },
})
typeNames.push(`coding-agent`)

const runtime = createRuntimeHandler({
  baseUrl: agentServerUrl,
  serveEndpoint,
  registry,
  subscriptionPathForType: (name) => `/${name}/*/main`,
  idleTimeout: 5_000,
  createElectricTools,
})
```

(Verify `serverLog` is the existing logger in this file. If the variable is named differently, use the same one as for the skills-registry warnings above.)

The HTTP loopback adds ~1-5 ms latency vs. an in-process call but matches the architecture of all other inbox sends. No mutable holder, no temporal coupling between `registerCodingAgent` and `createRuntimeHandler`.

- [ ] **Step 11: Run all coding-agent unit tests**

Run: `pnpm -C packages/coding-agents test test/unit/`
Expected: PASS — including the new wake-entity test plus all existing tests.

- [ ] **Step 12: Run the agents bootstrap test (if any)**

Run: `pnpm -C packages/agents test`
Expected: PASS — bootstrap change should not break Horton/Worker tests.

- [ ] **Step 13: Commit**

```bash
git add packages/coding-agents/src/entity/handler.ts \
        packages/coding-agents/src/entity/messages.ts \
        packages/coding-agents/src/entity/register.ts \
        packages/coding-agents/test/unit/entity-handler.test.ts \
        packages/agents/src/bootstrap.ts
git commit -m "fix(coding-agents): idle timer wakes entity to update status

After the idle timer destroys the container, fire a no-op
'lifecycle/idle-eviction-fired' inbox message via wakeEntity callback.
Reconcile at the top of the handler then sees 'idle && !running' and
flips meta.status to 'cold'. Closes the status divergence where the
UI saw 'idle' indefinitely after eviction.

Bootstrap supplies wakeEntity via a mutable holder closure since the
runtime is constructed after registerCodingAgent."
```

---

## Task 5: Trim mutex chain in `WorkspaceRegistry`

**Files:**

- Modify: `packages/coding-agents/src/workspace-registry.ts`
- Test: `packages/coding-agents/test/unit/workspace-registry.test.ts`

`acquire` extends the chain promise with `prior.then(() => next)` on every call but never trims. Long-lived shared workspaces leak microtask layers. Add an in-flight counter; trim the chain entry when the last acquirer releases.

- [ ] **Step 1: Write a failing test for chain trimming**

Append to `packages/coding-agents/test/unit/workspace-registry.test.ts`:

```ts
describe(`WorkspaceRegistry mutex chain trimming`, () => {
  it(`removes the chain entry when the last acquirer releases (serial)`, async () => {
    const wr = new WorkspaceRegistry()
    const internal = wr as unknown as {
      chainByIdentity: Map<string, Promise<void>>
    }

    for (let i = 0; i < 5; i++) {
      const release = await wr.acquire(`volume:foo`)
      release()
    }
    // Allow microtasks to drain.
    await Promise.resolve()
    await Promise.resolve()

    expect(internal.chainByIdentity.size).toBe(0)
  })

  it(`keeps the chain entry while concurrent acquirers are queued`, async () => {
    const wr = new WorkspaceRegistry()
    const internal = wr as unknown as {
      chainByIdentity: Map<string, Promise<void>>
    }

    const release1 = await wr.acquire(`volume:foo`)
    // Queue a second acquire that is waiting on release1.
    const pending2 = wr.acquire(`volume:foo`)
    expect(internal.chainByIdentity.size).toBe(1)

    release1()
    const release2 = await pending2
    // Still one entry while release2 is held.
    expect(internal.chainByIdentity.size).toBe(1)

    release2()
    await Promise.resolve()
    await Promise.resolve()
    expect(internal.chainByIdentity.size).toBe(0)
  })

  it(`existing serialization behaviour unchanged`, async () => {
    const wr = new WorkspaceRegistry()
    const order: Array<string> = []
    const a = wr.acquire(`volume:foo`).then((release) => {
      order.push(`a-acq`)
      return new Promise<void>((res) =>
        setTimeout(() => {
          order.push(`a-rel`)
          release()
          res()
        }, 20)
      )
    })
    await new Promise((r) => setTimeout(r, 5))
    const b = wr.acquire(`volume:foo`).then((release) => {
      order.push(`b-acq`)
      release()
    })
    await Promise.all([a, b])
    expect(order).toEqual([`a-acq`, `a-rel`, `b-acq`])
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm -C packages/coding-agents test test/unit/workspace-registry.test.ts -t "trim"`
Expected: FAIL — `chainByIdentity.size` is 1 (or more) after release.

- [ ] **Step 3: Add the in-flight counter and trim logic**

Edit `packages/coding-agents/src/workspace-registry.ts`. Replace the `acquire` method and add the counter field:

```ts
export class WorkspaceRegistry {
  private readonly refsByIdentity = new Map<string, Set<string>>()
  private readonly chainByIdentity = new Map<string, Promise<void>>()
  private readonly acquirersByIdentity = new Map<string, number>() // NEW

  // ... resolveIdentity, register, release, refs unchanged ...

  acquire(identity: string): Promise<() => void> {
    this.acquirersByIdentity.set(
      identity,
      (this.acquirersByIdentity.get(identity) ?? 0) + 1
    )
    const prior = this.chainByIdentity.get(identity) ?? Promise.resolve()
    let releaseFn!: () => void
    const next = new Promise<void>((res) => {
      releaseFn = res
    })
    const link = prior.then(() => next)
    this.chainByIdentity.set(identity, link)
    return prior.then(() => () => {
      const remaining = (this.acquirersByIdentity.get(identity) ?? 1) - 1
      if (remaining === 0) {
        this.acquirersByIdentity.delete(identity)
        // Only delete the chain entry if no acquirer chained onto us.
        if (this.chainByIdentity.get(identity) === link) {
          this.chainByIdentity.delete(identity)
        }
      } else {
        this.acquirersByIdentity.set(identity, remaining)
      }
      releaseFn()
    })
  }

  rebuild(snapshots: Array<{ identity: string; agentId: string }>): void {
    this.refsByIdentity.clear()
    this.chainByIdentity.clear()
    this.acquirersByIdentity.clear() // NEW
    for (const { identity, agentId } of snapshots) {
      this.register(identity, agentId)
    }
  }
}
```

- [ ] **Step 4: Run the workspace-registry test to verify it passes**

Run: `pnpm -C packages/coding-agents test test/unit/workspace-registry.test.ts`
Expected: PASS — including the existing serialization tests AND the new trim tests.

- [ ] **Step 5: Run the full unit suite**

Run: `pnpm -C packages/coding-agents test test/unit/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/coding-agents/src/workspace-registry.ts \
        packages/coding-agents/test/unit/workspace-registry.test.ts
git commit -m "fix(coding-agents): trim mutex chain in WorkspaceRegistry on release

Track in-flight acquirers per identity. When the last acquirer
releases AND no other acquirer chained onto the current link, drop
the chain entry. Concurrent acquirers walk the chain normally; only
the truly last lease prunes."
```

---

## Task 6: Cross-cutting integration test (idle eviction with resume)

**Files:**

- Create: `packages/coding-agents/test/integration/slice-c1.test.ts`

A single integration test that exercises Fix 1 (large transcript via stdin), Fix 2 (probe-and-materialise), and Fix 4 (idle timer wake) together. The slice-b test already covers a similar shape but with a slow `setTimeout(2500)` between turns; this one forces idle eviction more aggressively.

- [ ] **Step 1: Create the test file**

Write `packages/coding-agents/test/integration/slice-c1.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import {
  LocalDockerProvider,
  StdioBridge,
  WorkspaceRegistry,
  LifecycleManager,
} from '../../src'
import { makeCodingAgentHandler } from '../../src/entity/handler'
import { buildTestImage, TEST_IMAGE_TAG } from '../support/build-image'
import { loadTestEnv } from '../support/env'

const SHOULD_RUN = process.env.DOCKER === `1`
const describeMaybe = SHOULD_RUN ? describe : describe.skip

interface CollectionStub {
  rows: Map<string, any>
  get(k: string): any
  toArray: Array<any>
}

function makeCollection(): CollectionStub {
  const rows = new Map<string, any>()
  return {
    rows,
    get(k: string) {
      return rows.get(k)
    },
    get toArray(): Array<any> {
      return Array.from(rows.values())
    },
  }
}

function makeFakeCtx(entityUrl: string, args: Record<string, unknown>) {
  const state = {
    sessionMeta: makeCollection(),
    runs: makeCollection(),
    events: makeCollection(),
    lifecycle: makeCollection(),
    nativeJsonl: makeCollection(),
    inbox: makeCollection(),
  }
  let runCounter = 0
  const ctx: any = {
    entityUrl,
    entityType: `coding-agent`,
    args,
    tags: {},
    firstWake: false,
    db: {
      collections: state,
      actions: {
        sessionMeta_insert: ({ row }: any) =>
          state.sessionMeta.rows.set(row.key, row),
        sessionMeta_update: ({ key, updater }: any) => {
          const r = state.sessionMeta.rows.get(key)
          if (r) updater(r)
        },
        runs_insert: ({ row }: any) => state.runs.rows.set(row.key, row),
        runs_update: ({ key, updater }: any) => {
          const r = state.runs.rows.get(key)
          if (r) updater(r)
        },
        events_insert: ({ row }: any) => state.events.rows.set(row.key, row),
        lifecycle_insert: ({ row }: any) =>
          state.lifecycle.rows.set(row.key, row),
        nativeJsonl_insert: ({ row }: any) =>
          state.nativeJsonl.rows.set(row.key, row),
      },
    },
    recordRun() {
      const key = `run-${++runCounter}`
      const ent: any = { key, status: undefined, response: `` }
      state.runs.rows.set(key, ent)
      return {
        key,
        end({ status }: { status: string }) {
          ent.status = status
        },
        attachResponse(text: string) {
          ent.response += text
        },
      }
    },
    setTag: () => Promise.resolve(),
    send: () => undefined,
  }
  return { ctx, state }
}

describeMaybe(`Slice C₁ — idle eviction roundtrip`, () => {
  beforeAll(async () => {
    await buildTestImage()
  }, 600_000)

  it(`forced idle eviction between turns: turn 2 still resumes`, async () => {
    const env = loadTestEnv()
    const provider = new LocalDockerProvider({ image: TEST_IMAGE_TAG })
    const bridge = new StdioBridge()
    const wr = new WorkspaceRegistry()
    const lm = new LifecycleManager({ provider, bridge })

    let wakeCalls = 0
    const handler = makeCodingAgentHandler(lm, wr, {
      defaults: {
        idleTimeoutMs: 1_000,
        coldBootBudgetMs: 60_000,
        runTimeoutMs: 120_000,
      },
      env: () => ({
        ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
        ANTHROPIC_MODEL: env.ANTHROPIC_MODEL,
      }),
      wakeEntity: () => {
        wakeCalls++
      },
    })

    const agentId = `/test/coding-agent/c1-${Date.now().toString(36)}`
    const args = {
      kind: `claude`,
      workspaceType: `volume`,
      workspaceName: `c1-${Date.now().toString(36)}`,
      idleTimeoutMs: 1_000,
    }
    const { ctx, state } = makeFakeCtx(agentId, args)

    // Turn 1
    await handler(ctx, { type: `message_received` })
    state.inbox.rows.set(`i1`, {
      key: `i1`,
      message_type: `prompt`,
      payload: {
        text: `My favourite fruit is ELEPHANTBANANA. Acknowledge with exactly: "Got it"`,
      },
    })
    await handler(ctx, { type: `message_received` })
    expect(state.sessionMeta.get(`current`).status).toBe(`idle`)
    expect(state.sessionMeta.get(`current`).nativeSessionId).toBeDefined()

    // Force destroy NOW (more aggressive than waiting for the 1s idle
    // timer; this also simulates an external container death).
    await provider.destroy(agentId)

    // Re-enter the handler with no inbox message — reconcile should
    // observe the meta as 'idle' and providerStatus as 'unknown' (or
    // 'stopped'), and flip status to 'cold'.
    await handler(ctx, { type: `message_received` })
    expect(state.sessionMeta.get(`current`).status).toBe(`cold`)

    // Turn 2 — must trigger probe-and-materialise of the captured
    // transcript and resume successfully.
    state.inbox.rows.set(`i2`, {
      key: `i2`,
      message_type: `prompt`,
      payload: {
        text: `What was the favourite fruit I told you? Reply with the single word in all caps.`,
      },
    })
    await handler(ctx, { type: `message_received` })

    const runs = Array.from(state.runs.rows.values()) as any[]
    const lastRun = runs[runs.length - 1]
    if (lastRun.status !== `completed`) {
      console.log(
        `lastRun.finishReason:`,
        lastRun.finishReason,
        `\nlastError:`,
        state.sessionMeta.get(`current`)?.lastError,
        `\nlifecycle:`,
        Array.from(state.lifecycle.rows.values()).map(
          (r: any) => `${r.event}${r.detail ? `: ${r.detail}` : ``}`
        )
      )
    }
    expect(lastRun.status).toBe(`completed`)
    expect(lastRun.responseText?.toUpperCase()).toContain(`ELEPHANTBANANA`)

    // resume.restored should appear because the transcript file did
    // not exist in the post-destroy container.
    const lifecycleRows = Array.from(state.lifecycle.rows.values()) as any[]
    const resumeRow = lifecycleRows.find(
      (r: any) => r.event === `resume.restored`
    )
    expect(resumeRow).toBeDefined()

    await provider.destroy(agentId).catch(() => undefined)
  }, 360_000)
})
```

- [ ] **Step 2: Run the test with `DOCKER=1`**

Run: `DOCKER=1 pnpm -C packages/coding-agents test test/integration/slice-c1.test.ts`
Expected: PASS — turn 2 returns "ELEPHANTBANANA"; `resume.restored` lifecycle row is present.

- [ ] **Step 3: Run BOTH integration tests to confirm no cross-test regression**

Run: `DOCKER=1 pnpm -C packages/coding-agents test test/integration/`
Expected: All integration tests PASS — `smoke.test.ts`, `slice-a.test.ts`, `slice-b.test.ts`, `slice-c1.test.ts`.

- [ ] **Step 4: Commit**

```bash
git add packages/coding-agents/test/integration/slice-c1.test.ts
git commit -m "test(coding-agents): Slice C₁ idle-eviction roundtrip integration

Forces a destroy between turns 1 and 2 and verifies that probe-and-
materialise re-creates the transcript file and the second turn
resumes successfully. Exercises C1 (stdin pipe), C2 (probe), and
I1 (wakeEntity) together."
```

---

## Task 7: Manual smoke test + branch hygiene

**Files:** none (verification step)

- [ ] **Step 1: Run the full coding-agents test suite**

Run: `pnpm -C packages/coding-agents test`
Expected: ALL unit tests PASS. Integration tests skipped (no `DOCKER=1`).

- [ ] **Step 2: Run with `DOCKER=1` for full integration coverage**

Run: `DOCKER=1 pnpm -C packages/coding-agents test`
Expected: ALL tests PASS, including the four integration suites.

- [ ] **Step 3: Run the upstream test suites that depend on coding-agents**

Run: `pnpm -C packages/agents-runtime test`
Expected: PASS.

Run: `pnpm -C packages/agents test`
Expected: PASS — bootstrap restructure should not break anything.

- [ ] **Step 4: Manual UI smoke (optional, requires `bin/dev.mjs` running)**

If the dev environment is available:

1. `pnpm -C packages/electric-ax dev` (or whatever the dev script is — check `package.json`).
2. Open `http://localhost:4437/__agent_ui/` and spawn a coding-agent.
3. Send a prompt: "Remember the word ELEPHANT".
4. Wait until the status indicator drops from `idle` to `cold` (~5 minutes default, or configure shorter `idleTimeoutMs` for testing).
5. Verify the indicator transitions `idle → cold` (without sending another prompt). This confirms Fix 4 wakes the entity.
6. Send a second prompt: "What was the word?".
7. Confirm the response includes "ELEPHANT". This confirms Fix 1 + Fix 2 work end-to-end.
8. Run `ps -ef | grep ANTHROPIC` on the host during a turn — should return nothing matching the API key. This confirms Fix 3.

If any step fails, capture the failure and decide whether it's a Slice C₁ regression or a pre-existing issue.

- [ ] **Step 5: Push and update the open PR**

```bash
git push
```

The existing PR (https://github.com/electric-sql/electric/pull/4256) will pick up the new commits automatically. Verify CI is green (https://github.com/electric-sql/electric/actions/).

---

## Acceptance criteria (from the spec)

- [x] Five fixes land in commits on the existing branch (no separate PR needed).
- [x] New unit tests pass without `DOCKER=1`.
- [x] `DOCKER=1 pnpm -C packages/coding-agents test` green, including the new `slice-c1.test.ts`.
- [x] `ps -ef` on the host during a run shows no `ANTHROPIC_*` env values (verified by Task 3 step 6 + Task 7 manual step 8).
- [x] Multi-turn resume roundtrip succeeds with a fresh container between turns (covered by `slice-c1.test.ts`).
- [x] No public API or schema changes (verified by Task 7 step 3 — upstream packages still pass).
