import { useMemo } from 'react'
import {
  Activity,
  CalendarClock,
  Check,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Folder,
  ListFilter,
  Tag,
} from 'lucide-react'
import { useLiveQuery } from '@tanstack/react-db'
import { IconButton, Menu, Text } from '../ui'
import { useElectricAgents } from '../lib/ElectricAgentsProvider'
import {
  SIDEBAR_GROUP_BY_LABELS,
  SIDEBAR_GROUP_BY_OPTIONS,
  setSidebarGroupBy,
  toggleSidebarStatusVisibility,
  toggleSidebarTypeVisibility,
  useSidebarView,
  type SidebarGroupBy,
} from '../hooks/useSidebarView'
import {
  collapseAllExpanded,
  expandAllUrls,
} from '../hooks/useExpandedTreeNodes'
import styles from './SidebarViewMenu.module.css'

/** Hardcoded enum from `ElectricAgentsProvider.entitySchema`. */
const STATUSES = [`spawning`, `running`, `idle`, `stopped`] as const

const GROUP_BY_ICONS: Record<SidebarGroupBy, React.ReactElement> = {
  date: <CalendarClock size={14} />,
  type: <Tag size={14} />,
  status: <Activity size={14} />,
  workingDir: <Folder size={14} />,
}

/**
 * Sidebar view-and-filter menu — the funnel-icon dropdown that sits
 * between the server picker and the settings cog in the sidebar
 * footer.
 *
 * Mirrors the standard "Group by" / "Show" / collapse-all pattern
 * common in agent / IDE chrome. Group-by is single-select; Show
 * filters are multi-select submenus per category (Type, Status), so
 * a project with lots of stopped runs can hide them without
 * losing access to running sessions.
 *
 * State lives in the module-level `useSidebarView` store so the menu
 * (rendered in a portal) and the Sidebar (rendered up the tree) can
 * read and write the same prefs without an enclosing context.
 */
export function SidebarViewMenu(): React.ReactElement {
  const view = useSidebarView()
  const { entitiesCollection } = useElectricAgents()

  // Distinct types currently present in the entities collection —
  // drives the "Show > Type" submenu so newly-introduced agent kinds
  // appear automatically rather than being hardcoded here.
  const { data: entities = [] } = useLiveQuery(
    (q) => {
      if (!entitiesCollection) return undefined
      return q
        .from({ e: entitiesCollection })
        .orderBy(({ e }) => e.updated_at, `desc`)
    },
    [entitiesCollection]
  )
  const distinctTypes = useMemo(() => {
    const seen = new Set<string>()
    for (const e of entities) seen.add(e.type)
    return Array.from(seen).sort((a, b) => a.localeCompare(b))
  }, [entities])

  // "Expand all" needs to know which URLs are expandable (i.e. roots
  // with children). The Sidebar already builds this graph; for menu
  // purposes the cheap approximation of "every entity that is the
  // parent of at least one other entity" is good enough.
  const expandableUrls = useMemo(() => {
    const parents = new Set<string>()
    for (const e of entities) {
      if (e.parent) parents.add(e.parent)
    }
    return Array.from(parents)
  }, [entities])

  const formatLabel = (id: string): string =>
    id.replace(/[-_]+/g, ` `).replace(/\b\w/g, (c) => c.toUpperCase())

  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <IconButton
            variant="ghost"
            tone="neutral"
            size={1}
            aria-label="Filter & view options"
            title="Filter & view"
          >
            <ListFilter size={14} />
          </IconButton>
        }
      />
      <Menu.Content side="top" align="end">
        <Menu.Group>
          <Menu.Label>Group by</Menu.Label>
          {SIDEBAR_GROUP_BY_OPTIONS.map((opt) => {
            const active = view.groupBy === opt
            return (
              <Menu.Item key={opt} onSelect={() => setSidebarGroupBy(opt)}>
                {GROUP_BY_ICONS[opt]}
                <Text size={2}>{SIDEBAR_GROUP_BY_LABELS[opt]}</Text>
                {active && <Check size={14} className={styles.activeMark} />}
              </Menu.Item>
            )
          })}
        </Menu.Group>

        <Menu.Separator />

        <Menu.Group>
          <Menu.Label>Show</Menu.Label>

          <Menu.SubmenuRoot>
            <Menu.SubmenuTrigger className={styles.submenuTrigger}>
              <Tag size={14} />
              <Text size={2}>Type</Text>
              <ChevronRight size={14} className={styles.submenuChevron} />
            </Menu.SubmenuTrigger>
            <Menu.Content side="left" align="start">
              {distinctTypes.length === 0 ? (
                <Menu.Item disabled>
                  <Text size={2} tone="muted">
                    No types yet
                  </Text>
                </Menu.Item>
              ) : (
                distinctTypes.map((t) => {
                  const visible = !view.hiddenTypes.has(t)
                  return (
                    <Menu.Item
                      key={t}
                      onSelect={() => toggleSidebarTypeVisibility(t)}
                    >
                      <Text size={2}>{formatLabel(t)}</Text>
                      {visible && (
                        <Check size={14} className={styles.activeMark} />
                      )}
                    </Menu.Item>
                  )
                })
              )}
            </Menu.Content>
          </Menu.SubmenuRoot>

          <Menu.SubmenuRoot>
            <Menu.SubmenuTrigger className={styles.submenuTrigger}>
              <Activity size={14} />
              <Text size={2}>Status</Text>
              <ChevronRight size={14} className={styles.submenuChevron} />
            </Menu.SubmenuTrigger>
            <Menu.Content side="left" align="start">
              {STATUSES.map((s) => {
                const visible = !view.hiddenStatuses.has(s)
                return (
                  <Menu.Item
                    key={s}
                    onSelect={() => toggleSidebarStatusVisibility(s)}
                  >
                    <Text size={2}>{formatLabel(s)}</Text>
                    {visible && (
                      <Check size={14} className={styles.activeMark} />
                    )}
                  </Menu.Item>
                )
              })}
            </Menu.Content>
          </Menu.SubmenuRoot>
        </Menu.Group>

        <Menu.Separator />

        <Menu.Item
          onSelect={() => expandAllUrls(expandableUrls)}
          disabled={expandableUrls.length === 0}
        >
          <ChevronsUpDown size={14} />
          <Text size={2}>Expand all</Text>
        </Menu.Item>
        <Menu.Item onSelect={() => collapseAllExpanded()}>
          <ChevronsDownUp size={14} />
          <Text size={2}>Collapse all</Text>
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  )
}
