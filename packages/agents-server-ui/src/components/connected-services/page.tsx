import { useEffect, useState } from 'react'
import { Badge, Button, Stack, Text } from '../../ui'
import type { BadgeTone } from '../../ui'
import { useServerConnection } from '../../hooks/useServerConnection'
import { MainHeader } from '../MainHeader'
import styles from './page.module.css'

/**
 * Shape returned by `GET /api/mcp/servers` (see Task 25).
 *
 * Mirrors `ServerSummary` in `packages/agents-server/src/mcp-status-routes.ts`.
 * Keep this in sync if the server-side shape changes.
 */
interface ServerRow {
  name: string
  transport: string
  authMode: string | null
  status: string
  lastError?: string
  toolCount: number
  // Some deployments include a last-refresh timestamp; render it when present.
  lastRefreshedAt?: string
}

/**
 * Connected Services page (Task 26 — shell only).
 *
 * Lists every registered MCP server with its transport, auth mode,
 * status, tool count, and (when surfaced by the server) last-refresh
 * time. Per-row actions (Authorize / Disable / etc) are placeholders
 * here and get wired up in Task 27.
 */
export function ConnectedServicesPage(): React.ReactElement {
  const { activeServer } = useServerConnection()
  const baseUrl = activeServer?.url ?? ``
  const [rows, setRows] = useState<Array<ServerRow>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`${baseUrl}/api/mcp/servers`)
      .then((r) =>
        r.ok
          ? (r.json() as Promise<Array<ServerRow>>)
          : Promise.reject(new Error(`HTTP ${r.status}`))
      )
      .then((data) => {
        if (cancelled) return
        setRows(data)
        setLoading(false)
      })
      .catch((err: Error) => {
        if (cancelled) return
        setError(err.message)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl])

  return (
    <div className={styles.shell}>
      <MainHeader title={<Text size={2}>Connected Services</Text>} />
      <div className={styles.body}>
        <div className={styles.container}>
          <Stack direction="column" gap={4}>
            <div className={styles.heading}>
              <Text size={5} as="h1" className={styles.headingTitle}>
                Connected Services
              </Text>
              <span className={styles.headingSubtitle}>
                MCP servers registered with this agents server.
              </span>
            </div>

            {loading && <div className={styles.placeholder}>Loading…</div>}
            {error && (
              <div className={styles.error}>Error loading servers: {error}</div>
            )}
            {!loading && !error && rows.length === 0 && (
              <div className={styles.placeholder}>
                No MCP servers configured.
              </div>
            )}
            {!loading && !error && rows.length > 0 && (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Transport</th>
                      <th>Auth</th>
                      <th>Status</th>
                      <th>Tools</th>
                      <th>Last refreshed</th>
                      <th>Last error</th>
                      <th className={styles.actionsCol}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.name}>
                        <td className={styles.nameCell}>{r.name}</td>
                        <td>{r.transport}</td>
                        <td>{r.authMode ?? `—`}</td>
                        <td>
                          <StatusPill status={r.status} />
                        </td>
                        <td>{r.toolCount}</td>
                        <td>{formatRefreshed(r.lastRefreshedAt)}</td>
                        <td className={styles.errorCell}>
                          {r.lastError ?? `—`}
                        </td>
                        <td className={styles.actionsCol}>
                          <RowActions />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Stack>
        </div>
      </div>
    </div>
  )
}

function formatRefreshed(value: string | undefined): string {
  if (!value) return `—`
  const ts = Date.parse(value)
  if (Number.isNaN(ts)) return value
  return new Date(ts).toLocaleString()
}

/**
 * Status -> tone mapping for the design-system `Badge`.
 *
 * Kept in one place so we can keep the colour vocabulary consistent
 * (Task 27 will use the same mapping when it adds row actions that
 * change the displayed status).
 */
function statusTone(status: string): BadgeTone {
  switch (status) {
    case `healthy`:
      return `success`
    case `expiring`:
      return `warning`
    case `needs_auth`:
      return `yellow`
    case `error`:
      return `danger`
    case `disabled`:
      return `neutral`
    default:
      return `info`
  }
}

function StatusPill({ status }: { status: string }): React.ReactElement {
  return (
    <Badge tone={statusTone(status)} variant="soft">
      {status}
    </Badge>
  )
}

/**
 * Placeholder action cluster — Task 27 wires up Authorize / Disable / etc.
 * Rendered disabled here so the layout / spacing already settle.
 */
function RowActions(): React.ReactElement {
  return (
    <Stack gap={2}>
      <Button size={1} variant="soft" tone="neutral" disabled>
        Authorize
      </Button>
      <Button size={1} variant="soft" tone="neutral" disabled>
        Disable
      </Button>
    </Stack>
  )
}
