import { Check, Monitor, Moon, Sun } from 'lucide-react'
import {
  useDarkModeContext,
  type ThemePreference,
} from '../../../hooks/useDarkMode'
import { Text } from '../../../ui'
import { SettingsScreen, SettingsSection } from '../SettingsScreen'
import styles from './AppearancePage.module.css'

const THEME_OPTIONS: ReadonlyArray<{
  value: ThemePreference
  label: string
  icon: React.ReactElement
  hint: string
}> = [
  {
    value: `light`,
    label: `Light`,
    icon: <Sun size={20} />,
    hint: `Always use the light palette.`,
  },
  {
    value: `dark`,
    label: `Dark`,
    icon: <Moon size={20} />,
    hint: `Always use the dark palette.`,
  },
  {
    value: `system`,
    label: `System`,
    icon: <Monitor size={20} />,
    hint: `Follow your OS setting.`,
  },
]

/**
 * Settings → Appearance. Currently exposes the theme switcher only;
 * future appearance preferences (font scale, density, …) land here.
 */
export function AppearancePage(): React.ReactElement {
  const { preference, setPreference } = useDarkModeContext()

  return (
    <SettingsScreen title="Appearance">
      <SettingsSection
        title="Theme"
        description="Match Electric Agents to your system or pick a permanent palette."
      >
        <div className={styles.themeGrid}>
          {THEME_OPTIONS.map((opt) => {
            const active = preference === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPreference(opt.value)}
                className={`${styles.tile} ${active ? styles.tileActive : ``}`}
                aria-pressed={active}
              >
                <span className={styles.tileIcon}>{opt.icon}</span>
                <span className={styles.tileBody}>
                  <Text size={2} weight={`medium`}>
                    {opt.label}
                  </Text>
                  <Text size={1} tone="muted">
                    {opt.hint}
                  </Text>
                </span>
                {active && (
                  <span className={styles.tileMark} aria-hidden>
                    <Check size={14} />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </SettingsSection>
    </SettingsScreen>
  )
}
