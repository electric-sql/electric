import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Brain,
  Check,
  ChevronRight,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  Settings as SettingsIcon,
  Square,
  Sun,
} from 'lucide-react'
import { Icon, IconButton, Menu, Text } from '../ui'
import { useDarkModeContext, type ThemePreference } from '../hooks/useDarkMode'
import {
  loadDesktopState,
  onDesktopStateChanged,
  type DesktopState,
  type LocalRuntimeStatus,
} from '../lib/server-connection'
import styles from './SettingsMenu.module.css'

const THEME_OPTIONS: ReadonlyArray<{
  value: ThemePreference
  label: string
  icon: React.ReactElement
}> = [
  { value: `light`, label: `Light`, icon: <Icon icon={Sun} size={2} /> },
  { value: `dark`, label: `Dark`, icon: <Icon icon={Moon} size={2} /> },
  { value: `system`, label: `System`, icon: <Icon icon={Monitor} size={2} /> },
]

const RUNTIME_STATUS_LABELS: Record<LocalRuntimeStatus, string> = {
  disabled: `Disabled`,
  running: `Running`,
  starting: `Starting`,
  stopped: `Stopped`,
  error: `Error`,
}

/**
 * Settings cog dropdown.
 *
 * The top-level menu is a tight three-row launcher:
 *
 *   - Theme         → submenu (Light / Dark / System)
 *   - Local Runtime → submenu for this window's selected server
 *   - Settings…     → opens the full Settings screen at /settings
 *
 * "Local Runtime" only renders on the desktop build and refers to
 * the runtime for the server selected in the current window.
 */
