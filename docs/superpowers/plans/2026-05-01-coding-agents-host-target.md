# Coding-agents host target & native session import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-spawn `target: 'sandbox' | 'host'` execution mode and a way to import existing local Claude sessions into electric-ax-managed coding-agents.

**Architecture:** Introduce a new `HostProvider` (sibling of `LocalDockerProvider`) that runs `claude` directly on the host with `cwd=realpath(hostPath)`. Align `LocalDockerProvider`'s bind-mount cwd to the same realpath so `~/.claude/projects/<sanitised-cwd>/<id>.jsonl` paths line up across both targets — cross-target bind-mount resume works without rewriting the JSONL. Spawn args gain `target` and `importNativeSessionId`; `LifecycleManager` becomes target-aware. A small CLI (`electric-ax import-claude`) wraps the existing entity-spawn endpoint for one-shot imports.

**Tech Stack:** TypeScript, Node 22+, Vitest, tsdown, zod, Docker (for sandbox target).

**Spec:** `docs/superpowers/specs/2026-05-01-coding-agents-host-target-design.md`

---

## File map

**Created:**

- `packages/coding-agents/src/providers/host.ts` — `HostProvider` implementation
- `packages/coding-agents/src/cli/import-claude.ts` — CLI entrypoint
- `packages/coding-agents/test/unit/host-provider.test.ts` — `HostProvider` unit tests
- `packages/coding-agents/test/unit/cli-import.test.ts` — CLI unit tests
- `packages/coding-agents/test/integration/host-provider.test.ts` — gated integration tests

**Modified:**

- `packages/coding-agents/src/types.ts` — `SandboxSpec.target`, `RecoveredSandbox.target`
- `packages/coding-agents/src/entity/collections.ts` — `SessionMetaRow.target`, lifecycle event enum
- `packages/coding-agents/src/providers/local-docker.ts` — bind-mount target = `realpath(hostPath)`
- `packages/coding-agents/src/lifecycle-manager.ts` — multi-provider routing
- `packages/coding-agents/src/entity/register.ts` — schema additions, deps shape
- `packages/coding-agents/src/entity/handler.ts` — target validation, import flow, target-aware lifecycle calls
- `packages/coding-agents/src/index.ts` — export `HostProvider`
- `packages/coding-agents/package.json` — `bin` entry, tsdown entry
- `packages/coding-agents/tsdown.config.ts` — add CLI entry
- `packages/coding-agents/test/unit/local-docker.test.ts` — assert realpath workspaceMount for bindMount
- `packages/coding-agents/test/unit/lifecycle-manager.test.ts` — multi-provider tests
- `packages/coding-agents/test/unit/entity-handler.test.ts` — target validation, import path
- `packages/agents/src/bootstrap.ts` — pass `providers: { sandbox, host }`
- `website/docs/agents/entities/coding-agent.md` — Target & Importing sections
- `docs/agents-development.md` — host-target dev note

---

## Task 1: Add `target` to types and persisted state

**Files:**

- Modify: `packages/coding-agents/src/types.ts`
- Modify: `packages/coding-agents/src/entity/collections.ts`

- [ ] **Step 1: Add `target` to `SandboxSpec`**

In `packages/coding-agents/src/types.ts`, modify the `SandboxSpec` interface:

```ts
export interface SandboxSpec {
  /** Stable agent identity (e.g. /<parent>/coding-agent/<id>). */
  agentId: string
  kind: CodingAgentKind
  /** Execution target. 'sandbox' = Docker; 'host' = direct on-host (no isolation). */
  target: `sandbox` | `host`
  workspace:
    | { type: `volume`; name: string }
    | { type: `bindMount`; hostPath: string }
  /** Env vars exposed inside the sandbox (ANTHROPIC_API_KEY, etc.). */
  env: Record<string, string>
}
```

- [ ] **Step 2: Add `target` to `RecoveredSandbox`**

In the same file:

```ts
export interface RecoveredSandbox {
  agentId: string
  instanceId: string
  status: `running` | `stopped`
  target: `sandbox` | `host`
}
```

- [ ] **Step 3: Add `target` to `SessionMetaRow`**

In `packages/coding-agents/src/entity/collections.ts`, modify `sessionMetaRowSchema`:

```ts
export const sessionMetaRowSchema = z.object({
  key: z.literal(`current`),
  status: codingAgentStatusSchema,
  kind: z.enum([`claude`]),
  target: z.enum([`sandbox`, `host`]),
  pinned: z.boolean(),
  workspaceIdentity: z.string(),
  workspaceSpec: z.discriminatedUnion(`type`, [
    z.object({
      type: z.literal(`volume`),
      name: z.string(),
    }),
    z.object({
      type: z.literal(`bindMount`),
      hostPath: z.string(),
    }),
  ]),
  idleTimeoutMs: z.number(),
  keepWarm: z.boolean(),
  instanceId: z.string().optional(),
  lastError: z.string().optional(),
  currentPromptInboxKey: z.string().optional(),
  lastInboxKey: z.string().optional(),
  nativeSessionId: z.string().optional(),
})
```

- [ ] **Step 4: Extend the lifecycle event enum**

Same file, modify `lifecycleRowSchema.event` to add `import.restored` and `import.failed`:

```ts
export const lifecycleRowSchema = z.object({
  key: z.string(),
  ts: z.number(),
  event: z.enum([
    `sandbox.starting`,
    `sandbox.started`,
    `sandbox.stopped`,
    `sandbox.failed`,
    `pin`,
    `release`,
    `orphan.detected`,
    `resume.restored`,
    `import.restored`,
    `import.failed`,
  ]),
  detail: z.string().optional(),
})
```

