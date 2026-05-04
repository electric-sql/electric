import { useCallback, useState } from 'react'
import {
  Outlet,
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useNavigate,
  useParams,
  useSearch,
} from '@tanstack/react-router'
import { useLiveQuery } from '@tanstack/react-db'
import { eq } from '@tanstack/db'
import { z } from 'zod'
import { useServerConnection } from './hooks/useServerConnection'
import { usePinnedEntities } from './hooks/usePinnedEntities'
import { useElectricAgents } from './lib/ElectricAgentsProvider'
import {
  SidebarCollapsedProvider,
  useSidebarCollapsed,
} from './hooks/useSidebarCollapsed'
import { useHotkey } from './hooks/useHotkey'
import {
  SearchPaletteProvider,
  useSearchPalette,
} from './hooks/useSearchPalette'
import { Sidebar } from './components/Sidebar'
import { SearchPalette } from './components/SearchPalette'
import { EntityHeader } from './components/EntityHeader'
import { NewSessionPage } from './components/NewSessionPage'
import { getView, listViews, type ViewId } from './lib/workspace/viewRegistry'
import { Stack } from './ui'
import styles from './router.module.css'

function RootLayout(): React.ReactElement {
  return (
    <SidebarCollapsedProvider>
      <SearchPaletteProvider>
        <RootShell />
      </SearchPaletteProvider>
    </SidebarCollapsedProvider>
  )
}

