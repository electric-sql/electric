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
}

export class SpritesApiClient {
  private readonly token: string
  private readonly baseUrl: string

  constructor(opts: SpritesApiClientOptions) {
    this.token = opts.token
    this.baseUrl = opts.baseUrl ?? `https://api.sprites.dev/v1`
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
    const qs = opts.namePrefix
      ? `?name_prefix=${encodeURIComponent(opts.namePrefix)}`
      : ``
    return await this.request(`GET`, `/sprites${qs}`)
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
      authorization: `Bearer ${this.token}`,
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
