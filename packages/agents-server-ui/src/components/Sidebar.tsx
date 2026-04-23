import { useCallback, useMemo, useState } from 'react'
import { Flex, Popover, ScrollArea, Text } from '@radix-ui/themes'
import { ChevronDown } from 'lucide-react'
import { useLiveQuery } from '@tanstack/react-db'
import { eq, not } from '@tanstack/db'
import { nanoid } from 'nanoid'
import { useElectricAgents } from '../lib/ElectricAgentsProvider'
import { ServerPicker } from './ServerPicker'
import { EntityListItem } from './EntityListItem'
import { SpawnArgsDialog, hasSchemaProperties } from './SpawnArgsDialog'
import { CodingSessionSpawnDialog } from './CodingSessionSpawnDialog'

const CODING_SESSION_TYPE = `coding-session`
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
  const [filter, setFilter] = useState(``)
  const [spawnError, setSpawnError] = useState<string | null>(null)
  const [spawnDialogType, setSpawnDialogType] =
    useState<ElectricEntityType | null>(null)
  const [codingDialogOpen, setCodingDialogOpen] = useState(false)

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
      const tx = spawnEntity({ type: typeName, name, args })
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
      if (entityType.name === CODING_SESSION_TYPE) {
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
    <Flex
      direction="column"
      style={{
        width: 240,
        minWidth: 240,
        flexShrink: 0,
        borderRight: `1px solid var(--gray-a5)`,
        background: `var(--gray-a2)`,
        position: `relative`,
      }}
    >
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
                color: `white`,
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
          doSpawn(CODING_SESSION_TYPE, args)
          setCodingDialogOpen(false)
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
    const hit =
      name.toLowerCase().includes(needle) ||
      entity.type.toLowerCase().includes(needle)
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
