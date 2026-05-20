import { useEffect, useRef } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useWorkspace } from '../../hooks/useWorkspace'
import { useServerConnection } from '../../hooks/useServerConnection'
import { listTiles } from '../../lib/workspace/workspaceReducer'
import { listViews } from '../../lib/workspace/viewRegistry'
import { useElectricAgents } from '../../lib/ElectricAgentsProvider'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { decodeLayout } from '../../lib/workspace/layoutCodec'
import { NEW_SESSION_VIEW_ID } from '../../lib/workspace/types'
import { Badge, Button, Text } from '../../ui'
import { NodeRenderer } from './NodeRenderer'
import styles from './Workspace.module.css'
import type {
  LocalRuntimeStatus,
  ServerConnectionStatus,
} from '../../lib/server-connection'
import type { ViewId } from '../../lib/workspace/viewRegistry'

/**
 * Top-level workspace renderer. Owns:
 *
 * - Reading the URL (entity splat + ?view) and reflecting it into the
 *   workspace state on the way *in* (one-way: URL → workspace).
 * - Reflecting the active tile back out into the URL (one-way:
 *   workspace → URL) so deep-links still work.
 *
 * The URL ↔ workspace contract is the foundation that drag-and-drop,
 * the SplitMenu and the layout-codec build on. The rules in §3.4 of
 * the plan are encoded as effects below.
 */
