import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useLiveQuery } from '@tanstack/react-db'
import { eq, not } from '@tanstack/db'
import { nanoid } from 'nanoid'
import { CODING_SESSION_ENTITY_TYPE } from '@electric-ax/agents-runtime'
import { useElectricAgents } from '../lib/ElectricAgentsProvider'
import { Popover, ScrollArea, Stack, Text } from '../ui'
import { SidebarRow } from './SidebarRow'
import { SidebarTree } from './SidebarTree'
import { SidebarFooter } from './SidebarFooter'
import { getEntityDisplayTitle } from '../lib/entityDisplay'
import { SpawnArgsDialog, hasSchemaProperties } from './SpawnArgsDialog'
import { CodingSessionSpawnDialog } from './CodingSessionSpawnDialog'
import { useExpandedTreeNodes } from '../hooks/useExpandedTreeNodes'
import { bucketEntities } from '../lib/sessionGroups'
import styles from './Sidebar.module.css'
import type {
  ElectricEntity,
  ElectricEntityType,
} from '../lib/ElectricAgentsProvider'

const SIDEBAR_WIDTH_KEY = `electric-agents-ui.sidebar.width`
const SIDEBAR_DEFAULT_WIDTH = 240
const SIDEBAR_MIN_WIDTH = 200
const SIDEBAR_MAX_WIDTH = 600

function useSidebarWidth(): readonly [number, (w: number) => void] {
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === `undefined`) return SIDEBAR_DEFAULT_WIDTH
    const raw = window.localStorage.getItem(SIDEBAR_WIDTH_KEY)
    const parsed = raw === null ? NaN : Number(raw)
    if (
      Number.isFinite(parsed) &&
      parsed >= SIDEBAR_MIN_WIDTH &&
      parsed <= SIDEBAR_MAX_WIDTH
    ) {
      return parsed
    }
    return SIDEBAR_DEFAULT_WIDTH
  })
  useEffect(() => {
    if (typeof window === `undefined`) return
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width))
  }, [width])
  return [width, setWidth] as const
}

