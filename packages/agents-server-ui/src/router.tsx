import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Outlet,
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useNavigate,
  useParams,
} from '@tanstack/react-router'
import { connectEntityStream, getActiveBaseUrl } from './lib/entity-connection'
import type { EntityStreamDBWithActions } from '@electric-ax/agents-runtime'
import { useLiveQuery } from '@tanstack/react-db'
import { eq } from '@tanstack/db'
import { useServerConnection } from './hooks/useServerConnection'
import { usePinnedEntities } from './hooks/usePinnedEntities'
import { useElectricAgents } from './lib/ElectricAgentsProvider'
import type { ElectricEntity } from './lib/ElectricAgentsProvider'
import { useEntityTimeline } from './hooks/useEntityTimeline'
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
import { EntityTimeline } from './components/EntityTimeline'
import { EntityContextDrawer } from './components/EntityContextDrawer'
import { MessageInput } from './components/MessageInput'
import { StateExplorerPanel } from './components/stateExplorer/StateExplorerPanel'
import { NewSessionPage } from './components/NewSessionPage'
import { Link, Stack, Text } from './ui'
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

  const params = useParams({ strict: false })
  const splat = (params as Record<string, string | undefined>)._splat
  const selectedEntityUrl = splat ? `/${splat}` : null

  return (
    <div className={styles.appShell}>
      {!collapsed && (
        <Sidebar
          selectedEntityUrl={selectedEntityUrl}
          pinnedUrls={pinnedUrls}
          onTogglePin={togglePin}
        />
      )}
      <Outlet />
      <SearchPalette />
    </div>
  )
}

function EntityPage(): React.ReactElement {
  const { _splat } = useParams({ from: `/entity/$` })
  const { db: preloadedDb } = entityRoute.useLoaderData()
  const entityUrl = `/${_splat}`
  const { activeServer } = useServerConnection()
  const { pinnedUrls, togglePin } = usePinnedEntities()
  const { entitiesCollection, forkEntity, killEntity } = useElectricAgents()
  const navigate = useNavigate()

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

  const [stateExplorerOpen, setStateExplorerOpen] = useState(false)
  const [statePanelWidth, setStatePanelWidth] = useState(0.5)
  const containerRef = useRef<HTMLDivElement>(null)
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

  const [waitedLong, setWaitedLong] = useState(false)
  useEffect(() => {
    if (selectedEntity) return
    const timer = setTimeout(() => setWaitedLong(true), 2_000)
    return () => clearTimeout(timer)
  }, [selectedEntity])

  if (!selectedEntity) {
    if (entitiesCollection && waitedLong) {
      return <NotFoundPage message={`Session ${_splat} not found`} />
    }
    return (
      <Stack
        align="center"
        justify="center"
        grow
        className={styles.entityShell}
      >
        <span>Loading entity…</span>
      </Stack>
    )
  }

  const baseUrl = activeServer?.url ?? ``
  const connectUrl = isSpawning ? null : entityUrl

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
        stateExplorerOpen={stateExplorerOpen}
        onToggleStateExplorer={() => setStateExplorerOpen((prev) => !prev)}
      />
      <Stack ref={containerRef} className={styles.entityBody}>
        <Stack direction="column" className={styles.entityMain}>
          <GenericEntityBody
            baseUrl={baseUrl}
            entityUrl={connectUrl}
            entity={selectedEntity}
            entityStopped={entityStopped}
            preloadedDb={preloadedDb}
          />
        </Stack>
        {stateExplorerOpen && (
          <>
            <div
              className={styles.splitter}
              onMouseDown={(e) => {
                e.preventDefault()
                const container = containerRef.current
                if (!container) return
                const startX = e.clientX
                const startWidth = statePanelWidth
                const rect = container.getBoundingClientRect()
                const onMouseMove = (ev: MouseEvent) => {
                  const dx = startX - ev.clientX
                  const newWidth = Math.min(
                    0.7,
                    Math.max(0.2, startWidth + dx / rect.width)
                  )
                  setStatePanelWidth(newWidth)
                }
                const onMouseUp = () => {
                  document.removeEventListener(`mousemove`, onMouseMove)
                  document.removeEventListener(`mouseup`, onMouseUp)
                  document.body.style.cursor = ``
                  document.body.style.userSelect = ``
                }
                document.body.style.cursor = `col-resize`
                document.body.style.userSelect = `none`
                document.addEventListener(`mousemove`, onMouseMove)
                document.addEventListener(`mouseup`, onMouseUp)
              }}
            />
            <Stack
              direction="column"
              className={styles.statePanel}
              style={{ flex: `0 0 ${statePanelWidth * 100}%` }}
            >
              <StateExplorerPanel baseUrl={baseUrl} entityUrl={entityUrl} />
            </Stack>
          </>
        )}
      </Stack>
    </Stack>
  )
}

function GenericEntityBody({
  baseUrl,
  entityUrl,
  entity,
  entityStopped,
  preloadedDb,
}: {
  baseUrl: string
  entityUrl: string | null
  entity: ElectricEntity
  entityStopped: boolean
  preloadedDb?: EntityStreamDBWithActions | null
}): React.ReactElement {
  const { entries, db, loading, error } = useEntityTimeline(
    baseUrl || null,
    entityUrl,
    preloadedDb
  )

  return (
    <>
      <EntityTimeline
        entries={entries}
        loading={loading}
        error={error}
        entityStopped={entityStopped}
        cacheKey={`${baseUrl}${entityUrl ?? ``}`}
      />
      <MessageInput
        db={db}
        baseUrl={baseUrl}
        entityUrl={entityUrl ?? ``}
        disabled={entityStopped || !db}
        drawer={<EntityContextDrawer entity={entity} />}
      />
    </>
  )
}

function NotFoundPage({ message }: { message?: string }): React.ReactElement {
  return (
    <Stack
      align="center"
      justify="center"
      grow
      direction="column"
      gap={3}
      className={styles.entityShell}
    >
      <Text size={5} weight="medium">
        Not found
      </Text>
      <Text size={2} tone="muted">
        {message ?? `The page you're looking for doesn't exist.`}
      </Text>
      <Link href="#/" size={2}>
        Go home
      </Link>
    </Stack>
  )
}

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: () => <NotFoundPage />,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: `/`,
  component: NewSessionPage,
})

const entityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: `/entity/$`,
  // Kick off (or reuse a cached) stream connection during navigation so the
  // db is ready by the time the component renders. defaultPreload:'intent'
  // on the router means this also fires on sidebar hover via <Link>.
  loader: async ({
    params,
  }): Promise<{ db: EntityStreamDBWithActions | null }> => {
    const baseUrl = getActiveBaseUrl()
    if (!baseUrl) return { db: null }
    const entityUrl = `/${params._splat}`
    try {
      const { db } = await connectEntityStream({ baseUrl, entityUrl })
      return { db }
    } catch {
      return { db: null }
    }
  },
  component: EntityPage,
})

const routeTree = rootRoute.addChildren([indexRoute, entityRoute])

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: `intent`,
})

// eslint-disable-next-line quotes
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
