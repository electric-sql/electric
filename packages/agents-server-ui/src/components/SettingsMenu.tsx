import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Check,
  ChevronRight,
  Cpu,
  Monitor,
  Moon,
  Palette,
  Play,
  RefreshCw,
  Settings as SettingsIcon,
  Square,
  Sun,
} from 'lucide-react'
import { IconButton, Menu, Text } from '../ui'
import { useDarkModeContext, type ThemePreference } from '../hooks/useDarkMode'
import {
  loadDesktopState,
  onDesktopStateChanged,
  type DesktopState,
} from '../lib/server-connection'
import styles from './SettingsMenu.module.css'

const THEME_OPTIONS: ReadonlyArray<{
  value: ThemePreference
  label: string
  icon: React.ReactElement
}> = [
  { value: `light`, label: `Light`, icon: <Sun size={14} /> },
  { value: `dark`, label: `Dark`, icon: <Moon size={14} /> },
  { value: `system`, label: `System`, icon: <Monitor size={14} /> },
]

const RUNTIME_STATUS_LABELS: Record<DesktopState[`runtimeStatus`], string> = {
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
 *   - Local Runtime → submenu (status + start/restart/stop)
 *   - Settings…     → opens the full Settings screen at /settings
 *
 * "Local Runtime" only renders on the desktop build (it's the only
 * place where the bundled Horton runtime exists). The Settings link
 * is always shown — Settings → General is useful in the web build
 * too once additional preferences land there.
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

  const runtimeStatus = desktopState?.runtimeStatus ?? `stopped`
  const runtimeUrl = desktopState?.runtimeUrl ?? null
  const runtimeError = desktopState?.error ?? null
  const runtimeIsRunning = runtimeStatus === `running`
  const runtimeIsStarting = runtimeStatus === `starting`

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
            <SettingsIcon size={14} />
          </IconButton>
        }
      />
      <Menu.Content side="top" align="end">
        <Menu.SubmenuRoot>
          <Menu.SubmenuTrigger className={styles.submenuTrigger}>
            <Palette size={14} />
            <Text size={2}>Theme</Text>
            <ChevronRight size={14} className={styles.submenuChevron} />
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
                  {active && <Check size={14} className={styles.activeMark} />}
                </Menu.Item>
              )
            })}
          </Menu.Content>
        </Menu.SubmenuRoot>

        {isDesktop && (
          <Menu.SubmenuRoot>
            <Menu.SubmenuTrigger className={styles.submenuTrigger}>
              <Cpu size={14} />
              <Text size={2}>Local Runtime</Text>
              <ChevronRight size={14} className={styles.submenuChevron} />
            </Menu.SubmenuTrigger>
            <Menu.Content side="left" align="start">
              <Menu.Group>
                <Menu.Label>Status</Menu.Label>
                <Menu.Item disabled>
                  <Text size={2}>{RUNTIME_STATUS_LABELS[runtimeStatus]}</Text>
                </Menu.Item>
                {runtimeUrl && (
                  <Menu.Item disabled>
                    <Text size={1} family={`mono`} tone={`muted`}>
                      {runtimeUrl}
                    </Text>
                  </Menu.Item>
                )}
                {runtimeError && (
                  <Menu.Item disabled>
                    <Text size={1} tone={`danger`}>
                      {runtimeError}
                    </Text>
                  </Menu.Item>
                )}
              </Menu.Group>
              <Menu.Separator />
              <Menu.Group>
                {!runtimeIsRunning && !runtimeIsStarting ? (
                  <Menu.Item
                    onSelect={() => void window.electronAPI?.restartRuntime?.()}
                  >
                    <Play size={14} />
                    <Text size={2}>Start runtime</Text>
                  </Menu.Item>
                ) : (
                  <Menu.Item
                    disabled={runtimeIsStarting}
                    onSelect={() => void window.electronAPI?.restartRuntime?.()}
                  >
                    <RefreshCw size={14} />
                    <Text size={2}>Restart runtime</Text>
                  </Menu.Item>
                )}
                <Menu.Item
                  disabled={!runtimeIsRunning && !runtimeIsStarting}
                  onSelect={() => void window.electronAPI?.stopRuntime?.()}
                >
                  <Square size={14} />
                  <Text size={2}>Stop runtime</Text>
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
          <SettingsIcon size={14} />
          <Text size={2}>Settings…</Text>
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  )
}