export function Workspace(): React.ReactElement {
  const { workspace, helpers } = useWorkspace()
  const { activeServer, connected, connection, connectServer } =
    useServerConnection()
  const params = useParams({ strict: false })
  const search = useSearch({ strict: false }) as {
    view?: string
    source?: string
    layout?: string
  }
  const navigate = useNavigate()
  const splat = (params as Record<string, string | undefined>)._splat
  const entityUrl = splat ? `/${splat}` : null
  const requestedViewId = (search.view as ViewId | undefined) ?? null
  const requestedSource = (search.source as string | undefined) ?? null
  const layoutParam = (search.layout as string | undefined) ?? null

  // ---- ?layout=<DSL> import -------------------------------------------
  // Highest-priority hydration source: pasting a `?layout=…` URL
  // replaces the workspace then strips the param so the address bar
  // settles to the active tile (per §3.4 of the plan). Only fires once
  // per param value — guarded by `lastLayoutParam.current`.
  //
  // After the strip, the workspace → URL effect below takes over and
  // navigates to whichever tile is active (could be either route),
  // so we just need to remove the `?layout=` query without forcing
  // either path here.
  const lastLayoutParam = useRef<string | null>(null)
  useEffect(() => {
    if (!layoutParam || layoutParam === lastLayoutParam.current) return
    lastLayoutParam.current = layoutParam
    const decoded = decodeLayout(layoutParam)
    if (decoded.kind === `ok` && decoded.workspace.root) {
      helpers.replaceWorkspace(decoded.workspace)
    }
    // Strip the ?layout= param regardless of decode success — a bad
    // payload shouldn't sit in the address bar nagging the user.
    if (entityUrl) {
      void navigate({
        to: `/entity/$`,
        params: { _splat: splat ?? `` },
        search: {
          ...(requestedViewId ? { view: requestedViewId } : {}),
          ...(requestedSource ? { source: requestedSource } : {}),
        },
        replace: true,
      })
    } else {
      void navigate({ to: `/`, replace: true })
    }
  }, [layoutParam, helpers, navigate, splat, requestedViewId, entityUrl])

  const { entitiesCollection } = useElectricAgents()
  const { data: entityMatches = [] } = useLiveQuery(
    (q) => {
      if (!entitiesCollection || !entityUrl) return undefined
      return q
        .from({ e: entitiesCollection })
        .where(({ e }) => eq(e.url, entityUrl))
    },
    [entitiesCollection, entityUrl]
  )
  const entity = entityMatches.at(0) ?? null

  // ---- URL → workspace -------------------------------------------------
  // Three distinct cases handled below:
  //
  //   A. URL is `/`            → ensure the active tile is a new-session
  //                              tile (focus existing one, swap the
  //                              active tile's view, or bootstrap a
  //                              fresh tile in an empty workspace).
  //   B. URL is `/entity/$`    → ensure that (entityUrl, view) has a
  //                              tile and is active. Three sub-cases:
  //                                B1. exact (entity, view) match
  //                                    anywhere in the tree → refocus.
  //                                B2. active tile is the same entity
  //                                    (different view) → swap in place.
  //                                B3. otherwise → replace the active
  //                                    tile (or bootstrap if empty).
  //
  // The `lastSyncedKey` ref dedupes redundant syncs — without it, the
  // workspace → URL effect below would echo back into this one and
  // create infinite open-tile dispatches. The key intentionally uses
  // the empty string for null entityUrl so the sentinel space doesn't
  // accidentally collide with a real entity URL.
  const lastSyncedKey = useRef<string | null>(null)
  useEffect(() => {
    // Case A — URL is the index route. We want the active tile to be
    // a new-session tile.
    if (!entityUrl) {
      const key = `::${NEW_SESSION_VIEW_ID}`
      if (lastSyncedKey.current === key) return
      const tiles = listTiles(workspace.root)
      const existing = tiles.find(
        (t) => t.entityUrl === null && t.viewId === NEW_SESSION_VIEW_ID
      )
      if (existing) {
        helpers.setActiveTile(existing.id)
      } else {
        // No new-session tile yet — replace the active tile (or
        // bootstrap if the workspace is empty). `openNewSession` with
        // no target defaults to 'replace' on the active tile.
        helpers.openNewSession()
      }
      lastSyncedKey.current = key
      return
    }
    // Case B — entity URL.
    const availableViews = entity ? listViews(entity) : []
    const defaultViewId = availableViews[0]?.id ?? `chat`
    const desiredViewId =
      requestedViewId && availableViews.some((v) => v.id === requestedViewId)
        ? requestedViewId
        : defaultViewId
    const desiredViewParams =
      desiredViewId === `state-explorer` && requestedSource
        ? { source: requestedSource }
        : undefined
    const key = `${entityUrl}::${desiredViewId}::${requestedSource ?? ``}`
    if (lastSyncedKey.current === key) return

    const tiles = listTiles(workspace.root)

    // B1. Exact (entity, view) match anywhere in the tree → refocus.
    const exactMatch = tiles.find(
      (t) =>
        t.entityUrl === entityUrl &&
        t.viewId === desiredViewId &&
        (desiredViewParams?.source ?? ``) === (t.viewParams?.source ?? ``)
    )
    if (exactMatch) {
      helpers.setActiveTile(exactMatch.id)
      lastSyncedKey.current = key
      return
    }

    // B2. Active tile is the same entity (different view) → swap view
    // in place. Preserves the tile id (and any per-view UI state we
    // might want to keep).
    const activeTile = helpers.activeTile
    if (activeTile && activeTile.entityUrl === entityUrl) {
      helpers.setTileView(activeTile.id, desiredViewId, {
        viewParams: desiredViewParams,
      })
      lastSyncedKey.current = key
      return
    }

    // B3. New entity entirely → replace the active tile (or bootstrap
    // the empty workspace). `openEntity` with no target defaults to
    // 'replace' on the active tile.
    helpers.openEntity(entityUrl, {
      viewId: desiredViewId,
      viewParams: desiredViewParams,
    })
    lastSyncedKey.current = key
  }, [
    entityUrl,
    requestedViewId,
    requestedSource,
    entity,
    workspace.root,
    helpers,
  ])

  // ---- Workspace → URL -------------------------------------------------
  // Whenever the active tile changes, mirror its (entityUrl, viewId)
  // into the route. Standalone tiles (new-session) map back to `/`,
  // entity tiles to `/entity/$splat`. We use `replace: true` for the
  // URL update because the *user* navigations that change the active
  // tile (clicking a sidebar row, opening a new tile, switching views)
  // already pushed a history entry through their own `navigate({})`
  // calls — this effect runs *after* the dispatch and is just keeping
  // the URL in sync, so pushing again would double up.
  useEffect(() => {
    const tile = helpers.activeTile
    if (!tile) return
    const expectedKey =
      tile.entityUrl === null
        ? `::${tile.viewId}`
        : `${tile.entityUrl}::${tile.viewId}::${tile.viewParams?.source ?? ``}`
    if (lastSyncedKey.current === expectedKey) return
    lastSyncedKey.current = expectedKey
    if (tile.entityUrl === null) {
      void navigate({ to: `/`, replace: true })
      return
    }
    void navigate({
      to: `/entity/$`,
      params: { _splat: tile.entityUrl.replace(/^\//, ``) },
      search: {
        ...(tile.viewId === `chat` ? {} : { view: tile.viewId }),
        ...(tile.viewParams?.source ? { source: tile.viewParams.source } : {}),
      },
      replace: true,
    })
  }, [helpers.activeTile, navigate])

  const remoteStatus = getRemoteStatus(connected, connection?.status)
  const runtimeStatus = connection?.localRuntimeStatus ?? `disabled`
  const showConnectionPanel = Boolean(
    activeServer && remoteStatus !== `connected`
  )
  const showRuntimeWarning = Boolean(
    activeServer?.localRuntimeEnabled &&
      remoteStatus === `connected` &&
      (runtimeStatus === `error` || runtimeStatus === `stopped`)
  )

  if (showConnectionPanel && activeServer) {
    return (
      <div className={styles.workspace}>
        <ConnectionPanel
          serverName={activeServer.name}
          serverUrl={activeServer.url}
          remoteStatus={remoteStatus}
          runtimeStatus={runtimeStatus}
          error={connection?.lastError ?? null}
          onRetry={() => connectServer(activeServer.id)}
          onOpenSettings={() =>
            navigate({
              to: `/settings/$category`,
              params: { category: `servers` },
            })
          }
        />
      </div>
    )
  }

  if (!workspace.root) {
    return (
      <div className={styles.workspace}>
        <div className={styles.empty}>
          <Text tone="muted" size={2}>
            Loading workspace...
          </Text>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.workspace}>
      {showRuntimeWarning && activeServer && (
        <div className={styles.runtimeWarning}>
          <div className={styles.runtimeWarningText}>
            <Text size={2} weight="medium">
              Local runtime for {activeServer.name} is{` `}
              {RUNTIME_STATUS_LABELS[runtimeStatus].toLowerCase()}
            </Text>
            {connection?.runtimeError && (
              <Text size={1} tone="muted">
                {connection.runtimeError}
              </Text>
            )}
          </div>
          <Button
            size={1}
            variant="soft"
            tone="neutral"
            onClick={() =>
              navigate({
                to: `/settings/$category`,
                params: { category: `servers` },
              })
            }
          >
            Server settings
          </Button>
        </div>
      )}
      <NodeRenderer node={workspace.root} chromeInsetTarget />
    </div>
  )
}

function getRemoteStatus(
  connected: boolean,
  status: ServerConnectionStatus | undefined
): ServerConnectionStatus {
  if (status) return status
  return connected ? `connected` : `offline`
}

const REMOTE_STATUS_LABELS: Record<ServerConnectionStatus, string> = {
  connected: `Connected`,
  connecting: `Connecting`,
  reconnecting: `Reconnecting`,
  offline: `Offline`,
  error: `Error`,
  disconnected: `Disconnected`,
}

const RUNTIME_STATUS_LABELS: Record<LocalRuntimeStatus, string> = {
  disabled: `Disabled`,
  stopped: `Stopped`,
  starting: `Starting`,
  running: `Running`,
  error: `Error`,
}

function remoteTone(
  status: ServerConnectionStatus
): `success` | `warning` | `danger` | `info` | `neutral` {
  switch (status) {
    case `connected`:
      return `success`
    case `connecting`:
    case `reconnecting`:
      return `info`
    case `offline`:
      return `warning`
    case `error`:
      return `danger`
    case `disconnected`:
      return `neutral`
  }
}

function runtimeTone(
  status: LocalRuntimeStatus
): `success` | `warning` | `danger` | `info` | `neutral` {
  switch (status) {
    case `running`:
      return `success`
    case `starting`:
      return `info`
    case `error`:
      return `danger`
    case `stopped`:
      return `warning`
    case `disabled`:
      return `neutral`
  }
}

function ConnectionPanel({
  serverName,
  serverUrl,
  remoteStatus,
  runtimeStatus,
  error,
  onRetry,
  onOpenSettings,
}: {
  serverName: string
  serverUrl: string
  remoteStatus: ServerConnectionStatus
  runtimeStatus: LocalRuntimeStatus
  error: string | null
  onRetry: () => void
  onOpenSettings: () => void
}): React.ReactElement {
  return (
    <div className={styles.connectionPanelWrap}>
      <div className={styles.connectionPanel}>
        <Text size={4} weight="bold">
          {remoteStatus === `connecting` || remoteStatus === `reconnecting`
            ? `Connecting to ${serverName}`
            : `Cannot reach ${serverName}`}
        </Text>
        <Text size={2} tone="muted" family="mono">
          {serverUrl}
        </Text>
        <div className={styles.statusGrid}>
          <div className={styles.statusRow}>
            <Text size={2}>UI connection</Text>
            <Badge tone={remoteTone(remoteStatus)}>
              {REMOTE_STATUS_LABELS[remoteStatus]}
            </Badge>
          </div>
          <div className={styles.statusRow}>
            <Text size={2}>Local runtime</Text>
            <Badge tone={runtimeTone(runtimeStatus)}>
              {RUNTIME_STATUS_LABELS[runtimeStatus]}
            </Badge>
          </div>
        </div>
        {error && (
          <Text size={2} tone="danger">
            {error}
          </Text>
        )}
        <Text size={2} tone="muted">
          The UI connects directly to the remote agents server to list sessions
          and start new ones. The local runtime is separate and only runs local
          agents for this server when enabled.
        </Text>
        <div className={styles.connectionActions}>
          <Button
            variant="solid"
            tone="accent"
            onClick={onRetry}
            disabled={
              remoteStatus === `connecting` || remoteStatus === `reconnecting`
            }
          >
            {remoteStatus === `disconnected` ? `Connect` : `Retry connection`}
          </Button>
          <Button variant="soft" tone="neutral" onClick={onOpenSettings}>
            Server settings
          </Button>
        </div>
      </div>
    </div>
  )
}
