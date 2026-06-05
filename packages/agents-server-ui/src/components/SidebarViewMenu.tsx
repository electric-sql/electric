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
  Server,
  Tag,
  Users,
} from 'lucide-react'
import { eq, not, useLiveQuery } from '@tanstack/react-db'
import { Icon, IconButton, Menu, Text } from '../ui'
import { useElectricAgents } from '../lib/ElectricAgentsProvider'
import { getEntityRunnerId, shortenId } from '../lib/entityRuntime'
import {
  RUNNER_NONE,
  SIDEBAR_GROUP_BY_LABELS,
  SIDEBAR_GROUP_BY_OPTIONS,
  setSidebarGroupBy,
  toggleSidebarCreatorVisibility,
  toggleSidebarRunnerVisibility,
  toggleSidebarStatusVisibility,
  toggleSidebarTypeVisibility,
  useSidebarView,
  type SidebarGroupBy,
} from '../hooks/useSidebarView'
import {
  collapseAllExpanded,
  expandAllUrls,
} from '../hooks/useExpandedTreeNodes'
import { useCurrentPrincipal } from '../hooks/useCurrentPrincipal'
import {
  normalizePrincipalUrl,
  principalKeyFromInput,
  userIdFromPrincipal,
} from '../lib/principals'
import styles from './SidebarViewMenu.module.css'
import type { ElectricUser } from '../lib/ElectricAgentsProvider'

/** Hardcoded enum from `ElectricAgentsProvider.entitySchema`. */
const STATUSES = [`spawning`, `running`, `idle`, `stopped`] as const

