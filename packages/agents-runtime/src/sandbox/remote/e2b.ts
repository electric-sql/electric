import type { FileStat } from '../types'
import type { RemoteSandboxClient } from './types'

interface E2BCommandsRun {
  stdout: string
  stderr: string
  exitCode: number | null
}

interface E2BFileEntry {
  name: string
  type?: `file` | `dir`
  path?: string
}

interface E2BFileInfo {
  name?: string
  type?: `file` | `dir`
  size?: number
  modifiedTime?: string | Date
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
    list?(path: string): Promise<ReadonlyArray<E2BFileEntry>>
    exists?(path: string): Promise<boolean>
    remove?(path: string): Promise<unknown>
    getInfo?(path: string): Promise<E2BFileInfo>
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
    // customer opts into the remote provider.
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
    async readdir(path) {
      if (sbx.files.list) {
        const entries = await sbx.files.list(path)
        return entries.map((e) => ({
          name: e.name,
          type: e.type === `dir` ? (`directory` as const) : (`file` as const),
        }))
      }
      // Fallback via shell: `ls -1Ap` puts a trailing `/` on directories.
      const r = await sbx.commands.run(`ls -1Ap ${shellQuote(path)}`)
      if (r.exitCode !== 0) {
        throw new Error(r.stderr || `readdir failed: exit ${r.exitCode}`)
      }
      return r.stdout
        .split(`\n`)
        .filter((line) => line.length > 0)
        .map((line) => ({
          name: line.endsWith(`/`) ? line.slice(0, -1) : line,
          type: line.endsWith(`/`) ? (`directory` as const) : (`file` as const),
        }))
    },
    async exists(path) {
      if (sbx.files.exists) return sbx.files.exists(path)
      const r = await sbx.commands.run(`test -e ${shellQuote(path)}`)
      return r.exitCode === 0
    },
    async remove(path, opts) {
      if (sbx.files.remove && !opts?.recursive) {
        await sbx.files.remove(path)
        return
      }
      const flag = opts?.recursive ? `-rf` : `-f`
      const r = await sbx.commands.run(`rm ${flag} ${shellQuote(path)}`)
      if (r.exitCode !== 0) {
        throw new Error(r.stderr || `remove failed: exit ${r.exitCode}`)
      }
    },
    async stat(path): Promise<FileStat> {
      if (sbx.files.getInfo) {
        const info = await sbx.files.getInfo(path)
        return {
          type:
            info.type === `dir`
              ? `directory`
              : info.type === `file`
                ? `file`
                : `other`,
          size: info.size ?? 0,
          mtimeMs: info.modifiedTime
            ? new Date(info.modifiedTime).getTime()
            : 0,
        }
      }
      // Fallback: parse `stat` output (GNU/BusyBox compatible numeric form).
      const r = await sbx.commands.run(
        `stat -c '%F|%s|%Y' ${shellQuote(path)} 2>/dev/null || stat -f '%HT|%z|%m' ${shellQuote(path)}`
      )
      if (r.exitCode !== 0) {
        const err = new Error(
          r.stderr || `stat failed`
        ) as NodeJS.ErrnoException
        err.code = `ENOENT`
        throw err
      }
      const [kind, size, mtime] = r.stdout.trim().split(`|`)
      const lowerKind = (kind ?? ``).toLowerCase()
      const type: FileStat[`type`] = lowerKind.includes(`directory`)
        ? `directory`
        : lowerKind.includes(`symbolic`)
          ? `symlink`
          : lowerKind.includes(`regular`) || lowerKind === `file`
            ? `file`
            : `other`
      const mtimeNum = Number(mtime)
      return {
        type,
        size: Number(size) || 0,
        mtimeMs: Number.isFinite(mtimeNum) ? mtimeNum * 1000 : 0,
      }
    },
    async kill() {
      await sbx.kill()
    },
  }
}

function shellQuote(arg: string): string {
  return `'` + arg.replace(/'/g, `'\\''`) + `'`
}
