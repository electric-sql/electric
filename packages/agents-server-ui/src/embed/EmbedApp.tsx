import { useEffect, useMemo, useState, type ReactElement } from 'react'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { useLiveQuery } from '@tanstack/react-db'
import { eq } from '@tanstack/db'
import {
  ElectricAgentsProvider,
  useElectricAgents,
} from '../lib/ElectricAgentsProvider'
import { ThemeProvider } from '../ui'
import { ChatView } from '../components/views/ChatView'
import { StateExplorerView } from '../components/views/StateExplorerView'
import { readEmbedConfig, type MobileEmbedConfig } from './config'
import {
  postEmbedToNative,
  subscribeNativeToEmbed,
  type EmbedTheme,
  type EmbedView,
} from './bridge'
import styles from './EmbedApp.module.css'

const TILE_ID = `mobile-embed`

/**
 * Root of the bundled mobile embed.
 *
 * The native shell injects the initial config (server URL, entity,
 * view, theme) via `window.__MOBILE_EMBED__` BEFORE this script runs,
 * so the first paint matches the current native state. After mount we
 * announce `{ type: 'ready' }` so the host can start sending live
 * updates (`set-view`, `set-entity`, `set-theme`) without re-parsing
 * the multi-MB bundle on every navigation.
 */
export function EmbedApp(): ReactElement {
  const initial = useMemo(readEmbedConfig, [])

  // The initial values come from `__MOBILE_EMBED__`. Subsequent
  // updates from the native side (`set-*` messages) are routed through
  // `useEmbedState` below.
  const state = useEmbedState(initial)

  return (
    <ThemeProvider appearance={state.theme}>
      <ElectricAgentsProvider baseUrl={state.serverUrl}>
        <EmbeddedRouter state={state} />
      </ElectricAgentsProvider>
    </ThemeProvider>
  )
}

type EmbedState = {
  serverUrl: string
  entityUrl: string
  view: EmbedView
  theme: EmbedTheme
}

/**
 * Centralised in-embed state machine for everything the native side
 * can change at runtime. Reads `initial` once and then mirrors the
 * subset of native messages that update visible content.
 */
function useEmbedState(initial: MobileEmbedConfig): EmbedState {
  const [view, setView] = useState<EmbedView>(initial.view)
  const [entityUrl, setEntityUrl] = useState<string>(initial.entityUrl)
  const [theme, setTheme] = useState<EmbedTheme>(initial.theme)

  useEffect(() => {
    const unsub = subscribeNativeToEmbed((msg) => {
      switch (msg.type) {
        case `set-view`:
          if (msg.view === `chat` || msg.view === `state-explorer`) {
            setView(msg.view)
          }
          return
        case `set-entity`:
          if (typeof msg.entityUrl === `string`) {
            setEntityUrl(msg.entityUrl)
          }
          return
        case `set-theme`:
          if (msg.theme === `light` || msg.theme === `dark`) {
            setTheme(msg.theme)
          }
          return
      }
    })

    // Tell the host the listener is wired up. The host queues
    // `set-*` updates until it sees `ready` so no message is lost
    // between mount and the first user interaction.
    postEmbedToNative({ type: `ready` })

    return unsub
  }, [])

  // `serverUrl` is part of the initial config but never updated at
  // runtime — changing the active server requires a full WebView
  // reload because Electric collections, websocket streams and the
  // ElectricAgentsProvider all key on it.
  return { serverUrl: initial.serverUrl, view, entityUrl, theme }
}

/**
 * Minimal router context so views that rely on `useNavigate`
 * (ChatView, EntityContextDrawer, …) keep working inside the embed.
 *
 * The route tree mirrors the SHAPE of the desktop/web router so calls
 * like `navigate({ to: '/entity/$', params })` resolve without error.
 * Bodies are no-ops — the native shell owns navigation, so we forward
 * the intent over `postMessage` instead of changing the embedded view
 * underneath the user.
 */
function EmbeddedRouter({ state }: { state: EmbedState }): ReactElement {
  const router = useMemo(() => {
    const rootRoute = createRootRoute({
      component: () => <EmbedSurface state={state} />,
    })
    const indexRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: `/`,
      component: () => null,
    })
    const entityRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: `/entity/$`,
      component: () => null,
    })
    const router = createRouter({
      routeTree: rootRoute.addChildren([indexRoute, entityRoute]),
      history: createMemoryHistory({ initialEntries: [`/`] }),
    })

    // Forward in-embed navigations to the native shell. The host
    // decides whether to swap entity, push a new screen, or ignore.
    router.subscribe(`onResolved`, ({ toLocation }) => {
      postEmbedToNative({ type: `navigate`, pathname: toLocation.pathname })
    })

    return router
  }, [])

  // Re-create the surface (not the router) when state changes — keeps
  // the route tree stable while the rendered view follows the host.
  void state
  return <RouterProvider router={router} />
}

function EmbedSurface({ state }: { state: EmbedState }): ReactElement {
  const { entitiesCollection } = useElectricAgents()

  if (!state.entityUrl) {
    return <EmbedMessage title="No entity selected" />
  }
  if (!entitiesCollection) {
    return <EmbedMessage title="Connecting…" />
  }

  return (
    <EntityHost
      key={state.entityUrl}
      entityUrl={state.entityUrl}
      view={state.view}
      serverUrl={state.serverUrl}
    />
  )
}

function EntityHost({
  entityUrl,
  view,
  serverUrl,
}: {
  entityUrl: string
  view: EmbedView
  serverUrl: string
}): ReactElement {
  const { entitiesCollection } = useElectricAgents()
  const { data: matches = [], isLoading } = useLiveQuery(
    (query) =>
      query
        .from({ entity: entitiesCollection! })
        .where(({ entity }) => eq(entity.url, entityUrl)),
    [entitiesCollection, entityUrl]
  )
  const entity = matches.at(0) ?? null

  if (!entity) {
    // Treat both the initial sync window AND a missing-after-sync
    // entity as "loading" — the native shell already paints a loading
    // overlay, so we keep the embed neutral until the row appears.
    if (isLoading) return <EmbedMessage title="Loading session…" />
    return <EmbedMessage title="Loading session…" body={entityUrl} />
  }

  const props = {
    baseUrl: serverUrl,
    entityUrl,
    entity,
    entityStopped: entity.status === `stopped`,
    isSpawning: entity.status === `spawning`,
    tileId: TILE_ID,
  }

  if (view === `state-explorer`) {
    return (
      <div className={styles.scroll}>
        <StateExplorerView {...props} />
      </div>
    )
  }
  return (
    <div className={styles.column}>
      <ChatView {...props} />
    </div>
  )
}

function EmbedMessage({
  title,
  body,
}: {
  title: string
  body?: string
}): ReactElement {
  return (
    <div className={styles.message}>
      <div className={styles.messageTitle}>{title}</div>
      {body && <div className={styles.messageBody}>{body}</div>}
    </div>
  )
}