- [ ] **Step 5: Verify typecheck passes (will fail with downstream errors — that's expected)**

Run from repo root: `pnpm -C packages/coding-agents typecheck 2>&1 | head -20`

Expected: TypeScript reports errors in `local-docker.ts` (no `target` on SandboxSpec callers), `lifecycle-manager.ts`, and `handler.ts`. Subsequent tasks fix these.

- [ ] **Step 6: Commit**

```bash
git add packages/coding-agents/src/types.ts packages/coding-agents/src/entity/collections.ts
git commit -m "feat(coding-agents): add 'target' to SandboxSpec, RecoveredSandbox, SessionMetaRow

Wires the data shape changes for the per-spawn execution target. The
followup tasks update producers and consumers."
```

---

## Task 2: HostProvider — construction + reject volume

**Files:**

- Create: `packages/coding-agents/src/providers/host.ts`
- Create: `packages/coding-agents/test/unit/host-provider.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/coding-agents/test/unit/host-provider.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { HostProvider } from '../../src/providers/host'

describe(`HostProvider construction`, () => {
  it(`exposes name "host"`, () => {
    const p = new HostProvider()
    expect(p.name).toBe(`host`)
  })
})

describe(`HostProvider.start`, () => {
  it(`rejects a volume workspace`, async () => {
    const p = new HostProvider()
    await expect(
      p.start({
        agentId: `/t/coding-agent/x`,
        kind: `claude`,
        target: `host`,
        workspace: { type: `volume`, name: `w` },
        env: {},
      })
    ).rejects.toThrow(/HostProvider requires a bindMount workspace/)
  })
})
```

- [ ] **Step 2: Run test and verify it fails**

Run: `pnpm -C packages/coding-agents test --run test/unit/host-provider.test.ts`

Expected: FAIL — module `../../src/providers/host` not found.

- [ ] **Step 3: Create the minimal HostProvider skeleton**

Create `packages/coding-agents/src/providers/host.ts`:

```ts
import type {
  RecoveredSandbox,
  SandboxInstance,
  SandboxProvider,
  SandboxSpec,
} from '../types'

export class HostProvider implements SandboxProvider {
  readonly name = `host`

  async start(spec: SandboxSpec): Promise<SandboxInstance> {
    if (spec.workspace.type !== `bindMount`) {
      throw new Error(`HostProvider requires a bindMount workspace`)
    }
    throw new Error(`not implemented`)
  }

  async stop(_instanceId: string): Promise<void> {
    throw new Error(`not implemented`)
  }

  async destroy(_agentId: string): Promise<void> {
    throw new Error(`not implemented`)
  }

  async status(_agentId: string): Promise<`running` | `stopped` | `unknown`> {
    throw new Error(`not implemented`)
  }

  async recover(): Promise<Array<RecoveredSandbox>> {
    return []
  }
}
```

- [ ] **Step 4: Run test and verify it passes**

Run: `pnpm -C packages/coding-agents test --run test/unit/host-provider.test.ts`

Expected: PASS for the two tests.

- [ ] **Step 5: Commit**

```bash
git add packages/coding-agents/src/providers/host.ts packages/coding-agents/test/unit/host-provider.test.ts
git commit -m "feat(coding-agents): scaffold HostProvider rejecting volume workspaces"
```

---

## Task 3: HostProvider — start, status, stop/destroy

**Files:**

- Modify: `packages/coding-agents/src/providers/host.ts`
- Modify: `packages/coding-agents/test/unit/host-provider.test.ts`

- [ ] **Step 1: Write failing tests for start/status/destroy**

Append to `packages/coding-agents/test/unit/host-provider.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe(`HostProvider lifecycle`, () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), `host-prov-`))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it(`start records agent in map; status reflects it; destroy removes it`, async () => {
    const p = new HostProvider()
    const agentId = `/t/coding-agent/${Date.now()}`
    const inst = await p.start({
      agentId,
      kind: `claude`,
      target: `host`,
      workspace: { type: `bindMount`, hostPath: dir },
      env: {},
    })
    expect(inst.agentId).toBe(agentId)
    expect(inst.workspaceMount).toBe(dir)
    expect(inst.instanceId).toBe(`host:${agentId}`)
    expect(await p.status(agentId)).toBe(`running`)

    await p.destroy(agentId)
    expect(await p.status(agentId)).toBe(`unknown`)
  })

  it(`start is idempotent — second call returns the same instance`, async () => {
    const p = new HostProvider()
    const spec: any = {
      agentId: `/t/coding-agent/idem`,
      kind: `claude`,
      target: `host`,
      workspace: { type: `bindMount`, hostPath: dir },
      env: {},
    }
    const a = await p.start(spec)
    const b = await p.start(spec)
    expect(b.instanceId).toBe(a.instanceId)
    expect(b.workspaceMount).toBe(a.workspaceMount)
  })

  it(`recover always returns an empty array`, async () => {
    const p = new HostProvider()
    expect(await p.recover()).toEqual([])
  })
})
```

Add `beforeEach`/`afterEach` to the import line (`import { describe, it, expect, beforeEach, afterEach } from 'vitest'`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -C packages/coding-agents test --run test/unit/host-provider.test.ts`

Expected: FAIL with "not implemented".

- [ ] **Step 3: Implement start/status/stop/destroy**

Replace the placeholder bodies in `packages/coding-agents/src/providers/host.ts`. Full file:

```ts
import { spawn } from 'node:child_process'
import { mkdir, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import { log } from '../log'
import type {
  ExecHandle,
  ExecRequest,
  RecoveredSandbox,
  SandboxInstance,
  SandboxProvider,
  SandboxSpec,
} from '../types'

interface AgentRecord {
  workspaceMount: string
  env: Record<string, string>
}

export class HostProvider implements SandboxProvider {
  readonly name = `host`

  private readonly agents = new Map<string, AgentRecord>()

  async start(spec: SandboxSpec): Promise<SandboxInstance> {
    if (spec.workspace.type !== `bindMount`) {
      throw new Error(`HostProvider requires a bindMount workspace`)
    }
    const existing = this.agents.get(spec.agentId)
    if (existing) {
      return this.makeInstance(spec.agentId, existing)
    }
    const real = await realpath(spec.workspace.hostPath)
    const s = await stat(real)
    if (!s.isDirectory()) {
      throw new Error(`HostProvider workspace is not a directory: ${real}`)
    }
    const rec: AgentRecord = { workspaceMount: real, env: spec.env }
    this.agents.set(spec.agentId, rec)
    log.info(
      { agentId: spec.agentId, workspaceMount: real },
      `host provider started`
    )
    return this.makeInstance(spec.agentId, rec)
  }

  async stop(_instanceId: string): Promise<void> {
    // Nothing to kill between turns; the per-turn child has already exited.
    // Per-agent cleanup lives in destroy(agentId).
  }

  async destroy(agentId: string): Promise<void> {
    this.agents.delete(agentId)
  }

  async status(agentId: string): Promise<`running` | `stopped` | `unknown`> {
    return this.agents.has(agentId) ? `running` : `unknown`
  }

  async recover(): Promise<Array<RecoveredSandbox>> {
    return []
  }

  private makeInstance(agentId: string, rec: AgentRecord): SandboxInstance {
    return {
      instanceId: `host:${agentId}`,
      agentId,
      workspaceMount: rec.workspaceMount,
      exec: (req) => execOnHost(req, rec),
      copyTo: ({ destPath, content, mode = 0o600 }) =>
        copyToHost(destPath, content, mode),
    }
  }
}

function lineIterator(stream: Readable): AsyncIterable<string> {
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  return rl as unknown as AsyncIterable<string>
}

async function execOnHost(
  req: ExecRequest,
  rec: AgentRecord
): Promise<ExecHandle> {
  const env: Record<string, string> = { ...rec.env, ...(req.env ?? {}) }
  if (!env.PATH && process.env.PATH) env.PATH = process.env.PATH
  const cwd = req.cwd ?? rec.workspaceMount
  const child = spawn(req.cmd[0]!, req.cmd.slice(1), {
    cwd,
    env,
    stdio: [req.stdin === `pipe` ? `pipe` : `ignore`, `pipe`, `pipe`],
  })

  const exitPromise = new Promise<{ exitCode: number }>((resolve, reject) => {
    child.on(`error`, reject)
    child.on(`exit`, (code) => resolve({ exitCode: code ?? -1 }))
  })

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

async function copyToHost(
  destPath: string,
  content: string,
  mode: number
): Promise<void> {
  await mkdir(dirname(destPath), { recursive: true })
  await writeFile(destPath, content, { mode })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C packages/coding-agents test --run test/unit/host-provider.test.ts`

Expected: PASS — start/status/destroy/idempotency/recover.

- [ ] **Step 5: Commit**

```bash
git add packages/coding-agents/src/providers/host.ts packages/coding-agents/test/unit/host-provider.test.ts
git commit -m "feat(coding-agents): HostProvider start/status/destroy + idempotency"
```

---

## Task 4: HostProvider — exec & copyTo

**Files:**

- Modify: `packages/coding-agents/test/unit/host-provider.test.ts`

(`exec` and `copyTo` are already implemented in Task 3 — this task just adds tests proving they work end-to-end.)

- [ ] **Step 1: Write failing tests**

Append to `packages/coding-agents/test/unit/host-provider.test.ts`:

```ts
import { readFile, stat as statFs } from 'node:fs/promises'

describe(`HostProvider exec`, () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), `host-prov-exec-`))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it(`runs a child and drains stdout`, async () => {
    const p = new HostProvider()
    const agentId = `/t/coding-agent/exec-${Date.now()}`
    const inst = await p.start({
      agentId,
      kind: `claude`,
      target: `host`,
      workspace: { type: `bindMount`, hostPath: dir },
      env: {},
    })
    const handle = await inst.exec({
      cmd: [`node`, `-e`, `process.stdout.write("hi\\n")`],
    })
    let out = ``
    for await (const line of handle.stdout) out += line
    const exit = await handle.wait()
    expect(exit.exitCode).toBe(0)
    expect(out).toBe(`hi`)
  })

  it(`exposes only spec.env (+ inherited PATH) to the child`, async () => {
    const p = new HostProvider()
    process.env.HOST_PROVIDER_LEAK = `secret`
    const agentId = `/t/coding-agent/env-${Date.now()}`
    const inst = await p.start({
      agentId,
      kind: `claude`,
      target: `host`,
      workspace: { type: `bindMount`, hostPath: dir },
      env: { ALLOWED: `yes` },
    })
    const handle = await inst.exec({
      cmd: [
        `node`,
        `-e`,
        `process.stdout.write(JSON.stringify({allowed:process.env.ALLOWED ?? "", leak:process.env.HOST_PROVIDER_LEAK ?? ""}))`,
      ],
    })
    let out = ``
    for await (const line of handle.stdout) out += line
    await handle.wait()
    delete process.env.HOST_PROVIDER_LEAK
    const parsed = JSON.parse(out)
    expect(parsed.allowed).toBe(`yes`)
    expect(parsed.leak).toBe(``)
  })
})

describe(`HostProvider copyTo`, () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), `host-prov-copy-`))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it(`writes the content with the requested mode`, async () => {
    const p = new HostProvider()
    const agentId = `/t/coding-agent/copy-${Date.now()}`
    const inst = await p.start({
      agentId,
      kind: `claude`,
      target: `host`,
      workspace: { type: `bindMount`, hostPath: dir },
      env: {},
    })
    const dest = join(dir, `nested`, `file.txt`)
    await inst.copyTo({ destPath: dest, content: `payload`, mode: 0o600 })
    const contents = await readFile(dest, `utf8`)
    expect(contents).toBe(`payload`)
    const s = await statFs(dest)
    expect(s.mode & 0o777).toBe(0o600)
  })
})
```

- [ ] **Step 2: Run tests — they should pass directly (impl is from Task 3)**

Run: `pnpm -C packages/coding-agents test --run test/unit/host-provider.test.ts`

Expected: PASS — all tests in this file. If exec/copyTo tests fail, debug `host.ts` from Task 3.

- [ ] **Step 3: Commit**

```bash
git add packages/coding-agents/test/unit/host-provider.test.ts
git commit -m "test(coding-agents): cover HostProvider exec env policy and copyTo"
```

---

## Task 5: LocalDockerProvider — aligned bind-mount cwd

**Files:**

- Modify: `packages/coding-agents/src/providers/local-docker.ts`
- Modify: `packages/coding-agents/test/unit/local-docker.test.ts`

- [ ] **Step 1: Write failing test for aligned `workspaceMount`**

Append to `packages/coding-agents/test/unit/local-docker.test.ts`:

```ts
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'

