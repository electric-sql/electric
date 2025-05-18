import {
  ThemeProvider as NextThemeProvider,
  useTheme as useNextTheme,
} from 'next-themes'
import { Theme } from '@radix-ui/themes'
import { useEffect, useState } from 'react'
import '@radix-ui/themes/styles.css'

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: `light` | `dark` | `system`
}

export function ThemeProvider({
  children,
  defaultTheme = `system`,
}: ThemeProviderProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return null
  }

  return (
    <NextThemeProvider
      attribute="class"
      defaultTheme={defaultTheme}
      enableSystem
      themes={[`light`, `dark`, `system`]}
    >
      <Theme appearance="inherit" accentColor="purple" grayColor="gray">
        {children}
      </Theme>
    </NextThemeProvider>
  )
}

export const useTheme = () => {
  const { theme, setTheme } = useNextTheme()
  return { theme, setTheme }
}
