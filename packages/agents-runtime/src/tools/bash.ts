import { exec } from 'node:child_process'
import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@mariozechner/pi-agent-core'

const TIMEOUT_MS = 30_000
const MAX_OUTPUT_CHARS = 50_000

const DEFAULT_ALLOWED_ENV_KEYS: ReadonlyArray<string> = [
  // Shell / identity
  `PATH`,
  `HOME`,
  `USER`,
  `LOGNAME`,
  `SHELL`,
  // Locale + terminal
  `LANG`,
  `LC_ALL`,
  `LC_CTYPE`,
  `TERM`,
  `COLORTERM`,
  `NO_COLOR`,
  `FORCE_COLOR`,
  `CI`,
  // Temp dirs
  `TMPDIR`,
  `TMP`,
  `TEMP`,
  // XDG
  `XDG_CONFIG_HOME`,
  `XDG_CACHE_HOME`,
  `XDG_DATA_HOME`,
  // Proxies (lower + upper case — curl/git/node respect both forms)
  `HTTP_PROXY`,
  `HTTPS_PROXY`,
  `NO_PROXY`,
  `http_proxy`,
  `https_proxy`,
  `no_proxy`,
  // TLS roots (corporate MITM)
  `NODE_EXTRA_CA_CERTS`,
  `SSL_CERT_FILE`,
  `SSL_CERT_DIR`,
  // Windows essentials — cmd.exe and Node lookups fail without these.
  `SYSTEMROOT`,
  `COMSPEC`,
  `WINDIR`,
  `APPDATA`,
  `LOCALAPPDATA`,
  `USERPROFILE`,
]

export function createBashTool(
  workingDirectory: string,
  opts: {
    /** Extends the built-in safe defaults; cannot shrink them. */
    allowedEnvKeys?: ReadonlyArray<string>
  } = {}
): AgentTool {
  const allowedKeys = new Set<string>([
    ...DEFAULT_ALLOWED_ENV_KEYS,
    ...(opts.allowedEnvKeys ?? []),
  ])
  return {
    name: `bash`,
    label: `Bash`,
    description: `Execute a shell command and return its output. Commands run with a 30-second timeout and a 50KB output cap.`,
    parameters: Type.Object({
      command: Type.String({ description: `The shell command to execute` }),
    }),
    execute: async (_toolCallId, params) => {
      const { command } = params as { command: string }
      return new Promise((resolve) => {
        const child = exec(command, {
          cwd: workingDirectory,
          timeout: TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
          env: filterEnv(process.env, allowedKeys),
        })

        let stdout = ``
        let stderr = ``

        child.stdout?.on(`data`, (data: string) => {
          stdout += data
        })
        child.stderr?.on(`data`, (data: string) => {
          stderr += data
        })

        child.on(`close`, (code, signal) => {
          const timedOut = signal === `SIGTERM`
          let output = stdout
          if (stderr) {
            output += output ? `\n\nSTDERR:\n${stderr}` : stderr
          }
          if (timedOut) {
            output += `\n\n[Command timed out after ${TIMEOUT_MS / 1000}s]`
          }

          output = output.slice(0, MAX_OUTPUT_CHARS)

          resolve({
            content: [{ type: `text` as const, text: output || `(no output)` }],
            details: { exitCode: code ?? 1, timedOut },
          })
        })

        child.on(`error`, (err) => {
          resolve({
            content: [
              {
                type: `text` as const,
                text: `Command failed: ${err.message}`,
              },
            ],
            details: { exitCode: 1, timedOut: false },
          })
        })
      })
    },
  }
}

function filterEnv(
  parentEnv: NodeJS.ProcessEnv,
  allowedKeys: ReadonlySet<string>
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const key of allowedKeys) {
    const v = parentEnv[key]
    if (v !== undefined) out[key] = v
  }
  return out
}
