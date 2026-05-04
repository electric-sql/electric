import { useCallback, useEffect, useMemo, useState } from 'react'
import { SquarePen } from 'lucide-react'
import { useLiveQuery } from '@tanstack/react-db'
import { useNavigate } from '@tanstack/react-router'
import { useElectricAgents } from '../lib/ElectricAgentsProvider'
import { HoverCard, ScrollArea, Stack, Text } from '../ui'
import { NewSessionKey } from '../lib/keyLabels'
import { setDragPayload } from '../lib/workspace/dragPayload'
import { SidebarHeader } from './SidebarHeader'
import { SidebarRowInfo } from './SidebarRow'
import type { SidebarRowInfoPayload } from './SidebarRow'
import sidebarRowStyles from './SidebarRow.module.css'
import { SidebarTree } from './SidebarTree'
import { SidebarFooter } from './SidebarFooter'
import { bucketEntities } from '../lib/sessionGroups'
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

  // One shared HoverCard handle for every row in this sidebar. The
  // single Root rendered below switches its content based on which
  // trigger is currently active, so the popup follows the pointer
  // between rows without the open delay re-firing.
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
  const pinnedSet = useMemo(() => new Set(pinnedUrls), [pinnedUrls])
  const pinnedEntities = entities.filter((e) => pinnedSet.has(e.url))

  const { roots, childrenByParent } = useMemo(
    () => buildEntityTree(entities),
    [entities]
  )

  // Pinned roots are listed once at the top in the Pinned section; we
  // don't want them to show up again in their original time bucket.
  // We only strip *roots* — children of an unpinned parent that happen
  // to be pinned simply disappear from the parent's expanded subtree
  // (handled by SidebarTree's pinned-skip below).
  const unpinnedRoots = useMemo(
    () => roots.filter((r) => !pinnedSet.has(r.url)),
    [roots, pinnedSet]
  )

  const sessionGroups = useMemo(
    () => bucketEntities(unpinnedRoots),
    [unpinnedRoots]
  )

  const handleNewSession = useCallback(() => {
    navigate({ to: `/` })
  }, [navigate])

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
                // Pinned parents render as a full SidebarTree so they
                // can be expanded in place to reveal their children
                // (children themselves aren't pinnable — gated inside
                // SidebarTree to depth=0).
                <SidebarTree
                  key={`pinned:${entity.url}`}
                  entity={entity}
                  childrenByParent={childrenByParent}
                  selectedEntityUrl={selectedEntityUrl}
                  onSelectEntity={onSelectEntity}
                  onOpenEntityInSplit={onOpenEntityInSplit}
                  pinnedUrls={pinnedUrls}
                  onTogglePin={onTogglePin}
                  hoverHandle={hoverHandle}
                />
              ))}
            </>
          )}
          {sessionGroups.map((group) => (
            <div key={group.id}>
              <SectionLabel>{group.label}</SectionLabel>
              {group.items.map((root) => (
                <SidebarTree
                  key={root.url}
                  entity={root}
                  childrenByParent={childrenByParent}
                  selectedEntityUrl={selectedEntityUrl}
                  onSelectEntity={onSelectEntity}
                  onOpenEntityInSplit={onOpenEntityInSplit}
                  pinnedUrls={pinnedUrls}
                  onTogglePin={onTogglePin}
                  hoverHandle={hoverHandle}
                />
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
        </Stack>
      </ScrollArea>

      <SidebarFooter />

      {/* Shared HoverCard for every <SidebarRow> trigger above. One
          Root means: the open delay applies only to the *first* hover;
          once the popup is on screen, moving to another row swaps the
          payload and follows the pointer immediately. */}
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
