import { useEffect, useState } from 'react'
import type { ErrorResponse, HealthResponse } from '../../shared/types'

type HealthState =
  | { status: `loading` }
  | { status: `ready`; health: HealthResponse }
  | { status: `error`; error: string }

export function HealthPanel() {
  const [state, setState] = useState<HealthState>({ status: `loading` })

  useEffect(() => {
    let cancelled = false

    async function loadHealth() {
      try {
        const response = await fetch(`/api/health`)
        const data = (await response.json()) as HealthResponse | ErrorResponse

        if (cancelled) return

        if (!response.ok || !data.ok) {
          setState({
            status: `error`,
            error: data.ok ? `Unknown error` : data.error,
          })
          return
        }

        setState({ status: `ready`, health: data })
      } catch (error) {
        if (!cancelled) {
          setState({
            status: `error`,
            error: error instanceof Error ? error.message : `Unknown error`,
          })
        }
      }
    }

    void loadHealth()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div
      style={{
        marginTop: 28,
        padding: 20,
        border: `1px solid var(--lw-border)`,
        borderRadius: 16,
        background: `rgba(255,255,255,0.64)`,
      }}
    >
      {state.status === `loading` ? <p>Checking Worker API…</p> : null}
      {state.status === `error` ? (
        <p role="alert">Worker API error: {state.error}</p>
      ) : null}
      {state.status === `ready` ? (
        <div>
          <p style={{ margin: 0, fontWeight: 700 }}>Worker API: healthy</p>
          <p style={{ margin: `8px 0 0`, color: `var(--lw-muted)` }}>
            Environment: {state.health.env}
          </p>
          <p style={{ margin: `4px 0 0`, color: `var(--lw-muted)` }}>
            Electric Agents space: {state.health.electricAgentsSpaceId}
          </p>
          <p style={{ margin: `4px 0 0`, color: `var(--lw-muted)` }}>
            Electric Cloud token configured:{` `}
            {state.health.electricCloudConfigured ? `yes` : `no`}
          </p>
        </div>
      ) : null}
    </div>
  )
}
