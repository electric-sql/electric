import path from 'node:path'
import { serverLog } from './log.js'
import {
  createBuiltinAgentHandler,
  registerBuiltinAgentTypes,
} from './bootstrap.js'
import {
  createRegistry as createMcpRegistry,
  loadConfig as loadMcpConfig,
  watchConfig as watchMcpConfig,
  bridgeMcpTool,
  buildResourceTools,
  buildPromptTools,
  keychainPersistence,
} from '@electric-ax/agents-mcp'
import type {
  McpConfig,
  McpServerConfig,
  Registry as McpRegistry,
} from '@electric-ax/agents-mcp'
import {
  createPullWakeRunner,
  appendPathToUrl,
  registerToolProvider,
  unregisterToolProvider,
} from '@electric-ax/agents-runtime'
import type {
  AgentTool,
  EntityStreamDBWithActions,
  PullWakeRunner,
  PullWakeRunnerConfig,
} from '@electric-ax/agents-runtime'
import type { ChangeEvent } from '@durable-streams/state'
import type { StreamFn } from '@mariozechner/pi-agent-core'

export interface BuiltinAgentsServerOptions {
  agentServerUrl: string
  workingDirectory?: string
  mockStreamFn?: StreamFn
  /** Pull-wake runner configuration for built-in agents. */
  pullWake: {
    runnerId: string
    ownerUserId?: string
    label?: string
    registerRunner?: boolean
    headers?: PullWakeRunnerConfig[`headers`]
    claimHeaders?: PullWakeRunnerConfig[`claimHeaders`]
    claimTokenHeader?: PullWakeRunnerConfig[`claimTokenHeader`]
    heartbeatIntervalMs?: PullWakeRunnerConfig[`heartbeatIntervalMs`]
    leaseMs?: PullWakeRunnerConfig[`leaseMs`]
  }
  /** Invoked when an `authorizationCode` server needs user consent. */
  openAuthorizeUrl?: (url: string, server: string) => void
  /**
   * MCP servers contributed by the embedder. Merged with `mcp.json`
   * when `loadProjectMcpConfig` is set; on name conflict `mcp.json`
   * wins. `authorizationCode` servers are wired to `keychainPersistence`.
   */
  extraMcpServers?: ReadonlyArray<McpServerConfig>
  /** Invoked when applying MCP config fails. Errors are always logged. */
  onConfigError?: (error: unknown) => void
  /**
   * Base for OAuth redirect URIs — full URI is
   * `<base>/oauth/callback/<server-name>`. Must be stable across
   * restarts so DCR client info stays valid. The runtime never
   * listens at this URI; the embedder intercepts the redirect.
   * Defaults to the runtime's own listen URL.
   */
  mcpOAuthRedirectBase?: string
  /**
   * Load `<workingDirectory>/mcp.json` (and watch it for changes).
   * Off by default — stdio MCP servers can spawn local commands,
   * so the embedder must opt in.
   */
  loadProjectMcpConfig?: boolean
  /** Override for the built-in skills directory; required when embedders bundle this package. */
  baseSkillsDir?: string
  createElectricTools?: (context: {
    entityUrl: string
    entityType: string
    args: Readonly<Record<string, unknown>>
    db: EntityStreamDBWithActions
    events: Array<ChangeEvent>
    upsertCronSchedule: (opts: {
      id: string
      expression: string
      timezone?: string
      payload?: unknown
      debounceMs?: number
      timeoutMs?: number
    }) => Promise<{ txid: string }>
    upsertFutureSendSchedule: (opts: {
      id: string
      payload: unknown
      targetUrl?: string
      fireAt: string
      from?: string
      messageType?: string
    }) => Promise<{ txid: string }>
    deleteSchedule: (opts: { id: string }) => Promise<{ txid: string }>
  }) => Array<AgentTool> | Promise<Array<AgentTool>>
}

export class BuiltinAgentsServer {
  private bootstrap: Awaited<
    ReturnType<typeof createBuiltinAgentHandler>
  > | null = null
  private _mcpRegistry: McpRegistry | null = null
  private mcpWatcherCloser: (() => void) | null = null
  private mcpToolProviderName: string | null = null
  private mcpApplyInFlight: Set<Promise<void>> = new Set()
  private mcpStopping = false
  private pullWakeRunner: PullWakeRunner | null = null
  readonly options: BuiltinAgentsServerOptions

  constructor(options: BuiltinAgentsServerOptions) {
    this.options = options
  }

  /** Embedded MCP registry. `null` until `start()` has run. */
  get mcpRegistry(): McpRegistry | null {
    return this._mcpRegistry
  }

