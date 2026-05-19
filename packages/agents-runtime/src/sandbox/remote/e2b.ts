import type { RemoteSandboxClient } from './types'

interface E2BCommandsRun {
  stdout: string
  stderr: string
  exitCode: number | null
}

interface E2BSandboxInstance {
  commands: {
    run(
      cmd: string,
      opts?: { cwd?: string; envs?: Record<string, string>; timeoutMs?: number }
    ): Promise<E2BCommandsRun>
  }
  files: {
    read(
      path: string,
      opts?: { format?: `bytes` | `text` }
    ): Promise<Uint8Array | string>
    write(path: string, content: string | Uint8Array): Promise<unknown>
    makeDir(path: string): Promise<unknown>
  }
  kill(): Promise<unknown>
}

/**
 * Wraps an e2b Sandbox instance behind the provider-neutral
 * RemoteSandboxClient interface. The e2b SDK is loaded dynamically so it
 * remains an optional peer dependency — installing agents-runtime does not
 * pull in e2b unless the customer wants the remote provider.
 */
export async function createE2BClient(opts: {
  apiKey?: string
  template?: string
  workingDirectory: string
}): Promise<RemoteSandboxClient> {
  let mod: {
    Sandbox: {
      create(template?: string, opts?: unknown): Promise<E2BSandboxInstance>
    }
  }
  try {
    // e2b is an optional peer dependency — resolved at runtime when the
    // customer opts into the remote provider. Static type resolution is
    // intentionally not required.
    // @ts-expect-error - optional peer dep, no static type
    mod = (await import(`e2b`)) as unknown as typeof mod
  } catch {
    throw new Error(
      `remoteSandbox({provider:'e2b'}) requires the "e2b" package. Install it: pnpm add e2b`
    )
  }
  const sbx = opts.template
    ? await mod.Sandbox.create(opts.template, { apiKey: opts.apiKey })
    : await mod.Sandbox.create()
  // Ensure the working directory exists in the VM.
  await sbx.files.makeDir(opts.workingDirectory).catch(() => {
    /* ignore — may already exist */
  })
  return adaptE2B(sbx, opts.workingDirectory)
}

export function adaptE2B(
  sbx: E2BSandboxInstance,
  defaultCwd: string
): RemoteSandboxClient {
  return {
    async exec(opts) {
      const r = await sbx.commands.run(opts.command, {
        cwd: opts.cwd ?? defaultCwd,
        envs: opts.env,
        timeoutMs: opts.timeoutMs,
      })
      return {
        stdout: Buffer.from(r.stdout ?? ``),
        stderr: Buffer.from(r.stderr ?? ``),
        exitCode: r.exitCode,
      }
    },
    async readFile(path) {
      const out = await sbx.files.read(path, { format: `bytes` })
      return Buffer.isBuffer(out) ? out : Buffer.from(out as Uint8Array)
    },
    async writeFile(path, content) {
      await sbx.files.write(path, content)
    },
    async mkdir(path) {
      await sbx.files.makeDir(path)
    },
    async kill() {
      await sbx.kill()
    },
  }
}
