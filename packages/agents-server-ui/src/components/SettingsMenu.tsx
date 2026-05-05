import { useEffect, useState } from 'react'
import {
  Check,
  Monitor,
  Moon,
  RefreshCw,
  Settings,
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

/**
 * Settings cog dropdown — currently exposes the theme switcher
 * (Light / Dark / System) and reserves space for future preferences.
 */
export function SettingsMenu(): React.ReactElement {
  const { preference, setPreference } = useDarkModeContext()
  const [desktopState, setDesktopState] = useState<DesktopState | null>(null)

  useEffect(() => {
    if (!window.electronAPI?.getDesktopState) return
    void loadDesktopState().then(setDesktopState)
    const unsubscribe = onDesktopStateChanged(setDesktopState)
    return () => {
      unsubscribe?.()
    }
  }, [])

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
            <Settings size={14} />
          </IconButton>
        }
      />
      <Menu.Content side="top" align="end">
        <Menu.Group>
          <Menu.Label>Theme</Menu.Label>
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
        </Menu.Group>
        {desktopState && (
          <>
            <Menu.Separator />
            <Menu.Group>
              <Menu.Label>Desktop runtime</Menu.Label>
              <Menu.Item disabled>
                <Text size={2}>Status: {desktopState.runtimeStatus}</Text>
              </Menu.Item>
              {desktopState.runtimeUrl && (
                <Menu.Item disabled>
                  <Text size={2}>{desktopState.runtimeUrl}</Text>
                </Menu.Item>
              )}
              {desktopState.error && (
                <Menu.Item disabled>
                  <Text size={2}>{desktopState.error}</Text>
                </Menu.Item>
              )}
              <Menu.Item
                disabled={!desktopState.activeServer}
                onSelect={() => void window.electronAPI?.restartRuntime?.()}
              >
                <RefreshCw size={14} />
                <Text size={2}>Restart runtime</Text>
              </Menu.Item>
              <Menu.Item
                onSelect={() => void window.electronAPI?.stopRuntime?.()}
              >
                <Square size={14} />
                <Text size={2}>Stop runtime</Text>
              </Menu.Item>
            </Menu.Group>
          </>
        )}
      </Menu.Content>
    </Menu.Root>
  )
}
