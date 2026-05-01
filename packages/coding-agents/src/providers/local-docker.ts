import { spawn } from 'node:child_process'
import { realpath, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

/**
 * Per-instance env files persisted on the host filesystem. `docker exec
 * --env-file <path>` reads from the host, so we materialise spec.env to
 * a 0600 file in the host tmpdir and reference it instead of inlining
 * secrets in argv (visible via `ps`). The file is removed on destroy.
 */
function envFilePathForInstance(instanceId: string): string {
  return join(tmpdir(), `electric-agents-env-${instanceId}`)
}

export class LocalDockerProvider implements SandboxProvider {
  readonly name = `local-docker`
  private readonly image: string
  private readonly envFileByInstance = new Map<string, string>()

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
      // Re-materialise the env file for the adopted instance so subsequent
      // execs find secrets via --env-file rather than -e argv.
      if (Object.keys(spec.env).length > 0) {
        await this.writeEnvFile(existing.id, spec.env)
      }
      const mountPath = await this.inspectMountPath(existing.id, spec)
      return this.makeInstance(existing.id, spec, mountPath)
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

    if (Object.keys(spec.env).length > 0) {
      await this.writeEnvFile(instanceId, spec.env)
    }

    return this.makeInstance(instanceId, spec, mountPath)
  }

  private async writeEnvFile(
    instanceId: string,
    env: Record<string, string>
  ): Promise<void> {
    const path = envFilePathForInstance(instanceId)
    const content =
      Object.entries(env)
        .map(([k, v]) => `${k}=${v}`)
        .join(`\n`) + `\n`
    await writeFile(path, content, { mode: 0o600 })
    this.envFileByInstance.set(instanceId, path)
  }

  private async removeEnvFile(instanceId: string): Promise<void> {
    const path = this.envFileByInstance.get(instanceId)
    if (!path) return
    this.envFileByInstance.delete(instanceId)
    await unlink(path).catch(() => undefined)
  }

  async stop(instanceId: string): Promise<void> {
    await runDocker([`stop`, `-t`, `5`, instanceId]).catch((err) => {
      log.warn(
        { err, instanceId },
        `docker stop failed (probably already stopped)`
      )
    })
    await runDocker([`rm`, `-f`, instanceId]).catch(() => undefined)
    await this.removeEnvFile(instanceId)
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
          target: `sandbox` as const,
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

  private async mountFlag(
    spec: SandboxSpec
  ): Promise<{ flag: string; mountPath: string }> {
    if (spec.workspace.type === `volume`) {
      const volName = `coding-agent-workspace-${spec.workspace.name}`
      // ensure the volume exists (docker auto-creates on first use, but explicit is friendlier)
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

  private async inspectMountPath(
    _instanceId: string,
    spec: SandboxSpec
  ): Promise<string> {
    if (spec.workspace.type === `volume`) return `/workspace`
    return await realpath(spec.workspace.hostPath)
  }

  private makeInstance(
    instanceId: string,
    spec: SandboxSpec,
    mountPath: string
  ): SandboxInstance {
    const envFilePathFor = (): string | undefined =>
      this.envFileByInstance.get(instanceId)

    return {
      instanceId,
      agentId: spec.agentId,
      workspaceMount: mountPath,
      homeDir: `/home/agent`,
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

function shellQuote(s: string): string {
  // Single-quote and escape any single quotes inside.
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/**
 * Safe specifically because the inner `sh -c` produces no stdout/stderr
 * until EOF on stdin. If the sub-shell errors before draining (e.g.
 * destination directory missing), the host-side write may EPIPE; we
 * swallow that and let wait()'s exit code surface the real error.
 */
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
  try {
    await handle.writeStdin(content)
    await handle.closeStdin()
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== `EPIPE`) throw err
    // Sub-shell exited before consuming stdin; fall through to surface
    // the real failure via wait() + stderr.
  }
  const exit = await handle.wait()
  // Order matters: await drains AFTER wait() resolves so stderr captures
  // the full error text before we slice it into the thrown message.
  await Promise.all([stdoutPromise, stderrPromise])
  if (exit.exitCode !== 0) {
    throw new Error(
      `copyTo failed: exit ${exit.exitCode}, stderr=${stderr.slice(0, 400)}`
    )
  }
}

async function execInContainer(
  containerId: string,
  req: ExecRequest,
  baseEnv: Record<string, string>,
  envFilePath?: string
): Promise<ExecHandle> {
  const args: Array<string> = [`exec`, `-i`]
  if (req.cwd) args.push(`-w`, req.cwd)

  // Per-call req.env passes via -e (typically non-secret overrides).
  // Secrets in baseEnv route through --env-file when available so they
  // never appear in `ps`. Bootstrap call (env-file not yet written)
  // falls back to -e on baseEnv for that single call.
  if (envFilePath) {
    args.push(`--env-file`, envFilePath)
  } else {
    for (const [k, v] of Object.entries(baseEnv)) args.push(`-e`, `${k}=${v}`)
  }
  for (const [k, v] of Object.entries(req.env ?? {})) {
    args.push(`-e`, `${k}=${v}`)
  }
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
