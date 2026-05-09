import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, SquarePen } from 'lucide-react'
import { useLiveQuery } from '@tanstack/react-db'
import { eq, not } from '@tanstack/db'
import { useNavigate } from '@tanstack/react-router'
import { useElectricAgents } from '../lib/ElectricAgentsProvider'
import {
  bucketEntities,
  groupByStatus,
  groupByType,
  groupByWorkingDirectory,
} from '../lib/sessionGroups'
import { useSidebarView } from '../hooks/useSidebarView'
import { useSidebarCollapsed } from '../hooks/useSidebarCollapsed'
import { useNarrowViewport } from '../hooks/useNarrowViewport'
import { HoverCard, Icon, ScrollArea, Stack, Text } from '../ui'
import { NewSessionKey } from '../lib/keyLabels'
import { setWorkspaceDrag } from '../lib/workspace/dragPayload'
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

function NewSessionSidebarRow({
  onNewSession,
  selected,
}: {
  onNewSession: () => void
  selected: boolean
}): React.ReactElement {
  const draggingRef = useRef(false)

  const handleClick = useCallback(() => {
    if (draggingRef.current) {
      draggingRef.current = false
      return
    }
    onNewSession()
  }, [onNewSession])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== `Enter` && e.key !== ` `) return
      e.preventDefault()
      handleClick()
    },
    [handleClick]
  )

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      draggable={true}
      onDragStart={(e) => {
        draggingRef.current = true
        setWorkspaceDrag(
          e,
          { kind: `sidebar-new-session` },
          { dragImage: `sidebar-row` }
        )
      }}
      onDragEnd={() => {
        window.setTimeout(() => {
          draggingRef.current = false
        }, 0)
      }}
      className={[
        styles.newSessionRow,
        selected ? styles.newSessionRowSelected : null,
      ]
        .filter(Boolean)
        .join(` `)}
      title="New session"
    >
      <span className={styles.newSessionIconSlot}>
        <Icon icon={SquarePen} size={3} />
      </span>
      <span className={styles.newSessionLabel}>New session</span>
      <span className={styles.newSessionKbd} aria-hidden="true">
        <NewSessionKey />
      </span>
    </div>
  )
}

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
  const [showTopDivider, setShowTopDivider] = useState(false)
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () => new Set()
  )
  const scrollViewportRef = useRef<HTMLDivElement>(null)
  // Narrow viewports flip the sidebar from a push-displace flex
  // column into an absolute-positioned overlay that floats above
  // the main content with a backdrop. Selecting any sidebar row
  // auto-collapses the sidebar in overlay mode (standard mobile
  // drawer pattern) so the user is dropped straight into the new
  // content without an extra dismiss tap.
  const narrow = useNarrowViewport()
  const { collapsed, setCollapsed } = useSidebarCollapsed()
  // `data-state` drives both the narrow overlay slide/fade and the
  // wide-mode width collapse animation.
  const sidebarState: `open` | `closed` = collapsed ? `closed` : `open`
  const closeIfOverlay = useCallback(() => {
    if (narrow) setCollapsed(true)
  }, [narrow, setCollapsed])
  const wrappedSelectEntity = useCallback(
    (url: string) => {
      onSelectEntity(url)
      closeIfOverlay()
    },
    [onSelectEntity, closeIfOverlay]
  )
  const wrappedOpenInSplit = useMemo(() => {
    if (!onOpenEntityInSplit) return undefined
    return (url: string) => {
      onOpenEntityInSplit(url)
      closeIfOverlay()
    }
  }, [onOpenEntityInSplit, closeIfOverlay])

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

  const view = useSidebarView()

  const { data: visibleEntities = [] } = useLiveQuery(
    (query) => {
      if (!entitiesCollection) return undefined
      let builder = query.from({ e: entitiesCollection })

      for (const type of view.hiddenTypes) {
        builder = builder.where(({ e }) => not(eq(e.type, type)))
      }
      for (const status of view.hiddenStatuses) {
        builder = builder.where(({ e }) => not(eq(e.status, status)))
      }

      return builder.orderBy(({ e }) => e.updated_at, `desc`)
    },
    [entitiesCollection, view.hiddenTypes, view.hiddenStatuses]
  )

  const pinnedSet = useMemo(() => new Set(pinnedUrls), [pinnedUrls])
  const pinnedEntities = visibleEntities.filter((e) => pinnedSet.has(e.url))
  const filtersActive =
    view.hiddenTypes.size > 0 || view.hiddenStatuses.size > 0

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
    closeIfOverlay()
  }, [navigate, closeIfOverlay])

  const toggleSection = useCallback((id: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  useEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) return

    const updateTopDivider = () => {
      setShowTopDivider(viewport.scrollTop > 0)
    }

    updateTopDivider()
    viewport.addEventListener(`scroll`, updateTopDivider, { passive: true })
    return () => viewport.removeEventListener(`scroll`, updateTopDivider)
  }, [])

  const treeProps = {
    childrenByParent,
    selectedEntityUrl,
    onSelectEntity: wrappedSelectEntity,
    onOpenEntityInSplit: wrappedOpenInSplit,
    pinnedUrls,
    onTogglePin,
    hoverHandle,
  }

  return (
    <>
      {narrow && (
        <div
          className={styles.backdrop}
          data-state={sidebarState}
          onClick={() => setCollapsed(true)}
          aria-hidden={collapsed ? `true` : undefined}
        />
      )}
      <Stack
        direction="column"
        data-state={sidebarState}
        data-resizing={resizing ? `true` : undefined}
        aria-hidden={!narrow && collapsed ? `true` : undefined}
        className={`${styles.root} ${narrow ? styles.overlay : ``}`}
        style={
          narrow
            ? {
                // Floating overlay — cap width so a visible chunk
                // of backdrop remains for the user to tap-dismiss.
                // The user's saved width still applies up to the
                // cap. We deliberately drop `minWidth` so the
                // sidebar can shrink to the cap on viewports
                // narrower than `SIDEBAR_MIN_WIDTH`.
                width,
                minWidth: 0,
                maxWidth: `min(85vw, 320px)`,
              }
            : {
                width,
                minWidth: SIDEBAR_MIN_WIDTH,
                [`--sidebar-expanded-width`]: `${width}px`,
              }
        }
      >
        {/* Resize handle is push-mode-only — dragging an overlaid
            sidebar wider doesn't make sense when there's no flex
            sibling to take the displaced space. */}
        {!narrow && !collapsed && (
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
        )}
        <SidebarHeader />
        <div
          className={styles.topDivider}
          data-visible={showTopDivider ? `true` : undefined}
        />

        <ScrollArea
          className={styles.scrollFlex}
          viewportRef={scrollViewportRef}
        >
          <Stack direction="column" className={styles.treeRow}>
            <NewSessionSidebarRow
              onNewSession={handleNewSession}
              selected={selectedEntityUrl === null}
            />

            {pinnedEntities.length > 0 && (
              <div className={styles.sectionGroup}>
                <SectionHeader
                  id="pinned"
                  title="Pinned"
                  collapsed={collapsedSections.has(`pinned`)}
                  onToggle={toggleSection}
                />
                {!collapsedSections.has(`pinned`) &&
                  pinnedEntities.map((entity) => (
                    <SidebarTree
                      key={`pinned:${entity.url}`}
                      entity={entity}
                      {...treeProps}
                    />
                  ))}
              </div>
            )}

            {ungroupedBuckets.map((group) => (
              <div key={group.id} className={styles.sectionGroup}>
                <SectionHeader
                  id={`${view.groupBy}:${group.id}`}
                  title={group.label}
                  tooltip={group.title}
                  collapsed={collapsedSections.has(
                    `${view.groupBy}:${group.id}`
                  )}
                  onToggle={toggleSection}
                />
                {!collapsedSections.has(`${view.groupBy}:${group.id}`) &&
                  group.items.map((root) => (
                    <SidebarTree key={root.url} entity={root} {...treeProps} />
                  ))}
              </div>
            ))}

            {visibleEntities.length === 0 && (
              <Text
                size={1}
                tone="muted"
                align="center"
                className={styles.emptyTreeText}
              >
                {filtersActive
                  ? `No sessions match the current filters`
                  : `No sessions`}
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

function SectionHeader({
  id,
  title,
  tooltip,
  collapsed,
  onToggle,
}: {
  id: string
  title: string
  /**
   * Optional longer-form text surfaced as a native tooltip on hover.
   * Used by the working-directory grouping mode where `title` is
   * an abbreviated path (e.g. `…/projects/acme`) and the full path
   * is worth showing on hover.
   */
  tooltip?: string
  collapsed: boolean
  onToggle: (id: string) => void
}): React.ReactElement {
  return (
    <button
      type="button"
      className={styles.sectionHeader}
      title={tooltip}
      aria-expanded={!collapsed}
      onClick={() => onToggle(id)}
    >
      <span className={styles.sectionLabel}>{title}</span>
      <span className={styles.sectionChevron} data-collapsed={collapsed}>
        <Icon icon={ChevronRight} size={1} />
      </span>
    </button>
  )
}
