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
  /**
   * Sub-mode for `authorizationCode` servers. Lets the UI choose between
   * popping a browser tab and the device-code panel. `null` for non-OAuth
   * servers and any older agents-server that doesn't ship this field.
   */
  oauthFlow?: `browser` | `device` | null
  status: string
  lastError?: string
  toolCount: number
  // Some deployments include a last-refresh timestamp; render it when present.
  lastRefreshedAt?: string
}

/** A per-row action handler. Tightly bound to the buttons rendered below. */
type ActionKind = `authorize` | `device` | `disable` | `enable` | `disconnect`

/**
 * In-flight device-flow info kept on the page while the user completes
 * authorization on a second device. Cleared when status flips to
 * `completed` or when the user dismisses the panel.
 */
interface DeviceFlowPanelState {
  server: string
  userCode: string
  verificationUri: string
  verificationUriComplete?: string
  status: `pending` | `failed`
  error?: string
}

interface DeviceFlowStartResponse {
  status?: string
  userCode: string
  verificationUri: string
  verificationUriComplete?: string
  expiresAt?: string
}

interface DeviceFlowStatusResponse {
  status: `idle` | `pending` | `completed` | `failed`
  userCode?: string
  verificationUri?: string
  verificationUriComplete?: string
  error?: string
}

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
  const [devicePanel, setDevicePanel] = useState<DeviceFlowPanelState | null>(
    null
  )

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
        } else if (kind === `device`) {
          const r = await fetch(
            `${baseUrl}/oauth/device/${encodeURIComponent(server)}/start`,
            {
              method: `POST`,
              headers: { 'Content-Type': `application/json` },
              body: `{}`,
            }
          )
          if (r.ok) {
            const data = (await r.json()) as DeviceFlowStartResponse
            setDevicePanel({
              server,
              userCode: data.userCode,
              verificationUri: data.verificationUri,
              verificationUriComplete: data.verificationUriComplete,
              status: `pending`,
            })
          } else {
            const text = await r.text()
            alert(`Failed to start device flow: ${text}`)
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

  /**
   * Poll the device-flow status endpoint while a panel is open. When the
   * server reports `completed` we dismiss the panel and force a list
   * reload so the row's status flips from `needs_auth` to `healthy`.
   * `failed` keeps the panel up with the error so the user can read it
   * before dismissing.
   */
  useEffect(() => {
    if (!devicePanel) return undefined
    let cancelled = false
    const tick = async (): Promise<void> => {
      try {
        const r = await fetch(
          `${baseUrl}/oauth/device/${encodeURIComponent(devicePanel.server)}/status`
        )
        if (!r.ok) return
        const data = (await r.json()) as DeviceFlowStatusResponse
        if (cancelled) return
        if (data.status === `completed`) {
          setDevicePanel(null)
          void reload()
        } else if (data.status === `failed`) {
          setDevicePanel((prev) =>
            prev && prev.server === devicePanel.server
              ? { ...prev, status: `failed`, error: data.error }
              : prev
          )
        }
      } catch {
        // Ignore transient errors; the next tick will retry.
      }
    }
    const t = setInterval(() => {
      void tick()
    }, 2000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [devicePanel, baseUrl, reload])

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

            {devicePanel && (
              <DeviceFlowPanel
                state={devicePanel}
                onDismiss={() => setDevicePanel(null)}
              />
            )}
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
  const isDeviceFlow = row.oauthFlow === `device`
  // Default OAuth sub-mode is browser; only show the browser button when
  // the row says so explicitly, *or* when the server didn't ship the
  // `oauthFlow` field at all (older agents-server). That preserves
  // backward compat with older deployments.
  const isBrowserFlow = isAuthCode && (row.oauthFlow ?? `browser`) === `browser`
  const isDisabled = row.status === `disabled`
  const needsAuth = row.status === `needs_auth`
  const busyFor = (kind: ActionKind): boolean => busy === `${row.name}:${kind}`

  return (
    <Stack gap={2}>
      {isAuthCode && isBrowserFlow && (
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
      {isAuthCode && isDeviceFlow && (
        <Button
          size={1}
          variant="soft"
          tone="accent"
          disabled={busyFor(`device`)}
          onClick={() => {
            void onAction(row.name, `device`)
          }}
        >
          {needsAuth ? `Device flow` : `Re-authorize (device)`}
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

interface DeviceFlowPanelProps {
  state: DeviceFlowPanelState
  onDismiss: () => void
}

/**
 * Panel rendered while a device-code flow is in flight.
 *
 * Shows the user code (large, click-to-copy) plus a link to the
 * verification URL. When the flow fails the panel switches to an error
 * message so the user can read it before dismissing.
 *
 * The page-level effect polls `…/status` every 2s and clears this panel
 * automatically on `completed`.
 */
function DeviceFlowPanel({
  state,
  onDismiss,
}: DeviceFlowPanelProps): React.ReactElement {
  const verifyHref = state.verificationUriComplete ?? state.verificationUri
  const onCopy = (): void => {
    void navigator.clipboard?.writeText(state.userCode)
  }
  return (
    <div className={styles.devicePanel} role="status">
      <Stack direction="column" gap={3}>
        <Text size={3} as="h2">
          Device authorization for {state.server}
        </Text>
        {state.status === `pending` && (
          <>
            <Text size={1}>
              Visit{` `}
              <a
                href={verifyHref}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.deviceLink}
              >
                {verifyHref}
              </a>
              {` `}and enter the code below.
            </Text>
            <button
              type="button"
              className={styles.deviceCode}
              onClick={onCopy}
              title="Click to copy"
            >
              {state.userCode}
            </button>
          </>
        )}
        {state.status === `failed` && (
          <Text size={1}>
            Device flow failed: {state.error ?? `unknown error`}
          </Text>
        )}
        <Stack gap={2}>
          <Button size={1} variant="soft" tone="neutral" onClick={onDismiss}>
            {state.status === `failed` ? `Dismiss` : `Cancel`}
          </Button>
        </Stack>
      </Stack>
    </div>
  )
}
