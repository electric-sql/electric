import { useEffect, useState } from 'react'

export type McpStatus =
  | `connecting`
  | `authenticating`
  | `ready`
  | `error`
  | `disabled`

export interface McpServerRow {
  name: string
  transport?: `http` | `stdio`
  url?: string
  authMode?: string
  status: McpStatus
  authUrl?: string
  error?: { kind: string; message: string }
  toolCount: number
  tools?: Array<{ name: string; description?: string }>
}

export interface UseMcpServersOpts {
  runtimeUrl: string
  fetchImpl?: typeof fetch
  idleMs?: number /* default 10_000 */
  authMs?: number /* default 2_000 */
}

export function useMcpServers(opts: UseMcpServersOpts) {
  const [servers, setServers] = useState<McpServerRow[]>([])
  const [error, setError] = useState<Error | undefined>()
  const fetchImpl = opts.fetchImpl ?? fetch
  const idle = opts.idleMs ?? 10_000
  const authMs = opts.authMs ?? 2_000

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const load = async () => {
      try {
        const res = await fetchImpl(`${opts.runtimeUrl}/api/mcp/servers`)
        if (!res.ok) throw new Error(`servers ${res.status}`)
        const json = (await res.json()) as { servers: McpServerRow[] }
        if (cancelled) return
        setServers(json.servers)
        setError(undefined)
        const wait = json.servers.some((s) => s.status === `authenticating`)
          ? authMs
          : idle
        timer = setTimeout(load, wait)
      } catch (err) {
        if (cancelled) return
        setError(err as Error)
        timer = setTimeout(load, idle)
      }
    }

    void load()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [opts.runtimeUrl, fetchImpl, idle, authMs])

  return { servers, error }
}