export function SettingsMenu(): React.ReactElement {
  const { preference, setPreference } = useDarkModeContext()
  const navigate = useNavigate()
  const [desktopState, setDesktopState] = useState<DesktopState | null>(null)
  const isDesktop = typeof window !== `undefined` && Boolean(window.electronAPI)

  useEffect(() => {
    if (!window.electronAPI?.getDesktopState) return
    void loadDesktopState().then(setDesktopState)
    const unsubscribe = onDesktopStateChanged(setDesktopState)
    return () => {
      unsubscribe?.()
    }
  }, [])

  const activeServerName = desktopState?.activeServer?.name ?? `current server`
  const activeServerId =
    desktopState?.selectedServerId ?? desktopState?.activeServer?.id ?? null
  const activeConnection =
    desktopState?.connections.find(
      (entry) => entry.serverId === desktopState.selectedServerId
    ) ?? null
  const localRuntimeStatus = activeConnection?.localRuntimeStatus ?? `stopped`
  const localRuntimeDisabled = localRuntimeStatus === `disabled`
  const runtimeUrl = activeConnection?.runtimeUrl ?? null
  const runtimeError = activeConnection?.runtimeError ?? null
  const runtimeIsRunning = localRuntimeStatus === `running`
  const runtimeIsStarting = localRuntimeStatus === `starting`

  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <IconButton
            variant="ghost"
            tone="neutral"
            size={1}
            aria-label="Settings"
            title="Settings"
          >
            <Icon icon={SettingsIcon} size={2} />
          </IconButton>
        }
      />
      <Menu.Content side="top" align="end">
        <Menu.SubmenuRoot>
          <Menu.SubmenuTrigger className={styles.submenuTrigger}>
            <Icon icon={Palette} size={2} />
            <Text size={2}>Theme</Text>
            <Icon
              icon={ChevronRight}
              size={2}
              className={styles.submenuChevron}
            />
          </Menu.SubmenuTrigger>
          <Menu.Content side="left" align="start">
            {THEME_OPTIONS.map((opt) => {
              const active = preference === opt.value
              return (
                <Menu.Item
                  key={opt.value}
                  onSelect={() => setPreference(opt.value)}
                >
                  {opt.icon}
                  <Text size={2}>{opt.label}</Text>
                  {active && (
                    <Icon icon={Check} size={2} className={styles.activeMark} />
                  )}
                </Menu.Item>
              )
            })}
          </Menu.Content>
        </Menu.SubmenuRoot>

        {isDesktop && (
          <Menu.SubmenuRoot>
            <Menu.SubmenuTrigger className={styles.submenuTrigger}>
              <Icon icon={Brain} size={2} />
              <Text size={2}>Local runtime</Text>
              <Icon
                icon={ChevronRight}
                size={2}
                className={styles.submenuChevron}
              />
            </Menu.SubmenuTrigger>
            <Menu.Content
              side="left"
              align="start"
              className={styles.runtimeMenu}
            >
              <div className={styles.runtimeCard}>
                <div className={styles.runtimeHeader}>
                  <div className={styles.runtimeIcon}>
                    <Icon icon={Brain} size={2} />
                  </div>
                  <div className={styles.runtimeTitle}>
                    <Text size={2} weight="medium">
                      Local runtime
                    </Text>
                    <Text size={1} tone="muted" truncate>
                      For {activeServerName}
                    </Text>
                  </div>
                  <span
                    className={styles.runtimeStatus}
                    data-status={localRuntimeStatus}
                  >
                    <span className={styles.runtimeStatusDot} />
                    {RUNTIME_STATUS_LABELS[localRuntimeStatus]}
                  </span>
                </div>
                {runtimeUrl ? (
                  <Text
                    size={1}
                    family="mono"
                    tone="muted"
                    truncate
                    className={styles.runtimeUrl}
                  >
                    Pull-wake
                  </Text>
                ) : (
                  <Text size={1} tone="muted" className={styles.runtimeHint}>
                    {localRuntimeDisabled
                      ? `Disabled for this server`
                      : `Runtime not started`}
                  </Text>
                )}
                {runtimeError && (
                  <Text size={1} tone="danger" className={styles.runtimeError}>
                    {runtimeError}
                  </Text>
                )}
              </div>
              <Menu.Separator />
              <Menu.Group>
                {!runtimeIsRunning && !runtimeIsStarting ? (
                  <Menu.Item
                    disabled={localRuntimeDisabled || !activeServerId}
                    onSelect={() =>
                      activeServerId
                        ? void window.electronAPI?.restartServerRuntime?.(
                            activeServerId
                          )
                        : undefined
                    }
                  >
                    <Icon icon={Brain} size={2} />
                    <Text size={2}>Start runtime</Text>
                  </Menu.Item>
                ) : (
                  <Menu.Item
                    disabled={runtimeIsStarting}
                    onSelect={() =>
                      activeServerId
                        ? void window.electronAPI?.restartServerRuntime?.(
                            activeServerId
                          )
                        : undefined
                    }
                  >
                    <Icon icon={RefreshCw} size={2} />
                    <Text size={2}>Restart runtime</Text>
                  </Menu.Item>
                )}
                <Menu.Item
                  disabled={!runtimeIsRunning && !runtimeIsStarting}
                  onSelect={() =>
                    activeServerId
                      ? void window.electronAPI?.stopServerRuntime?.(
                          activeServerId
                        )
                      : undefined
                  }
                >
                  <Icon icon={Square} size={2} />
                  <Text size={2}>Stop runtime</Text>
                </Menu.Item>
                <Menu.Item
                  onSelect={() =>
                    navigate({
                      to: `/settings/$category`,
                      params: { category: `servers` },
                    })
                  }
                >
                  <Icon icon={SettingsIcon} size={2} />
                  <Text size={2}>Configure server…</Text>
                </Menu.Item>
              </Menu.Group>
            </Menu.Content>
          </Menu.SubmenuRoot>
        )}

        <Menu.Separator />

        <Menu.Item
          onSelect={() =>
            navigate({
              to: `/settings/$category`,
              params: { category: `general` },
            })
          }
        >
          <Icon icon={SettingsIcon} size={2} />
          <Text size={2}>Settings…</Text>
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  )
}
