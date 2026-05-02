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

function spriteName(agentId: string): string {
  // agentId looks like '/coding-agent/foo' — sanitise to 'coding-agent-foo'.
  return agentId.replace(/^\//, ``).replace(/\//g, `-`)
}

export class FlySpriteProvider implements SandboxProvider {
  readonly name = `fly-sprites`
  private readonly client: SpritesApiClient
  private readonly idleTimeoutSecs: number
  // Cache agentId → { sprite name, per-sprite URL } resolution between calls
  // within one process. Sprite NAME (not id) is the API path parameter; the
  // per-sprite URL (e.g. https://<name>-<suffix>.sprites.app) is what the
  // exec WebSocket connects to (NOT api.sprites.dev).
  private readonly agentToSprite = new Map<
    string,
    { name: string; url: string }
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
    const name = spriteName(spec.agentId)
    let resolvedName = await this.findExisting(name)
    let spriteUrl: string
    if (!resolvedName) {
      const created = await this.client.createSprite({
        name,
        idleTimeoutSecs: this.idleTimeoutSecs,
      })
      resolvedName = created.name
      spriteUrl = created.url ?? ``
    } else {
      // Find-existing returned only the name; fetch full record to get url.
      const full = await this.client.getSprite(resolvedName)
      spriteUrl = full.url ?? ``
    }
    if (!spriteUrl) {
      throw new Error(
        `FlySpriteProvider: sprite ${resolvedName} has no per-sprite url; cannot open exec WebSocket`
      )
    }
    this.agentToSprite.set(spec.agentId, { name: resolvedName, url: spriteUrl })

    // Run bootstrap (idempotent — marker check inside the script).
    await this.runBootstrap(spriteUrl)

    // Write spec.env to /run/agent.env so subsequent execs source it.
    // Routed through exec + cat (no public REST filesystem endpoint).
    if (Object.keys(spec.env).length > 0) {
      const envBody = Object.entries(spec.env)
        .map(([k, v]) => `${k}=${shellEscape(v)}`)
        .join(`\n`)
      await this.writeFileViaExec(spriteUrl, `/run/agent.env`, envBody, 0o600)
    }

    return this.makeInstance(resolvedName, spriteUrl, spec)
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
    if (!resolvedName) return
    try {
      await this.client.deleteSprite(resolvedName)
    } catch (err) {
      log.warn(
        { err, agentId, spriteName: resolvedName },
        `sprites destroy failed`
      )
    }
    this.agentToSprite.delete(agentId)
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

  private async runBootstrap(spriteUrl: string): Promise<void> {
    // Run BOOTSTRAP_SCRIPT via /bin/sh. Drain to completion.
    const ws = this.openExecWebSocket(spriteUrl)
    const handle = createExecHandle({
      ws,
      cmd: [`/bin/sh`, `-c`, BOOTSTRAP_SCRIPT],
    })
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
        `sprites bootstrap failed: exit ${exitInfo.exitCode} on sprite ${spriteUrl}`
      )
    }
  }

  private openExecWebSocket(spriteUrl: string): WebSocket {
    // Convert https://<name>-<suffix>.sprites.app to wss://<name>-<suffix>.sprites.app/exec
    // The exec WebSocket lives on the per-sprite URL, NOT api.sprites.dev.
    const wsUrl = spriteUrl.replace(/^https?:/, `wss:`) + `/exec`
    return new WebSocket(wsUrl, {
      headers: { authorization: `Bearer ${this.client.tokenForExec()}` },
    } as any)
  }

  private async writeFileViaExec(
    spriteUrl: string,
    destPath: string,
    content: string,
    mode = 0o600
  ): Promise<void> {
    const ws = this.openExecWebSocket(spriteUrl)
    const handle = createExecHandle({
      ws,
      cmd: [
        `sh`,
        `-c`,
        `cat > ${shellEscape(destPath)} && chmod ${mode.toString(8)} ${shellEscape(destPath)}`,
      ],
      stdin: `pipe`,
    })
    await handle.writeStdin!(content)
    await handle.closeStdin!()
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
    url: string,
    spec: SandboxSpec
  ): SandboxInstance {
    const spriteUrl = url
    return {
      instanceId: name,
      agentId: spec.agentId,
      workspaceMount: `/work`,
      homeDir: `/root`,
      exec: async (req) => {
        const ws = this.openExecWebSocket(spriteUrl)
        return createExecHandle({
          ws,
          cmd: req.cmd,
          stdin: req.stdin,
          cwd: req.cwd,
          env: req.env,
        })
      },
      copyTo: async (args) => {
        await this.writeFileViaExec(
          spriteUrl,
          args.destPath,
          args.content,
          args.mode ?? 0o600
        )
      },
    }
  }
}

function shellEscape(v: string): string {
  // Wrap in single quotes; close-and-escape any single quotes inside.
  return `'${v.replace(/'/g, `'\\''`)}'`
}
