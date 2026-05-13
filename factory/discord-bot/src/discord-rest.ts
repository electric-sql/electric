const API_BASE = `https://discord.com/api/v10`

export interface DiscordRestOptions {
  token: string
  fetch?: typeof globalThis.fetch
  baseUrl?: string
}

export class DiscordRestError extends Error {
  constructor(
    public status: number,
    public body: unknown
  ) {
    super(`Discord API ${status}: ${JSON.stringify(body)}`)
  }
}

export interface DiscordRest {
  get<T = unknown>(path: string): Promise<T>
  post<T = unknown>(path: string, body: unknown): Promise<T>
  patch<T = unknown>(path: string, body: unknown): Promise<T>
  put<T = unknown>(path: string, body: unknown): Promise<T>
  delete<T = unknown>(path: string): Promise<T>
}

const MAX_ATTEMPTS = 2

export function createDiscordRest(opts: DiscordRestOptions): DiscordRest {
  const fetchFn = opts.fetch ?? globalThis.fetch
  const base = opts.baseUrl ?? API_BASE

  async function request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    let attempts = 0
    while (true) {
      attempts++
      const res = await fetchFn(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bot ${opts.token}`,
          'Content-Type': `application/json`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (res.status === 429 && attempts < MAX_ATTEMPTS) {
        const payload = (await res.json().catch(() => ({}))) as {
          retry_after?: number
        }
        await new Promise((r) =>
          setTimeout(r, Math.ceil((payload.retry_after ?? 1) * 1000))
        )
        continue
      }
      const text = await res.text()
      const parsed = text ? JSON.parse(text) : null
      if (!res.ok) throw new DiscordRestError(res.status, parsed)
      return parsed as T
    }
  }

  return {
    get: (path) => request(`GET`, path),
    post: (path, body) => request(`POST`, path, body),
    patch: (path, body) => request(`PATCH`, path, body),
    put: (path, body) => request(`PUT`, path, body),
    delete: (path) => request(`DELETE`, path),
  }
}
