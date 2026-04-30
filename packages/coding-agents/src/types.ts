import type { NormalizedEvent } from 'agent-session-protocol'

export type CodingAgentKind = `claude` | `codex`

// ─── Sandbox provider ──────────────────────────────────────────────────────

export interface SandboxSpec {
  /** Stable agent identity (e.g. /<parent>/coding-agent/<id>). */
  agentId: string
  kind: CodingAgentKind
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
  exec(args: ExecRequest): Promise<ExecHandle>
}

export interface RecoveredSandbox {
  agentId: string
  instanceId: string
  status: `running` | `stopped`
}

export interface SandboxProvider {
  readonly name: string
  start(spec: SandboxSpec): Promise<SandboxInstance>
  stop(instanceId: string): Promise<void>
  destroy(agentId: string): Promise<void>
  status(agentId: string): Promise<`running` | `stopped` | `unknown`>
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