  async start(): Promise<string> {
    if (this.bootstrap || this.pullWakeRunner) {
      throw new Error(`Builtin agents runtime already started`)
    }

    const pullWake = this.options.pullWake
    if (!pullWake?.runnerId) {
      throw new Error(`Builtin agents require a pull-wake runner id`)
    }

    try {
      const publicUrl =
        this.options.mcpOAuthRedirectBase ?? this.options.agentServerUrl

      const mcpRegistry = createMcpRegistry({
        publicUrl,
        openAuthorizeUrl: this.options.openAuthorizeUrl,
      })
      this._mcpRegistry = mcpRegistry
      const mcpConfigPath = this.options.loadProjectMcpConfig
        ? path.resolve(
            this.options.workingDirectory ?? process.cwd(),
            `mcp.json`
          )
        : null
      const extras = this.options.extraMcpServers ?? []

      const wirePersistence = async (cfg: McpConfig): Promise<McpConfig> => {
        const servers: McpServerConfig[] = []
        for (const s of cfg.servers) {
          if (s.transport === `http` && s.auth?.mode === `authorizationCode`) {
            const persist = await keychainPersistence({ server: s.name })
            servers.push({
              ...s,
              auth: { ...s.auth, ...persist },
            })
          } else {
            servers.push(s)
          }
        }
        return { ...cfg, servers }
      }

      // On name conflict between extras and mcp.json, mcp.json wins.
      const merge = (jsonCfg: McpConfig | null): McpConfig => {
        const jsonServers = jsonCfg?.servers ?? []
        const jsonNames = new Set(jsonServers.map((s) => s.name))
        const filteredExtras = extras.filter((s) => !jsonNames.has(s.name))
        return {
          servers: [...filteredExtras, ...jsonServers],
          raw: jsonCfg?.raw,
        }
      }

      const onConfigError = this.options.onConfigError
      const runApply = async (jsonCfg: McpConfig | null): Promise<void> => {
        if (this.mcpStopping) return
        try {
          const wired = await wirePersistence(merge(jsonCfg))
          if (this.mcpStopping) return
          await mcpRegistry.applyConfig(wired)
        } catch (e) {
          serverLog.error(`[mcp] applyConfig:`, e)
          try {
            onConfigError?.(e)
          } catch (cbErr) {
            serverLog.error(`[mcp] onConfigError callback failed:`, cbErr)
          }
        }
      }
      const applyMerged = (jsonCfg: McpConfig | null): Promise<void> => {
        const p = runApply(jsonCfg)
        this.mcpApplyInFlight.add(p)
        void p.finally(() => this.mcpApplyInFlight.delete(p))
        return p
      }

      if (mcpConfigPath) {
        try {
          const cfg = await loadMcpConfig(mcpConfigPath, process.env)
          void applyMerged(cfg)
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== `ENOENT`) throw err
          if (extras.length === 0) {
            serverLog.info(
              `[mcp] no ${mcpConfigPath} — starting with no servers`
            )
          } else {
            serverLog.info(
              `[mcp] no ${mcpConfigPath} — starting with ${extras.length} server(s) from extras`
            )
          }
          void applyMerged(null)
        }

        try {
          this.mcpWatcherCloser = await watchMcpConfig(mcpConfigPath, {
            onChange: (cfg) => void applyMerged(cfg),
            onError: (e) => serverLog.error(`[mcp] config error:`, e),
          })
        } catch (e) {
          serverLog.error(`[mcp] config watcher failed to start:`, e)
        }
      } else {
        if (extras.length > 0) {
          serverLog.info(
            `[mcp] starting with ${extras.length} server(s) from extras`
          )
        }
        void applyMerged(null)
      }

      this.mcpToolProviderName = `mcp`
      registerToolProvider({
        name: `mcp`,
        tools: () => {
          const tools: ReturnType<typeof bridgeMcpTool>[] = []
          for (const entry of mcpRegistry.list()) {
            if (entry.status !== `ready`) continue
            const live = mcpRegistry.get(entry.name)
            if (!live?.transport) continue
            for (const t of entry.tools) {
              tools.push(
                bridgeMcpTool({
                  server: entry.name,
                  tool: t,
                  client: live.transport.client as {
                    callTool: (
                      args: { name: string; arguments?: unknown },
                      resultSchema?: unknown,
                      opts?: {
                        onProgress?: (p: unknown) => void
                        signal?: AbortSignal
                      }
                    ) => Promise<unknown>
                  },
                  timeoutMs: live.config.timeoutMs,
                })
              )
            }
            const caps = (
              live.transport.client as any
            ).getServerCapabilities?.()
            if (caps?.resources) {
              tools.push(
                ...buildResourceTools({
                  server: entry.name,
                  client: live.transport.client as any,
                  timeoutMs: live.config.timeoutMs,
                })
              )
            }
            if (caps?.prompts) {
              tools.push(
                ...buildPromptTools({
                  server: entry.name,
                  client: live.transport.client as any,
                  timeoutMs: live.config.timeoutMs,
                })
              )
            }
          }
          return tools
        },
      })
      // --- end MCP wiring ---

      this.bootstrap = await createBuiltinAgentHandler({
        agentServerUrl: this.options.agentServerUrl,
        workingDirectory: this.options.workingDirectory,
        streamFn: this.options.mockStreamFn,
        createElectricTools: this.options.createElectricTools,
        publicUrl,
        runtimeName: `builtin-agents`,
        baseSkillsDir: this.options.baseSkillsDir,
        serverHeaders: pullWake.headers,
      })
      if (!this.bootstrap) {
        throw new Error(
          `ANTHROPIC_API_KEY or OPENAI_API_KEY must be set before starting builtin agents`
        )
      }

      await registerBuiltinAgentTypes(this.bootstrap)
      const registeredRunner = pullWake.registerRunner
        ? await this.registerPullWakeRunner(pullWake)
        : null
      this.pullWakeRunner = createPullWakeRunner({
        baseUrl: this.options.agentServerUrl,
        runnerId: pullWake.runnerId,
        runtime: this.bootstrap.runtime,
        headers: pullWake.headers,
        claimHeaders: pullWake.claimHeaders,
        claimTokenHeader: pullWake.claimTokenHeader,
        heartbeatIntervalMs: pullWake.heartbeatIntervalMs,
        leaseMs: pullWake.leaseMs,
        offset: registeredRunner?.wake_stream_offset,
        onError: (error) => {
          serverLog.error(`[builtin-agents] pull-wake runner failed`, error)
          return true
        },
      })
      this.pullWakeRunner.start()
      serverLog.info(
        `[builtin-agents] pull-wake runner started: ${pullWake.runnerId}`
      )
      return `pull-wake:${pullWake.runnerId}`
    } catch (error) {
      await this.stop().catch(() => {})
      throw error
    }
  }

  async stop(): Promise<void> {
    if (this.pullWakeRunner) {
      await this.pullWakeRunner.stop().catch((e) => {
        serverLog.error(`[builtin-agents] pull-wake runner stop failed`, e)
      })
      this.pullWakeRunner = null
    }

    if (this.bootstrap) {
      this.bootstrap.runtime.abortWakes()
      await Promise.race([
        this.bootstrap.runtime.drainWakes().catch((err) => {
          serverLog.error(
            `[builtin-agents] drainWakes failed during shutdown:`,
            err
          )
        }),
        new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
      ])
      this.bootstrap = null
    }

    // Order: latch stopping flag, close watcher, drain in-flight
    // applies, unregister provider, close registry. Each step
    // protects the next from acting on torn-down state.
    this.mcpStopping = true

    if (this.mcpWatcherCloser) {
      try {
        this.mcpWatcherCloser()
      } catch (e) {
        serverLog.error(`[mcp] watcher close failed:`, e)
      }
      this.mcpWatcherCloser = null
    }

    if (this.mcpApplyInFlight.size > 0) {
      await Promise.allSettled([...this.mcpApplyInFlight])
    }

    if (this.mcpToolProviderName) {
      unregisterToolProvider(this.mcpToolProviderName)
      this.mcpToolProviderName = null
    }

    if (this._mcpRegistry) {
      await this._mcpRegistry.close().catch((e) => {
        serverLog.error(`[mcp] registry close failed:`, e)
      })
      this._mcpRegistry = null
    }

    this.mcpStopping = false
  }

  private async registerPullWakeRunner(
    pullWake: NonNullable<BuiltinAgentsServerOptions[`pullWake`]>
  ): Promise<{ wake_stream_offset?: string }> {
    const headers = new Headers(
      typeof pullWake.headers === `function`
        ? await pullWake.headers()
        : pullWake.headers
    )
    headers.set(`content-type`, `application/json`)
    const response = await fetch(
      appendPathToUrl(this.options.agentServerUrl, `/_electric/runners`),
      {
        method: `POST`,
        headers,
        body: JSON.stringify({
          id: pullWake.runnerId,
          owner_user_id: `user:${pullWake.ownerUserId}`,
          label: pullWake.label ?? `Built-in agents`,
          kind: `local`,
          admin_status: `enabled`,
        }),
      }
    )
    if (!response.ok) {
      throw new Error(
        `Failed to register pull-wake runner ${pullWake.runnerId}: ${response.status} ${await response.text()}`
      )
    }
    return (await response.json()) as { wake_stream_offset?: string }
  }
}
