import { useCallback, useEffect, useState } from 'react'
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

/** A per-row action handler. Tightly bound to the buttons rendered below. */
type ActionKind = `authorize` | `disable` | `enable` | `disconnect`

/**
 * Connected Services page.
 *
 * Lists every registered MCP server (transport / auth / status / tools /
 * last-refresh / last-error) and exposes per-row actions:
 *
 *   - Authorize / Re-authorize: `authorizationCode` mode only. Hits
 *     `POST /api/mcp/servers/:server/authorize` (empty body — the server
 *     resolves OAuth params from registry+vault, see Option B in
 *     `oauth-routes.ts`) and opens the returned URL in a new tab.
 *   - Disable / Enable: `POST .../disable` or `.../enable` depending on
 *     current status.
 *   - Disconnect: `DELETE .../credentials`. Always available for HTTP
 *     servers; clears the vault entry (or token cache) and disables the
 *     server.
 *
 * The list also auto-refreshes every 5 seconds so status flips after an
 * authorize round-trip become visible without a manual reload.
 */
export function ConnectedServicesPage(): React.ReactElement {
  const { activeServer } = useServerConnection()
  const baseUrl = activeServer?.url ?? ``
  const [rows, setRows] = useState<Array<ServerRow>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    try {
      const r = await fetch(`${baseUrl}/api/mcp/servers`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = (await r.json()) as Array<ServerRow>
      setRows(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [baseUrl])

  useEffect(() => {
    setLoading(true)
    void reload()
    const t = setInterval(() => {
      void reload()
    }, 5000)
    return () => clearInterval(t)
  }, [reload])

  /**
   * Wire a click on a row button to the matching server endpoint.
   *
   * `authorize` is special: the server returns `{ url }` and we open it
   * in a new tab so the user can complete the OAuth dance. The other
   * three are fire-and-forget; we just re-fetch the list to pick up the
   * new status.
   */
  const action = useCallback(
    async (server: string, kind: ActionKind): Promise<void> => {
      const key = `${server}:${kind}`
      setBusy(key)
      try {
        if (kind === `authorize`) {
          const r = await fetch(
            `${baseUrl}/api/mcp/servers/${encodeURIComponent(server)}/authorize`,
            {
              method: `POST`,
              headers: { 'Content-Type': `application/json` },
              body: `{}`,
            }
          )
          if (r.ok) {
            const { url } = (await r.json()) as { url: string }
            window.open(url, `_blank`, `noopener,noreferrer`)
          } else {
            const text = await r.text()

            alert(`Failed to start auth: ${text}`)
          }
        } else {
          const method = kind === `disconnect` ? `DELETE` : `POST`
          const path = kind === `disconnect` ? `credentials` : kind
          await fetch(
            `${baseUrl}/api/mcp/servers/${encodeURIComponent(server)}/${path}`,
            { method }
          )
        }
        await reload()
      } finally {
        setBusy(null)
      }
    },
    [baseUrl, reload]
  )

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
                          <RowActions row={r} busy={busy} onAction={action} />
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
 * across the table and any future status displays.
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

interface RowActionsProps {
  row: ServerRow
  busy: string | null
  onAction: (server: string, kind: ActionKind) => Promise<void>
}

/**
 * The per-row action cluster.
 *
 * Buttons are shown / hidden / labelled based on the row's current state:
 *
 *   - `Authorize` / `Re-authorize` only renders for `authorizationCode`
 *     servers. The label flips to `Re-authorize` once the server has
 *     credentials (any status that isn't `needs_auth`).
 *   - `Disable` / `Enable` flips on the `disabled` status.
 *   - `Disconnect` renders only for HTTP servers — stdio servers don't
 *     have credentials to clear.
 */
function RowActions({
  row,
  busy,
  onAction,
}: RowActionsProps): React.ReactElement {
  const isHttp = row.transport === `http`
  const isAuthCode = row.authMode === `authorizationCode`
  const isDisabled = row.status === `disabled`
  const needsAuth = row.status === `needs_auth`
  const busyFor = (kind: ActionKind): boolean => busy === `${row.name}:${kind}`

  return (
    <Stack gap={2}>
      {isAuthCode && (
        <Button
          size={1}
          variant="soft"
          tone="accent"
          disabled={busyFor(`authorize`)}
          onClick={() => {
            void onAction(row.name, `authorize`)
          }}
        >
          {needsAuth ? `Authorize` : `Re-authorize`}
        </Button>
      )}
      {isDisabled ? (
        <Button
          size={1}
          variant="soft"
          tone="neutral"
          disabled={busyFor(`enable`)}
          onClick={() => {
            void onAction(row.name, `enable`)
          }}
        >
          Enable
        </Button>
      ) : (
        <Button
          size={1}
          variant="soft"
          tone="neutral"
          disabled={busyFor(`disable`)}
          onClick={() => {
            void onAction(row.name, `disable`)
          }}
        >
          Disable
        </Button>
      )}
      {isHttp && (
        <Button
          size={1}
          variant="soft"
          tone="danger"
          disabled={busyFor(`disconnect`)}
          onClick={() => {
            void onAction(row.name, `disconnect`)
          }}
        >
          Disconnect
        </Button>
      )}
    </Stack>
  )
}
