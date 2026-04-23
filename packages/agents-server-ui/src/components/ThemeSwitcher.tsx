import { useEffect, useState } from 'react'
import { Flex } from '@radix-ui/themes'

export type ThemeId = `editorial` | `control` | `workshop`

export interface ThemeConfig {
  label: string
  accentColor: `indigo` | `jade` | `amber`
  grayColor: `mauve` | `sage` | `sand`
  radius: `medium` | `large`
}

export const themes: Record<ThemeId, ThemeConfig> = {
  editorial: {
    label: `Editorial`,
    accentColor: `indigo`,
    grayColor: `mauve`,
    radius: `medium`,
  },
  control: {
    label: `Control`,
    accentColor: `jade`,
    grayColor: `sage`,
    radius: `medium`,
  },
  workshop: {
    label: `Workshop`,
    accentColor: `amber`,
    grayColor: `sand`,
    radius: `large`,
  },
}

const themeIds: Array<ThemeId> = [`editorial`, `control`, `workshop`]

const accentDots: Record<ThemeId, string> = {
  editorial: `#6366f1`,
  control: `#2dd4a8`,
  workshop: `#f59e0b`,
}

export function useTheme(): {
  themeId: ThemeId
  theme: ThemeConfig
  setThemeId: (id: ThemeId) => void
} {
  const [themeId, setThemeIdState] = useState<ThemeId>(() => {
    if (typeof window !== `undefined`) {
      const stored = localStorage.getItem(`electric-agents-theme`)
      if (stored && stored in themes) return stored as ThemeId
    }
    return `editorial`
  })

  const setThemeId = (id: ThemeId) => {
    setThemeIdState(id)
    localStorage.setItem(`electric-agents-theme`, id)
  }

  useEffect(() => {
    document.documentElement.setAttribute(`data-theme`, themeId)
  }, [themeId])

  return { themeId, theme: themes[themeId], setThemeId }
}

export function ThemeSwitcher({
  themeId,
  onSwitch,
}: {
  themeId: ThemeId
  onSwitch: (id: ThemeId) => void
}): React.ReactElement {
  return (
    <Flex
      align="center"
      gap="1"
      style={{
        position: `fixed`,
        bottom: 16,
        right: 16,
        zIndex: 9999,
        background: `var(--color-background)`,
        border: `1px solid var(--gray-a5)`,
        borderRadius: 8,
        padding: `4px`,
        boxShadow: `0 2px 8px rgba(0,0,0,0.12)`,
      }}
    >
      {themeIds.map((id) => (
        <button
          key={id}
          onClick={() => onSwitch(id)}
          style={{
            display: `flex`,
            alignItems: `center`,
            gap: 6,
            padding: `6px 12px`,
            borderRadius: 6,
            border: `none`,
            cursor: `pointer`,
            fontSize: 12,
            fontFamily: `var(--default-font-family)`,
            fontWeight: id === themeId ? 600 : 400,
            background: id === themeId ? `var(--gray-a4)` : `transparent`,
            color: id === themeId ? `var(--gray-12)` : `var(--gray-9)`,
            transition: `all 0.15s`,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: `50%`,
              background: accentDots[id],
              flexShrink: 0,
            }}
          />
          {themes[id].label}
        </button>
      ))}
    </Flex>
  )
}
