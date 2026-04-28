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
import { useLiveQuery } from '@tanstack/react-db'
import { eq } from '@tanstack/db'
import { Flex, Text } from '@radix-ui/themes'
import { CODING_SESSION_ENTITY_TYPE } from '@electric-ax/agents-runtime'
import { useServerConnection } from './hooks/useServerConnection'
import { usePinnedEntities } from './hooks/usePinnedEntities'
import { useElectricAgents } from './lib/ElectricAgentsProvider'
import { useEntityTimeline } from './hooks/useEntityTimeline'
import { Sidebar } from './components/Sidebar'
import { EntityHeader } from './components/EntityHeader'
import { EntityTimeline } from './components/EntityTimeline'
import { MessageInput } from './components/MessageInput'
import { StateExplorerPanel } from './components/stateExplorer/StateExplorerPanel'
import { CodingSessionView } from './components/CodingSessionView'

function RootLayout(): React.ReactElement {
  const { pinnedUrls } = usePinnedEntities()
  const navigate = useNavigate()

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
    <Flex style={{ height: `100vh` }}>
      <Sidebar
        selectedEntityUrl={selectedEntityUrl}
        onSelectEntity={navigateToEntity}
        pinnedUrls={pinnedUrls}
      />
      <Outlet />
    </Flex>
  )
}

function IndexPage(): React.ReactElement {
  return (
    <Flex align="center" justify="center" flexGrow="1">
      <Text color="gray" size="2">
        Select an entity from the sidebar
      </Text>
    </Flex>
  )
}

function EntityPage(): React.ReactElement {
  const { _splat } = useParams({ from: `/entity/$` })
  const entityUrl = `/${_splat}`
  const { activeServer } = useServerConnection()
  const { pinnedUrls, togglePin } = usePinnedEntities()
  const { entitiesCollection, killEntity } = useElectricAgents()

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

  const handleKill = useCallback(() => {
    if (!killEntity) return
    setKillError(null)
    const tx = killEntity(entityUrl)
    tx.isPersisted.promise.catch((err: Error) => {
      setKillError(err.message)
    })
  }, [killEntity, entityUrl])

  if (!selectedEntity) {
    return (
      <Flex align="center" justify="center" flexGrow="1">
        <Text color="gray" size="2">
          Loading entity...
        </Text>
      </Flex>
    )
  }

  const baseUrl = activeServer?.url ?? ``
  // Hide the body while spawning — server streams don't exist yet.
  const connectUrl = isSpawning ? null : entityUrl

  return (
    <Flex direction="column" flexGrow="1" style={{ minWidth: 0 }}>
      <EntityHeader
        entity={selectedEntity}
        pinned={pinnedUrls.includes(entityUrl)}
        onTogglePin={() => togglePin(entityUrl)}
        onKill={handleKill}
        killError={killError}
        stateExplorerOpen={stateExplorerOpen}
        onToggleStateExplorer={() => setStateExplorerOpen((prev) => !prev)}
      />
      <Flex
        ref={containerRef}
        style={{ flex: 1, minHeight: 0, overflow: `hidden` }}
      >
        <Flex
          direction="column"
          style={{ flex: 1, minWidth: 0, overflow: `hidden` }}
        >
          {selectedEntity.type === CODING_SESSION_ENTITY_TYPE && connectUrl ? (
            <CodingSessionView
              baseUrl={baseUrl}
              entityUrl={connectUrl}
              entityStopped={entityStopped}
            />
          ) : (
            <GenericEntityBody
              baseUrl={baseUrl}
              entityUrl={connectUrl}
              entityStopped={entityStopped}
              isSpawning={isSpawning}
            />
          )}
        </Flex>
        {stateExplorerOpen && (
          <>
            <div
              style={{
                width: 4,
                cursor: `col-resize`,
                flexShrink: 0,
                background: `var(--gray-a5)`,
              }}
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
            <Flex
              direction="column"
              style={{
                flex: `0 0 ${statePanelWidth * 100}%`,
                minWidth: 0,
                overflow: `hidden`,
              }}
            >
              <StateExplorerPanel baseUrl={baseUrl} entityUrl={entityUrl} />
            </Flex>
          </>
        )}
      </Flex>
    </Flex>
  )
}

function GenericEntityBody({
  baseUrl,
  entityUrl,
  entityStopped,
  isSpawning,
}: {
  baseUrl: string
  entityUrl: string | null
  entityStopped: boolean
  isSpawning: boolean
}): React.ReactElement {
  const { entries, db, loading, error } = useEntityTimeline(
    baseUrl || null,
    entityUrl
  )
  const navigate = useNavigate()

  useEffect(() => {
    if (error && !isSpawning) {
      navigate({ to: `/` })
    }
  }, [error, navigate, isSpawning])

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
      />
    </>
  )
}

const rootRoute = createRootRoute({ component: RootLayout })

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: `/`,
  component: IndexPage,
})

const entityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: `/entity/$`,
  component: EntityPage,
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
