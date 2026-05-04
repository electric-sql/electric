import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FolderOpen, SquarePen } from 'lucide-react'
import { useLiveQuery } from '@tanstack/react-db'
import { useNavigate } from '@tanstack/react-router'
import { useElectricAgents } from '../lib/ElectricAgentsProvider'
import { useProjects } from '../hooks/useProjects'
import { bucketEntities } from '../lib/sessionGroups'
import { HoverCard, ScrollArea, Stack, Text } from '../ui'
import { NewSessionKey } from '../lib/keyLabels'
import { SidebarHeader } from './SidebarHeader'
import { SidebarRowInfo } from './SidebarRow'
import type { SidebarRowInfoPayload } from './SidebarRow'
import sidebarRowStyles from './SidebarRow.module.css'
import { SidebarTree } from './SidebarTree'
import { SidebarFooter } from './SidebarFooter'
import styles from './Sidebar.module.css'
import type { ElectricEntity } from '../lib/ElectricAgentsProvider'
import type { Project } from '../hooks/useProjects'

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
  onTogglePin,
}: {
  selectedEntityUrl: string | null
  onSelectEntity: (url: string) => void
  pinnedUrls: Array<string>
  onTogglePin: (url: string) => void
}): React.ReactElement {
  const { entitiesCollection } = useElectricAgents()
  const { projects } = useProjects()
  const navigate = useNavigate()
  const [width, setWidth] = useSidebarWidth()
  const [resizeHandleHover, setResizeHandleHover] = useState(false)
  const [resizing, setResizing] = useState(false)
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(
    () => new Set()
  )

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

  const unpinnedRoots = useMemo(
    () => roots.filter((r) => !pinnedSet.has(r.url)),
    [roots, pinnedSet]
  )

  const { projectSections, ungrouped } = useMemo(
    () => groupByProject(unpinnedRoots, projects),
    [unpinnedRoots, projects]
  )

  const ungroupedBuckets = useMemo(() => bucketEntities(ungrouped), [ungrouped])

  const toggleProjectCollapsed = useCallback((projectId: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) {
        next.delete(projectId)
      } else {
        next.add(projectId)
      }
      return next
    })
  }, [])

  const handleNewSession = useCallback(() => {
    navigate({ to: `/` })
  }, [navigate])

  const treeProps = {
    childrenByParent,
    selectedEntityUrl,
    onSelectEntity,
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

          {projectSections.map((section) => {
            const collapsed = collapsedProjects.has(section.id)
            return (
              <div key={section.id}>
                <button
                  type="button"
                  className={styles.projectHeader}
                  onClick={() => toggleProjectCollapsed(section.id)}
                >
                  <FolderOpen size={12} className={styles.projectHeaderIcon} />
                  <span className={styles.projectHeaderLabel}>
                    {section.name}
                  </span>
                  <span className={styles.projectHeaderCount}>
                    {section.items.length}
                  </span>
                  {collapsed ? (
                    <ChevronRight size={12} />
                  ) : (
                    <ChevronDown size={12} />
                  )}
                </button>
                {!collapsed &&
                  section.items.map((root) => (
                    <SidebarTree key={root.url} entity={root} {...treeProps} />
                  ))}
              </div>
            )
          })}

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

interface ProjectSection {
  id: string
  name: string
  items: Array<ElectricEntity>
}

function groupByProject(
  roots: ReadonlyArray<ElectricEntity>,
  projects: ReadonlyArray<Project>
): {
  projectSections: Array<ProjectSection>
  ungrouped: Array<ElectricEntity>
} {
  const projectMap = new Map(projects.map((p) => [p.id, p]))
  const byProject = new Map<string, Array<ElectricEntity>>()
  const ungrouped: Array<ElectricEntity> = []

  for (const entity of roots) {
    const projectId = entity.tags?.project
    if (projectId && projectMap.has(projectId)) {
      const list = byProject.get(projectId) ?? []
      list.push(entity)
      byProject.set(projectId, list)
    } else {
      ungrouped.push(entity)
    }
  }

  const projectSections: Array<ProjectSection> = []
  for (const [id, items] of byProject) {
    const project = projectMap.get(id)!
    projectSections.push({ id, name: project.name, items })
  }

  projectSections.sort((a, b) => {
    const aMax = Math.max(...a.items.map((e) => e.updated_at))
    const bMax = Math.max(...b.items.map((e) => e.updated_at))
    return bMax - aMax
  })

  return { projectSections, ungrouped }
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
