import type { CodingAgentKind } from '../types'

/**
 * Per-kind adapter. Holds every CLI-specific concern so the bridge,
 * handler, and import CLI stay kind-agnostic.
 */
export interface CodingAgentAdapter {
  readonly kind: CodingAgentKind
  /** CLI binary on $PATH inside the sandbox/host. */
  readonly cliBinary: string
  /** Env vars sourced from process.env when the handler builds spec.env. */
  readonly defaultEnvVars: ReadonlyArray<string>

  /** Build the argv tail and decide where the prompt is delivered. */
  buildCliInvocation(opts: {
    prompt: string
    nativeSessionId?: string
    model?: string
  }): { args: ReadonlyArray<string>; promptDelivery: `stdin` | `argv` }

  /** Argv whose exit code reports whether the resume transcript exists. */
  probeCommand(opts: {
    homeDir: string
    cwd: string
    sessionId: string
  }): ReadonlyArray<string>

  /** Where to write `nativeJsonl.content` so `--resume <id>` will find it. */
  materialiseTargetPath(opts: {
    homeDir: string
    cwd: string
    sessionId: string
    /** Captured transcript bytes; codex needs this to reconstruct YYYY/MM/DD. */
    content?: string
  }): string

  /** Argv that prints the transcript base64-encoded with no line breaks. */
  captureCommand(opts: {
    homeDir: string
    cwd: string
    sessionId: string
  }): ReadonlyArray<string>
}

const adapters = new Map<CodingAgentKind, CodingAgentAdapter>()

export function registerAdapter(a: CodingAgentAdapter): void {
  adapters.set(a.kind, a)
}

export function getAdapter(kind: CodingAgentKind): CodingAgentAdapter {
  const a = adapters.get(kind)
  if (!a) throw new Error(`unknown coding-agent kind: ${kind}`)
  return a
}

export function listAdapters(): ReadonlyArray<CodingAgentAdapter> {
  return Array.from(adapters.values())
}
