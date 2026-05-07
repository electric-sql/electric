import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  ArrowLeft,
  Cpu,
  Palette,
  Plug,
  Settings as SettingsIcon,
} from 'lucide-react'
import { Icon, ScrollArea, Stack, Text } from '../../ui'
import {
  loadDesktopState,
  onDesktopStateChanged,
  type DesktopState,
} from '../../lib/server-connection'
import { useNarrowViewport } from '../../hooks/useNarrowViewport'
import { useSidebarCollapsed } from '../../hooks/useSidebarCollapsed'
import styles from './SettingsSidebar.module.css'

export type SettingsCategoryId =
  | `general`
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

/**
 * Settings sidebar — replaces the regular `<Sidebar>` while the user
 * is on a `/settings/*` route. Mirrors the visual chrome of the main
 * sidebar (same background, same width as the standard sidebar header
 * gutter) so the settings experience reads as part of the same shell
 * rather than a modal overlay.
 *
 * The header row sits in the macOS draggable region (see
 * `:global(html[data-electric-desktop='true'])` rules in the
 * stylesheet); the "Back to app" affordance opts back out via
 * `data-no-drag` so it stays clickable.
 */
export function SettingsSidebar({
  activeCategory,
}: {
  activeCategory: SettingsCategoryId
}): React.ReactElement {
  const navigate = useNavigate()
  const [desktopState, setDesktopState] = useState<DesktopState | null>(null)
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

  useEffect(() => {
    if (!window.electronAPI?.getDesktopState) return
    void loadDesktopState().then(setDesktopState)
    const unsubscribe = onDesktopStateChanged(setDesktopState)
    return () => {
      unsubscribe?.()
    }
  }, [])

  const categories: ReadonlyArray<CategoryDef> = [
    {
      id: `general`,
      label: `General`,
      icon: <Icon icon={SettingsIcon} size={2} />,
      visible: true,
    },
    {
      id: `appearance`,
      label: `Appearance`,
      icon: <Icon icon={Palette} size={2} />,
      visible: true,
    },
    {
      id: `local-runtime`,
      label: `Local Runtime`,
      icon: <Icon icon={Cpu} size={2} />,
      visible: isDesktop || Boolean(desktopState),
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
        <div className={styles.header}>
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
            {categories
              .filter((c) => c.visible)
              .map((c) => (
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
        </ScrollArea>
      </Stack>
    </>
  )
}
