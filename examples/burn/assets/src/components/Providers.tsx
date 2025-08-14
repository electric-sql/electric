import type { ReactNode } from 'react'
import { ThemeProvider } from './Providers/ThemeProvider'
import { SidebarProvider } from './Providers/SidebarProvider'

type ProvidersProps = {
  children: ReactNode
  defaultTheme?: `light` | `dark` | `system`
}

export function Providers({ children, defaultTheme = `dark` }: ProvidersProps) {
  return (
    <ThemeProvider defaultTheme={defaultTheme}>
      <SidebarProvider>{children}</SidebarProvider>
    </ThemeProvider>
  )
}
