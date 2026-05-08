import path from 'node:path'
import { createServer } from 'node:http'
import { serverLog } from './log.js'
import {
  DEFAULT_BUILTIN_AGENT_HANDLER_PATH,
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
  registerToolProvider,
  unregisterToolProvider,
} from '@electric-ax/agents-runtime'
import type {
  AgentTool,
  EntityStreamDBWithActions,
} from '@electric-ax/agents-runtime'
import type { ChangeEvent } from '@durable-streams/state'
import type { StreamFn } from '@mariozechner/pi-agent-core'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'

export interface BuiltinAgentsServerOptions {
  agentServerUrl: string
  baseUrl?: string
  port: number
  host?: string
  workingDirectory?: string
  mockStreamFn?: StreamFn
  webhookPath?: string
  /**
   * Forwarded to the embedded MCP registry. Invoked when an
   * authorizationCode-flow server first needs the user to consent.
   * The Electron desktop app sets this to "open a sandboxed
   * BrowserWindow"; headless embedders can leave it undefined.
   */
  openAuthorizeUrl?: (url: string, server: string) => void
  /**
   * MCP servers contributed by the embedder (e.g. desktop's
   * `settings.json` `mcp.servers`). Always applied; merged with the
   * project-scoped `mcp.json` if present, with `mcp.json` winning by
   * name on conflict. Auto-wired with `keychainPersistence` for
   * `authorizationCode` servers, same as `mcp.json` entries.
   */
  extraMcpServers?: ReadonlyArray<McpServerConfig>
  /**
   * Optional callback invoked when applying an MCP config (initial
   * boot or watcher reload) fails. Errors are always logged via
   * `serverLog.error`; this callback is the embedder's hook for
   * surfacing them programmatically — e.g. forwarding to a renderer
   * over IPC so the desktop UI can show a banner. The callback runs
   * after the catch, so per-server entry errors (which still appear
   * in the registry snapshot) are unaffected.
   */
  onConfigError?: (error: unknown) => void
  /**
   * Base used to derive OAuth redirect URIs for `authorizationCode`
   * MCP servers — full URI is `<base>/oauth/callback/<server-name>`.
   * Defaults to `process.env.MCP_RUNTIME_PUBLIC_URL` or the runtime's
   * own URL. Embedders that listen on an ephemeral port (the Electron
   * desktop runs on `port: 0`) MUST set this to a stable value;
   * otherwise the cached DCR client info goes stale every restart
   * and users have to re-authorize on every launch. The runtime
   * never hosts an HTTP listener at this URI — the embedder's
   * BrowserWindow (or whatever drives the OAuth flow) intercepts
   * the redirect before it hits the network.
   */
  mcpOAuthRedirectBase?: string
  /**
   * Enable loading project-scoped `mcp.json` from `workingDirectory`.
   * Defaults to `false`: stdio MCP servers spawn local commands, so
   * picking a working directory should not auto-execute config from
   * that directory. Embedders that want project config (the Electron
   * desktop, the `electric-ax` CLI) opt in explicitly.
   *
   * - `true` — load `<workingDirectory>/mcp.json` (and watch it).
   * - `string` — load that exact path instead.
   * - `false` / `undefined` — do not read or watch any `mcp.json`;
   *    only `extraMcpServers` is applied.
   */
  loadProjectMcpConfig?: boolean | string
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
  private server: Server | null = null
  private bootstrap: Awaited<
    ReturnType<typeof createBuiltinAgentHandler>
  > | null = null
  private _url: string | null = null
  private publicBaseUrl: string | null = null
  private _mcpRegistry: McpRegistry | null = null
  private mcpWatcherCloser: (() => void) | null = null
  private mcpToolProviderName: string | null = null
  // In-flight `applyMerged` promises. `stop()` awaits these so the
  // registry isn't torn down while a config apply is mid-flight.
  private mcpApplyInFlight: Set<Promise<void>> = new Set()
  // Latched once `stop()` starts so any debounced watcher reload
  // that fires during teardown short-circuits instead of resurrecting
  // transports against a registry that's about to clear.
  private mcpStopping = false
  readonly options: BuiltinAgentsServerOptions

  constructor(options: BuiltinAgentsServerOptions) {
    this.options = options
  }

  /**
   * Read-only access to the embedded MCP registry. `null` until `start()`
   * has run. The Electron desktop uses this to subscribe to state changes
   * and forward them to renderer windows over IPC.
   */
  get mcpRegistry(): McpRegistry | null {
    return this._mcpRegistry
  }

  get url(): string {
    if (!this._url) {
      throw new Error(`Builtin agents server not started`)
    }
    return this._url
  }

  get registeredBaseUrl(): string {
    if (!this.publicBaseUrl) {
      throw new Error(`Builtin agents server not started`)
    }
    return this.publicBaseUrl
  }