const GROUP_BY_ICONS: Record<SidebarGroupBy, React.ReactElement> = {
  date: <Icon icon={CalendarClock} size={2} />,
  type: <Icon icon={Tag} size={2} />,
  status: <Icon icon={Activity} size={2} />,
  workingDir: <Icon icon={Folder} size={2} />,
  runner: <Icon icon={Server} size={2} />,
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
  const { entitiesCollection, runnersCollection, usersCollection } =
    useElectricAgents()
  const { principal: currentPrincipal } = useCurrentPrincipal()
  const currentPrincipalUrl = useMemo(
    () => normalizePrincipalUrl(currentPrincipal),
    [currentPrincipal]
  )

  // Distinct types currently present in the entities collection —
  // drives the "Show > Type" submenu so newly-introduced agent kinds
  // appear automatically rather than being hardcoded here.
  const { data: entities = [] } = useLiveQuery(
    (q) => {
      if (!entitiesCollection) return undefined
      return q
        .from({ e: entitiesCollection })
        .where(({ e }) => not(eq(e.type, `principal`)))
        .orderBy(({ e }) => e.updated_at, `desc`)
        .select(({ e }) => ({
          url: e.url,
          type: e.type,
          parent: e.parent,
          created_by: e.created_by,
          dispatch_policy: e.dispatch_policy,
        }))
    },
    [entitiesCollection]
  )
  const distinctTypes = useMemo(() => {
    const seen = new Set<string>()
    for (const e of entities) seen.add(e.type)
    return Array.from(seen).sort((a, b) => a.localeCompare(b))
  }, [entities])

  // Runner id → label, for the "Show > Runner" submenu.
  const { data: runners = [] } = useLiveQuery(
    (q) => {
      if (!runnersCollection) return undefined
      return q.from({ r: runnersCollection })
    },
    [runnersCollection]
  )
  const runnerLabelById = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of runners) map.set(r.id, r.label || r.id)
    return map
  }, [runners])

  const { data: users = [] } = useLiveQuery(
    (q) => {
      if (!usersCollection) return undefined
      return q.from({ user: usersCollection })
    },
    [usersCollection]
  )
  const usersById = useMemo(
    () => new Map(users.map((user) => [user.id, user])),
    [users]
  )

  const creatorOptions = useMemo(() => {
    const seen = new Set<string>()
    if (currentPrincipalUrl) seen.add(currentPrincipalUrl)
    for (const e of entities) {
      const creator = normalizePrincipalUrl(e.created_by)
      if (creator) seen.add(creator)
    }

    const options = Array.from(seen).map((principal) =>
      principalFilterOption(principal, {
        currentPrincipalUrl,
        usersById,
      })
    )
    return options.sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1
      return a.label.localeCompare(b.label)
    })
  }, [currentPrincipalUrl, entities, usersById])

  // Distinct runners pinned across the current entities, plus whether any
  // entity has no pinned runner (drives the trailing "None" filter entry).
  const { distinctRunners, hasNoneRunner } = useMemo(() => {
    const ids = new Set<string>()
    let none = false
    for (const e of entities) {
      const id = getEntityRunnerId(e)
      if (id === null) none = true
      else ids.add(id)
    }
    const list = Array.from(ids)
      .map((id) => ({
        id,
        label: runnerLabelById.get(id) ?? shortenId(id),
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
    return { distinctRunners: list, hasNoneRunner: none }
  }, [entities, runnerLabelById])

  // "Expand all" needs to know which URLs are expandable (i.e. roots
  // with children). The Sidebar already builds this graph; for menu
  // purposes the cheap approximation of "every entity that is the
  // parent of at least one other entity" is good enough.
  const expandableUrls = useMemo(() => {
    const entityUrls = new Set(entities.map((e) => e.url))
    const parents = new Set<string>()
    for (const e of entities) {
      if (e.parent && entityUrls.has(e.parent)) parents.add(e.parent)
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
            <Icon icon={ListFilter} size={2} />
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
                {active && (
                  <Icon icon={Check} size={2} className={styles.activeMark} />
                )}
              </Menu.Item>
            )
          })}
        </Menu.Group>

        <Menu.Separator />

        <Menu.Group>
          <Menu.Label>Show</Menu.Label>

          <Menu.SubmenuRoot>
            <Menu.SubmenuTrigger className={styles.submenuTrigger}>
              <Icon icon={Tag} size={2} />
              <Text size={2}>Type</Text>
              <Icon
                icon={ChevronRight}
                size={2}
                className={styles.submenuChevron}
              />
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
                        <Icon
                          icon={Check}
                          size={2}
                          className={styles.activeMark}
                        />
                      )}
                    </Menu.Item>
                  )
                })
              )}
            </Menu.Content>
          </Menu.SubmenuRoot>

          <Menu.SubmenuRoot>
            <Menu.SubmenuTrigger className={styles.submenuTrigger}>
              <Icon icon={Activity} size={2} />
              <Text size={2}>Status</Text>
              <Icon
                icon={ChevronRight}
                size={2}
                className={styles.submenuChevron}
              />
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
                      <Icon
                        icon={Check}
                        size={2}
                        className={styles.activeMark}
                      />
                    )}
                  </Menu.Item>
                )
              })}
            </Menu.Content>
          </Menu.SubmenuRoot>

          <Menu.SubmenuRoot>
            <Menu.SubmenuTrigger className={styles.submenuTrigger}>
              <Icon icon={Server} size={2} />
              <Text size={2}>Runner</Text>
              <Icon
                icon={ChevronRight}
                size={2}
                className={styles.submenuChevron}
              />
            </Menu.SubmenuTrigger>
            <Menu.Content side="left" align="start">
              {distinctRunners.length === 0 && !hasNoneRunner ? (
                <Menu.Item disabled>
                  <Text size={2} tone="muted">
                    No runners yet
                  </Text>
                </Menu.Item>
              ) : (
                <>
                  {distinctRunners.map((r) => {
                    const visible = !view.hiddenRunners.has(r.id)
                    return (
                      <Menu.Item
                        key={r.id}
                        onSelect={() => toggleSidebarRunnerVisibility(r.id)}
                      >
                        <Text size={2}>{r.label}</Text>
                        {visible && (
                          <Icon
                            icon={Check}
                            size={2}
                            className={styles.activeMark}
                          />
                        )}
                      </Menu.Item>
                    )
                  })}
                  {hasNoneRunner && (
                    <Menu.Item
                      onSelect={() =>
                        toggleSidebarRunnerVisibility(RUNNER_NONE)
                      }
                    >
                      <Text size={2}>None</Text>
                      {!view.hiddenRunners.has(RUNNER_NONE) && (
                        <Icon
                          icon={Check}
                          size={2}
                          className={styles.activeMark}
                        />
                      )}
                    </Menu.Item>
                  )}
                </>
              )}
            </Menu.Content>
          </Menu.SubmenuRoot>

          <Menu.SubmenuRoot>
            <Menu.SubmenuTrigger className={styles.submenuTrigger}>
              <Icon icon={Users} size={2} />
              <Text size={2}>Created by</Text>
              <Icon
                icon={ChevronRight}
                size={2}
                className={styles.submenuChevron}
              />
            </Menu.SubmenuTrigger>
            <Menu.Content side="left" align="start" className={styles.wideMenu}>
              {creatorOptions.length === 0 ? (
                <Menu.Item disabled>
                  <Text size={2} tone="muted">
                    No creators yet
                  </Text>
                </Menu.Item>
              ) : (
                creatorOptions.map((creator) => {
                  const visible = !view.hiddenCreators.has(creator.principal)
                  return (
                    <Menu.Item
                      key={creator.principal}
                      onSelect={() =>
                        toggleSidebarCreatorVisibility(creator.principal)
                      }
                    >
                      <span className={styles.principalText}>
                        <Text size={2} className={styles.principalLabel}>
                          {creator.label}
                        </Text>
                        <Text
                          size={1}
                          tone="muted"
                          family="mono"
                          className={styles.principalKey}
                        >
                          {creator.principalKey}
                        </Text>
                      </span>
                      {visible && (
                        <Icon
                          icon={Check}
                          size={2}
                          className={styles.activeMark}
                        />
                      )}
                    </Menu.Item>
                  )
                })
              )}
            </Menu.Content>
          </Menu.SubmenuRoot>
        </Menu.Group>

        <Menu.Separator />

        <Menu.Item
          onSelect={() => expandAllUrls(expandableUrls)}
          disabled={expandableUrls.length === 0}
        >
          <Icon icon={ChevronsUpDown} size={2} />
          <Text size={2}>Expand all</Text>
        </Menu.Item>
        <Menu.Item onSelect={() => collapseAllExpanded()}>
          <Icon icon={ChevronsDownUp} size={2} />
          <Text size={2}>Collapse all</Text>
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  )
}

