import { useEffect, useState } from 'react'

export interface Runtime {
  name: string
  publicUrl: string
  types: string[]
}

export interface UseRuntimesOpts {
  baseUrl?: string /* default: '' (same-origin) */
  fetchImpl?: typeof fetch
  /** ms; default 60000. */
  refreshIntervalMs?: number
}

export function useRuntimes(opts: UseRuntimesOpts = {}) {
  const [runtimes, setRuntimes] = useState<Runtime[]>([])
  const [error, setError] = useState<Error | undefined>()
  const fetchImpl = opts.fetchImpl ?? fetch
  const baseUrl = opts.baseUrl ?? ``
  const interval = opts.refreshIntervalMs ?? 60_000

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const res = await fetchImpl(`${baseUrl}/api/runtimes`)
        if (!res.ok) throw new Error(`/api/runtimes ${res.status}`)
        const json = (await res.json()) as { runtimes: Runtime[] }
        if (!cancelled) {
          setRuntimes(json.runtimes)
          setError(undefined)
        }
      } catch (err) {
        if (!cancelled) setError(err as Error)
      }
    }

    void load()
    const onFocus = () => void load()
    window.addEventListener(`focus`, onFocus)
    const timer = setInterval(load, interval)
    return () => {
      cancelled = true
      window.removeEventListener(`focus`, onFocus)
      clearInterval(timer)
    }
  }, [baseUrl, fetchImpl, interval])

  return { runtimes, error }
}
