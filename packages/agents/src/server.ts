import { createServer } from 'node:http'
import { serverLog } from './log.js'
import {
  DEFAULT_BUILTIN_AGENT_HANDLER_PATH,
  createBuiltinAgentHandler,
  registerBuiltinAgentTypes,
} from './bootstrap.js'
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
  private bootstrap: ReturnType<typeof createBuiltinAgentHandler> | null = null
  private _url: string | null = null
  private publicBaseUrl: string | null = null
  readonly options: BuiltinAgentsServerOptions

  constructor(options: BuiltinAgentsServerOptions) {
    this.options = options
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

          this.bootstrap = createBuiltinAgentHandler({
            agentServerUrl: this.options.agentServerUrl,
            serveEndpoint,
            workingDirectory: this.options.workingDirectory,
            streamFn: this.options.mockStreamFn,
            createElectricTools: this.options.createElectricTools,
          })
          if (!this.bootstrap) {
            throw new Error(
              `ANTHROPIC_API_KEY must be set before starting builtin agents`
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

    if (this.server) {
      const server = this.server
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
      this.server = null
    }

    this._url = null
    this.publicBaseUrl = null
  }

  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const method = req.method?.toUpperCase()
    const path = new URL(req.url ?? `/`, `http://localhost`).pathname
    const webhookPath =
      this.options.webhookPath ?? DEFAULT_BUILTIN_AGENT_HANDLER_PATH

    if (path === `/_electric/health` && method === `GET`) {
      res.writeHead(200, { 'content-type': `application/json` })
      res.end(JSON.stringify({ status: `ok` }))
      return
    }

    if (path === webhookPath && method === `POST` && this.bootstrap) {
      await this.bootstrap.handler(req, res)
      return
    }

    res.writeHead(404, { 'content-type': `application/json` })
    res.end(JSON.stringify({ error: `Not found` }))
  }
}
