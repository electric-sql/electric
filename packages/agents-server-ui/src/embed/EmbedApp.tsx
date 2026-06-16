import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactElement,
} from 'react'
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
  type ForkEntityFn,
} from '../lib/ElectricAgentsProvider'
import { WorkspaceProvider } from '../hooks/useWorkspace'
import { ThemeProvider } from '../ui/ThemeProvider'
import { ChatLogView, ChatView } from '../components/views/ChatView'
import { StateExplorerView } from '../components/views/StateExplorerView'
import { ToastProvider } from '../components/ToastViewport'
import { registerActiveServerHeaders } from '../lib/auth-fetch'
import styles from './EmbedApp.module.css'
import type { OptimisticInboxMessage } from '../lib/sendMessage'

const TILE_ID = `mobile-embed`

type EmbedView = `chat` | `chat-log` | `state-explorer`
type EmbedTheme = `light` | `dark`

export type EmbedSessionProps = EmbedState & {
  onNavigatePathname?: (pathname: string) => void | Promise<void>
  // Marshalled native fork transport — when present (mobile), the embed's
  // fork runs over native RN networking instead of the WebView's fetch.
  onRequestForkEntity?: ForkEntityFn
}

export function EmbedSessionRoot({
  onNavigatePathname,
  onRequestForkEntity,
  ...state
}: EmbedSessionProps): ReactElement {
  // Register the Cloud auth headers in THIS context's auth-fetch
  // module before ElectricAgentsProvider creates its collections —
  // they fetch synchronously on first render, so a later useEffect
  // registration would race the initial 401.
  if (state.serverHeaders) {
    registerActiveServerHeaders(state.serverHeaders)
  } else {
    registerActiveServerHeaders(null)
  }
  // Keep a stable wrapper so the provider's action memo doesn't rebuild on
  // every render (the marshalled prop's identity isn't guaranteed stable).
  const forkRef = useRef(onRequestForkEntity)
  forkRef.current = onRequestForkEntity
  const hasNativeFork = Boolean(onRequestForkEntity)
  const forkEntityImpl = useMemo<ForkEntityFn | undefined>(
    () =>
      hasNativeFork
        ? (entityUrl, opts) => forkRef.current!(entityUrl, opts)
        : undefined,
    [hasNativeFork]
  )
  return (
    <ThemeProvider appearance={state.theme}>
      {/* The full app mounts the toast viewport in its router; the embed has
          its own entry, so mount one here too — otherwise fork (and other)
          failures fire into a bus with no listener and vanish in the WebView. */}
      <ToastProvider>
        <ElectricAgentsProvider
          baseUrl={state.serverUrl}
          forkEntityImpl={forkEntityImpl}
        >
          {/* The state-explorer view calls `useWorkspace`; the native shell owns
              navigation, so this just satisfies the context (tile dispatches are
              inert against the embed's fixed view). */}
          <WorkspaceProvider>
            <EmbeddedRouter
              state={state}
              onNavigatePathname={onNavigatePathname}
            />
          </WorkspaceProvider>
        </ElectricAgentsProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}

export type EmbedSurfaceProps = Omit<EmbedSessionProps, `view`>

export function EmbedChatLogRoot(props: EmbedSurfaceProps): ReactElement {
  return <EmbedSessionRoot {...props} view="chat-log" />
}

export function EmbedStateInspectorRoot(
  props: EmbedSurfaceProps
): ReactElement {
  return <EmbedSessionRoot {...props} view="state-explorer" />
}

type EmbedState = {
  serverUrl: string
  entityUrl: string
  view: EmbedView
  theme: EmbedTheme
  inlineQueuedMessages?: Array<OptimisticInboxMessage>
  bottomInset?: number
  // Forwarded across the Expo-DOM boundary so the embed's auth-fetch
  // module instance (separate from the native side) can inject the
  // Cloud auth headers on every outbound request. `null` means no
  // headers required (local server).
  serverHeaders?: {
    url: string
    headers: Record<string, string>
  } | null
}

const EmbedStateContext = createContext<EmbedState | null>(null)

function useCurrentEmbedState(): EmbedState {
  const state = useContext(EmbedStateContext)
  if (!state) {
    throw new Error(`useCurrentEmbedState must be used inside EmbeddedRouter`)
  }
  return state
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
function EmbeddedRouter({
  state,
  onNavigatePathname,
}: {
  state: EmbedState
  onNavigatePathname?: (pathname: string) => void | Promise<void>
}): ReactElement {
  const router = useMemo(() => {
    const rootRoute = createRootRoute({
      component: EmbedRouteSurface,
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
      void onNavigatePathname?.(toLocation.pathname)
    })

    return router
  }, [onNavigatePathname])

  return (
    <EmbedStateContext.Provider value={state}>
      <RouterProvider router={router} />
    </EmbedStateContext.Provider>
  )
}

function EmbedRouteSurface(): ReactElement {
  return <EmbedSurface state={useCurrentEmbedState()} />
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
      inlineQueuedMessages={state.inlineQueuedMessages}
      bottomInset={state.bottomInset}
    />
  )
}

function EntityHost({
  entityUrl,
  view,
  serverUrl,
  inlineQueuedMessages,
  bottomInset,
}: {
  entityUrl: string
  view: EmbedView
  serverUrl: string
  inlineQueuedMessages?: Array<OptimisticInboxMessage>
  bottomInset?: number
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

  // Publish the composer inset on the document root (not just `.column`) so the
  // image-preview dialog — which portals to <body> — can keep clear of the
  // native composer overlaying the bottom of the WebView.
  useEffect(() => {
    if (typeof document === `undefined` || view !== `chat-log`) return
    const root = document.documentElement
    root.style.setProperty(
      `--mobile-chat-bottom-inset`,
      `${Math.max(0, bottomInset ?? 0)}px`
    )
    return () => {
      root.style.removeProperty(`--mobile-chat-bottom-inset`)
    }
  }, [view, bottomInset])

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
  if (view === `chat-log`) {
    // Inset var is seeded on the document root (above); resize updates arrive
    // imperatively via setBottomInset — no inline value here, which would shadow it.
    return (
      <div className={styles.column}>
        <ChatLogView {...props} inlineQueuedMessages={inlineQueuedMessages} />
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
