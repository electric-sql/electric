export interface SpritesApiClientOptions {
  token: string
  baseUrl?: string
}

export interface CreateSpriteRequest {
  name: string
  idleTimeoutSecs?: number
}

export interface SpriteSummary {
  id: string
  name: string
  status?: string
  url?: string // per-sprite URL e.g. https://<name>-<suffix>.sprites.app — used for WebSocket exec
}

export interface ListSpritesOptions {
  namePrefix?: string
  /** Page through results when the API indicates `has_more`. */
  continuationToken?: string
}

export class SpritesApiClient {
  private readonly _token: string
  private readonly baseUrl: string

  constructor(opts: SpritesApiClientOptions) {
    this._token = opts.token
    this.baseUrl = opts.baseUrl ?? `https://api.sprites.dev/v1`
  }

  /**
   * Expose the bearer token for the per-sprite exec WebSocket auth header.
   * The exec WebSocket lives on each sprite's per-sprite URL (NOT
   * api.sprites.dev) but uses the same Bearer token.
   */
  public tokenForExec(): string {
    return this._token
  }

  async createSprite(req: CreateSpriteRequest): Promise<SpriteSummary> {
    return await this.request(`POST`, `/sprites`, req)
  }

  async getSprite(name: string): Promise<SpriteSummary> {
    return await this.request(`GET`, `/sprites/${encodeURIComponent(name)}`)
  }

  async listSprites(opts: ListSpritesOptions = {}): Promise<{
    sprites: Array<SpriteSummary>
    has_more?: boolean
    next_continuation_token?: string | null
  }> {
    const params: Array<string> = []
    if (opts.namePrefix)
      params.push(`name_prefix=${encodeURIComponent(opts.namePrefix)}`)
    if (opts.continuationToken)
      params.push(
        `continuation_token=${encodeURIComponent(opts.continuationToken)}`
      )
    const qs = params.length > 0 ? `?${params.join(`&`)}` : ``
    return await this.request(`GET`, `/sprites${qs}`)
  }

  /**
   * Page through `listSprites` until `has_more` is false. Returns the
   * concatenated sprite array. Internal callers (findExisting,
   * cleanup-sprites) need this when a name prefix could match more
   * than one page; without it a sprite buried past the first page is
   * silently missed and `createSprite` 409s.
   */
  async listAllSprites(
    opts: ListSpritesOptions = {}
  ): Promise<{ sprites: Array<SpriteSummary> }> {
    const out: Array<SpriteSummary> = []
    let token: string | undefined = opts.continuationToken
    // Cap iterations defensively — should be rare in practice.
    for (let i = 0; i < 50; i++) {
      const page = (await this.listSprites({
        namePrefix: opts.namePrefix,
        continuationToken: token,
      })) as Awaited<ReturnType<typeof this.listSprites>>
      out.push(...page.sprites)
      if (!page.has_more || !page.next_continuation_token) break
      token = page.next_continuation_token
    }
    return { sprites: out }
  }

  async deleteSprite(name: string): Promise<void> {
    await this.request(`DELETE`, `/sprites/${encodeURIComponent(name)}`)
  }

  private async request<T = any>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this._token}`,
    }
    let bodyInit: string | undefined
    if (body !== undefined) {
      headers[`content-type`] = `application/json`
      bodyInit = JSON.stringify(body)
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: bodyInit,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => ``)
      throw new Error(
        `Sprites API ${method} ${path}: ${res.status} ${res.statusText}: ${text.slice(0, 200)}`
      )
    }
    if (res.status === 204) return undefined as T
    const ct = res.headers.get(`content-type`) ?? ``
    if (ct.includes(`application/json`)) {
      return (await res.json()) as T
    }
    return (await res.text()) as unknown as T
  }
}
