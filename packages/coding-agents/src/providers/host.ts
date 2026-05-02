import { spawn } from 'node:child_process'
import { mkdir, realpath, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
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
  /** Per-start nonce so each fresh start (after destroy) has a unique instanceId. */
  nonce: string
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
    const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const rec: AgentRecord = { workspaceMount: real, env: spec.env, nonce }
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
      instanceId: `host:${agentId}#${rec.nonce}`,
      agentId,
      workspaceMount: rec.workspaceMount,
      homeDir: os.homedir(),
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
  if (!env.HOME && process.env.HOME) env.HOME = process.env.HOME
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