function RootShell(): React.ReactElement {
  const { pinnedUrls, togglePin } = usePinnedEntities()
  const navigate = useNavigate()
  const { collapsed, toggle } = useSidebarCollapsed()
  const search = useSearchPalette()

  useHotkey(`mod+b`, toggle)
  useHotkey(`mod+k`, (e) => {
    e.preventDefault()
    search.toggle()
  })
  // New session: bind both ⌘N / Ctrl+N (works in Electron) and
  // ⌘⇧O / Ctrl+Shift+O (works in browsers — `⌘N` is reserved by
  // browsers for opening a new window and can't be intercepted, so
  // we fall back to a combo that isn't claimed by the chrome).
  // The displayed shortcut hint switches per environment via
  // `NewSessionKey` / `newSessionLabel`.
  const openNewSession = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault()
      navigate({ to: `/` })
    },
    [navigate]
  )
  useHotkey(`mod+n`, openNewSession)
  useHotkey(`mod+shift+o`, openNewSession)

  const navigateToEntity = useCallback(
    (entityUrl: string) => {
      navigate({
        to: `/entity/$`,
        params: { _splat: entityUrl.replace(/^\//, ``) },
      })
    },
    [navigate]
  )

  const params = useParams({ strict: false })
  const splat = (params as Record<string, string | undefined>)._splat
  const selectedEntityUrl = splat ? `/${splat}` : null

  return (
    <div className={styles.appShell}>
      {!collapsed && (
        <Sidebar
          selectedEntityUrl={selectedEntityUrl}
          onSelectEntity={navigateToEntity}
          pinnedUrls={pinnedUrls}
          onTogglePin={togglePin}
        />
      )}
      <Outlet />
      <SearchPalette />
    </div>
  )
}

/**
 * Search-param schema for the entity route. `view` is optional and
 * defaults to the first registered view (`chat`) when absent — that way
 * the URL stays clean (`/entity/foo`) for the common case and only
 * surfaces the param when the user is on a non-default view
 * (`/entity/foo?view=state-explorer`).
 */
const entitySearchSchema = z.object({
  view: z.string().optional(),
})

function EntityPage(): React.ReactElement {
  const { _splat } = useParams({ from: `/entity/$` })
  const entityUrl = `/${_splat}`
  const { activeServer } = useServerConnection()
  const { pinnedUrls, togglePin } = usePinnedEntities()
  const { entitiesCollection, forkEntity, killEntity } = useElectricAgents()
  const navigate = useNavigate()
  const search = useSearch({ from: `/entity/$` })

  const { data: matchingEntities = [] } = useLiveQuery(
    (query) => {
      if (!entitiesCollection) return undefined
      return query
        .from({ e: entitiesCollection })
        .where(({ e }) => eq(e.url, entityUrl))
    },
    [entitiesCollection, entityUrl]
  )
  const selectedEntity = matchingEntities.at(0) ?? null
  const isSpawning = selectedEntity?.status === `spawning`
  const entityStopped = selectedEntity?.status === `stopped`

  // Resolve the active view from the URL. The first registered view
  // (`chat`) is the implicit default when the param is absent or
  // points at an unknown id — we never fail closed.
  const requestedViewId = search.view as ViewId | undefined
  const availableViews = selectedEntity ? listViews(selectedEntity) : []
  const defaultViewId = availableViews[0]?.id ?? `chat`
  const activeViewId: ViewId =
    requestedViewId && availableViews.some((v) => v.id === requestedViewId)
      ? requestedViewId
      : defaultViewId

  const setActiveView = useCallback(
    (viewId: ViewId) => {
      // Omit the param from the URL when it matches the default view —
      // keeps `/entity/foo` clean for the chat case rather than always
      // showing `?view=chat`.
      void navigate({
        to: `/entity/$`,
        params: { _splat },
        search: viewId === defaultViewId ? {} : { view: viewId },
      })
    },
    [navigate, _splat, defaultViewId]
  )

  const [killError, setKillError] = useState<string | null>(null)
  const [forkError, setForkError] = useState<string | null>(null)
  const [forking, setForking] = useState(false)

  const handleKill = useCallback(() => {
    if (!killEntity) return
    setKillError(null)
    const tx = killEntity(entityUrl)
    tx.isPersisted.promise.catch((err: Error) => {
      setKillError(err.message)
    })
  }, [killEntity, entityUrl])

  const handleFork = useCallback(() => {
    if (!forkEntity || forking) return
    setForkError(null)
    setForking(true)
    forkEntity(entityUrl)
      .then((root) => {
        navigate({
          to: `/entity/$`,
          params: { _splat: root.url.replace(/^\//, ``) },
        })
      })
      .catch((err: Error) => {
        setForkError(err.message)
      })
      .finally(() => {
        setForking(false)
      })
  }, [entityUrl, forkEntity, forking, navigate])

  if (!selectedEntity) {
    return (
      <Stack
        align="center"
        justify="center"
        grow
        className={styles.entityShell}
      >
        <span>Loading entity...</span>
      </Stack>
    )
  }

  const baseUrl = activeServer?.url ?? ``
  const ViewComponent = getView(activeViewId)?.Component

  return (
    <Stack direction="column" className={styles.entityShell}>
      <EntityHeader
        entity={selectedEntity}
        pinned={pinnedUrls.includes(entityUrl)}
        onTogglePin={() => togglePin(entityUrl)}
        onKill={handleKill}
        killError={killError}
        onFork={forkEntity && !selectedEntity.parent ? handleFork : undefined}
        forkError={forkError}
        forking={forking}
        currentViewId={activeViewId}
        onSetView={setActiveView}
      />
      <Stack className={styles.entityBody}>
        <Stack direction="column" className={styles.entityMain}>
          {ViewComponent ? (
            <ViewComponent
              baseUrl={baseUrl}
              entityUrl={entityUrl}
              entity={selectedEntity}
              entityStopped={entityStopped}
              isSpawning={isSpawning}
              // Stage 1 has no tile concept yet — synthesise a stable id
              // from the entity URL + view so per-tile state hooks behave
              // (a single-tile workspace effectively has one tile per
              // (entity, view) pair).
              tileId={`${entityUrl}::${activeViewId}`}
            />
          ) : (
            <Stack
              align="center"
              justify="center"
              grow
              className={styles.entityShell}
            >
              <span>Unknown view: {activeViewId}</span>
            </Stack>
          )}
        </Stack>
      </Stack>
    </Stack>
  )
}

const rootRoute = createRootRoute({ component: RootLayout })

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: `/`,
  component: NewSessionPage,
})

const entityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: `/entity/$`,
  component: EntityPage,
  validateSearch: entitySearchSchema,
})

const routeTree = rootRoute.addChildren([indexRoute, entityRoute])

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
})

// eslint-disable-next-line quotes
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
