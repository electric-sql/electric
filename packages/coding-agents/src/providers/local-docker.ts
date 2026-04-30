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
  process.env.CODING_AGENT_IMAGE ?? `electric-ax/coding-agent-sandbox:test`

export interface LocalDockerProviderOptions {
  /** Override the image tag (default: env CODING_AGENT_IMAGE or test image). */
  image?: string
}

export class LocalDockerProvider implements SandboxProvider {
  readonly name = `local-docker`
  private readonly image: string

  constructor(opts: LocalDockerProviderOptions = {}) {
    this.image = opts.image ?? IMAGE
  }

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
      // Stale stopped container with same agentId. Remove it first.
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
    return this.makeInstance(instanceId, spec)
  }

  async stop(instanceId: string): Promise<void> {
    await runDocker([`stop`, `-t`, `5`, instanceId]).catch((err) => {
      log.warn(
        { err, instanceId },
        `docker stop failed (probably already stopped)`
      )
    })
    await runDocker([`rm`, `-f`, instanceId]).catch(() => undefined)
  }

  async destroy(agentId: string): Promise<void> {
    const c = await this.findContainerByAgentId(agentId)
    if (c) await this.stop(c.id)
    // Volume cleanup is intentionally NOT done in MVP — tests clean up explicitly.
  }

  async status(agentId: string): Promise<`running` | `stopped` | `unknown`> {
    const c = await this.findContainerByAgentId(agentId)
    if (!c) return `unknown`
    return c.running ? `running` : `stopped`
  }

  async recover(): Promise<Array<RecoveredSandbox>> {
    const { stdout } = await runDocker([
      `ps`,
      `-a`,
      `--format`,
      `{{.ID}}\t{{.Label "electric-ax.agent-id"}}\t{{.State}}`,
      `--filter`,
      `label=electric-ax.agent-id`,
    ])
    return stdout
      .trim()
      .split(`\n`)
      .filter(Boolean)
      .map((line) => {
        const [id, agentId, state] = line.split(`\t`)
        return {
          instanceId: id ?? ``,
          agentId: agentId ?? ``,
          status: state === `running` ? `running` : `stopped`,
        }
      })
  }

  // ── private helpers ──

  private async findContainerByAgentId(
    agentId: string
  ): Promise<{ id: string; running: boolean } | null> {
    const { stdout } = await runDocker([
      `ps`,
      `-a`,
      `--format`,
      `{{.ID}}\t{{.State}}`,
      `--filter`,
      `label=electric-ax.agent-id=${agentId}`,
    ])
    const line = stdout
      .trim()
      .split(`\n`)
      .find((l) => l.length > 0)
    if (!line) return null
    const [id, state] = line.split(`\t`)
    return { id: id ?? ``, running: state === `running` }
  }

  private async mountFlag(spec: SandboxSpec): Promise<string> {
    if (spec.workspace.type === `volume`) {
      const volName = `coding-agent-workspace-${spec.workspace.name}`
      // ensure the volume exists (docker auto-creates on first use, but explicit is friendlier)
      await runDocker([`volume`, `create`, volName]).catch(() => undefined)
      return `--mount=type=volume,source=${volName},target=/workspace`
    }
    const real = await realpath(spec.workspace.hostPath)
    return `--mount=type=bind,source=${real},target=/workspace`
  }

  private makeInstance(instanceId: string, spec: SandboxSpec): SandboxInstance {
    return {
      instanceId,
      agentId: spec.agentId,
      workspaceMount: `/workspace`,
      exec: (args) => execInContainer(instanceId, args, spec.env),
    }
  }
}

// ── docker CLI helpers ──

async function runDocker(
  args: ReadonlyArray<string>
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolveCmd, rejectCmd) => {
    const child = spawn(`docker`, args as Array<string>, {
      stdio: [`ignore`, `pipe`, `pipe`],
    })
    let stdout = ``
    let stderr = ``
    child.stdout.on(`data`, (d) => (stdout += d.toString()))
    child.stderr.on(`data`, (d) => (stderr += d.toString()))
    child.on(`error`, rejectCmd)
    child.on(`exit`, (code) => {
      if (code === 0) resolveCmd({ stdout, stderr })
      else
        rejectCmd(
          new Error(`docker ${args.join(` `)} exited ${code}: ${stderr}`)
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
  const args: Array<string> = [`exec`, `-i`]
  if (req.cwd) args.push(`-w`, req.cwd)
  for (const [k, v] of Object.entries(env)) args.push(`-e`, `${k}=${v}`)
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
  // touch exitCode to silence unused-var warnings if any
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
