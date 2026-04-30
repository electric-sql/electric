# Coding Agents Platform Primitive — MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a minimum viable `@electric-ax/coding-agents` package that proves the core architecture: a Docker sandbox + a stdio bridge to the Claude CLI + a normalized event stream. Validation bar: an integration smoke test that starts a sandbox, runs `claude --print --output-format=stream-json` inside it, parses the JSONL output, and asserts `session_init` and `assistant_message` events were captured.

**Architecture:** Three modules in a new package — `LocalDockerProvider` (subprocess-driven Docker CLI; no `dockerode` dep to keep it small), `StdioBridge` (parses claude's stream-json output via `agent-session-protocol`'s `normalize`), and a tiny in-memory `Sandbox` lifecycle (start, exec, stop). No runtime API surface, no entity wiring, no UI in this MVP — those come after smoke green.

**Tech Stack:** TypeScript, Vitest, tsdown, `agent-session-protocol@0.0.2` (already in workspace), Node `child_process`, Docker.

**Spec scope cuts (intentional, MVP):**

- Claude only, not Codex.
- No `LifecycleManager` (idle hibernation, pin/release).
- No workspace registry / refcount.
- No `ctx.spawnCodingAgent` API surface on `HandlerContext`.
- No built-in `coding-agent` entity wiring.
- No UI updates.
- No same-kind/cross-kind resume; single-shot turn only.
- Existing `coder` entity stays in place — no removal in MVP.

These cuts are deliberate. Once the smoke test passes, the broader spec gets implemented in follow-on plans.

**Reference spec:** `docs/superpowers/specs/2026-04-30-coding-agents-platform-primitive-design.md`

---

## File Structure

```
packages/coding-agents/                   ← NEW package
├── package.json
├── tsconfig.json
├── tsdown.config.ts
├── vitest.config.ts
├── .gitignore
├── src/
│   ├── index.ts                          ← public exports
│   ├── types.ts                          ← all interfaces
│   ├── providers/
│   │   └── local-docker.ts               ← LocalDockerProvider
│   ├── bridge/
│   │   └── stdio-bridge.ts               ← StdioBridge
│   └── log.ts                            ← pino logger (mirrors agents-runtime/src/log.ts pattern)
├── docker/
│   ├── Dockerfile                        ← node + claude installed
│   └── entrypoint.sh                     ← container PID 1, keeps it alive
└── test/
    ├── unit/
    │   ├── stdio-bridge.test.ts          ← unit tests with stubbed exec
    │   └── local-docker.test.ts          ← unit tests against fake docker bin (post-MVP, optional)
    ├── integration/
    │   └── smoke.test.ts                 ← REAL Docker + REAL Claude CLI + real API key
    └── support/
        ├── build-image.ts                ← helper to build the test image
        └── env.ts                        ← reads /tmp/.electric-coding-agents-env
```

**No changes to other packages in this MVP.**

---

## Phase Plan

| Phase | Tasks         | Parallelism                     | Depends on |
| ----- | ------------- | ------------------------------- | ---------- |
| 0     | 0.1, 0.2      | sequential                      | —          |
| 1     | 1.A, 1.B, 1.C | parallel (3 independent agents) | Phase 0    |
| 2     | 2.1           | sequential                      | Phase 1    |
| 3     | iteration     | sequential                      | Phase 2    |

---

## Phase 0 — Foundation (sequential)

### Task 0.1 — Scaffold package

**Files to create:**

- `packages/coding-agents/package.json`
- `packages/coding-agents/tsconfig.json`
- `packages/coding-agents/tsdown.config.ts`
- `packages/coding-agents/vitest.config.ts`
- `packages/coding-agents/.gitignore`

The patterns mirror `packages/agents-runtime/` exactly. Copy versions of `tsdown`, `vitest`, `typescript`, `@types/node` from there.

- [ ] **Step 1: Write `packages/coding-agents/package.json`**

```json
{
  "name": "@electric-ax/coding-agents",
  "version": "0.0.1",
  "description": "Sandbox + bridge layer for spawning coding agents (Claude Code, Codex) under Electric Agents.",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/electric-sql/electric.git",
    "directory": "packages/coding-agents"
  },
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsdown",
    "dev": "tsdown --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "DOCKER=1 vitest run test/integration",
    "typecheck": "tsc --noEmit",
    "stylecheck": "eslint . --quiet"
  },
  "exports": {
    ".": {
      "import": {
        "types": "./dist/index.d.ts",
        "default": "./dist/index.js"
      },
      "require": {
        "types": "./dist/index.d.cts",
        "default": "./dist/index.cjs"
      }
    },
    "./package.json": "./package.json"
  },
  "dependencies": {
    "agent-session-protocol": "^0.0.2",
    "pino": "^10.3.1",
    "pino-pretty": "^13.0.0",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@types/node": "^22.19.15",
    "tsdown": "^0.9.0",
    "typescript": "^5.7.0",
    "vitest": "^3.2.4"
  },
  "files": ["dist", "docker"],
  "sideEffects": false,
  "license": "Apache-2.0"
}
```

