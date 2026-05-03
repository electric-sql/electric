import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, Monitor, Moon, Sun } from 'lucide-react'
import { useLiveQuery } from '@tanstack/react-db'
import { eq, not } from '@tanstack/db'
import { nanoid } from 'nanoid'
import { CODING_SESSION_ENTITY_TYPE } from '@electric-ax/agents-runtime'
import { useElectricAgents } from '../lib/ElectricAgentsProvider'
import { IconButton, Popover, ScrollArea, Stack, Text } from '../ui'
import { ServerPicker } from './ServerPicker'
import { EntityListItem, getEntityDisplayTitle } from './EntityListItem'
import { SpawnArgsDialog, hasSchemaProperties } from './SpawnArgsDialog'
import { CodingSessionSpawnDialog } from './CodingSessionSpawnDialog'
import { useDarkModeContext, type ThemePreference } from '../hooks/useDarkMode'
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
  const { preference, cyclePreference } = useDarkModeContext()
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
      <ServerPicker />

      {spawnError && (
        <Stack px={3} py={3} className={styles.spawnError}>
          <Text size={1} tone="danger" role="alert">
            {spawnError}
          </Text>
        </Stack>
      )}

      <Stack px={3} style={{ paddingTop: 12, paddingBottom: 4 }}>
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
              style={{ paddingTop: 12, paddingBottom: 8 }}
              className={styles.newSessionHeader}
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
                            style={{ lineHeight: 1.4 }}
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

      {pinnedEntities.length > 0 && (
        <>
          <SectionLabel>Pinned</SectionLabel>
          <Stack direction="column" px={2} gap={1}>
            {pinnedEntities.map((entity) => (
              <EntityListItem
                key={entity.url}
                entity={entity}
                selected={entity.url === selectedEntityUrl}
                onSelect={() => onSelectEntity(entity.url)}
              />
            ))}
          </Stack>
        </>
      )}

      <Stack px={3} style={{ paddingTop: 4, paddingBottom: 4 }}>
        <input
          placeholder="Filter by type or name..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className={styles.filterInput}
        />
      </Stack>

      <ScrollArea className={styles.scrollFlex}>
        <Stack direction="column" px={2} style={{ paddingBottom: 8 }}>
          {roots.map((root) => (
            <EntityTreeNode
              key={root.url}
              entity={root}
              hasMoreAtDepth={[]}
              childrenByParent={childrenByParent}
              visibleUrls={visibleUrls}
              selectedEntityUrl={selectedEntityUrl}
              onSelectEntity={onSelectEntity}
            />
          ))}
          {roots.length === 0 && (
            <Text
              size={1}
              tone="muted"
              align="center"
              className={styles.emptyTreeText}
            >
              {entities.length === 0 ? `No sessions` : `No matches`}
            </Text>
          )}
        </Stack>
      </ScrollArea>

      <Stack
        align="center"
        justify="end"
        px={3}
        py={2}
        className={styles.footer}
      >
        <IconButton
          variant="ghost"
          tone="neutral"
          size={2}
          onClick={cyclePreference}
          aria-label={themeButtonAriaLabel(preference)}
        >
          {themeButtonIcon(preference)}
        </IconButton>
      </Stack>

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

function EntityTreeNode({
  entity,
  hasMoreAtDepth,
  childrenByParent,
  visibleUrls,
  selectedEntityUrl,
  onSelectEntity,
}: {
  entity: ElectricEntity
  hasMoreAtDepth: ReadonlyArray<boolean>
  childrenByParent: Map<string, Array<ElectricEntity>>
  visibleUrls: Set<string> | null
  selectedEntityUrl: string | null
  onSelectEntity: (url: string) => void
}): React.ReactElement | null {
  if (visibleUrls && !visibleUrls.has(entity.url)) return null
  const children = childrenByParent.get(entity.url) ?? []
  const lastIndex = children.length - 1
  return (
    <>
      <EntityListItem
        entity={entity}
        selected={entity.url === selectedEntityUrl}
        onSelect={() => onSelectEntity(entity.url)}
        hasMoreAtDepth={hasMoreAtDepth}
      />
      {children.map((child, i) => (
        <EntityTreeNode
          key={child.url}
          entity={child}
          hasMoreAtDepth={[...hasMoreAtDepth, i < lastIndex]}
          childrenByParent={childrenByParent}
          visibleUrls={visibleUrls}
          selectedEntityUrl={selectedEntityUrl}
          onSelectEntity={onSelectEntity}
        />
      ))}
    </>
  )
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

function themeButtonIcon(preference: ThemePreference): React.ReactElement {
  if (preference === `light`) return <Sun size={14} />
  if (preference === `dark`) return <Moon size={14} />
  return <Monitor size={14} />
}

function themeButtonAriaLabel(preference: ThemePreference): string {
  if (preference === `light`) return `Theme: light. Click to switch to dark.`
  if (preference === `dark`) return `Theme: dark. Click to follow system.`
  return `Theme: system. Click to switch to light.`
}