export function Sidebar({
  selectedEntityUrl,
  onSelectEntity,
  pinnedUrls,
}: {
  selectedEntityUrl: string | null
  onSelectEntity: (url: string) => void
  pinnedUrls: Array<string>
}): React.ReactElement {
  const { entitiesCollection, entityTypesCollection, spawnEntity } =
    useElectricAgents()
  const expanded = useExpandedTreeNodes()
  const [filter, setFilter] = useState(``)
  const [spawnError, setSpawnError] = useState<string | null>(null)
  const [spawnDialogType, setSpawnDialogType] =
    useState<ElectricEntityType | null>(null)
  const [codingDialogOpen, setCodingDialogOpen] = useState(false)
  const [width, setWidth] = useSidebarWidth()
  const [resizeHandleHover, setResizeHandleHover] = useState(false)
  const [resizing, setResizing] = useState(false)

  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = width
      setResizing(true)
      const onMove = (ev: MouseEvent): void => {
        const next = Math.min(
          SIDEBAR_MAX_WIDTH,
          Math.max(SIDEBAR_MIN_WIDTH, startWidth + (ev.clientX - startX))
        )
        setWidth(next)
      }
      const onUp = (): void => {
        document.removeEventListener(`mousemove`, onMove)
        document.removeEventListener(`mouseup`, onUp)
        document.body.style.cursor = ``
        document.body.style.userSelect = ``
        setResizing(false)
      }
      document.body.style.cursor = `col-resize`
      document.body.style.userSelect = `none`
      document.addEventListener(`mousemove`, onMove)
      document.addEventListener(`mouseup`, onUp)
    },
    [width, setWidth]
  )

  const { data: entities = [] } = useLiveQuery(
    (query) => {
      if (!entitiesCollection) return undefined
      return query
        .from({ e: entitiesCollection })
        .orderBy(({ e }) => e.updated_at, `desc`)
    },
    [entitiesCollection]
  )
  const { data: entityTypes = [] } = useLiveQuery(
    (query) => {
      if (!entityTypesCollection) return undefined
      return query
        .from({ t: entityTypesCollection })
        .where(({ t }) => not(eq(t.name, `worker`)))
        .orderBy(({ t }) => t.name, `asc`)
    },
    [entityTypesCollection]
  )
  const pinnedEntities = entities.filter((e) => pinnedUrls.includes(e.url))

  const { roots, childrenByParent } = useMemo(
    () => buildEntityTree(entities),
    [entities]
  )

  const visibleUrls = useMemo(
    () => urlsMatchingFilter(entities, filter),
    [entities, filter]
  )

  const sessionGroups = useMemo(() => bucketEntities(roots), [roots])

  const doSpawn = useCallback(
    (typeName: string, args?: Record<string, unknown>) => {
      if (!spawnEntity) return
      setSpawnError(null)
      const name = nanoid(10)
      // Coder entities need a fresh-input event on the first wake to
      // actually invoke the handler — `entity_created` alone is a
      // management event and the runtime skips the initial handler
      // pass when only management events are present. A sentinel inbox
      // message delivers that fresh input; the coder handler ignores
      // non-prompt payloads. Covers create, attach, and import modes.
      const initialMessage =
        typeName === CODING_SESSION_ENTITY_TYPE
          ? { __bootstrap: true }
          : undefined
      const tx = spawnEntity({ type: typeName, name, args, initialMessage })
      onSelectEntity(`/${typeName}/${name}`)
      tx.isPersisted.promise.catch((err: Error) => {
        setSpawnError(
          `Could not start session: ${err.message}. The server may be missing ANTHROPIC_API_KEY.`
        )
      })
    },
    [onSelectEntity, spawnEntity]
  )

  const handleNewSession = useCallback(
    (entityType: ElectricEntityType) => {
      if (entityType.name === CODING_SESSION_ENTITY_TYPE) {
        setCodingDialogOpen(true)
        return
      }
      if (hasSchemaProperties(entityType.creation_schema)) {
        setSpawnDialogType(entityType)
      } else {
        doSpawn(entityType.name)
      }
    },
    [doSpawn]
  )

  return (
    <Stack
      direction="column"
      className={styles.root}
      style={{ width, minWidth: SIDEBAR_MIN_WIDTH }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onMouseDown={startResize}
        onMouseEnter={() => setResizeHandleHover(true)}
        onMouseLeave={() => setResizeHandleHover(false)}
        className={`${styles.resizeHandle} ${
          resizing || resizeHandleHover ? styles.resizeHandleActive : ``
        }`}
      />
      {spawnError && (
        <Stack px={3} py={3}>
          <Text size={1} tone="danger" role="alert">
            {spawnError}
          </Text>
        </Stack>
      )}

      <Stack px={3} className={styles.newSessionRow}>
        <Popover.Root>
          <Popover.Trigger
            render={
              <button
                type="button"
                disabled={!spawnEntity || entityTypes.length === 0}
                className={styles.newSessionBtn}
              >
                New session
                <ChevronDown size={14} />
              </button>
            }
          />
          <Popover.Content
            side="right"
            align="start"
            padded={false}
            className={styles.newSessionPopup}
          >
            <Stack
              px={3}
              className={`${styles.newSessionHeader} ${styles.newSessionPopupHeader}`}
            >
              <Text size={2} weight="bold">
                New session
              </Text>
            </Stack>
            <div className={styles.newSessionList}>
              <Stack direction="column" gap={0}>
                {entityTypes.map((t) => (
                  <Popover.Close
                    key={t.name}
                    render={
                      <button
                        type="button"
                        onClick={() => handleNewSession(t)}
                        className={styles.newSessionItem}
                      >
                        <Text size={2} weight="medium">
                          {t.name}
                        </Text>
                        {t.description && (
                          <Text
                            size={1}
                            tone="muted"
                            className={styles.newSessionItemDescription}
                          >
                            {t.description}
                          </Text>
                        )}
                      </button>
                    }
                  />
                ))}
                {entityTypes.length === 0 && (
                  <Text
                    size={1}
                    tone="muted"
                    align="center"
                    className={styles.emptyHint}
                  >
                    No entity types registered
                  </Text>
                )}
              </Stack>
            </div>
          </Popover.Content>
        </Popover.Root>
      </Stack>

      <Stack px={3} className={styles.filterRow}>
        <input
          placeholder="Filter by type or name..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className={styles.filterInput}
        />
      </Stack>

      <ScrollArea className={styles.scrollFlex}>
        <Stack direction="column" px={2} className={styles.treeRow}>
          {pinnedEntities.length > 0 && (
            <>
              <SectionLabel>Pinned</SectionLabel>
              {pinnedEntities.map((entity) => (
                <SidebarRow
                  key={`pinned:${entity.url}`}
                  entity={entity}
                  selected={entity.url === selectedEntityUrl}
                  onSelect={() => onSelectEntity(entity.url)}
                />
              ))}
            </>
          )}
          {sessionGroups.map((group) => {
            const visibleRoots = group.items.filter(
              (root) =>
                visibleUrls === null || subtreeMatches(root.url, visibleUrls)
            )
            if (visibleRoots.length === 0) return null
            return (
              <div key={group.id}>
                <SectionLabel>{group.label}</SectionLabel>
                {visibleRoots.map((root) => (
                  <SidebarTree
                    key={root.url}
                    entity={root}
                    childrenByParent={childrenByParent}
                    selectedEntityUrl={selectedEntityUrl}
                    onSelectEntity={onSelectEntity}
                    isExpanded={expanded.isExpanded}
                    toggleExpanded={expanded.toggle}
                    expandNode={expanded.expand}
                    visibleUrls={visibleUrls}
                  />
                ))}
              </div>
            )
          })}
          {entities.length === 0 && (
            <Text
              size={1}
              tone="muted"
              align="center"
              className={styles.emptyTreeText}
            >
              No sessions
            </Text>
          )}
          {entities.length > 0 && sessionGroups.length === 0 && (
            <Text
              size={1}
              tone="muted"
              align="center"
              className={styles.emptyTreeText}
            >
              No matches
            </Text>
          )}
        </Stack>
      </ScrollArea>

      <SidebarFooter />

      {spawnDialogType && (
        <SpawnArgsDialog
          entityType={spawnDialogType}
          open={true}
          onOpenChange={(open) => {
            if (!open) setSpawnDialogType(null)
          }}
          onSpawn={(args) => {
            doSpawn(spawnDialogType.name, args)
            setSpawnDialogType(null)
          }}
        />
      )}
      <CodingSessionSpawnDialog
        open={codingDialogOpen}
        onOpenChange={setCodingDialogOpen}
        onSpawn={(args) => {
          doSpawn(CODING_SESSION_ENTITY_TYPE, args)
          setCodingDialogOpen(false)
        }}
      />
    </Stack>
  )
}

