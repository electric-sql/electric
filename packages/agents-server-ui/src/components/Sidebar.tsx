import { useCallback, useEffect, useMemo, useState } from 'react'
import { Flex, IconButton, Popover, ScrollArea, Text } from '@radix-ui/themes'
import { ChevronDown, Monitor, Moon, Sun } from 'lucide-react'
import { useLiveQuery } from '@tanstack/react-db'
import { eq, not } from '@tanstack/db'
import { nanoid } from 'nanoid'
import { useElectricAgents } from '../lib/ElectricAgentsProvider'
import { ServerPicker } from './ServerPicker'
import { EntityListItem, getEntityDisplayTitle } from './EntityListItem'
import { SpawnArgsDialog, hasSchemaProperties } from './SpawnArgsDialog'
import { CodingAgentSpawnDialog } from './CodingAgentSpawnDialog'
import { useDarkModeContext, type ThemePreference } from '../hooks/useDarkMode'

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
import type {
  ElectricEntity,
  ElectricEntityType,
} from '../lib/ElectricAgentsProvider'

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
  const [codingAgentDialogOpen, setCodingAgentDialogOpen] = useState(false)
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
    (
      typeName: string,
      args?: Record<string, unknown>,
      initialMessage?: { text: string }
    ) => {
      if (!spawnEntity) return
      setSpawnError(null)
      const name = nanoid(10)
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
      if (entityType.name === `coding-agent`) {
        setCodingAgentDialogOpen(true)
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
    <Flex
      direction="column"
      style={{
        width,
        minWidth: SIDEBAR_MIN_WIDTH,
        flexShrink: 0,
        borderRight: `1px solid var(--gray-a5)`,
        background: `var(--gray-a2)`,
        position: `relative`,
      }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onMouseDown={startResize}
        onMouseEnter={() => setResizeHandleHover(true)}
        onMouseLeave={() => setResizeHandleHover(false)}
        style={{
          position: `absolute`,
          top: 0,
          bottom: 0,
          right: -3,
          width: 6,
          cursor: `col-resize`,
          zIndex: 20,
          background:
            resizing || resizeHandleHover ? `var(--accent-a6)` : `transparent`,
          transition: `background 0.15s`,
        }}
      />
      <ServerPicker />

      {spawnError && (
        <Flex px="3" pt="3">
          <Text size="1" color="red" role="alert">
            {spawnError}
          </Text>
        </Flex>
      )}

      <Flex px="3" pt="3" pb="1">
        <Popover.Root>
          <Popover.Trigger>
            <button
              type="button"
              disabled={!spawnEntity || entityTypes.length === 0}
              style={{
                all: `unset`,
                display: `flex`,
                alignItems: `center`,
                justifyContent: `space-between`,
                width: `100%`,
                gap: 6,
                padding: `6px 10px`,
                cursor: `pointer`,
                fontSize: `var(--font-size-2)`,
                fontWeight: 500,
                color: `var(--accent-contrast)`,
                background: `var(--accent-9)`,
                borderRadius: `var(--radius-2)`,
                opacity: !spawnEntity || entityTypes.length === 0 ? 0.4 : 1,
              }}
            >
              New session
              <ChevronDown size={14} />
            </button>
          </Popover.Trigger>
          <Popover.Content
            side="right"
            align="start"
            style={{ padding: 0, width: 320, maxHeight: 400 }}
          >
            <Flex
              px="3"
              pt="3"
              pb="2"
              style={{ borderBottom: `1px solid var(--gray-a4)` }}
            >
              <Text size="2" weight="bold">
                New session
              </Text>
            </Flex>
            <div style={{ maxHeight: 340, overflowY: `auto` }}>
              <Flex direction="column" gap="0">
                {entityTypes.map((t, i) => (
                  <Popover.Close key={t.name}>
                    <button
                      type="button"
                      onClick={() => handleNewSession(t)}
                      style={{
                        all: `unset`,
                        display: `flex`,
                        flexDirection: `column`,
                        alignItems: `flex-start`,
                        gap: 4,
                        width: `100%`,
                        boxSizing: `border-box`,
                        padding: `12px 16px`,
                        cursor: `pointer`,
                        ...(i < entityTypes.length - 1
                          ? { borderBottom: `1px solid var(--gray-a3)` }
                          : {}),
                      }}
                      className="entity-list-item"
                    >
                      <Text size="2" weight="medium">
                        {t.name}
                      </Text>
                      {t.description && (
                        <Text size="1" color="gray" style={{ lineHeight: 1.4 }}>
                          {t.description}
                        </Text>
                      )}
                    </button>
                  </Popover.Close>
                ))}
                {entityTypes.length === 0 && (
                  <Text
                    size="1"
                    color="gray"
                    align="center"
                    style={{ padding: 12 }}
                  >
                    No entity types registered
                  </Text>
                )}
              </Flex>
            </div>
          </Popover.Content>
        </Popover.Root>
      </Flex>

      {pinnedEntities.length > 0 && (
        <>
          <SectionLabel>Pinned</SectionLabel>
          <Flex direction="column" px="2" gap="1">
            {pinnedEntities.map((entity) => (
              <EntityListItem
                key={entity.url}
                entity={entity}
                selected={entity.url === selectedEntityUrl}
                onSelect={() => onSelectEntity(entity.url)}
              />
            ))}
          </Flex>
        </>
      )}

      <Flex px="3" pb="1" pt="1">
        <input
          placeholder="Filter by type or name..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="agent-ui-input"
          style={{
            width: `100%`,
            padding: `6px 10px`,
            borderRadius: `var(--radius-2)`,
            border: `1px solid var(--gray-a4)`,
            background: `var(--gray-a2)`,
            fontSize: `var(--font-size-1)`,
            fontFamily: `var(--default-font-family)`,
            color: `var(--gray-12)`,
            outline: `none`,
          }}
        />
      </Flex>

      <ScrollArea style={{ flex: 1 }}>
        <Flex direction="column" px="2" pb="2">
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
              size="1"
              color="gray"
              align="center"
              style={{ paddingTop: 20 }}
            >
              {entities.length === 0 ? `No sessions` : `No matches`}
            </Text>
          )}
        </Flex>
      </ScrollArea>

      <Flex
        align="center"
        justify="end"
        px="3"
        py="2"
        style={{
          borderTop: `1px solid var(--gray-a5)`,
          flexShrink: 0,
        }}
      >
        <IconButton
          variant="ghost"
          size="2"
          onClick={cyclePreference}
          aria-label={themeButtonAriaLabel(preference)}
        >
          {themeButtonIcon(preference)}
        </IconButton>
      </Flex>

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
      <CodingAgentSpawnDialog
        open={codingAgentDialogOpen}
        onOpenChange={setCodingAgentDialogOpen}
        availableCodingAgents={entities
          .filter((e) => e.type === `coding-agent` && e.status !== `stopped`)
          .map((e) => ({
            url: e.url,
            kind:
              (e.spawn_args.kind as `claude` | `codex` | undefined) ?? `claude`,
          }))}
        onSpawn={(args, initialMessage) => {
          doSpawn(`coding-agent`, args, initialMessage)
          setCodingAgentDialogOpen(false)
        }}
      />
    </Flex>
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
    <Text
      size="1"
      weight="medium"
      color="gray"
      style={{
        textTransform: `uppercase`,
        letterSpacing: `0.1em`,
        fontSize: 10,
        padding: `12px 16px 4px`,
        opacity: 0.6,
      }}
    >
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