function principalFilterOption(
  principal: string,
  {
    currentPrincipalUrl,
    usersById,
  }: {
    currentPrincipalUrl: string | null
    usersById: ReadonlyMap<string, ElectricUser>
  }
): {
  principal: string
  principalKey: string
  label: string
  isCurrent: boolean
} {
  const principalKey = principalKeyFromInput(principal) ?? principal
  const isCurrent = principal === currentPrincipalUrl
  if (isCurrent) {
    return { principal, principalKey, label: `Me`, isCurrent }
  }
  const userId = userIdFromPrincipal(principal)
  const user = userId ? usersById.get(userId) : undefined
  return {
    principal,
    principalKey,
    label: userDisplayName(user) ?? formatPrincipalKey(principalKey),
    isCurrent,
  }
}

function userDisplayName(user: ElectricUser | undefined): string | null {
  if (!user) return null
  return user.display_name || user.email || null
}

function formatPrincipalKey(key: string): string {
  const colon = key.indexOf(`:`)
  if (colon <= 0) return shortenPrincipalId(key)
  const kind = key.slice(0, colon)
  const id = key.slice(colon + 1)
  return `${kind}:${shortenPrincipalId(id)}`
}

function shortenPrincipalId(id: string): string {
  if (id.length <= 18) return id
  return `${id.slice(0, 8)}...${id.slice(-6)}`
}
