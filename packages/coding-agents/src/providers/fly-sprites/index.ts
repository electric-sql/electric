import type {
  ExecHandle,
  ExecRequest,
  RecoveredSandbox,
  SandboxInstance,
  SandboxProvider,
  SandboxSpec,
} from '../../types'
import { log } from '../../log'
import { SpritesApiClient } from './api-client'
import { createExecHandle } from './exec-adapter'
import { BOOTSTRAP_SCRIPT } from './bootstrap'

export interface FlySpriteProviderOptions {
  token?: string
  baseUrl?: string
  /**
   * idle_timeout_secs passed to POST /sprites. Sprites auto-sleep when
   * idle (free); they wake on next exec (~300ms). Default 300s.
   */
  idleTimeoutSecs?: number
}

const NAME_PREFIX = `coding-agent-`

// Sprites require names matching [a-z0-9-]+. agentIds use mixed-case nanoid,
// and the path-style URL has slashes. This sanitiser is lossy: uppercase →
// lowercase, any other non-allowed char → '-'. Collisions across distinct
// agentIds with case-only differences are theoretically possible but vanishingly
// unlikely with 10-char nanoids — accepted.
function spriteName(agentId: string): string {
  return agentId
    .replace(/^\//, ``)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, `-`)
    .replace(/-+/g, `-`)
    .replace(/^-|-$/g, ``)
}

export class FlySpriteProvider implements SandboxProvider {
  readonly name = `fly-sprites`
  private readonly client: SpritesApiClient
  private readonly idleTimeoutSecs: number
  // Cache agentId → { sprite name, per-sprite URL, sprite-id (UUID) }
  // resolution between calls within one process. Sprite NAME (not id) is the
  // API path parameter; the per-sprite URL (e.g. https://<name>-<suffix>.sprites.app)
  // is what the per-sprite-services HTTP routes to. The sprite ID is the
  // platform's stable UUID — used as the SandboxInstance.instanceId so the
  // conformance suite's "destroy + recreate produces a fresh instance" check
  // sees a new value (the name is reused since it's derived from agentId).
  private readonly agentToSprite = new Map<
    string,
    { name: string; url: string; id: string }
  >()

  constructor(opts: FlySpriteProviderOptions = {}) {
    const token = opts.token ?? process.env.SPRITES_TOKEN
    if (!token) {
      throw new Error(
        `FlySpriteProvider: SPRITES_TOKEN env var is required (or pass token option)`
      )
    }
    this.client = new SpritesApiClient({ token, baseUrl: opts.baseUrl })
    this.idleTimeoutSecs = opts.idleTimeoutSecs ?? 300
  }

  async start(spec: SandboxSpec): Promise<SandboxInstance> {
    if (spec.workspace.type !== `volume`) {
      throw new Error(
        `FlySpriteProvider: only workspace.type='volume' is supported (got '${spec.workspace.type}'). Sprites have intrinsic FS; no bind-mount analog.`
      )
    }
    // Fast path: already started in this process. The lifecycle-manager
    // calls start() on every prompt; redoing bootstrap + writeFileViaExec
    // each time costs two extra WS round-trips and trips the conformance
    // L2.2 (warm second prompt) against the live API. Bootstrap is
    // idempotent (marker file) and the env file already exists on the
    // sprite — we can short-circuit safely.
    const cached = this.agentToSprite.get(spec.agentId)
    if (cached) {
      return this.makeInstance(cached.name, cached.id, spec)
    }
    const name = spriteName(spec.agentId)
    let resolvedName = await this.findExisting(name)
    let spriteUrl: string
    let spriteId: string
    if (!resolvedName) {
      const created = await this.client.createSprite({
        name,
        idleTimeoutSecs: this.idleTimeoutSecs,
      })
      resolvedName = created.name
      spriteUrl = created.url ?? ``
      spriteId = created.id
    } else {
      // Find-existing returned only the name; fetch full record to get
      // url + id.
      const full = await this.client.getSprite(resolvedName)
      spriteUrl = full.url ?? ``
      spriteId = full.id
    }
    if (!spriteUrl) {
      throw new Error(
        `FlySpriteProvider: sprite ${resolvedName} has no per-sprite url; cannot open exec WebSocket`
      )
    }
    this.agentToSprite.set(spec.agentId, {
      name: resolvedName,
      url: spriteUrl,
      id: spriteId,
    })

    // Run bootstrap (idempotent — marker check inside the script).
    await this.runBootstrap(resolvedName)

    // Write spec.env to /run/agent.env so subsequent execs source it.
    // Routed through exec (no public REST filesystem endpoint as of
    // v0.0.1-rc30 — filesystem API doc exists but isn't wired through
    // for arbitrary writes).
    if (Object.keys(spec.env).length > 0) {
      const envBody = Object.entries(spec.env)
        .map(([k, v]) => `${k}=${shellEscape(v)}`)
        .join(`\n`)
      await this.writeFileViaExec(
        resolvedName,
        `/run/agent.env`,
        envBody,
        0o600
      )
    }

    return this.makeInstance(resolvedName, spriteId, spec)
  }

  async exec(_req: ExecRequest): Promise<ExecHandle> {
    // exec is invoked through the SandboxInstance, not the provider directly.
    // Provided here for the SandboxProvider interface but not called.
    throw new Error(
      `FlySpriteProvider.exec must be invoked via SandboxInstance.exec`
    )
  }

  async stop(_instanceId: string): Promise<void> {
    // Sprites auto-sleep — explicit stop is a no-op. v1.x can add cordon
    // via PUT /sprites/{name} if explicit force-sleep is needed.
  }

  async destroy(agentId: string): Promise<void> {
    const name = spriteName(agentId)
    const cached = this.agentToSprite.get(agentId)
    const resolvedName = cached?.name ?? (await this.findExisting(name))
    // Clear the cache BEFORE the REST delete. The idle timer's onFire
    // calls destroy concurrently with the next prompt's start() — if
    // we cleared after the delete, start() could read stale cache
    // between the API call kicking off and completing, hand the bridge
    // a SandboxInstance pointing at a sprite that's being deleted, and
    // the bridge's first POST exec returns 404 'sprite not found'.
    // Conformance L2.2 reproduces this when idleTimeoutMs is short.
    this.agentToSprite.delete(agentId)
    if (!resolvedName) return
    try {
      await this.client.deleteSprite(resolvedName)
    } catch (err) {
      log.warn(
        { err, agentId, spriteName: resolvedName },
        `sprites destroy failed`
      )
    }
  }

  async status(agentId: string): Promise<`running` | `stopped` | `unknown`> {
    const name = spriteName(agentId)
    const cached = this.agentToSprite.get(agentId)
    const resolvedName = cached?.name ?? (await this.findExisting(name))
    if (!resolvedName) return `unknown`
    try {
      const sprite = await this.client.getSprite(resolvedName)
      // Treat any non-deleted sprite as 'running' (auto-slept sprites wake).
      return sprite.status === `destroyed` ? `stopped` : `running`
    } catch {
      return `unknown`
    }
  }

  async recover(): Promise<Array<RecoveredSandbox>> {
    try {
      const r = await this.client.listSprites({ namePrefix: NAME_PREFIX })
      return r.sprites.map((s) => ({
        // Best-effort reconstruction of agentId from sprite name. The runtime
        // spawn pattern is one-segment ('/coding-agent/<id>'), so we strip
        // NAME_PREFIX and treat the rest as the trailing segment. Agent IDs
        // with embedded slashes deeper than that won't roundtrip cleanly —
        // acceptable for v1; revisit if we add nested agent paths.
        agentId: s.name.startsWith(NAME_PREFIX)
          ? `/coding-agent/${s.name.slice(NAME_PREFIX.length)}`
          : `/${s.name}`, // best-effort fallback for sprites not created via this provider
        instanceId: s.id,
        status:
          s.status === `destroyed`
            ? (`stopped` as const)
            : (`running` as const),
        target: `sprites` as const,
      }))
    } catch (err) {
      log.warn({ err }, `sprites recover failed`)
      return []
    }
  }

  // ─── private helpers ─────────────────────────────────────────────────

  private async findExisting(name: string): Promise<string | null> {
    const r = await this.client.listSprites({ namePrefix: name })
    const exact = r.sprites.find((s) => s.name === name)
    return exact?.name ?? null
  }

  private async runBootstrap(name: string): Promise<void> {
    // Run BOOTSTRAP_SCRIPT via /bin/sh. Drain to completion.
    const ws = this.openExecWebSocket(name, [`/bin/sh`, `-c`, BOOTSTRAP_SCRIPT])
    const handle = createExecHandle({ ws })
    const drain = async (s: AsyncIterable<string>): Promise<void> => {
      for await (const _ of s) {
        // discard
      }
    }
    const exit = handle.wait()
    await Promise.all([drain(handle.stdout), drain(handle.stderr), exit])
    const exitInfo = await exit
    if (exitInfo.exitCode !== 0) {
      throw new Error(
        `sprites bootstrap failed: exit ${exitInfo.exitCode} on sprite ${name}`
      )
    }
  }

  private openExecWebSocket(
    spriteName: string,
    cmd: ReadonlyArray<string>,
    opts: { env?: Record<string, string>; cwd?: string } = {}
  ): WebSocket {
    // Exec lives on api.sprites.dev — NOT the per-sprite URL (the per-sprite
    // URL routes to user services running inside the sprite, e.g. on :8080).
    // Cmd is passed via repeated ?cmd= query params; the API has no `start`
    // frame.
    const apiBase = `wss://api.sprites.dev/v1/sprites/${encodeURIComponent(
      spriteName
    )}/exec`
    const params = cmd.map((c) => `cmd=${encodeURIComponent(c)}`)
    if (opts.cwd) params.push(`cwd=${encodeURIComponent(opts.cwd)}`)
    if (opts.env) {
      for (const [k, v] of Object.entries(opts.env)) {
        params.push(`env=${encodeURIComponent(`${k}=${v}`)}`)
      }
    }
    const wsUrl = `${apiBase}?${params.join(`&`)}`
    const ws = new WebSocket(wsUrl, {
      headers: { authorization: `Bearer ${this.client.tokenForExec()}` },
    } as any)
    ws.binaryType = `arraybuffer`
    return ws
  }

  private async writeFileViaExec(
    spriteName: string,
    destPath: string,
    content: string,
    mode = 0o600
  ): Promise<void> {
    // No stdin path on the new exec API — bake the content into the cmd
    // via base64 so embedded quotes/newlines round-trip safely. The size
    // ceiling here is the URL/header limit (~16 KiB worth of params), well
    // above the env-file use case.
    const b64 = Buffer.from(content, `utf-8`).toString(`base64`)
    const ws = this.openExecWebSocket(spriteName, [
      `/bin/sh`,
      `-c`,
      `printf %s ${shellEscape(b64)} | base64 -d > ${shellEscape(destPath)} && chmod ${mode.toString(8)} ${shellEscape(destPath)}`,
    ])
    const handle = createExecHandle({ ws })
    const drain = async (s: AsyncIterable<string>) => {
      for await (const _ of s) {
        // discard
      }
    }
    const exit = handle.wait()
    await Promise.all([drain(handle.stdout), drain(handle.stderr), exit])
    const exitInfo = await exit
    if (exitInfo.exitCode !== 0) {
      throw new Error(
        `writeFileViaExec failed: exit ${exitInfo.exitCode} writing ${destPath}`
      )
    }
  }

  private makeInstance(
    name: string,
    spriteId: string,
    spec: SandboxSpec
  ): SandboxInstance {
    return {
      // The sprite's UUID changes on every fresh create; using the name
      // (which is derived from agentId and reused after destroy) would
      // make L1.2 think the recreated instance is the same as before.
      instanceId: spriteId,
      agentId: spec.agentId,
      workspaceMount: `/work`,
      // Sprites run as the `sprite` user (uid 1001) — not root.
      homeDir: `/home/sprite`,
      exec: async (req) => {
        // Wrap every exec in a shell that sources /run/agent.env so the
        // agent's env (ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN /
        // OPENAI_API_KEY etc.) is available to the user cmd. The local
        // docker provider gets these via the container env directly;
        // sprites don't have a container-level env knob in the public
        // API, so we stage them in /run/agent.env at start() time and
        // source on every exec.
        const wrapped = wrapWithAgentEnv(req.cmd, req.cwd)
        if (req.stdin === `pipe`) {
          // Sprites WS protocol for stdin isn't stable across rc30→rc43;
          // route stdin-bearing exec through HTTP POST instead, which
          // accepts stdin in the request body. POST doesn't deliver an
          // exit frame, so we wrap the user's argv in a sh that emits
          // an explicit marker line; the adapter parses it back.
          return this.execWithStdinViaPost(name, { ...req, cmd: wrapped })
        }
        const ws = this.openExecWebSocket(name, wrapped, {
          env: req.env,
          cwd: req.cwd,
        })
        return createExecHandle({ ws })
      },
      copyTo: async (args) => {
        await this.writeFileViaExec(
          name,
          args.destPath,
          args.content,
          args.mode ?? 0o600
        )
      },
    }
  }

  // Stdin-bearing exec via HTTP POST. The CLI bridge writes the full
  // prompt and closes — we buffer in writeStdin, then on closeStdin
  // issue the POST and stream the response into stdoutQ. The wrapped
  // shell appends an out-of-band marker line carrying the exit code.
  private execWithStdinViaPost(
    spriteName: string,
    req: ExecRequest
  ): ExecHandle {
    const EXIT_MARKER = `__SPRITES_EXIT_CODE__:`
    const stdoutLines: Array<string> = []
    let stdoutResolve: ((line: IteratorResult<string>) => void) | null = null
    const stdoutDone = { value: false }
    const stderrLines: Array<string> = []
    let stderrResolve: ((line: IteratorResult<string>) => void) | null = null
    const stderrDone = { value: false }
    let exitInfo: { exitCode: number } | null = null
    let exitResolve: ((info: { exitCode: number }) => void) | null = null
    const exitPromise = new Promise<{ exitCode: number }>(
      (r) => (exitResolve = r)
    )

    let stdinBuf = ``
    let started = false

    const pushStdout = (line: string): void => {
      if (stdoutResolve) {
        const r = stdoutResolve
        stdoutResolve = null
        r({ value: line, done: false })
      } else {
        stdoutLines.push(line)
      }
    }
    const pushStderr = (line: string): void => {
      if (stderrResolve) {
        const r = stderrResolve
        stderrResolve = null
        r({ value: line, done: false })
      } else {
        stderrLines.push(line)
      }
    }
    const endStdout = (): void => {
      stdoutDone.value = true
      if (stdoutResolve) {
        stdoutResolve({ value: undefined as unknown as string, done: true })
        stdoutResolve = null
      }
    }
    const endStderr = (): void => {
      stderrDone.value = true
      if (stderrResolve) {
        stderrResolve({ value: undefined as unknown as string, done: true })
        stderrResolve = null
      }
    }

    const start = async () => {
      if (started) return
      started = true
      // Wrap user argv so we capture the real exit code on a marker line.
      // We pass the user argv through "$@" — robust against shell
      // metacharacters in cmd args.
      const wrapper = [
        `/bin/sh`,
        `-c`,
        `"$@"; ec=$?; printf '\\n${EXIT_MARKER}%d\\n' "$ec"`,
        `wrapper`,
        ...req.cmd,
      ]
      const params = wrapper.map((c) => `cmd=${encodeURIComponent(c)}`)
      params.push(`stdin=true`)
      if (req.cwd) params.push(`cwd=${encodeURIComponent(req.cwd)}`)
      if (req.env) {
        for (const [k, v] of Object.entries(req.env)) {
          params.push(`env=${encodeURIComponent(`${k}=${v}`)}`)
        }
      }
      const url = `https://api.sprites.dev/v1/sprites/${encodeURIComponent(
        spriteName
      )}/exec?${params.join(`&`)}`
      try {
        const res = await fetch(url, {
          method: `POST`,
          headers: {
            authorization: `Bearer ${this.client.tokenForExec()}`,
            'content-type': `application/octet-stream`,
          },
          body: stdinBuf,
        })
        if (!res.ok) {
          const txt = await res.text().catch(() => ``)
          throw new Error(
            `Sprites POST exec ${spriteName}: ${res.status} ${txt.slice(0, 200)}`
          )
        }
        // Stream body and demultiplex sprites' framed output. Each
        // POST chunk may contain multiple framed segments:
        //   <0x01> stdout-bytes... | <0x02> stderr-bytes... | <0x03> <exit>
        // Frame boundaries align with kernel writes; we accumulate a
        // bytewise buffer and split on stream-prefix bytes. Within a
        // stream's bytes, split on \n for line-oriented push.
        const reader = res.body?.getReader()
        if (!reader) {
          endStdout()
          endStderr()
          if (exitResolve) exitResolve({ exitCode: -1 })
          return
        }
        const decoder = new TextDecoder()
        let stdoutTail = ``
        let stderrTail = ``
        const flushStdoutLines = (text: string, finalFlush: boolean) => {
          stdoutTail += text
          const parts = stdoutTail.split(`\n`)
          stdoutTail = finalFlush ? `` : (parts.pop() ?? ``)
          for (const line of finalFlush ? parts : parts) {
            if (line.startsWith(EXIT_MARKER)) {
              exitInfo = { exitCode: Number(line.slice(EXIT_MARKER.length)) }
              continue
            }
            pushStdout(line)
          }
          if (finalFlush && stdoutTail) {
            // Already flushed via parts above when finalFlush=true; no-op.
          }
        }
        const flushStderrLines = (text: string, finalFlush: boolean) => {
          stderrTail += text
          const parts = stderrTail.split(`\n`)
          stderrTail = finalFlush ? `` : (parts.pop() ?? ``)
          for (const line of parts) pushStderr(line)
        }
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          // Walk the chunk byte-by-byte, switching streams on prefix bytes.
          // Each segment's bytes are decoded as utf-8 lines.
          let i = 0
          while (i < value.length) {
            const prefix = value[i]!
            if (prefix === 0x03) {
              // Control: next byte is exit code.
              if (i + 1 < value.length && !exitInfo) {
                exitInfo = { exitCode: value[i + 1]! }
              }
              i += 2
              continue
            }
            if (prefix !== 0x01 && prefix !== 0x02) {
              // Defensive: unknown prefix — skip one byte.
              i += 1
              continue
            }
            // Find next prefix byte boundary.
            let end = i + 1
            while (
              end < value.length &&
              value[end] !== 0x01 &&
              value[end] !== 0x02 &&
              value[end] !== 0x03
            ) {
              end += 1
            }
            const segment = value.slice(i + 1, end)
            const text = decoder.decode(segment, { stream: end < value.length })
            if (prefix === 0x01) flushStdoutLines(text, false)
            else flushStderrLines(text, false)
            i = end
          }
        }
        // Final flush for any incomplete trailing line.
        flushStdoutLines(``, true)
        flushStderrLines(``, true)
        endStdout()
        endStderr()
        if (!exitInfo) exitInfo = { exitCode: -1 }
        if (exitResolve) exitResolve(exitInfo)
      } catch (err) {
        endStdout()
        endStderr()
        if (!exitInfo) exitInfo = { exitCode: -1 }
        if (exitResolve) exitResolve(exitInfo)
        log.warn({ err }, `sprites POST exec failed`)
      }
    }

    return {
      stdout: {
        [Symbol.asyncIterator]: () => ({
          next: () => {
            if (stdoutLines.length > 0) {
              return Promise.resolve({
                value: stdoutLines.shift()!,
                done: false,
              })
            }
            if (stdoutDone.value) {
              return Promise.resolve({
                value: undefined as unknown as string,
                done: true,
              })
            }
            return new Promise<IteratorResult<string>>((r) => {
              stdoutResolve = r
            })
          },
        }),
      },
      stderr: {
        [Symbol.asyncIterator]: () => ({
          next: () => {
            if (stderrLines.length > 0) {
              return Promise.resolve({
                value: stderrLines.shift()!,
                done: false,
              })
            }
            if (stderrDone.value) {
              return Promise.resolve({
                value: undefined as unknown as string,
                done: true,
              })
            }
            return new Promise<IteratorResult<string>>((r) => {
              stderrResolve = r
            })
          },
        }),
      },
      wait: () => exitPromise,
      kill: () => {
        // POST is a single shot; nothing to abort cleanly.
      },
      writeStdin: async (chunk: string) => {
        stdinBuf += chunk
      },
      closeStdin: async () => {
        // closeStdin triggers the actual POST. Bridge waits on stdout/exit.
        void start()
      },
    }
  }
}

function shellEscape(v: string): string {
  // Wrap in single quotes; close-and-escape any single quotes inside.
  return `'${v.replace(/'/g, `'\\''`)}'`
}

// Build a /bin/sh -c invocation that sources /run/agent.env (if present),
// cd's into cwd (if provided), and then exec's the user argv via "$@".
// `set -a` (allexport) ensures the file's `KEY=value` lines are EXPORTED —
// without it, `.` only sets shell-local vars and child processes (e.g. claude)
// don't see them. The explicit `cd` is necessary because sprites' exec
// API ignores the `cwd=` query param when the cmd is wrapped in a shell;
// we honour it here instead. `exec` replaces the shell so signals and
// exit codes pass through cleanly.
function wrapWithAgentEnv(
  cmd: ReadonlyArray<string>,
  cwd?: string
): Array<string> {
  const parts = [
    `if [ -r /run/agent.env ]; then set -a; . /run/agent.env; set +a; fi`,
  ]
  if (cwd) parts.push(`cd ${shellEscape(cwd)}`)
  parts.push(`exec "$@"`)
  return [`/bin/sh`, `-c`, parts.join(`; `), `agent-env-wrapper`, ...cmd]
}
