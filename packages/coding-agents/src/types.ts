import type { AgentType, NormalizedEvent } from 'agent-session-protocol'
import type { CodingAgentStatus } from './entity/collections'

// asp's AgentType = 'claude' | 'codex'. opencode is a third kind we
// support locally without an asp upstream patch — normalize/denormalize
// for opencode lives in this package. A future upstream PR widens
// AgentType and this becomes `= AgentType` again.
export type CodingAgentKind = AgentType | `opencode`

// ─── Sandbox provider ──────────────────────────────────────────────────────

export interface SandboxSpec {
  /** Stable agent identity (e.g. /<parent>/coding-agent/<id>). */
  agentId: string
  kind: CodingAgentKind
  /** Execution target. 'sandbox' = Docker; 'host' = direct on-host (no isolation). */
  target: `sandbox` | `host` | `sprites`
  workspace:
    | { type: `volume`; name: string }
    | { type: `bindMount`; hostPath: string }
  /** Env vars exposed inside the sandbox (ANTHROPIC_API_KEY, etc.). */
  env: Record<string, string>
}

export interface ExecRequest {
  cmd: string[]
  cwd?: string
  env?: Record<string, string>
  stdin?: `pipe` | `ignore`
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
  /**
   * Home directory of the user the CLI runs as inside this sandbox.
   * Used to locate ~/.claude/projects/<dir>/<sessionId>.jsonl (and the
   * codex equivalent) for resume materialise/capture.
   *   - LocalDockerProvider: '/home/agent' (the container user).
   *   - HostProvider: os.homedir() of the host process.
   */
  readonly homeDir: string
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

export interface RecoveredSandbox {
  agentId: string
  instanceId: string
  status: `running` | `stopped`
  target: `sandbox` | `host` | `sprites`
}

export interface SandboxProvider {
  readonly name: string
  start(spec: SandboxSpec): Promise<SandboxInstance>
  stop(instanceId: string): Promise<void>
  destroy(agentId: string): Promise<void>
  status(agentId: string): Promise<`running` | `stopped` | `unknown`>
  /** Discover sandboxes adopted across host restarts. MVP: may return []. */
  recover(): Promise<Array<RecoveredSandbox>>
  /**
   * Optional. If implemented, fork can use 'clone' workspace mode.
   * Copies contents of `source` into `target`. Implementations must:
   *   - Fail fast if either workspace doesn't exist.
   *   - Be idempotent (overwriting target is allowed).
   *   - Not mutate the source.
   */
  cloneWorkspace?(opts: {
    source: SandboxSpec[`workspace`]
    target: SandboxSpec[`workspace`]
  }): Promise<void>
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

// ─── Slice A: SpawnCodingAgentOptions / RunSummary ──────────────────────────

export interface SpawnCodingAgentOptions {
  /** Stable id, scoped to the spawning entity. */
  id: string
  kind: CodingAgentKind
  /**
   * Workspace mount. Identity is the lease key.
   *   { type: 'volume', name: 'foo' }    → 'volume:foo'
   *   { type: 'volume' }                 → 'volume:<agentId>'
   *   { type: 'bindMount', hostPath: P } → 'bindMount:<realpath(P)>'
   */
  workspace:
    | { type: `volume`; name?: string }
    | { type: `bindMount`; hostPath: string }
  /** Initial prompt; queued before the first wake. */
  initialPrompt?: string
  /** Slice A: 'runFinished' only. */
  wake?: { on: `runFinished`; includeResponse?: boolean }
  /** Lifecycle overrides. */
  lifecycle?: { idleTimeoutMs?: number; keepWarm?: boolean }
  /**
   * Optional source agent to fork from. The new agent's events history
   * starts as denormalize(source.events, this.kind, ...). Workspace
   * inheritance is controlled by `workspaceMode`:
   *   - 'share': inherit source's workspace identity (lease-serialised).
   *   - 'clone': copy source's workspace into a fresh volume (provider must support cloneWorkspace).
   *   - 'fresh': new empty workspace (no file context).
   * Default policy: 'share' for bindMount sources; 'clone' for volume
   * sources (errors at spawn-time if the provider can't clone).
   */
  from?: {
    agentId: string
    workspaceMode?: `share` | `clone` | `fresh`
  }
}

export interface RunSummary {
  runId: string
  startedAt: number
  endedAt?: number
  status: `running` | `completed` | `failed`
  promptInboxKey: string
  responseText?: string
}

export type { CodingAgentStatus }

/** Defaults applied when a SpawnCodingAgentOptions field is omitted. */
export const SLICE_A_DEFAULTS = {
  idleTimeoutMs: 5 * 60_000,
  coldBootBudgetMs: 30_000,
  runTimeoutMs: 30 * 60_000,
  keepWarm: false,
} as const