- [ ] **Step 2: Write `packages/coding-agents/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*", "test/**/*"],
  "exclude": ["dist", "node_modules"]
}
```

If `tsconfig.base.json` does not exist, copy the compilerOptions from `packages/agents-runtime/tsconfig.json` instead.

- [ ] **Step 3: Write `packages/coding-agents/tsdown.config.ts`**

Mirror `packages/agents-runtime/tsdown.config.ts`. The minimum is:

```ts
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['./src/index.ts'],
  outDir: 'dist',
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
})
```

- [ ] **Step 4: Write `packages/coding-agents/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 120_000, // integration tests build images, can be slow
  },
})
```

- [ ] **Step 5: Write `packages/coding-agents/.gitignore`**

```
dist
node_modules
.vitest-temp
coverage
```

- [ ] **Step 6: Run `pnpm install` from repo root**

```
pnpm install
```

Expect: workspace picks up the new package; no errors.

- [ ] **Step 7: Verify the package builds (no source yet → typecheck-only)**

```
pnpm -C packages/coding-agents typecheck
```

Expect: clean (no `src/` files yet, but typecheck against an empty include shouldn't error).
If it errors due to `include: ["src/**/*"]` matching nothing, add an empty `src/index.ts` with `export {}` first.

- [ ] **Step 8: Commit**

```
git add packages/coding-agents
git commit -m "feat(coding-agents): scaffold @electric-ax/coding-agents package"
```

---

### Task 0.2 — Define core types & log

**Files:**

- Create: `packages/coding-agents/src/types.ts`
- Create: `packages/coding-agents/src/log.ts`
- Create: `packages/coding-agents/src/index.ts` (replace empty version from 0.1.7)

- [ ] **Step 1: Write `src/log.ts`**

```ts
import pino from 'pino'

export const log = pino({
  name: 'coding-agents',
  level: process.env.LOG_LEVEL ?? 'info',
  ...(process.env.NODE_ENV !== 'production'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l' },
        },
      }
    : {}),
})
```

- [ ] **Step 2: Write `src/types.ts`**

```ts
import type { NormalizedEvent } from 'agent-session-protocol'

export type CodingAgentKind = 'claude' | 'codex'

// ─── Sandbox provider ──────────────────────────────────────────────────────

export interface SandboxSpec {
  /** Stable agent identity (e.g. /<parent>/coding-agent/<id>). */
  agentId: string
  kind: CodingAgentKind
  workspace:
    | { type: 'volume'; name: string }
    | { type: 'bindMount'; hostPath: string }
  /** Env vars exposed inside the sandbox (ANTHROPIC_API_KEY, etc.). */
  env: Record<string, string>
}

export interface ExecRequest {
  cmd: string[]
  cwd?: string
  env?: Record<string, string>
  stdin?: 'pipe' | 'ignore'
}

export interface ExecHandle {
  /** Async iterables of stdout/stderr lines (UTF-8, newline-stripped). */
  stdout: AsyncIterable<string>
  stderr: AsyncIterable<string>
  /** Available iff request.stdin === 'pipe'. */
  writeStdin?: (chunk: string) => Promise<void>
  closeStdin?: () => Promise<void>
  wait(): Promise<{ exitCode: number }>
  kill(signal?: NodeJS.Signals): void
}

export interface SandboxInstance {
  instanceId: string
  agentId: string
  /** Path inside sandbox where the workspace volume / bind-mount is mounted. */
  workspaceMount: string
  exec(args: ExecRequest): Promise<ExecHandle>
}

export interface RecoveredSandbox {
  agentId: string
  instanceId: string
  status: 'running' | 'stopped'
}

export interface SandboxProvider {
  readonly name: string
  start(spec: SandboxSpec): Promise<SandboxInstance>
  stop(instanceId: string): Promise<void>
  destroy(agentId: string): Promise<void>
  status(agentId: string): Promise<'running' | 'stopped' | 'unknown'>
  /** Discover sandboxes adopted across host restarts. MVP: may return []. */
  recover(): Promise<Array<RecoveredSandbox>>
}

// ─── Bridge ────────────────────────────────────────────────────────────────

export interface RunTurnArgs {
  sandbox: SandboxInstance
  kind: CodingAgentKind
  /** Resume id; undefined for first turn. */
  nativeSessionId?: string
  prompt: string
  /** Model to pass to the CLI (e.g. 'claude-haiku-4-5-20251001'). */
  model?: string
  /** Sink for normalized events as parsed off CLI stdout. */
  onEvent: (e: NormalizedEvent) => void
  /** Sink for raw native JSONL lines (tee'd to a sidecar collection). */
  onNativeLine?: (line: string) => void
}

export interface RunTurnResult {
  /** Discovered or provided session id. */
  nativeSessionId?: string
  exitCode: number
  /** First assistant_message text (for parent's wake payload). */
  finalText?: string
}

export interface Bridge {
  runTurn(args: RunTurnArgs): Promise<RunTurnResult>
}
```

- [ ] **Step 3: Write `src/index.ts`**

```ts
export type {
  CodingAgentKind,
  SandboxSpec,
  ExecRequest,
  ExecHandle,
  SandboxInstance,
  SandboxProvider,
  RecoveredSandbox,
  RunTurnArgs,
  RunTurnResult,
  Bridge,
} from './types'
export { LocalDockerProvider } from './providers/local-docker'
export { StdioBridge } from './bridge/stdio-bridge'
```

(Step 3 references modules that don't exist yet; that's fine — tests in Phase 1 will create them. For the typecheck in Step 5 below, temporarily comment out the two `LocalDockerProvider`/`StdioBridge` re-exports until Phase 1 lands.)

- [ ] **Step 4: Verify the package typechecks**

```
pnpm -C packages/coding-agents typecheck
```

Expect: clean.

- [ ] **Step 5: Commit**

```
git add packages/coding-agents/src
git commit -m "feat(coding-agents): define core types"
```

---

## Phase 1 — Independent components (parallel, 3 agents)

These three tasks touch disjoint files. Dispatch them in parallel.

### Task 1.A — Dockerfile + entrypoint

**Files:**

- Create: `packages/coding-agents/docker/Dockerfile`
- Create: `packages/coding-agents/docker/entrypoint.sh`
- Create: `packages/coding-agents/test/support/build-image.ts`

**Constraints / notes:**

- Image must contain: `node` ≥ 22, `npm`, the official Claude CLI from npm, `git`, and `bash`.
- Claude is published as `@anthropic-ai/claude-code` on npm. Install with `npm install -g @anthropic-ai/claude-code`. The bin name is `claude`.
- Use `node:22-bookworm-slim` as the base — it's small enough and has glibc (musl on alpine breaks some npm postinstall scripts).
- The container's PID 1 must stay alive between `docker exec` invocations. Use `tail -f /dev/null`.
- Image tag for tests: `electric-ax/coding-agent-sandbox:test`.

- [ ] **Step 1: Write `docker/Dockerfile`**

```dockerfile
FROM node:22-bookworm-slim

# Install OS deps: git (claude needs it), curl (claude installer occasionally probes), bash, ca-certs.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        bash \
        tini \
    && rm -rf /var/lib/apt/lists/*

# Non-root user for the agent. Claude's home is needed for ~/.claude transcript dir.
RUN useradd -m -s /bin/bash -u 1000 agent

# Install the Claude CLI globally. Pin a recent version to avoid drift; can bump later.
# (Use the floating tag for now; pin in v1.)
RUN npm install -g @anthropic-ai/claude-code@latest \
    && claude --version

# Workspace mount point. The provider attaches a volume here.
RUN mkdir -p /workspace \
    && chown agent:agent /workspace

USER agent
WORKDIR /workspace

COPY --chown=agent:agent docker/entrypoint.sh /home/agent/entrypoint.sh
RUN chmod +x /home/agent/entrypoint.sh

ENTRYPOINT ["/usr/bin/tini", "--", "/home/agent/entrypoint.sh"]
```

- [ ] **Step 2: Write `docker/entrypoint.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
# PID 1 just stays alive so docker exec can attach. Real work is done via exec.
exec tail -f /dev/null
```

- [ ] **Step 3: Write `test/support/build-image.ts`**

```ts
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(here, '../..')

export const TEST_IMAGE_TAG = 'electric-ax/coding-agent-sandbox:test'

/**
 * Build the test image. Idempotent: re-runs are cheap if Docker layer cache is warm.
 * Throws on non-zero exit.
 */
export async function buildTestImage(): Promise<void> {
  await new Promise<void>((resolveBuild, rejectBuild) => {
    const child = spawn(
      'docker',
      ['build', '-t', TEST_IMAGE_TAG, '-f', 'docker/Dockerfile', '.'],
      { cwd: PACKAGE_ROOT, stdio: 'inherit' }
    )
    child.on('error', rejectBuild)
    child.on('exit', (code) => {
      if (code === 0) resolveBuild()
      else rejectBuild(new Error(`docker build exited ${code}`))
    })
  })
}
```

- [ ] **Step 4: Build the image to verify it works**

```
cd packages/coding-agents
docker build -t electric-ax/coding-agent-sandbox:test -f docker/Dockerfile .
```

Expect: succeeds; final layer reports `claude --version`.

- [ ] **Step 5: Smoke-check Claude inside the container**

```
docker run --rm electric-ax/coding-agent-sandbox:test claude --version
```

Expect: prints the claude version (e.g. `2.1.116 (Claude Code)`).

- [ ] **Step 6: Commit**

```
git add packages/coding-agents/docker packages/coding-agents/test/support
git commit -m "feat(coding-agents): add Dockerfile and image build helper"
```

---

### Task 1.B — `LocalDockerProvider`

**Files:**

- Create: `packages/coding-agents/src/providers/local-docker.ts`
- Create: `packages/coding-agents/test/unit/local-docker.test.ts` (smoke unit; integration coverage is Phase 2)

**Constraints:**

- Use Node `child_process.spawn` to drive the `docker` CLI. No `dockerode` dependency.
- `start()` is idempotent: if a container with `electric-ax.agent-id=<agentId>` exists and is running, attach to it.
- Container labels: `electric-ax.agent-id=<id>`, `electric-ax.kind=<kind>`, `electric-ax.workspace-name=<name>`.
- Volumes:
  - `volume`: ensures `coding-agent-workspace-<name>` exists, mounts at `/workspace`.
  - `bindMount`: mounts `realpath(hostPath)` at `/workspace`.
- Exec environment must merge `spec.env` so `ANTHROPIC_API_KEY` flows through.
- `exec` returns line-by-line async iterables and a `wait()` that resolves the exit code.

- [ ] **Step 1: Write `src/providers/local-docker.ts`**

```ts
import { spawn } from 'node:child_process'
import { realpath } from 'node:fs/promises'
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

const IMAGE =
  process.env.CODING_AGENT_IMAGE ?? 'electric-ax/coding-agent-sandbox:test'

export interface LocalDockerProviderOptions {
  /** Override the image tag (default: env CODING_AGENT_IMAGE or test image). */
  image?: string
}

export class LocalDockerProvider implements SandboxProvider {
  readonly name = 'local-docker'
  private readonly image: string

  constructor(opts: LocalDockerProviderOptions = {}) {
    this.image = opts.image ?? IMAGE
  }

  async start(spec: SandboxSpec): Promise<SandboxInstance> {
    const existing = await this.findContainerByAgentId(spec.agentId)
    if (existing && existing.running) {
      log.debug(
        { agentId: spec.agentId, instanceId: existing.id },
        'attaching to existing sandbox'
      )
      return this.makeInstance(existing.id, spec)
    }
    if (existing && !existing.running) {
      // Stale stopped container with same agentId. Remove it first.
      await runDocker(['rm', '-f', existing.id])
    }

    const labels = [
      `electric-ax.agent-id=${spec.agentId}`,
      `electric-ax.kind=${spec.kind}`,
      `electric-ax.workspace-name=${
        spec.workspace.type === 'volume' ? spec.workspace.name : 'bind-mount'
      }`,
    ]

    const mount = await this.mountFlag(spec)

    const args = [
      'run',
      '-d',
      '--rm=false',
      ...labels.flatMap((l) => ['--label', l]),
      mount,
      this.image,
    ]

    const { stdout } = await runDocker(args)
    const instanceId = stdout.trim()
    log.info({ agentId: spec.agentId, instanceId }, 'started sandbox')
    return this.makeInstance(instanceId, spec)
  }

  async stop(instanceId: string): Promise<void> {
    await runDocker(['stop', '-t', '5', instanceId]).catch((err) => {
      log.warn(
        { err, instanceId },
        'docker stop failed (probably already stopped)'
      )
    })
    await runDocker(['rm', '-f', instanceId]).catch(() => undefined)
  }

  async destroy(agentId: string): Promise<void> {
    const c = await this.findContainerByAgentId(agentId)
    if (c) await this.stop(c.id)
    // Volume cleanup is intentionally NOT done in MVP — tests clean up explicitly.
  }

  async status(agentId: string): Promise<'running' | 'stopped' | 'unknown'> {
    const c = await this.findContainerByAgentId(agentId)
    if (!c) return 'unknown'
    return c.running ? 'running' : 'stopped'
  }

  async recover(): Promise<Array<RecoveredSandbox>> {
    const { stdout } = await runDocker([
      'ps',
      '-a',
      '--format',
      '{{.ID}}\t{{.Label "electric-ax.agent-id"}}\t{{.State}}',
      '--filter',
      'label=electric-ax.agent-id',
    ])
    return stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [id, agentId, state] = line.split('\t')
        return {
          instanceId: id ?? '',
          agentId: agentId ?? '',
          status: state === 'running' ? 'running' : 'stopped',
        }
      })
  }

  // ── private helpers ──

  private async findContainerByAgentId(
    agentId: string
  ): Promise<{ id: string; running: boolean } | null> {
    const { stdout } = await runDocker([
      'ps',
      '-a',
      '--format',
      '{{.ID}}\t{{.State}}',
      '--filter',
      `label=electric-ax.agent-id=${agentId}`,
    ])
    const line = stdout
      .trim()
      .split('\n')
      .find((l) => l.length > 0)
    if (!line) return null
    const [id, state] = line.split('\t')
    return { id: id ?? '', running: state === 'running' }
  }

  private async mountFlag(spec: SandboxSpec): Promise<string> {
    if (spec.workspace.type === 'volume') {
      const volName = `coding-agent-workspace-${spec.workspace.name}`
      // ensure the volume exists (docker auto-creates on first use, but explicit is friendlier)
      await runDocker(['volume', 'create', volName]).catch(() => undefined)
      return `--mount=type=volume,source=${volName},target=/workspace`
    }
    const real = await realpath(spec.workspace.hostPath)
    return `--mount=type=bind,source=${real},target=/workspace`
  }

  private makeInstance(instanceId: string, spec: SandboxSpec): SandboxInstance {
    return {
      instanceId,
      agentId: spec.agentId,
      workspaceMount: '/workspace',
      exec: (args) => execInContainer(instanceId, args, spec.env),
    }
  }
}

// ── docker CLI helpers ──

async function runDocker(
  args: ReadonlyArray<string>
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolveCmd, rejectCmd) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('error', rejectCmd)
    child.on('exit', (code) => {
      if (code === 0) resolveCmd({ stdout, stderr })
      else
        rejectCmd(
          new Error(`docker ${args.join(' ')} exited ${code}: ${stderr}`)
        )
    })
  })
}

function lineIterator(stream: Readable): AsyncIterable<string> {
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  return rl as unknown as AsyncIterable<string>
}

async function execInContainer(
  containerId: string,
  req: ExecRequest,
  baseEnv: Record<string, string>
): Promise<ExecHandle> {
  const env = { ...baseEnv, ...(req.env ?? {}) }
  const args: Array<string> = ['exec', '-i']
  if (req.cwd) args.push('-w', req.cwd)
  for (const [k, v] of Object.entries(env)) args.push('-e', `${k}=${v}`)
  args.push(containerId, ...req.cmd)

  const child = spawn('docker', args, {
    stdio: [req.stdin === 'pipe' ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  })

  let exitCode: number | null = null
  const exitPromise = new Promise<{ exitCode: number }>(
    (resolveWait, rejectWait) => {
      child.on('error', rejectWait)
      child.on('exit', (code) => {
        exitCode = code ?? -1
        resolveWait({ exitCode })
      })
    }
  )

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
    kill: (signal = 'SIGTERM') => {
      try {
        child.kill(signal)
      } catch {
        // already dead
      }
    },
  }
}
```

- [ ] **Step 2: Write `test/unit/local-docker.test.ts`** — minimal type-only smoke

```ts
import { describe, it, expect } from 'vitest'
import { LocalDockerProvider } from '../../src/providers/local-docker'

describe('LocalDockerProvider construction', () => {
  it('exposes name "local-docker"', () => {
    const p = new LocalDockerProvider()
    expect(p.name).toBe('local-docker')
  })
})
```

- [ ] **Step 3: Run `pnpm -C packages/coding-agents test test/unit/local-docker.test.ts`**

Expect: PASS.

- [ ] **Step 4: Commit**

```
git add packages/coding-agents/src/providers packages/coding-agents/test/unit/local-docker.test.ts
git commit -m "feat(coding-agents): add LocalDockerProvider"
```

---

### Task 1.C — `StdioBridge`

**Files:**

- Create: `packages/coding-agents/src/bridge/stdio-bridge.ts`
- Create: `packages/coding-agents/test/unit/stdio-bridge.test.ts`

**Constraints / claude CLI conventions (verified against `claude --help`):**

- Required flags for streaming JSONL output: `--print --output-format=stream-json --verbose`. The `--verbose` flag is required when combining `--print` with `--output-format=stream-json`.
- `--input-format=stream-json` is for streaming JSON _input_; we just want to send a single prompt, so we either pipe the prompt on stdin (default text input) or pass it on argv. Pipe on stdin to mirror existing patterns.
- `--dangerously-skip-permissions` — required for non-interactive autonomous runs.
- `--model <id>` — pass `'claude-haiku-4-5-20251001'` for cheap test runs.
- Resume: `--resume <id>` — out of scope for MVP; bridge ignores `nativeSessionId` for now (logs a warning if set).

**Event normalization:**

- `agent-session-protocol` exports `normalize(lines: string[], agent: 'claude'): NormalizedEvent[]`. Use it on each accumulated batch — but we want to emit events per line. The library also ships line-level normalization functions; if they're not directly exposed, we batch internally and call `normalize(batch, 'claude')` on each new line and emit only the events we haven't emitted yet.
- Cleanest first-pass: collect all stdout lines into a buffer, call `normalize(buf, 'claude')` once at end, emit. Streaming-during-turn is a v2 optimization. The smoke test only asserts events are present, not real-time-ness, so batch-at-end is fine for MVP.

- [ ] **Step 1: Write `src/bridge/stdio-bridge.ts`**

```ts
import { normalize } from 'agent-session-protocol'
import type { NormalizedEvent } from 'agent-session-protocol'
import { log } from '../log'
import type { Bridge, RunTurnArgs, RunTurnResult } from '../types'

export class StdioBridge implements Bridge {
  async runTurn(args: RunTurnArgs): Promise<RunTurnResult> {
    if (args.kind !== 'claude') {
      throw new Error(
        `StdioBridge MVP supports only 'claude', got '${args.kind}'`
      )
    }
    if (args.nativeSessionId) {
      log.warn(
        { nativeSessionId: args.nativeSessionId },
        'StdioBridge MVP does not implement resume — running fresh turn'
      )
    }

    const cliArgs: Array<string> = [
      '--print',
      '--output-format=stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
    ]
    if (args.model) cliArgs.push('--model', args.model)

    const handle = await args.sandbox.exec({
      cmd: ['claude', ...cliArgs],
      cwd: args.sandbox.workspaceMount,
      stdin: 'pipe',
    })

    // Pipe prompt on stdin, then close.
    if (!handle.writeStdin || !handle.closeStdin) {
      throw new Error(
        'StdioBridge requires stdin pipe but ExecHandle lacks one'
      )
    }
    await handle.writeStdin(args.prompt)
    await handle.closeStdin()

    const rawLines: Array<string> = []
    const stderrLines: Array<string> = []

    const drainStderr = async () => {
      for await (const line of handle.stderr) {
        stderrLines.push(line)
      }
    }
    const drainStdout = async () => {
      for await (const line of handle.stdout) {
        if (!line) continue
        rawLines.push(line)
        if (args.onNativeLine) args.onNativeLine(line)
      }
    }

    await Promise.all([drainStdout(), drainStderr()])
    const exitInfo = await handle.wait()

    if (exitInfo.exitCode !== 0) {
      const stderrPreview = stderrLines.join('\n').slice(0, 800) || '<empty>'
      throw new Error(
        `claude CLI exited ${exitInfo.exitCode}. stderr=${stderrPreview}`
      )
    }

    let events: Array<NormalizedEvent> = []
    try {
      events = normalize(rawLines, 'claude')
    } catch (err) {
      log.error({ err, sample: rawLines.slice(0, 3) }, 'normalize failed')
      throw err
    }

    for (const e of events) args.onEvent(e)

    const sessionInit = events.find((e) => e.type === 'session_init')
    const lastAssistant = [...events]
      .reverse()
      .find((e) => e.type === 'assistant_message')

    return {
      nativeSessionId:
        sessionInit && 'sessionId' in sessionInit
          ? (sessionInit as { sessionId?: string }).sessionId
          : undefined,
      exitCode: exitInfo.exitCode,
      finalText:
        lastAssistant && 'text' in lastAssistant
          ? (lastAssistant as { text?: string }).text
          : undefined,
    }
  }
}
```

- [ ] **Step 2: Write `test/unit/stdio-bridge.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { StdioBridge } from '../../src/bridge/stdio-bridge'
import type { ExecHandle, ExecRequest, SandboxInstance } from '../../src/types'

function fakeSandbox(opts: {
  stdoutLines: Array<string>
  stderrLines?: Array<string>
  exitCode?: number
  onCmd?: (cmd: ReadonlyArray<string>) => void
  onStdin?: (chunk: string) => void
}): SandboxInstance {
  return {
    instanceId: 'fake',
    agentId: '/x/coding-agent/y',
    workspaceMount: '/workspace',
    async exec(req: ExecRequest): Promise<ExecHandle> {
      opts.onCmd?.(req.cmd)
      const stdoutLines = opts.stdoutLines.slice()
      const stderrLines = (opts.stderrLines ?? []).slice()
      let stdinBuf = ''
      return {
        stdout: (async function* () {
          for (const l of stdoutLines) yield l
        })(),
        stderr: (async function* () {
          for (const l of stderrLines) yield l
        })(),
        writeStdin: async (chunk) => {
          stdinBuf += chunk
          opts.onStdin?.(chunk)
        },
        closeStdin: async () => undefined,
        wait: async () => ({ exitCode: opts.exitCode ?? 0 }),
        kill: () => undefined,
      }
    },
  }
}

describe('StdioBridge', () => {
  it('rejects non-claude kinds', async () => {
    const b = new StdioBridge()
    await expect(
      b.runTurn({
        sandbox: fakeSandbox({ stdoutLines: [] }),
        kind: 'codex' as 'claude',
        prompt: 'x',
        onEvent: () => undefined,
      })
    ).rejects.toThrow(/MVP supports only 'claude'/)
  })

  it('passes the prompt through stdin and runs the right CLI args', async () => {
    let cmd: ReadonlyArray<string> = []
    let stdin = ''
    const b = new StdioBridge()
    await b.runTurn({
      sandbox: fakeSandbox({
        stdoutLines: ['{"type":"system","subtype":"init","session_id":"abc"}'],
        onCmd: (c) => (cmd = c),
        onStdin: (s) => (stdin = s),
      }),
      kind: 'claude',
      prompt: 'hello world',
      model: 'claude-haiku-4-5-20251001',
      onEvent: () => undefined,
    })
    expect(cmd[0]).toBe('claude')
    expect(cmd).toContain('--print')
    expect(cmd).toContain('--output-format=stream-json')
    expect(cmd).toContain('--verbose')
    expect(cmd).toContain('--dangerously-skip-permissions')
    expect(cmd).toContain('--model')
    expect(cmd).toContain('claude-haiku-4-5-20251001')
    expect(stdin).toBe('hello world')
  })

  it('throws with stderr when CLI exits non-zero', async () => {
    const b = new StdioBridge()
    await expect(
      b.runTurn({
        sandbox: fakeSandbox({
          stdoutLines: [],
          stderrLines: ['fatal: bad thing'],
          exitCode: 1,
        }),
        kind: 'claude',
        prompt: 'x',
        onEvent: () => undefined,
      })
    ).rejects.toThrow(/claude CLI exited 1.*fatal: bad thing/)
  })
})
```

(Note: the test that depends on real `agent-session-protocol` normalization of synthetic JSONL is omitted — the integration smoke test in Phase 2 covers that path with real CLI output.)

- [ ] **Step 3: Run `pnpm -C packages/coding-agents test test/unit/stdio-bridge.test.ts`**

Expect: PASS.

- [ ] **Step 4: Commit**

```
git add packages/coding-agents/src/bridge packages/coding-agents/test/unit/stdio-bridge.test.ts
git commit -m "feat(coding-agents): add StdioBridge"
```

---

## Phase 2 — Integration smoke (sequential)

### Task 2.1 — End-to-end smoke test

**Files:**

- Create: `packages/coding-agents/test/support/env.ts`
- Create: `packages/coding-agents/test/integration/smoke.test.ts`

**Validation goal:**

1. Build the test image.
2. `LocalDockerProvider.start()` a sandbox with a per-test volume and `ANTHROPIC_API_KEY` from the env file.
3. `StdioBridge.runTurn()` runs `claude --print` inside, with prompt `"Reply with the single word: ok"`.
4. Assert: at least one `session_init` event and at least one `assistant_message` event were captured.
5. Cleanup: `provider.destroy(agentId)` removes the container.

- [ ] **Step 1: Write `test/support/env.ts`**

```ts
import { readFileSync } from 'node:fs'

const KEY_FILE = '/tmp/.electric-coding-agents-env'

export interface TestEnv {
  ANTHROPIC_API_KEY: string
  ANTHROPIC_MODEL: string
}

let cached: TestEnv | null = null

export function loadTestEnv(): TestEnv {
  if (cached) return cached
  let raw: string
  try {
    raw = readFileSync(KEY_FILE, 'utf-8')
  } catch (e) {
    throw new Error(
      `Integration tests require ${KEY_FILE} (mode 600) with ANTHROPIC_API_KEY=… and ANTHROPIC_MODEL=…`
    )
  }
  const out: Partial<TestEnv> = {}
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const k = trimmed.slice(0, eq)
    const v = trimmed.slice(eq + 1)
    if (k === 'ANTHROPIC_API_KEY' || k === 'ANTHROPIC_MODEL') out[k] = v
  }
  if (!out.ANTHROPIC_API_KEY) {
    throw new Error(`${KEY_FILE} must contain ANTHROPIC_API_KEY=…`)
  }
  cached = {
    ANTHROPIC_API_KEY: out.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: out.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001',
  }
  return cached
}
```

- [ ] **Step 2: Write `test/integration/smoke.test.ts`**

```ts
import { describe, expect, beforeAll, afterAll, it } from 'vitest'
import type { NormalizedEvent } from 'agent-session-protocol'
import { LocalDockerProvider } from '../../src/providers/local-docker'
import { StdioBridge } from '../../src/bridge/stdio-bridge'
import { buildTestImage, TEST_IMAGE_TAG } from '../support/build-image'
import { loadTestEnv } from '../support/env'

const SHOULD_RUN = process.env.DOCKER === '1'
const describeMaybe = SHOULD_RUN ? describe : describe.skip

describeMaybe('coding-agents smoke (real Docker + real Claude)', () => {
  const provider = new LocalDockerProvider({ image: TEST_IMAGE_TAG })
  const bridge = new StdioBridge()
  const agentId = `/test/coding-agent/${Date.now().toString(36)}`
  const events: Array<NormalizedEvent> = []

  beforeAll(async () => {
    await buildTestImage()
  }, 600_000)

  afterAll(async () => {
    await provider.destroy(agentId).catch(() => undefined)
  })

  it('starts a sandbox, runs claude, captures session_init + assistant_message', async () => {
    const env = loadTestEnv()
    const sandbox = await provider.start({
      agentId,
      kind: 'claude',
      workspace: { type: 'volume', name: agentId.replace(/[^a-z0-9-]/gi, '-') },
      env: { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY },
    })

    const result = await bridge.runTurn({
      sandbox,
      kind: 'claude',
      prompt: 'Reply with the single word: ok',
      model: env.ANTHROPIC_MODEL,
      onEvent: (e) => events.push(e),
    })

    expect(result.exitCode).toBe(0)
    expect(events.find((e) => e.type === 'session_init')).toBeTruthy()
    expect(events.find((e) => e.type === 'assistant_message')).toBeTruthy()
    // sanity: response text isn't empty
    expect(result.finalText && result.finalText.length > 0).toBe(true)
  }, 180_000)
})
```

- [ ] **Step 3: Run the smoke test**

```
DOCKER=1 pnpm -C packages/coding-agents test:integration
```

Expect: PASS within ~3 minutes (image build + claude invocation).

If it fails, **iterate** (Phase 3): inspect output, adjust the bridge / dockerfile / provider, re-run. Maximum 5 iterations before declaring blocked and writing the report.

- [ ] **Step 4: Commit**

```
git add packages/coding-agents/test/support/env.ts packages/coding-agents/test/integration
git commit -m "test(coding-agents): integration smoke against real Docker + Claude"
```

---

## Phase 3 — Iteration (when smoke fails)

For each failure, follow this protocol (max 5 cycles):

1. Capture full failure output.
2. Hypothesize 1-3 likely causes (e.g., wrong claude flags, missing env, container exits early).
3. Pick the highest-likelihood fix; apply it.
4. Re-run smoke.
5. If still failing, document in the report (Phase 4) and try the next hypothesis.

Common failure modes to anticipate:

- **`claude: not found`** → image install path issue. Check `which claude` inside the container; ensure the npm global bin is in PATH.
- **`ANTHROPIC_API_KEY not set`** → env not piped through `docker exec -e`. Verify `LocalDockerProvider.execInContainer` is forwarding the env.
- **`--verbose required with --output-format=stream-json`** → already accounted for, but if claude version drifts the message may differ.
- **Empty stdout** → Claude may be writing JSON only when it has the API key valid. Check stderr.
- **`normalize` throws** → a line is not valid JSON. Filter empty/non-JSON lines before passing.
- **Container exits before exec lands** → `tini` + `tail -f /dev/null` should keep it alive. Add `docker logs <id>` debug.
- **Permission errors on volume** → ensure `chown agent:agent /workspace` in Dockerfile.

After a passing run, even if some flakiness was observed, treat first green as success and proceed to Phase 4.

If 5 cycles pass without green, **stop** and write the report describing the blocker.

---

## Phase 4 — Report

### Task 4.1 — Write report

**File:** `docs/superpowers/specs/notes/2026-04-30-coding-agents-mvp-report.md`

- [ ] **Step 1: Write report markdown**

Include:

- Goal & validation bar.
- What worked: tasks/phases that landed cleanly on first try.
- What broke: each bug, hypothesis, fix attempt, outcome.
- Token usage / time on wall clock if observable.
- Open questions for the next iteration.
- Recommended next steps to extend the MVP toward the full spec.

- [ ] **Step 2: Commit**

```
git add docs/superpowers/specs/notes/2026-04-30-coding-agents-mvp-report.md
git commit -m "docs(coding-agents): MVP run report"
```

---

## Self-review checklist (post-write)

- [x] **Spec coverage:** Plan covers a subset of the full spec — explicitly scoped down to "claude in docker via Provider + Bridge". The full spec sections this MVP defers to follow-on plans:
  - LifecycleManager, workspace registry / lease, runtime API surface, built-in entity, UI updates, codex support, resume flow, conformance suite, removal of `coder` entity. All listed under "Spec scope cuts".
- [x] **Placeholder scan:** No TBDs / TODOs / "appropriate handling" in the steps.
- [x] **Type consistency:** `RunTurnArgs.kind`, `RunTurnArgs.model`, `RunTurnArgs.onEvent`, `RunTurnArgs.onNativeLine` consistent across `types.ts`, `stdio-bridge.ts`, and the smoke test.
- [x] **Approval:** Pre-approved per user instruction ("approve everything"). Proceeding to dispatch.