describeMaybe(`LocalDockerProvider mount alignment`, () => {
  beforeAll(async () => {
    await buildTestImage()
  }, 600_000)

  it(`bindMount workspace is mounted at realpath(hostPath) and instance.workspaceMount matches`, async () => {
    const provider = new LocalDockerProvider({ image: TEST_IMAGE_TAG })
    const tmp = await mkdtemp(join(tmpdir(), `mount-align-`))
    const real = await realpath(tmp)
    const agentId = `/test/coding-agent/align-${Date.now().toString(36)}`
    try {
      const inst = await provider.start({
        agentId,
        kind: `claude`,
        target: `sandbox`,
        workspace: { type: `bindMount`, hostPath: tmp },
        env: {},
      })
      expect(inst.workspaceMount).toBe(real)
      const handle = await inst.exec({ cmd: [`pwd`] })
      let cwd = ``
      for await (const line of handle.stdout) cwd += line
      await handle.wait()
      expect(cwd.trim()).toBe(real)
    } finally {
      await provider.destroy(agentId).catch(() => undefined)
      await rm(tmp, { recursive: true, force: true })
    }
  }, 240_000)

  it(`volume workspace still mounts at /workspace`, async () => {
    const provider = new LocalDockerProvider({ image: TEST_IMAGE_TAG })
    const agentId = `/test/coding-agent/vol-${Date.now().toString(36)}`
    try {
      const inst = await provider.start({
        agentId,
        kind: `claude`,
        target: `sandbox`,
        workspace: { type: `volume`, name: `vol-${Date.now().toString(36)}` },
        env: {},
      })
      expect(inst.workspaceMount).toBe(`/workspace`)
    } finally {
      await provider.destroy(agentId).catch(() => undefined)
    }
  }, 240_000)
})
```

- [ ] **Step 2: Run tests to confirm they fail (they need the impl change)**

Run: `DOCKER=1 pnpm -C packages/coding-agents test --run test/unit/local-docker.test.ts`

Expected: FAIL — `inst.workspaceMount` is `'/workspace'`, not `realpath(tmp)`.

- [ ] **Step 3: Update `mountFlag` and `makeInstance`**

In `packages/coding-agents/src/providers/local-docker.ts`, change `mountFlag` to return both the flag and the resolved mount path, and thread that through `makeInstance`:

```ts
private async mountFlag(
  spec: SandboxSpec
): Promise<{ flag: string; mountPath: string }> {
  if (spec.workspace.type === `volume`) {
    const volName = `coding-agent-workspace-${spec.workspace.name}`
    await runDocker([`volume`, `create`, volName]).catch(() => undefined)
    return {
      flag: `--mount=type=volume,source=${volName},target=/workspace`,
      mountPath: `/workspace`,
    }
  }
  const real = await realpath(spec.workspace.hostPath)
  return {
    flag: `--mount=type=bind,source=${real},target=${real}`,
    mountPath: real,
  }
}
```

Update `start()` to destructure the new return shape:

```ts
const { flag: mount, mountPath } = await this.mountFlag(spec)

const args = [
  `run`,
  `-d`,
  `--rm=false`,
  ...labels.flatMap((l) => [`--label`, l]),
  mount,
  `-w`,
  mountPath,
  this.image,
]

const { stdout } = await runDocker(args)
const instanceId = stdout.trim()
log.info({ agentId: spec.agentId, instanceId }, `started sandbox`)
return this.makeInstance(instanceId, spec, mountPath)
```

(The `-w` flag pre-sets the container's WORKDIR to the resolved mount path. The Dockerfile's `WORKDIR /workspace` is overridden when the mount target differs.)

For the existing-container path, look up the mount path from `docker inspect`:

```ts
async start(spec: SandboxSpec): Promise<SandboxInstance> {
  const existing = await this.findContainerByAgentId(spec.agentId)
  if (existing && existing.running) {
    log.debug(
      { agentId: spec.agentId, instanceId: existing.id },
      `attaching to existing sandbox`
    )
    const mountPath = await this.inspectMountPath(existing.id, spec)
    return this.makeInstance(existing.id, spec, mountPath)
  }
  if (existing && !existing.running) {
    await runDocker([`rm`, `-f`, existing.id])
  }
  // … existing fall-through logic above …
}