  async start(): Promise<string> {
    if (this.server) {
      throw new Error(`Builtin agents server already started`)
    }

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res).catch((error) => {
          serverLog.error(`[builtin-agents] unhandled request error`, error)
          if (!res.headersSent) {
            res.writeHead(500, { 'content-type': `application/json` })
            res.end(JSON.stringify({ error: `Internal server error` }))
          }
        })
      })

      this.server.on(`error`, reject)

      const host = this.options.host ?? `127.0.0.1`
      this.server.listen(this.options.port, host, async () => {
        try {
          const addr = this.server!.address()
          if (typeof addr === `string`) {
            this._url = addr
          } else if (addr) {
            const resolvedHost = host === `0.0.0.0` ? `127.0.0.1` : host
            this._url = `http://${resolvedHost}:${addr.port}`
          } else {
            throw new Error(`Could not determine builtin agents server address`)
          }

          this.publicBaseUrl = this.options.baseUrl ?? this._url
          const webhookPath =
            this.options.webhookPath ?? DEFAULT_BUILTIN_AGENT_HANDLER_PATH
          const serveEndpoint = new URL(
            webhookPath,
            this.publicBaseUrl.endsWith(`/`)
              ? this.publicBaseUrl
              : `${this.publicBaseUrl}/`
          ).toString()

          const publicUrl =
            this.options.mcpOAuthRedirectBase ??
            process.env.MCP_RUNTIME_PUBLIC_URL ??
            this.publicBaseUrl

          // --- MCP wiring ---
          // No credential store. The registry's private auth cache holds
          // OAuth tokens for the lifetime of this process; cross-restart
          // persistence is opted into per-server via keychainPersistence
          // (or whatever the operator wires onto onTokensChanged) below.
          const mcpRegistry = createMcpRegistry({
            publicUrl,
            openAuthorizeUrl: this.options.openAuthorizeUrl,
          })
          this._mcpRegistry = mcpRegistry
          // mcp.json is project-scoped and must be opted into. Stdio
          // MCP servers spawn arbitrary local commands, so we don't
          // auto-execute config from a working directory unless the
          // embedder explicitly asked for it. The Electron desktop
          // and the `electric-ax` CLI opt in; library embedders get
          // the safer default of "extras only".
          const loadProject = this.options.loadProjectMcpConfig
          const mcpConfigPath: string | null =
            typeof loadProject === `string`
              ? loadProject
              : loadProject === true
                ? path.resolve(
                    this.options.workingDirectory ?? process.cwd(),
                    `mcp.json`
                  )
                : null
          const extras = this.options.extraMcpServers ?? []

          // Walks a config and, for every authorizationCode server,
          // awaits keychainPersistence(server) and merges the returned
          // auth-config slice (tokens / client / hooks) into the
          // server's auth config. Tokens then survive process restarts
          // via the OS keychain.
          const wirePersistence = async (
            cfg: McpConfig
          ): Promise<McpConfig> => {
            const servers: McpServerConfig[] = []
            for (const s of cfg.servers) {
              if (
                s.transport === `http` &&
                s.auth?.mode === `authorizationCode`
              ) {
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

          // Merge: embedder-provided extras + workspace mcp.json. On
          // name conflict, mcp.json wins (project scope overrides
          // global). Servers from both sides that don't conflict are
          // applied together. `raw` is preserved when the workspace
          // file contributed one — otherwise undefined; the registry
          // does not look at `raw` during applyConfig.
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
              // Fire-and-forget: HTTPS discovery + DCR can take seconds.
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

          // No HTTP admin / OAuth-callback surface anymore. The browser
          // OAuth flow is hosted by the Electron desktop (which intercepts
          // the redirect_uri navigation in a sandboxed BrowserWindow);
          // headless embedders that hosted this BuiltinAgentsServer
          // directly only see api-key / clientCredentials / pre-fed-token
          // flows, none of which need an HTTP listener.

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
            serveEndpoint,
            workingDirectory: this.options.workingDirectory,
            streamFn: this.options.mockStreamFn,
            createElectricTools: this.options.createElectricTools,
            publicUrl,
            runtimeName: `builtin-agents`,
          })
          if (!this.bootstrap) {
            throw new Error(
              `ANTHROPIC_API_KEY or OPENAI_API_KEY must be set before starting builtin agents`
            )
          }

          await registerBuiltinAgentTypes(this.bootstrap)
          serverLog.info(
            `[builtin-agents] webhook handler listening at ${serveEndpoint}`
          )
          resolve(this._url)
        } catch (error) {
          await this.stop().catch(() => {})
          reject(error)
        }
      })
    })
  }

  async stop(): Promise<void> {
    if (this.bootstrap) {
      this.bootstrap.runtime.abortWakes()
      await Promise.race([
        this.bootstrap.runtime.drainWakes().catch(() => {}),
        new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
      ])
      this.bootstrap = null
    }

    // MCP teardown:
    //   1. Latch `mcpStopping` so any debounced watcher reload that
    //      runs during shutdown short-circuits before touching the
    //      registry.
    //   2. Stop the file watcher.
    //   3. Drain in-flight `applyMerged` promises so the registry
    //      isn't cleared underneath an active applyConfig.
    //   4. Unregister the tool provider so wake-time composition
    //      stops resolving against this registry.
    //   5. Close registry transports last.
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

    if (this.server) {
      const server = this.server
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
      this.server = null
    }

    this.mcpStopping = false
    this._url = null
    this.publicBaseUrl = null
  }

  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const method = req.method?.toUpperCase()
    const pathname = new URL(req.url ?? `/`, `http://localhost`).pathname
    const webhookPath =
      this.options.webhookPath ?? DEFAULT_BUILTIN_AGENT_HANDLER_PATH

    if (pathname === `/_electric/health` && method === `GET`) {
      res.writeHead(200, { 'content-type': `application/json` })
      res.end(JSON.stringify({ status: `ok` }))
      return
    }

    if (pathname === webhookPath && method === `POST` && this.bootstrap) {
      await this.bootstrap.handler(req, res)
      return
    }

    res.writeHead(404, { 'content-type': `application/json` })
    res.end(JSON.stringify({ error: `Not found` }))
  }
}
