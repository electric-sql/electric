import { spawn, type ChildProcess } from 'node:child_process'
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
  /**
   * Live per-turn children. SIGTERM'd on stop()/destroy() so the
   * SandboxProvider contract (terminate the running child within N s,
   * see L1.11 conformance) holds.
   */
  activeChildren: Set<ChildProcess>
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
    const rec: AgentRecord = {
      workspaceMount: real,
      env: spec.env,
      nonce,
      activeChildren: new Set(),
    }
    this.agents.set(spec.agentId, rec)
    log.info(
      { agentId: spec.agentId, workspaceMount: real },
      `host provider started`
    )
    return this.makeInstance(spec.agentId, rec)
  }

  async stop(instanceId: string): Promise<void> {
    // Best-effort: kill any in-flight children for the agent matching
    // this instanceId. Without this, calling stop() while a turn is
    // mid-exec leaves the child running (R1 #9). LocalDocker passes
    // L1.11 via container removal; sprites passes via WS close;
    // host now passes via SIGTERM with a SIGKILL fallback.
    for (const [agentId, rec] of this.agents) {
      if (instanceId !== `host:${agentId}#${rec.nonce}`) continue
      await terminateChildren(rec.activeChildren)
      return
    }
  }

  async destroy(agentId: string): Promise<void> {
    const rec = this.agents.get(agentId)
    if (rec) await terminateChildren(rec.activeChildren)
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
  rec.activeChildren.add(child)

  const exitPromise = new Promise<{ exitCode: number }>((resolve, reject) => {
    child.on(`error`, (err) => {
      rec.activeChildren.delete(child)
      reject(err)
    })
    child.on(`exit`, (code) => {
      rec.activeChildren.delete(child)
      resolve({ exitCode: code ?? -1 })
    })
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

async function terminateChildren(children: Set<ChildProcess>): Promise<void> {
  if (children.size === 0) return
  // SIGTERM first; collect the pending exit promises so we can fall
  // back to SIGKILL after a grace period if any survive.
  const pending: Array<Promise<void>> = []
  for (const child of children) {
    if (child.killed || child.exitCode !== null) {
      children.delete(child)
      continue
    }
    pending.push(
      new Promise<void>((resolve) => {
        child.once(`exit`, () => resolve())
        try {
          child.kill(`SIGTERM`)
        } catch {
          resolve()
        }
      })
    )
  }
  // Wait up to 5 s for graceful exit; SIGKILL anything still alive.
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5_000))
  await Promise.race([Promise.all(pending), timeout])
  for (const child of children) {
    if (child.exitCode === null && !child.killed) {
      try {
        child.kill(`SIGKILL`)
      } catch {
        // already dead
      }
    }
  }
}
