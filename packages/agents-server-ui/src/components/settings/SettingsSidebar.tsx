import { useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  ArrowLeft,
  Brain,
  KeyRound,
  Palette,
  Plug,
  RadioTower,
  Server,
  Settings as SettingsIcon,
  Terminal,
  UserCircle,
} from 'lucide-react'
import { Icon, ScrollArea, Stack, Text } from '../../ui'
import { useNarrowViewport } from '../../hooks/useNarrowViewport'
import { useSidebarCollapsed } from '../../hooks/useSidebarCollapsed'
import styles from './SettingsSidebar.module.css'

export type SettingsCategoryId =
  | `general`
  | `account`
  | `servers`
  | `credentials`
  | `realtime`
  | `command-line`
  | `appearance`
  | `local-runtime`
  | `mcp-servers`

interface CategoryDef {
  id: SettingsCategoryId
  label: string
  icon: React.ReactElement
  /** When false, hide the row entirely (e.g. desktop-only rows). */
  visible: boolean
}

interface CategorySectionDef {
  title: string | null
  categories: ReadonlyArray<CategoryDef>
}

/**
 * Settings sidebar — replaces the regular `<Sidebar>` while the user
 * is on a `/settings/*` route. Mirrors the visual chrome of the main
 * sidebar (same background, same width as the standard sidebar header
 * gutter) so the settings experience reads as part of the same shell
 * rather than a modal overlay.
 *
 * In macOS desktop builds the header row sits in the draggable window
 * region; the "Back to app" affordance opts back out via `data-no-drag`
 * so it stays clickable.
 */
export function SettingsSidebar({
  activeCategory,
}: {
  activeCategory: SettingsCategoryId
}): React.ReactElement {
  const navigate = useNavigate()
  const isDesktop = typeof window !== `undefined` && Boolean(window.electronAPI)
  // See Sidebar.tsx — same overlay pattern so settings reads
  // consistently with the workspace sidebar on narrow viewports.
  const narrow = useNarrowViewport()
  const { collapsed, setCollapsed } = useSidebarCollapsed()
  const overlayState: `open` | `closed` | undefined = narrow
    ? collapsed
      ? `closed`
      : `open`
    : undefined
  const closeIfOverlay = useCallback(() => {
    if (narrow) setCollapsed(true)
  }, [narrow, setCollapsed])

  const sections: ReadonlyArray<CategorySectionDef> = [
    {
      title: null,
      categories: [
        {
          id: `general`,
          label: `General`,
          icon: <Icon icon={SettingsIcon} size={2} />,
          visible: true,
        },
      ],
    },
    {
      title: `Setup`,
      categories: [
        {
          id: `account`,
          label: `Account`,
          icon: <Icon icon={UserCircle} size={2} />,
          // Sign-in only makes sense in the desktop build; the web build
          // doesn't have IPC to safely hold the resulting JWT.
          visible: isDesktop,
        },
        {
          id: `servers`,
          label: `Servers`,
          icon: <Icon icon={Server} size={2} />,
          visible: true,
        },
        {
          id: `credentials`,
          label: `Credentials`,
          icon: <Icon icon={KeyRound} size={2} />,
          visible: true,
        },
        {
          id: `realtime`,
          label: `Realtime`,
          icon: <Icon icon={RadioTower} size={2} />,
          visible: true,
        },
        {
          id: `command-line`,
          label: `Command Line`,
          icon: <Icon icon={Terminal} size={2} />,
          visible: isDesktop,
        },
        {
          id: `local-runtime`,
          label: `Local Runtime`,
          icon: <Icon icon={Brain} size={2} />,
          visible: isDesktop,
        },
        {
          id: `mcp-servers`,
          label: `MCP Servers`,
          icon: <Plug size={14} />,
          // Push-based view of the in-process MCP registry — desktop only.
          // The web build doesn't have access to BuiltinAgentsServer's
          // registry over IPC, and remote runtimes are no longer aggregated.
          visible: isDesktop,
        },
      ],
    },
    {
      title: `Preferences`,
      categories: [
        {
          id: `appearance`,
          label: `Appearance`,
          icon: <Icon icon={Palette} size={2} />,
          visible: true,
        },
      ],
    },
  ]

  return (
    <>
      {narrow && (
        <div
          className={styles.backdrop}
          data-state={overlayState}
          onClick={() => setCollapsed(true)}
          aria-hidden={collapsed ? `true` : undefined}
        />
      )}
      <Stack
        direction="column"
        data-state={overlayState}
        className={`${styles.root} ${narrow ? styles.overlay : ``}`}
      >
        <div className={styles.header} data-sidebar-control-surface="true">
          <button
            type="button"
            onClick={() => {
              navigate({ to: `/` })
              closeIfOverlay()
            }}
            className={styles.backButton}
            data-no-drag
            aria-label="Back to app"
          >
            <Icon icon={ArrowLeft} size={2} />
            <Text size={2}>Back to app</Text>
          </button>
        </div>

        <ScrollArea className={styles.scrollFlex}>
          <Stack direction="column" className={styles.list}>
            {sections.map((section) => {
              const visibleCategories = section.categories.filter(
                (c) => c.visible
              )
              if (visibleCategories.length === 0) return null
              return (
                <div key={section.title ?? `root`} className={styles.group}>
                  {section.title && (
                    <Text
                      size={1}
                      tone="muted"
                      weight="medium"
                      className={styles.groupLabel}
                    >
                      {section.title}
                    </Text>
                  )}
                  <Stack direction="column" gap={1}>
                    {visibleCategories.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          navigate({
                            to: `/settings/$category`,
                            params: { category: c.id },
                          })
                          closeIfOverlay()
                        }}
                        className={`${styles.row} ${
                          activeCategory === c.id ? styles.rowActive : ``
                        }`}
                      >
                        <span className={styles.iconSlot}>{c.icon}</span>
                        <span className={styles.label}>{c.label}</span>
                      </button>
                    ))}
                  </Stack>
                </div>
              )
            })}
          </Stack>
        </ScrollArea>
      </Stack>
    </>
  )
}
