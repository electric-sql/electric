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
import { nanoid } from 'nanoid'
import { useServerConnection } from './hooks/useServerConnection'
import { usePinnedEntities } from './hooks/usePinnedEntities'
import { useElectricAgents } from './lib/ElectricAgentsProvider'
import { useEntityTimeline } from './hooks/useEntityTimeline'
import { useCodingAgent } from './hooks/useCodingAgent'
import { Sidebar } from './components/Sidebar'
import { EntityHeader } from './components/EntityHeader'
import type { CodingAgentWorkspaceSpec } from './components/EntityHeader'
import { EntityTimeline } from './components/EntityTimeline'
import { MessageInput } from './components/MessageInput'
import { StateExplorerPanel } from './components/stateExplorer/StateExplorerPanel'
import { CodingAgentView } from './components/CodingAgentView'

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
  const { entitiesCollection, forkEntity, killEntity, spawnEntity } =
    useElectricAgents()
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

  // Hooks must run unconditionally on every render — call useCodingAgent
  // BEFORE any early-return so its position in the hooks order is stable.
  const baseUrl = activeServer?.url ?? ``
  const connectUrl = isSpawning ? null : entityUrl
  const isCodingAgent = selectedEntity?.type === `coding-agent`
  const codingAgentHook = useCodingAgent(
    isCodingAgent ? baseUrl : null,
    isCodingAgent ? connectUrl : null
  )

  const codingAgentMeta = codingAgentHook.meta
  const handleForkToKind = useCallback(
    (pickedKind: `claude` | `codex`) => {
      if (forking) return
      const sourceKind = codingAgentMeta?.kind
      // Same-kind fork preserves the runtime's subtree-clone semantics.
      if (!sourceKind || sourceKind === pickedKind) {
        if (!forkEntity) return
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
        return
      }
      // Different-kind fork → spawn a new top-level coding-agent inheriting
      // transcript via fromAgentId. Workspace mode defaults via runtime
      // policy (bind-mount → share, volume → clone-or-error).
      if (!spawnEntity) return
      const sourceWorkspace = codingAgentMeta?.workspaceSpec
      const sourceTarget = codingAgentMeta?.target ?? `sandbox`
      if (!sourceWorkspace) {
        setForkError(`Cannot fork: source workspace unknown`)
        return
      }
      const args: Record<string, unknown> = {
        kind: pickedKind,
        workspaceType: sourceWorkspace.type,
        target: sourceTarget,
        fromAgentId: entityUrl,
      }
      if (sourceWorkspace.type === `bindMount`) {
        // bind-mount source → share mode (default policy). Same hostPath
        // is the share semantics; the runtime serialises access via the
        // workspace lease.
        args.workspaceHostPath = sourceWorkspace.hostPath
      }
      // Volume source: deliberately OMIT workspaceName so the runtime
      // auto-derives a fresh volume name from the new agent's id. The
      // default policy for volume sources is `clone`, and the fork branch
      // reads the source's volume from its sessionMeta and copies it into
      // the new agent's freshly-named volume. Passing the source's name
      // here would cause cloneWorkspace to copy a volume into itself
      // ("cp: '/from/.' and '/to/.' are the same file").
      const newName = nanoid(10)
      setForkError(null)
      setForking(true)
      const tx = spawnEntity({
        type: `coding-agent`,
        name: newName,
        args,
      })
      tx.isPersisted.promise
        .then(() => {
          navigate({
            to: `/entity/$`,
            params: { _splat: `coding-agent/${newName}` },
          })
        })
        .catch((err: Error) => {
          setForkError(err.message)
        })
        .finally(() => {
          setForking(false)
        })
    },
    [codingAgentMeta, entityUrl, forkEntity, forking, navigate, spawnEntity]
  )

  if (!selectedEntity) {
    return (
      <Flex align="center" justify="center" flexGrow="1">
        <Text color="gray" size="2">
          Loading entity...
        </Text>
      </Flex>
    )
  }

  return (
    <Flex direction="column" flexGrow="1" style={{ minWidth: 0 }}>
      <EntityHeader
        entity={selectedEntity}
        pinned={pinnedUrls.includes(entityUrl)}
        onTogglePin={() => togglePin(entityUrl)}
        onKill={handleKill}
        killError={killError}
        onFork={forkEntity && !selectedEntity.parent ? handleFork : undefined}
        onForkToKind={
          isCodingAgent && !selectedEntity.parent && (forkEntity || spawnEntity)
            ? handleForkToKind
            : undefined
        }
        forkError={forkError}
        forking={forking}
        stateExplorerOpen={stateExplorerOpen}
        onToggleStateExplorer={() => setStateExplorerOpen((prev) => !prev)}
        baseUrl={isCodingAgent ? baseUrl : undefined}
        codingAgentTarget={
          isCodingAgent ? codingAgentHook.meta?.target : undefined
        }
        codingAgentWorkspaceSpec={
          isCodingAgent
            ? (codingAgentHook.meta?.workspaceSpec as
                | CodingAgentWorkspaceSpec
                | undefined)
            : undefined
        }
        codingAgentStatus={
          isCodingAgent ? codingAgentHook.meta?.status : undefined
        }
        codingAgentLastError={
          isCodingAgent ? codingAgentHook.meta?.lastError : undefined
        }
        codingAgentKind={isCodingAgent ? codingAgentHook.meta?.kind : undefined}
      />
      <Flex
        ref={containerRef}
        style={{ flex: 1, minHeight: 0, overflow: `hidden` }}
      >
        <Flex
          direction="column"
          style={{ flex: 1, minWidth: 0, overflow: `hidden` }}
        >
          {isCodingAgent && connectUrl ? (
            <CodingAgentView
              baseUrl={baseUrl}
              entityUrl={connectUrl}
              entityStopped={entityStopped}
              agent={codingAgentHook}
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