private async inspectMountPath(
  instanceId: string,
  spec: SandboxSpec
): Promise<string> {
  if (spec.workspace.type === `volume`) return `/workspace`
  return await realpath(spec.workspace.hostPath)
}
```

Modify `makeInstance` to accept a `mountPath`:

```ts
private makeInstance(
  instanceId: string,
  spec: SandboxSpec,
  mountPath: string
): SandboxInstance {
  return {
    instanceId,
    agentId: spec.agentId,
    workspaceMount: mountPath,
    exec: (args) => execInContainer(instanceId, args, spec.env),
    copyTo: ({ destPath, content, mode = 0o600 }) =>
      copyToContainer(instanceId, destPath, content, mode, spec.env),
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DOCKER=1 pnpm -C packages/coding-agents test --run test/unit/local-docker.test.ts`

Expected: PASS — alignment + volume tests + the existing copyTo test.

- [ ] **Step 5: Commit**

```bash
git add packages/coding-agents/src/providers/local-docker.ts packages/coding-agents/test/unit/local-docker.test.ts
git commit -m "feat(coding-agents): align bind-mount cwd to realpath in LocalDockerProvider

Drops the /workspace remap for bind-mounts so the container cwd matches
the host cwd. Volume workspaces still mount at /workspace. Enables
cross-target resume via aligned ~/.claude/projects/<sanitised-cwd>/
path math (no JSONL rewrite needed). Volume sandboxes are unchanged."
```

---

## Task 6: LifecycleManager — multi-provider routing

**Files:**

- Modify: `packages/coding-agents/src/lifecycle-manager.ts`
- Modify: `packages/coding-agents/test/unit/lifecycle-manager.test.ts`

- [ ] **Step 1: Write failing tests for the new shape**

Replace the contents of `packages/coding-agents/test/unit/lifecycle-manager.test.ts` with:

```ts
import { describe, it, expect, vi } from 'vitest'
import { LifecycleManager } from '../../src/lifecycle-manager'
import type {
  Bridge,
  ExecHandle,
  ExecRequest,
  RecoveredSandbox,
  RunTurnArgs,
  RunTurnResult,
  SandboxInstance,
  SandboxProvider,
  SandboxSpec,
} from '../../src/types'

function fakeProvider(name: `sandbox` | `host`): SandboxProvider & {
  starts: Array<SandboxSpec>
  destroys: Array<string>
} {
  const stub: SandboxInstance = {
    instanceId: `inst-${name}`,
    agentId: ``,
    workspaceMount: `/workspace`,
    async exec(_req: ExecRequest): Promise<ExecHandle> {
      throw new Error(`not used`)
    },
  }
  const fp: any = {
    name,
    starts: [] as Array<SandboxSpec>,
    destroys: [] as Array<string>,
    async start(spec: SandboxSpec): Promise<SandboxInstance> {
      fp.starts.push(spec)
      return { ...stub, agentId: spec.agentId }
    },
    async stop(_id: string): Promise<void> {},
    async destroy(id: string): Promise<void> {
      fp.destroys.push(id)
    },
    async status(_id: string): Promise<`running` | `stopped` | `unknown`> {
      return `running`
    },
    async recover(): Promise<Array<RecoveredSandbox>> {
      return []
    },
  }
  return fp
}

const fakeBridge: Bridge = {
  async runTurn(_args: RunTurnArgs): Promise<RunTurnResult> {
    return { exitCode: 0 }
  },
}

describe(`LifecycleManager target routing`, () => {
  it(`ensureRunning routes to sandbox provider when spec.target='sandbox'`, async () => {
    const sandbox = fakeProvider(`sandbox`)
    const host = fakeProvider(`host`)
    const lm = new LifecycleManager({
      providers: { sandbox, host },
      bridge: fakeBridge,
    })
    await lm.ensureRunning({
      agentId: `/x/coding-agent/y`,
      kind: `claude`,
      target: `sandbox`,
      workspace: { type: `volume`, name: `w` },
      env: {},
    })
    expect(sandbox.starts).toHaveLength(1)
    expect(host.starts).toHaveLength(0)
  })

  it(`ensureRunning routes to host provider when spec.target='host'`, async () => {
    const sandbox = fakeProvider(`sandbox`)
    const host = fakeProvider(`host`)
    const lm = new LifecycleManager({
      providers: { sandbox, host },
      bridge: fakeBridge,
    })
    await lm.ensureRunning({
      agentId: `/x/coding-agent/y`,
      kind: `claude`,
      target: `host`,
      workspace: { type: `bindMount`, hostPath: `/tmp` },
      env: {},
    })
    expect(host.starts).toHaveLength(1)
    expect(sandbox.starts).toHaveLength(0)
  })

  it(`statusFor and destroyFor route to the requested target`, async () => {
    const sandbox = fakeProvider(`sandbox`)
    const host = fakeProvider(`host`)
    const lm = new LifecycleManager({
      providers: { sandbox, host },
      bridge: fakeBridge,
    })
    await lm.statusFor(`/x/coding-agent/y`, `sandbox`)
    await lm.destroyFor(`/x/coding-agent/y`, `host`)
    expect(host.destroys).toEqual([`/x/coding-agent/y`])
    expect(sandbox.destroys).toEqual([])
  })

  it(`adoptRunningContainers merges results from both providers`, async () => {
    const sandbox = fakeProvider(`sandbox`) as any
    sandbox.recover = async () => [
      { agentId: `/a`, instanceId: `s1`, status: `running`, target: `sandbox` },
    ]
    const host = fakeProvider(`host`) as any
    host.recover = async () => [
      { agentId: `/b`, instanceId: `h1`, status: `running`, target: `host` },
    ]
    const lm = new LifecycleManager({
      providers: { sandbox, host },
      bridge: fakeBridge,
    })
    const adopted = await lm.adoptRunningContainers()
    expect(adopted).toHaveLength(2)
    expect(adopted.map((r) => r.target).sort()).toEqual([`host`, `sandbox`])
  })
})

describe(`LifecycleManager pin refcount`, () => {
  it(`increments and decrements with a floor at 0`, () => {
    const lm = new LifecycleManager({
      providers: {
        sandbox: fakeProvider(`sandbox`),
        host: fakeProvider(`host`),
      },
      bridge: fakeBridge,
    })
    expect(lm.pinCount(`a`)).toBe(0)
    expect(lm.pin(`a`).count).toBe(1)
    expect(lm.pin(`a`).count).toBe(2)
    expect(lm.release(`a`).count).toBe(1)
    expect(lm.release(`a`).count).toBe(0)
    expect(lm.release(`a`).count).toBe(0)
  })
})

describe(`LifecycleManager idle timer`, () => {
  it(`arms and fires onFire after ms elapses`, async () => {
    const lm = new LifecycleManager({
      providers: {
        sandbox: fakeProvider(`sandbox`),
        host: fakeProvider(`host`),
      },
      bridge: fakeBridge,
    })
    const onFire = vi.fn()
    lm.armIdleTimer(`a`, 20, onFire)
    await new Promise((r) => setTimeout(r, 50))
    expect(onFire).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -C packages/coding-agents test --run test/unit/lifecycle-manager.test.ts`

Expected: FAIL — constructor type mismatch (`providers` vs. `provider`), `statusFor`/`destroyFor` undefined.

- [ ] **Step 3: Update LifecycleManager**

Replace `packages/coding-agents/src/lifecycle-manager.ts`:

```ts
import { log } from './log'
import type {
  Bridge,
  RecoveredSandbox,
  SandboxInstance,
  SandboxProvider,
  SandboxSpec,
} from './types'

export interface LifecycleManagerDeps {
  providers: { sandbox: SandboxProvider; host: SandboxProvider }
  bridge: Bridge
}

export type Target = `sandbox` | `host`

export class LifecycleManager {
  readonly providers: { sandbox: SandboxProvider; host: SandboxProvider }
  readonly bridge: Bridge
  /** Wall-clock ms captured at construction. Used to detect orphan runs. */
  readonly startedAtMs: number

  private readonly idleTimers = new Map<string, NodeJS.Timeout>()
  private readonly pinCounts = new Map<string, number>()

  constructor(deps: LifecycleManagerDeps) {
    this.providers = deps.providers
    this.bridge = deps.bridge
    this.startedAtMs = Date.now()
  }

  // ── sandbox lifecycle ──

  async ensureRunning(spec: SandboxSpec): Promise<SandboxInstance> {
    return this.providers[spec.target].start(spec)
  }

  async statusFor(
    agentId: string,
    target: Target
  ): Promise<`running` | `stopped` | `unknown`> {
    return this.providers[target].status(agentId)
  }

  async destroyFor(agentId: string, target: Target): Promise<void> {
    this.cancelIdleTimer(agentId)
    await this.providers[target].destroy(agentId).catch((err) => {
      log.warn({ err, agentId, target }, `lifecycleManager.destroyFor failed`)
    })
  }

  async stopFor(agentId: string, target: Target): Promise<void> {
    this.cancelIdleTimer(agentId)
    await this.providers[target].destroy(agentId).catch((err) => {
      log.warn({ err, agentId, target }, `lifecycleManager.stopFor failed`)
    })
  }

  async destroyAndForget(agentId: string, target: Target): Promise<void> {
    await this.destroyFor(agentId, target)
    this.pinCounts.delete(agentId)
  }

  async adoptRunningContainers(): Promise<Array<RecoveredSandbox>> {
    const [a, b] = await Promise.all([
      this.providers.sandbox.recover(),
      this.providers.host.recover(),
    ])
    return [...a, ...b]
  }

  // ── idle timer ──

  armIdleTimer(agentId: string, ms: number, onFire: () => void): void {
    this.cancelIdleTimer(agentId)
    const handle = setTimeout(() => {
      this.idleTimers.delete(agentId)
      try {
        onFire()
      } catch (err) {
        log.warn({ err, agentId }, `idle timer onFire threw`)
      }
    }, ms)
    this.idleTimers.set(agentId, handle)
  }

  cancelIdleTimer(agentId: string): void {
    const handle = this.idleTimers.get(agentId)
    if (handle) {
      clearTimeout(handle)
      this.idleTimers.delete(agentId)
    }
  }

  // ── pin refcount ──

  pin(agentId: string): { count: number } {
    const next = (this.pinCounts.get(agentId) ?? 0) + 1
    this.pinCounts.set(agentId, next)
    if (next === 1) this.cancelIdleTimer(agentId)
    return { count: next }
  }

  release(agentId: string): { count: number } {
    const cur = this.pinCounts.get(agentId) ?? 0
    const next = Math.max(0, cur - 1)
    if (next === 0) this.pinCounts.delete(agentId)
    else this.pinCounts.set(agentId, next)
    return { count: next }
  }

  pinCount(agentId: string): number {
    return this.pinCounts.get(agentId) ?? 0
  }

  resetPinCount(agentId: string): void {
    this.pinCounts.delete(agentId)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C packages/coding-agents test --run test/unit/lifecycle-manager.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/coding-agents/src/lifecycle-manager.ts packages/coding-agents/test/unit/lifecycle-manager.test.ts
git commit -m "feat(coding-agents): make LifecycleManager target-aware (sandbox/host providers)

ensureRunning routes by spec.target. New statusFor/destroyFor/stopFor
take an explicit target parameter (handler passes meta.target).
adoptRunningContainers merges recover() from both providers."
```

---

## Task 7: Handler — wire `target` through reconcile and processPrompt

**Files:**

- Modify: `packages/coding-agents/src/entity/handler.ts`

- [ ] **Step 1: Update first-wake init to persist `target`**

In `packages/coding-agents/src/entity/handler.ts`, modify the args-typing block and the `initial` SessionMetaRow assembly inside the first-wake branch:

```ts
const args = ctx.args as {
  kind?: `claude`
  target?: `sandbox` | `host`
  workspaceType?: `volume` | `bindMount`
  workspaceName?: string
  workspaceHostPath?: string
  importNativeSessionId?: string
  idleTimeoutMs?: number
  keepWarm?: boolean
}
const target = args.target ?? `sandbox`
const ws =
  args.workspaceType === `bindMount`
    ? {
        type: `bindMount` as const,
        hostPath: args.workspaceHostPath ?? process.cwd(),
      }
    : { type: `volume` as const, name: args.workspaceName }

if (target === `host` && ws.type !== `bindMount`) {
  const initial: SessionMetaRow = {
    key: `current`,
    status: `error`,
    kind: args.kind ?? `claude`,
    target,
    pinned: false,
    workspaceIdentity: `error:host-requires-bindMount`,
    workspaceSpec: { type: `volume`, name: `none` },
    idleTimeoutMs: options.defaults.idleTimeoutMs,
    keepWarm: false,
    lastError: `target='host' requires workspaceType='bindMount'`,
  }
  ctx.db.actions.sessionMeta_insert({ row: initial })
  return
}

const resolved = await WorkspaceRegistry.resolveIdentity(agentId, ws)
const idleTimeoutMs = args.idleTimeoutMs ?? options.defaults.idleTimeoutMs
const keepWarm = args.keepWarm ?? false
const initial: SessionMetaRow = {
  key: `current`,
  status: `cold`,
  kind: args.kind ?? `claude`,
  target,
  pinned: false,
  workspaceIdentity: resolved.identity,
  workspaceSpec: resolved.resolved,
  idleTimeoutMs,
  keepWarm,
}
ctx.db.actions.sessionMeta_insert({ row: initial })
wr.register(resolved.identity, agentId)
meta = initial
```

- [ ] **Step 2: Replace `lm.provider.status(agentId)` with `lm.statusFor(agentId, meta.target)`**

In the reconcile block:

```ts
const providerStatus = await lm.statusFor(agentId, meta.target)
```

- [ ] **Step 3: Pass `target` into `SandboxSpec` at every `lm.ensureRunning` call**

In `processPrompt`:

```ts
sandbox = await raceTimeout(
  lm.ensureRunning({
    agentId,
    kind: meta.kind,
    target: meta.target,
    workspace: meta.workspaceSpec,
    env: options.env(),
  }),
  options.defaults.coldBootBudgetMs
)
```

- [ ] **Step 4: Update idle-timer destroy callback and processStop/processDestroy**

Replace `lm.provider.destroy(agentId)` calls with `lm.destroyFor(agentId, meta.target)` (idle-timer fire and processRelease's idle-eviction path) and `lm.stop(agentId)` with `lm.stopFor(agentId, meta.target)` in `processStop`.

In `processPrompt` (idle timer), capture `meta.target` outside the closure:

```ts
const finalMeta = sessionMetaCol.get(`current`) as SessionMetaRow
if (!finalMeta.keepWarm && lm.pinCount(agentId) === 0) {
  const target = finalMeta.target
  lm.armIdleTimer(agentId, finalMeta.idleTimeoutMs, () => {
    void lm.destroyFor(agentId, target).catch((err) => {
      log.warn({ err, agentId, target }, `idle stop failed`)
    })
  })
}
```

In `processRelease`:

```ts
if (count === 0) {
  const meta = ctx.db.collections.sessionMeta.get(`current`) as SessionMetaRow
  if (!meta.keepWarm && meta.status === `idle`) {
    const target = meta.target
    lm.armIdleTimer(agentId, meta.idleTimeoutMs, () => {
      void lm.destroyFor(agentId, target).catch(() => undefined)
    })
  }
}
```

In `processStop`:

```ts
const meta = ctx.db.collections.sessionMeta.get(`current`) as SessionMetaRow
ctx.db.actions.sessionMeta_update({
  key: `current`,
  updater: (d: SessionMetaRow) => {
    d.status = `stopping`
  },
})
await lm.stopFor(agentId, meta.target)
```

In `processDestroy`:

```ts
const meta = ctx.db.collections.sessionMeta.get(`current`) as SessionMetaRow
await lm.destroyAndForget(agentId, meta.target)
if (meta) wr.release(meta.workspaceIdentity, agentId)
```

- [ ] **Step 5: Run typecheck**

Run: `pnpm -C packages/coding-agents typecheck 2>&1 | head -40`

Expected: clean (no errors). If there are residual `lm.provider` references, fix them now.

- [ ] **Step 6: Run the existing handler tests**

Run: `pnpm -C packages/coding-agents test --run test/unit/entity-handler.test.ts test/unit/handler-resume.test.ts`

Expected: most existing tests fail because they construct `LifecycleManager({ provider: ..., bridge })`. Convert them to the new shape — search-and-replace `provider:` → `providers: { sandbox: ..., host: makeFakeProvider() }` (host can be a stub that throws). Add `target: 'sandbox'` to any meta literals or args literals lacking it.

- [ ] **Step 7: Run handler tests again**

Run: `pnpm -C packages/coding-agents test --run test/unit/entity-handler.test.ts test/unit/handler-resume.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/coding-agents/src/entity/handler.ts packages/coding-agents/test/unit/entity-handler.test.ts packages/coding-agents/test/unit/handler-resume.test.ts
git commit -m "feat(coding-agents): thread target through handler reconcile/lifecycle calls"
```

---

## Task 8: Schema additions in `register.ts` + multi-provider deps

**Files:**

- Modify: `packages/coding-agents/src/entity/register.ts`

- [ ] **Step 1: Update `creationArgsSchema`**

In `packages/coding-agents/src/entity/register.ts`:

```ts
const creationArgsSchema = z.object({
  kind: z.enum([`claude`]).optional(),
  target: z.enum([`sandbox`, `host`]).optional(),
  workspaceType: z.enum([`volume`, `bindMount`]).optional(),
  workspaceName: z.string().optional(),
  workspaceHostPath: z.string().optional(),
  importNativeSessionId: z.string().optional(),
  idleTimeoutMs: z.number().optional(),
  keepWarm: z.boolean().optional(),
})
```

- [ ] **Step 2: Update `RegisterCodingAgentDeps` and constructor wiring**

```ts
export interface RegisterCodingAgentDeps {
  providers: { sandbox: SandboxProvider; host: SandboxProvider }
  bridge: Bridge
  defaults?: Partial<{
    idleTimeoutMs: number
    coldBootBudgetMs: number
    runTimeoutMs: number
  }>
  env?: () => Record<string, string>
  wakeEntity?: (agentId: string) => void
}

export function registerCodingAgent(
  registry: EntityRegistry,
  deps: RegisterCodingAgentDeps
): void {
  const lm = new LifecycleManager({
    providers: deps.providers,
    bridge: deps.bridge,
  })
  // ... rest unchanged
}
```

Update the description string in `registry.define`:

```ts
description: `Runs a Claude Code CLI session via Docker (target='sandbox') or directly on the host (target='host'). Manages lifecycle (cold/idle/running) and workspace lease.`,
```

- [ ] **Step 3: Run typecheck and commit**

```bash
pnpm -C packages/coding-agents typecheck
git add packages/coding-agents/src/entity/register.ts
git commit -m "feat(coding-agents): registerCodingAgent takes providers map; spawn args gain target/import"
```

---

## Task 9: Validation tests for `target` and `importNativeSessionId`

**Files:**

- Modify: `packages/coding-agents/test/unit/entity-handler.test.ts`

- [ ] **Step 1: Add validation tests**

Append to `packages/coding-agents/test/unit/entity-handler.test.ts`:

```ts
describe(`entity handler — target validation`, () => {
  it(`target='host' with workspaceType='volume' fails into error state`, async () => {
    const lm = new LifecycleManager({
      providers: {
        sandbox: makeFakeProvider(),
        host: makeFakeProvider(),
      },
      bridge: {
        async runTurn() {
          return { exitCode: 0 }
        },
      },
    })
    const wr = new WorkspaceRegistry()
    const handler = makeCodingAgentHandler(lm, wr, {
      defaults: {
        idleTimeoutMs: 1000,
        coldBootBudgetMs: 5000,
        runTimeoutMs: 5000,
      },
      env: () => ({}),
    })
    const { ctx } = makeFakeCtx({
      entityUrl: `/t/coding-agent/x`,
      args: {
        kind: `claude`,
        target: `host`,
        workspaceType: `volume`,
        workspaceName: `w`,
      },
    })
    await handler(ctx, { type: `message_received` } as any)
    const meta = ctx.db.collections.sessionMeta.get(`current`)
    expect(meta.status).toBe(`error`)
    expect(meta.lastError).toMatch(/host.*bindMount/)
  })

  it(`target='sandbox' with importNativeSessionId fails into error state`, async () => {
    const lm = new LifecycleManager({
      providers: { sandbox: makeFakeProvider(), host: makeFakeProvider() },
      bridge: {
        async runTurn() {
          return { exitCode: 0 }
        },
      },
    })
    const wr = new WorkspaceRegistry()
    const handler = makeCodingAgentHandler(lm, wr, {
      defaults: {
        idleTimeoutMs: 1000,
        coldBootBudgetMs: 5000,
        runTimeoutMs: 5000,
      },
      env: () => ({}),
    })
    const { ctx } = makeFakeCtx({
      entityUrl: `/t/coding-agent/x`,
      args: {
        kind: `claude`,
        target: `sandbox`,
        workspaceType: `bindMount`,
        workspaceHostPath: `/tmp`,
        importNativeSessionId: `abc-123`,
      },
    })
    await handler(ctx, { type: `message_received` } as any)
    const meta = ctx.db.collections.sessionMeta.get(`current`)
    expect(meta.status).toBe(`error`)
    expect(meta.lastError).toMatch(/importNativeSessionId.*host/)
  })
})
```

- [ ] **Step 2: Run tests — they should fail (validation not yet added)**

Run: `pnpm -C packages/coding-agents test --run test/unit/entity-handler.test.ts -t "target validation"`

Expected: FAIL — second test case (sandbox+import) doesn't error.

- [ ] **Step 3: Add the importNativeSessionId+sandbox check**

In `packages/coding-agents/src/entity/handler.ts`, in the first-wake init block, _before_ the `host requires bindMount` check, add:

```ts
if (args.importNativeSessionId && target !== `host`) {
  const initial: SessionMetaRow = {
    key: `current`,
    status: `error`,
    kind: args.kind ?? `claude`,
    target,
    pinned: false,
    workspaceIdentity: `error:import-requires-host`,
    workspaceSpec: { type: `volume`, name: `none` },
    idleTimeoutMs: options.defaults.idleTimeoutMs,
    keepWarm: false,
    lastError: `importNativeSessionId requires target='host'`,
  }
  ctx.db.actions.sessionMeta_insert({ row: initial })
  return
}
```

- [ ] **Step 4: Run tests — they should pass**

Run: `pnpm -C packages/coding-agents test --run test/unit/entity-handler.test.ts`

Expected: PASS for the new validation tests and all existing ones.

- [ ] **Step 5: Commit**

```bash
git add packages/coding-agents/src/entity/handler.ts packages/coding-agents/test/unit/entity-handler.test.ts
git commit -m "feat(coding-agents): validate target/import combos at first-wake init"
```

---

## Task 10: Import flow — read host JSONL into nativeJsonl on first wake

**Files:**

- Modify: `packages/coding-agents/src/entity/handler.ts`
- Modify: `packages/coding-agents/test/unit/entity-handler.test.ts`

- [ ] **Step 1: Write a failing test for the import flow**

Append to `packages/coding-agents/test/unit/entity-handler.test.ts`:

```ts
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { realpath } from 'node:fs/promises'

describe(`entity handler — importNativeSessionId flow`, () => {
  it(`reads the JSONL from ~/.claude/projects and seeds nativeJsonl`, async () => {
    const fakeHome = await mkdtemp(join(tmpdir(), `home-`))
    const workspace = await mkdtemp(join(tmpdir(), `ws-`))
    const realWorkspace = await realpath(workspace)
    const sanitised = realWorkspace.replace(/\//g, `-`)
    const projectDir = join(fakeHome, `.claude`, `projects`, sanitised)
    await mkdir(projectDir, { recursive: true })
    const sessionId = `imported-abc`
    const transcript = `{"type":"system","subtype":"init"}\n`
    await writeFile(join(projectDir, `${sessionId}.jsonl`), transcript)

    try {
      const lm = new LifecycleManager({
        providers: { sandbox: makeFakeProvider(), host: makeFakeProvider() },
        bridge: {
          async runTurn() {
            return { exitCode: 0 }
          },
        },
      })
      const wr = new WorkspaceRegistry()
      const handler = makeCodingAgentHandler(lm, wr, {
        defaults: {
          idleTimeoutMs: 1000,
          coldBootBudgetMs: 5000,
          runTimeoutMs: 5000,
        },
        env: () => ({}),
        homeDir: fakeHome,
      })
      const { ctx } = makeFakeCtx({
        entityUrl: `/t/coding-agent/imp-${Date.now()}`,
        args: {
          kind: `claude`,
          target: `host`,
          workspaceType: `bindMount`,
          workspaceHostPath: workspace,
          importNativeSessionId: sessionId,
        },
      })
      await handler(ctx, { type: `message_received` } as any)
      const meta = ctx.db.collections.sessionMeta.get(`current`)
      expect(meta.status).toBe(`cold`)
      expect(meta.nativeSessionId).toBe(sessionId)
      const row = ctx.db.collections.nativeJsonl.get(`current`)
      expect(row).toBeDefined()
      expect(row.nativeSessionId).toBe(sessionId)
      expect(row.content).toBe(transcript)
      const rows = ctx.db.collections.lifecycle.toArray
      const restored = rows.find((r: any) => r.event === `import.restored`)
      expect(restored).toBeDefined()
    } finally {
      await rm(fakeHome, { recursive: true, force: true })
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it(`missing JSONL → status=error and lifecycle import.failed row`, async () => {
    const fakeHome = await mkdtemp(join(tmpdir(), `home-`))
    const workspace = await mkdtemp(join(tmpdir(), `ws-`))
    try {
      const lm = new LifecycleManager({
        providers: { sandbox: makeFakeProvider(), host: makeFakeProvider() },
        bridge: {
          async runTurn() {
            return { exitCode: 0 }
          },
        },
      })
      const wr = new WorkspaceRegistry()
      const handler = makeCodingAgentHandler(lm, wr, {
        defaults: {
          idleTimeoutMs: 1000,
          coldBootBudgetMs: 5000,
          runTimeoutMs: 5000,
        },
        env: () => ({}),
        homeDir: fakeHome,
      })
      const { ctx } = makeFakeCtx({
        entityUrl: `/t/coding-agent/missing-${Date.now()}`,
        args: {
          kind: `claude`,
          target: `host`,
          workspaceType: `bindMount`,
          workspaceHostPath: workspace,
          importNativeSessionId: `does-not-exist`,
        },
      })
      await handler(ctx, { type: `message_received` } as any)
      const meta = ctx.db.collections.sessionMeta.get(`current`)
      expect(meta.status).toBe(`error`)
      expect(meta.lastError).toMatch(/imported session file not found/)
      const failed = ctx.db.collections.lifecycle.toArray.find(
        (r: any) => r.event === `import.failed`
      )
      expect(failed).toBeDefined()
    } finally {
      await rm(fakeHome, { recursive: true, force: true })
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run tests — they should fail (no import flow yet)**

Run: `pnpm -C packages/coding-agents test --run test/unit/entity-handler.test.ts -t "importNativeSessionId flow"`

Expected: FAIL — `homeDir` option not supported, import not implemented.

- [ ] **Step 3: Implement the import flow**

In `packages/coding-agents/src/entity/handler.ts`:

a. Add `homeDir?: string` to `CodingAgentHandlerOptions`. Default to `os.homedir()` at use-site.

b. After the workspace identity is resolved and `meta` is set with `status: 'cold'`, add the import block (still inside the first-wake init):

```ts
if (args.importNativeSessionId && target === `host`) {
  const home = options.homeDir ?? os.homedir()
  const realWorkspace = await realpath(args.workspaceHostPath ?? process.cwd())
  const projectDir = sanitiseCwd(realWorkspace)
  const sessionPath = path.join(
    home,
    `.claude`,
    `projects`,
    projectDir,
    `${args.importNativeSessionId}.jsonl`
  )
  try {
    const content = await fs.readFile(sessionPath, `utf8`)
    ctx.db.actions.nativeJsonl_insert({
      row: {
        key: `current`,
        nativeSessionId: args.importNativeSessionId,
        content,
      } satisfies NativeJsonlRow,
    })
    ctx.db.actions.sessionMeta_update({
      key: `current`,
      updater: (d: SessionMetaRow) => {
        d.nativeSessionId = args.importNativeSessionId
      },
    })
    ctx.db.actions.lifecycle_insert({
      row: {
        key: lifecycleKey(`import`),
        ts: Date.now(),
        event: `import.restored`,
        detail: `bytes=${content.length}`,
      } satisfies LifecycleRow,
    })
    meta = sessionMetaCol.get(`current`) as SessionMetaRow
  } catch (err) {
    const msg =
      err instanceof Error && (err as any).code === `ENOENT`
        ? `imported session file not found at ${sessionPath}`
        : `imported session read failed: ${err instanceof Error ? err.message : String(err)}`
    ctx.db.actions.sessionMeta_update({
      key: `current`,
      updater: (d: SessionMetaRow) => {
        d.status = `error`
        d.lastError = msg
      },
    })
    ctx.db.actions.lifecycle_insert({
      row: {
        key: lifecycleKey(`import`),
        ts: Date.now(),
        event: `import.failed`,
        detail: msg,
      } satisfies LifecycleRow,
    })
    return
  }
}
```

c. Add the imports at the top of the file:

```ts
import { promises as fs } from 'node:fs'
import { realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
```

(Avoid duplicating already-present imports — search the file first.)

- [ ] **Step 4: Run tests — they should pass**

Run: `pnpm -C packages/coding-agents test --run test/unit/entity-handler.test.ts -t "importNativeSessionId flow"`

Expected: PASS for both cases.

- [ ] **Step 5: Run the entire unit suite**

Run: `pnpm -C packages/coding-agents test --run test/unit/`

Expected: PASS for all unit tests.

- [ ] **Step 6: Commit**

```bash
git add packages/coding-agents/src/entity/handler.ts packages/coding-agents/test/unit/entity-handler.test.ts
git commit -m "feat(coding-agents): import host Claude sessions on first wake via importNativeSessionId

Reads ~/.claude/projects/<sanitised-realpath>/<id>.jsonl from disk into
nativeJsonl + sets sessionMeta.nativeSessionId. Missing or unreadable
file → error + lifecycle import.failed row."
```

---

## Task 11: Export `HostProvider` and update bootstrap wiring

**Files:**

- Modify: `packages/coding-agents/src/index.ts`
- Modify: `packages/agents/src/bootstrap.ts`

- [ ] **Step 1: Add the export**

In `packages/coding-agents/src/index.ts`, after `LocalDockerProvider`:

```ts
export { LocalDockerProvider } from './providers/local-docker'
export { HostProvider } from './providers/host'
```

- [ ] **Step 2: Update bootstrap wiring**

In `packages/agents/src/bootstrap.ts`, modify the `registerCodingAgent` call:

```ts
import {
  LocalDockerProvider,
  HostProvider,
  StdioBridge,
  registerCodingAgent,
} from '@electric-ax/coding-agents'

// ...

registerCodingAgent(registry, {
  providers: {
    sandbox: new LocalDockerProvider(),
    host: new HostProvider(),
  },
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
```

- [ ] **Step 3: Build coding-agents and run typecheck**

Run:

```bash
pnpm -C packages/coding-agents build
pnpm -C packages/agents typecheck
```

Expected: both green.

- [ ] **Step 4: Commit**

```bash
git add packages/coding-agents/src/index.ts packages/agents/src/bootstrap.ts
git commit -m "feat(coding-agents): export HostProvider; bootstrap wires both providers"
```

---

## Task 12: CLI — `electric-ax import-claude`

**Files:**

- Create: `packages/coding-agents/src/cli/import-claude.ts`
- Create: `packages/coding-agents/test/unit/cli-import.test.ts`
- Modify: `packages/coding-agents/package.json`
- Modify: `packages/coding-agents/tsdown.config.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/coding-agents/test/unit/cli-import.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runImportCli } from '../../src/cli/import-claude'

describe(`runImportCli`, () => {
  it(`builds the correct PUT body and URL`, async () => {
    const home = await mkdtemp(join(tmpdir(), `cli-home-`))
    const ws = await mkdtemp(join(tmpdir(), `cli-ws-`))
    const sanitised = (await realpath(ws)).replace(/\//g, `-`)
    const projectDir = join(home, `.claude`, `projects`, sanitised)
    await mkdir(projectDir, { recursive: true })
    await writeFile(join(projectDir, `s1.jsonl`), `{"k":"v"}\n`)

    const fetchMock = vi.fn(async (url: string, init: any) => {
      return new Response(JSON.stringify({ url: `/test/coding-agent/imp-1` }), {
        status: 200,
      })
    })

    try {
      const result = await runImportCli({
        argv: [
          `--workspace`,
          ws,
          `--session-id`,
          `s1`,
          `--server`,
          `http://localhost:9999`,
          `--agent-id`,
          `imp-1`,
        ],
        homeDir: home,
        fetchFn: fetchMock as any,
      })
      expect(result.exitCode).toBe(0)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]!
      expect(url).toMatch(/\/coding-agent\/imp-1$/)
      expect(init.method).toBe(`PUT`)
      const body = JSON.parse(init.body)
      expect(body.target).toBe(`host`)
      expect(body.workspaceType).toBe(`bindMount`)
      expect(body.workspaceHostPath).toBe(ws)
      expect(body.importNativeSessionId).toBe(`s1`)
    } finally {
      await rm(home, { recursive: true, force: true })
      await rm(ws, { recursive: true, force: true })
    }
  })

  it(`fails fast when the JSONL file is missing on disk`, async () => {
    const home = await mkdtemp(join(tmpdir(), `cli-home-`))
    const ws = await mkdtemp(join(tmpdir(), `cli-ws-`))
    const fetchMock = vi.fn()
    try {
      const result = await runImportCli({
        argv: [`--workspace`, ws, `--session-id`, `nope`],
        homeDir: home,
        fetchFn: fetchMock as any,
      })
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toMatch(/not found/)
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      await rm(home, { recursive: true, force: true })
      await rm(ws, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run test — should fail (file doesn't exist)**

Run: `pnpm -C packages/coding-agents test --run test/unit/cli-import.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the CLI**

Create `packages/coding-agents/src/cli/import-claude.ts`:

```ts
import { parseArgs } from 'node:util'
import { stat, access, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export interface RunImportCliOptions {
  argv: Array<string>
  homeDir?: string
  fetchFn?: typeof fetch
}

export interface RunImportCliResult {
  exitCode: number
  stdout: string
  stderr: string
}

function sanitiseCwd(p: string): string {
  return p.replace(/\//g, `-`)
}

function slugifyForName(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9_.-]/g, `-`)
    .replace(/-+/g, `-`)
    .replace(/^[-_.]+/, ``)
    .replace(/[-_.]+$/, ``)
}

export async function runImportCli(
  opts: RunImportCliOptions
): Promise<RunImportCliResult> {
  const { values } = parseArgs({
    args: opts.argv,
    options: {
      workspace: { type: `string` },
      'session-id': { type: `string` },
      'agent-id': { type: `string` },
      server: { type: `string` },
    },
    allowPositionals: false,
  })

  const workspace = values.workspace
  const sessionId = values[`session-id`]
  if (!workspace || !sessionId) {
    return {
      exitCode: 2,
      stdout: ``,
      stderr: `usage: electric-ax import-claude --workspace <path> --session-id <id> [--agent-id <name>] [--server <url>]\n`,
    }
  }

  const home = opts.homeDir ?? os.homedir()
  const fetchFn = opts.fetchFn ?? fetch

  // Validate workspace exists
  try {
    const s = await stat(workspace)
    if (!s.isDirectory()) {
      return {
        exitCode: 1,
        stdout: ``,
        stderr: `workspace is not a directory: ${workspace}\n`,
      }
    }
  } catch (err) {
    return {
      exitCode: 1,
      stdout: ``,
      stderr: `workspace not accessible: ${workspace}\n`,
    }
  }

  // Validate JSONL exists
  const real = await realpath(workspace)
  const sessionFile = path.join(
    home,
    `.claude`,
    `projects`,
    sanitiseCwd(real),
    `${sessionId}.jsonl`
  )
  try {
    await access(sessionFile)
  } catch {
    return {
      exitCode: 1,
      stdout: ``,
      stderr: `session JSONL not found at ${sessionFile}\n`,
    }
  }

  const agentName = values[`agent-id`] ?? `import-${slugifyForName(sessionId)}`
  const server = values.server ?? `http://localhost:4437`
  const url = `${server.replace(/\/$/, ``)}/coding-agent/${agentName}`

  const body = {
    kind: `claude`,
    target: `host`,
    workspaceType: `bindMount`,
    workspaceHostPath: workspace,
    importNativeSessionId: sessionId,
  }

  const res = await fetchFn(url, {
    method: `PUT`,
    headers: { 'content-type': `application/json` },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => ``)
    return {
      exitCode: 1,
      stdout: ``,
      stderr: `spawn request failed: ${res.status} ${text}\n`,
    }
  }

  return {
    exitCode: 0,
    stdout: `imported as /coding-agent/${agentName}\n`,
    stderr: ``,
  }
}

// Direct invocation entrypoint
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith(`import-claude.js`)
if (isMain) {
  runImportCli({ argv: process.argv.slice(2) }).then(
    (r) => {
      if (r.stdout) process.stdout.write(r.stdout)
      if (r.stderr) process.stderr.write(r.stderr)
      process.exit(r.exitCode)
    },
    (err) => {
      process.stderr.write(`unexpected error: ${err}\n`)
      process.exit(1)
    }
  )
}
```

- [ ] **Step 4: Run test — should pass**

Run: `pnpm -C packages/coding-agents test --run test/unit/cli-import.test.ts`

Expected: PASS.

- [ ] **Step 5: Add tsdown entry and bin**

In `packages/coding-agents/tsdown.config.ts`:

```ts
import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: [`./src/index.ts`],
    outDir: `dist`,
    format: [`esm`, `cjs`],
    dts: true,
    clean: true,
    sourcemap: true,
  },
  {
    entry: [`./src/cli/import-claude.ts`],
    outDir: `dist/cli`,
    format: [`esm`],
    dts: false,
    sourcemap: true,
  },
])
```

In `packages/coding-agents/package.json`, add:

```json
"bin": {
  "electric-ax-import-claude": "./dist/cli/import-claude.js"
},
```

(Place after `"types"` and before `"scripts"`.)

- [ ] **Step 6: Build and smoke-test the CLI**

Run:

```bash
pnpm -C packages/coding-agents build
node packages/coding-agents/dist/cli/import-claude.js
```

Expected: stderr usage banner, exit code 2.

- [ ] **Step 7: Commit**

```bash
git add packages/coding-agents/src/cli/import-claude.ts packages/coding-agents/test/unit/cli-import.test.ts packages/coding-agents/package.json packages/coding-agents/tsdown.config.ts
git commit -m "feat(coding-agents): add electric-ax-import-claude CLI

Thin wrapper that PUTs the entity-spawn endpoint with target='host',
workspaceType='bindMount', and importNativeSessionId. Validates the
on-disk JSONL exists before dispatching."
```

---

## Task 13: Update existing handler-resume tests for new shape

**Files:**

- Modify: `packages/coding-agents/test/unit/handler-resume.test.ts`
- Modify: `packages/coding-agents/test/unit/stdio-bridge-resume.test.ts` (if needed)

- [ ] **Step 1: Update test fixtures**

In `packages/coding-agents/test/unit/handler-resume.test.ts`:

- Add `target: 'sandbox'` to every meta literal that constructs a `SessionMetaRow`.
- The `makeMinimalLm` fake should expose `statusFor`/`destroyFor`/`stopFor` instead of `provider.status` and `provider.destroy`. Update those to forward to the existing mocks.
- Confirm the `sandbox.workspaceMount` path in the test stays `/workspace` (the test uses a volume conceptually); verify the `materialiseResume` invocation pattern still triggers.

Example diff for `makeMinimalLm`:

```ts
function makeMinimalLm(sandbox: SandboxInstance) {
  const lm = {
    startedAtMs: Date.now(),
    providers: {
      sandbox: {
        status: vi.fn().mockResolvedValue(`stopped`),
        destroy: vi.fn().mockResolvedValue(undefined),
      },
      host: {
        status: vi.fn().mockResolvedValue(`unknown`),
        destroy: vi.fn().mockResolvedValue(undefined),
      },
    },
    bridge: {
      runTurn: vi.fn().mockResolvedValue({
        nativeSessionId: `native-1`,
        finalText: `reply`,
        exitCode: 0,
      }),
    },
    ensureRunning: vi.fn().mockResolvedValue(sandbox),
    statusFor: vi.fn().mockResolvedValue(`stopped`),
    stopFor: vi.fn().mockResolvedValue(undefined),
    destroyFor: vi.fn().mockResolvedValue(undefined),
    destroyAndForget: vi.fn().mockResolvedValue(undefined),
    pin: vi.fn().mockReturnValue({ count: 1 }),
    release: vi.fn().mockReturnValue({ count: 0 }),
    pinCount: vi.fn().mockReturnValue(0),
    armIdleTimer: vi.fn(),
  }
  return lm as unknown as LifecycleManager
}
```

- [ ] **Step 2: Run the resume tests**

Run: `pnpm -C packages/coding-agents test --run test/unit/handler-resume.test.ts test/unit/stdio-bridge-resume.test.ts`

Expected: PASS.

- [ ] **Step 3: Run the full unit suite as a sanity check**

Run: `pnpm -C packages/coding-agents test --run`

Expected: PASS — all unit tests.

- [ ] **Step 4: Commit**

```bash
git add packages/coding-agents/test/
git commit -m "test(coding-agents): adapt resume-flow fixtures to multi-provider LifecycleManager"
```

---

## Task 14: Documentation updates

**Files:**

- Modify: `website/docs/agents/entities/coding-agent.md`
- Modify: `docs/agents-development.md`

- [ ] **Step 1: Update the entity reference**

In `website/docs/agents/entities/coding-agent.md`, change the opening summary:

Old:

> `coding-agent` is the built-in entity type for long-lived, sandboxed Claude Code sessions. Each agent runs the `claude` CLI inside a Docker container with a persistent workspace volume.

New:

> `coding-agent` is the built-in entity type for long-lived Claude Code sessions. By default each agent runs the `claude` CLI inside a Docker container with a persistent workspace (`target: 'sandbox'`); you can also opt into running directly on the host machine with no isolation (`target: 'host'`), which is useful for importing existing local Claude sessions or for environments where Docker is unavailable.

- [ ] **Step 2: Add a "Target" section**

Insert a new H2 section between "When to use it" and "Lifecycle" titled `## Target`. Include:

- A short explanation of the two targets (sandbox vs. host).
- The trust tradeoff: host mode runs as the user with full filesystem/network access — pick it when you want to import a local Claude session, or when sandbox isolation isn't required/possible.
- Constraints: `target: 'host'` requires `workspaceType: 'bindMount'`. `target: 'sandbox'` supports both `volume` and `bindMount`. Volume workspaces are sandbox-only.
- The aligned-cwd note: bind-mount sandboxes mount the host path at the same path inside the container, so `~/.claude/projects/<sanitised-cwd>/...` matches across targets.

- [ ] **Step 3: Add an "Importing a host session" section**

After the "Target" section, add `## Importing a host session`:

- The spawn-arg flow: `target: 'host'`, `workspaceType: 'bindMount'`, `workspaceHostPath`, `importNativeSessionId: '<id>'` — the handler reads `~/.claude/projects/<sanitised-realpath>/<id>.jsonl` on first wake.
- The CLI shortcut:

  ```sh
  pnpm -C packages/coding-agents build
  electric-ax-import-claude \
    --workspace /path/to/proj \
    --session-id <claude-session-id>
  ```

- One-line caveat: host-target writes the captured transcript back into the user's real `~/.claude/projects/...` after each turn (that's where `claude --resume` reads from); imported sessions stay in sync with what claude already maintains there.

- [ ] **Step 4: Update spawn args table**

If the page has a spawn-args reference (it does — search for `workspaceType` to find it), add rows for `target` and `importNativeSessionId` with the same shape as existing rows.

- [ ] **Step 5: Lifecycle diagram caveat**

In the "Lifecycle" section, add a one-paragraph note: "For `target: 'host'`, the `STARTING` step is essentially a noop (no container to start), but the state machine still cycles through it for consistency with the sandbox target."

- [ ] **Step 6: Update agents-development.md**

In `docs/agents-development.md`, find the "Developing Electric Agents" or coding-agent dev iteration section. Add a paragraph:

> For dev iteration without rebuilding the Docker image, spawn coding-agents with `target: 'host'` and a bind-mount workspace. The agent runs `claude` directly on the host with no isolation; the lifecycle, persistence, and resume behavior are otherwise identical to the sandbox target.

- [ ] **Step 7: Commit**

```bash
git add website/docs/agents/entities/coding-agent.md docs/agents-development.md
git commit -m "docs(coding-agents): document target and host-session import"
```

---

## Task 15: Integration test — host provider end-to-end

**Files:**

- Create: `packages/coding-agents/test/integration/host-provider.test.ts`
- Modify: `packages/coding-agents/package.json` (add a script)

- [ ] **Step 1: Write the test**

Create `packages/coding-agents/test/integration/host-provider.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HostProvider } from '../../src/providers/host'
import { StdioBridge } from '../../src/bridge/stdio-bridge'

const SHOULD_RUN = process.env.HOST_PROVIDER === `1`
const describeMaybe = SHOULD_RUN ? describe : describe.skip

describeMaybe(`HostProvider integration`, () => {
  it(`runs a one-turn claude prompt on the host with a bind-mount workspace`, async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error(`ANTHROPIC_API_KEY required for integration`)
    const ws = await mkdtemp(join(tmpdir(), `host-int-`))
    const provider = new HostProvider()
    const bridge = new StdioBridge()
    const agentId = `/test/coding-agent/host-int-${Date.now().toString(36)}`
    try {
      const sandbox = await provider.start({
        agentId,
        kind: `claude`,
        target: `host`,
        workspace: { type: `bindMount`, hostPath: ws },
        env: { ANTHROPIC_API_KEY: apiKey },
      })
      const events: any[] = []
      const result = await bridge.runTurn({
        sandbox,
        kind: `claude`,
        prompt: `reply with the single word: ok`,
        model: `claude-haiku-4-5-20251001`,
        onEvent: (e) => events.push(e),
      })
      expect(result.exitCode).toBe(0)
      expect(result.nativeSessionId).toBeTruthy()
      // claude wrote the transcript into the user's home
      // (we don't assert the exact path — just that some assistant_message arrived).
      const assistant = events.find((e) => e.type === `assistant_message`)
      expect(assistant).toBeDefined()
    } finally {
      await provider.destroy(agentId)
      await rm(ws, { recursive: true, force: true })
    }
  }, 120_000)
})
```

- [ ] **Step 2: Add a package script**

In `packages/coding-agents/package.json` `"scripts"`:

```json
"test:integration:host": "HOST_PROVIDER=1 vitest run test/integration/host-provider.test.ts"
```

- [ ] **Step 3: Verify the test runs locally (with `ANTHROPIC_API_KEY` set)**

Run from repo root with the API key in env:

```bash
HOST_PROVIDER=1 pnpm -C packages/coding-agents test --run test/integration/host-provider.test.ts
```

Expected: PASS — claude runs on host, exits 0, an `assistant_message` event is captured.

If it fails because `claude` isn't on PATH: install it globally (`npm install -g @anthropic-ai/claude-code`) or set `PATH` so the test can find it.

- [ ] **Step 4: Verify the test is skipped when the gate is off**

Run: `pnpm -C packages/coding-agents test --run test/integration/host-provider.test.ts`

Expected: tests skipped (no `HOST_PROVIDER=1`).

- [ ] **Step 5: Commit**

```bash
git add packages/coding-agents/test/integration/host-provider.test.ts packages/coding-agents/package.json
git commit -m "test(coding-agents): integration test for HostProvider end-to-end"
```

---

## Task 16: Final sweep

- [ ] **Step 1: Run the full test suite, typecheck, and stylecheck**

```bash
pnpm -C packages/coding-agents typecheck
pnpm -C packages/coding-agents stylecheck
pnpm -C packages/coding-agents test --run
pnpm -C packages/agents typecheck
```

Expected: all green.

- [ ] **Step 2: Smoke-test the docker provider still works**

```bash
DOCKER=1 pnpm -C packages/coding-agents test --run test/unit/local-docker.test.ts
```

Expected: PASS — including the new alignment tests.

- [ ] **Step 3: Verify the bootstrap builds end-to-end**

```bash
pnpm -C packages/coding-agents build
pnpm -C packages/agents build
```

Expected: both builds complete without error.

- [ ] **Step 4: Final commit (if anything was tweaked)**

```bash
git status
# if the working tree is clean, skip
git add -A
git commit -m "chore(coding-agents): final test/typecheck sweep for host target slice"
```

---

## Self-review

**Spec coverage:**

- D1 per-spawn `target` → Tasks 1, 7, 8.
- D2 aligned bind-mount cwd → Task 5.
- D3 `HostProvider` → Tasks 2–4.
- D4 multi-provider routing → Tasks 6, 7, 8, 11.
- D5 import flow → Task 10 (handler) + Task 12 (CLI).
- D6 CLI → Task 12.
- Testing coverage (unit + integration) → Tasks 2–4, 5, 6, 9, 10, 12, 15.
- Docs → Task 14.
- Bootstrap rewire → Task 11.
- Lifecycle event additions → Task 1.

**Placeholder scan:** No TODO/TBD/"add validation"/"similar to" patterns. Every step has either concrete code or an exact command with expected output.

**Type consistency:**

- `LifecycleManager` methods used in tasks line up: `ensureRunning(spec)`, `statusFor(agentId, target)`, `destroyFor(agentId, target)`, `stopFor(agentId, target)`, `destroyAndForget(agentId, target)`, `adoptRunningContainers()`, `pin/release/pinCount/armIdleTimer/cancelIdleTimer/resetPinCount`.
- `HostProvider` returns `instanceId: 'host:<agentId>'` (Task 3 test, Task 3 impl).
- `creationArgsSchema` field names: `target`, `importNativeSessionId` consistent across Tasks 8, 9, 10, 12.
- Lifecycle event names `import.restored` / `import.failed` consistent (Tasks 1, 10).
- `homeDir` option name consistent (Tasks 10, 12).