function subtreeMatches(rootUrl: string, visible: Set<string>): boolean {
  // The visible set already contains every match plus its ancestor chain
  // (built by `urlsMatchingFilter`), so testing the root alone is enough.
  return visible.has(rootUrl)
}

function buildEntityTree(entities: ReadonlyArray<ElectricEntity>): {
  roots: Array<ElectricEntity>
  childrenByParent: Map<string, Array<ElectricEntity>>
} {
  const urlSet = new Set(entities.map((e) => e.url))
  const childrenByParent = new Map<string, Array<ElectricEntity>>()
  const roots: Array<ElectricEntity> = []
  for (const entity of entities) {
    const parent = entity.parent
    if (parent && urlSet.has(parent)) {
      const list = childrenByParent.get(parent) ?? []
      list.push(entity)
      childrenByParent.set(parent, list)
    } else {
      roots.push(entity)
    }
  }
  return { roots, childrenByParent }
}

function urlsMatchingFilter(
  entities: ReadonlyArray<ElectricEntity>,
  filter: string
): Set<string> | null {
  if (!filter) return null
  const needle = filter.toLowerCase()
  const byUrl = new Map(entities.map((e) => [e.url, e]))
  const visible = new Set<string>()
  for (const entity of entities) {
    const name = entity.url.split(`/`).pop() ?? ``
    const { title } = getEntityDisplayTitle(entity)
    const hit =
      name.toLowerCase().includes(needle) ||
      entity.type.toLowerCase().includes(needle) ||
      title.toLowerCase().includes(needle)
    if (!hit) continue
    visible.add(entity.url)
    let cursor: string | null = entity.parent
    while (cursor && byUrl.has(cursor) && !visible.has(cursor)) {
      visible.add(cursor)
      cursor = byUrl.get(cursor)?.parent ?? null
    }
  }
  return visible
}

function SectionLabel({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  return (
    <Text size={1} weight="medium" tone="muted" className={styles.sectionLabel}>
      {children}
    </Text>
  )
}
