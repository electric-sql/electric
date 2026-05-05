import { useCallback, useEffect, useMemo, useState } from 'react'
import { SquarePen } from 'lucide-react'
import { useLiveQuery } from '@tanstack/react-db'
import { useNavigate } from '@tanstack/react-router'
import { useElectricAgents } from '../lib/ElectricAgentsProvider'
import {
  bucketEntities,
  groupByStatus,
  groupByType,
  groupByWorkingDirectory,
} from '../lib/sessionGroups'
import { useSidebarView } from '../hooks/useSidebarView'
import { HoverCard, ScrollArea, Stack, Text } from '../ui'
import { NewSessionKey } from '../lib/keyLabels'
import { setDragPayload } from '../lib/workspace/dragPayload'
import { SidebarHeader } from './SidebarHeader'
import { SidebarRowInfo } from './SidebarRow'
import type { SidebarRowInfoPayload } from './SidebarRow'
import sidebarRowStyles from './SidebarRow.module.css'
import { SidebarTree } from './SidebarTree'
import { SidebarFooter } from './SidebarFooter'
import styles from './Sidebar.module.css'
import type { ElectricEntity } from '../lib/ElectricAgentsProvider'

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
  onOpenEntityInSplit,
  pinnedUrls,
  onTogglePin,
}: {
  selectedEntityUrl: string | null
  onSelectEntity: (url: string) => void
  /**
   * Optional ⌘/Ctrl-click + middle-click handler — opens an entity in
   * a new split rather than replacing the active tile. Routed through
   * the workspace helpers in `RootShell`.
   */
  onOpenEntityInSplit?: (url: string) => void
  pinnedUrls: Array<string>
  onTogglePin: (url: string) => void
}): React.ReactElement {
  const { entitiesCollection } = useElectricAgents()
  const navigate = useNavigate()
  const [width, setWidth] = useSidebarWidth()
  const [resizeHandleHover, setResizeHandleHover] = useState(false)
  const [resizing, setResizing] = useState(false)

  const hoverHandle = HoverCard.useHandle<SidebarRowInfoPayload>()

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

  const view = useSidebarView()

  // Apply Show > Type / Show > Status filters before building the
  // tree so a hidden parent doesn't accidentally hide its (visible)
  // children — instead, the children are reparented to the root level
  // in the filtered view, which is the conventional behaviour for
  // tree filtering.
  const visibleEntities = useMemo(() => {
    if (view.hiddenTypes.size === 0 && view.hiddenStatuses.size === 0) {
      return entities
    }
    return entities.filter(
      (e) => !view.hiddenTypes.has(e.type) && !view.hiddenStatuses.has(e.status)
    )
  }, [entities, view.hiddenTypes, view.hiddenStatuses])

  const pinnedSet = useMemo(() => new Set(pinnedUrls), [pinnedUrls])
  const pinnedEntities = visibleEntities.filter((e) => pinnedSet.has(e.url))

  const { roots, childrenByParent } = useMemo(
    () => buildEntityTree(visibleEntities),
    [visibleEntities]
  )

  const unpinnedRoots = useMemo(
    () => roots.filter((r) => !pinnedSet.has(r.url)),
    [roots, pinnedSet]
  )

  const ungroupedBuckets = useMemo(() => {
    switch (view.groupBy) {
      case `type`:
        return groupByType(unpinnedRoots)
      case `status`:
        return groupByStatus(unpinnedRoots)
      case `workingDir`:
        return groupByWorkingDirectory(unpinnedRoots)
      case `date`:
      default:
        return bucketEntities(unpinnedRoots)
    }
  }, [unpinnedRoots, view.groupBy])

  const handleNewSession = useCallback(() => {
    navigate({ to: `/` })
  }, [navigate])

  const treeProps = {
    childrenByParent,
    selectedEntityUrl,
    onSelectEntity,
    onOpenEntityInSplit,
    pinnedUrls,
    onTogglePin,
    hoverHandle,
  }

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
      <SidebarHeader />

      <ScrollArea className={styles.scrollFlex}>
        <Stack direction="column" className={styles.treeRow}>
          <button
            type="button"
            onClick={handleNewSession}
            // Draggable so the user can drop a fresh new-session tile
            // into any quadrant of an existing tile (creating a split)
            // — gives them multiple new-session tiles at once. The
            // browser only fires `dragstart` after the cursor moves,
            // so a click that doesn't drag still triggers `onClick`.
            draggable
            onDragStart={(e) =>
              setDragPayload(e, { kind: `sidebar-new-session` })
            }
            className={styles.newSessionRow}
          >
            <span className={styles.newSessionIconSlot}>
              <SquarePen size={16} />
            </span>
            <span className={styles.newSessionLabel}>New session</span>
            <span className={styles.newSessionKbd} aria-hidden="true">
              <NewSessionKey />
            </span>
          </button>

          {pinnedEntities.length > 0 && (
            <>
              <SectionLabel>Pinned</SectionLabel>
              {pinnedEntities.map((entity) => (
                <SidebarTree
                  key={`pinned:${entity.url}`}
                  entity={entity}
                  {...treeProps}
                />
              ))}
            </>
          )}

          {ungroupedBuckets.map((group) => (
            <div key={group.id}>
              <SectionLabel>{group.label}</SectionLabel>
              {group.items.map((root) => (
                <SidebarTree key={root.url} entity={root} {...treeProps} />
              ))}
            </div>
          ))}

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
          {entities.length > 0 && visibleEntities.length === 0 && (
            <Text
              size={1}
              tone="muted"
              align="center"
              className={styles.emptyTreeText}
            >
              No sessions match the current filters
            </Text>
          )}
        </Stack>
      </ScrollArea>

      <SidebarFooter />

      <HoverCard.Root handle={hoverHandle}>
        {({ payload }: { payload: SidebarRowInfoPayload | undefined }) => (
          <HoverCard.Content
            side="right"
            align="start"
            sideOffset={8}
            padded={false}
            className={sidebarRowStyles.infoCard}
          >
            {payload ? <SidebarRowInfo {...payload} /> : null}
          </HoverCard.Content>
        )}
      </HoverCard.Root>
    </Stack>
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

function SectionLabel({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  return (
    <Text size={1} tone="muted" className={styles.sectionLabel}>
      {children}
    </Text>
  )
}
