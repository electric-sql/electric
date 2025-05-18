import { ReactNode } from 'react'
import { ThemeProvider } from './ThemeProvider'
import { SidebarProvider } from './SidebarProvider'

type ProvidersProps = {
  children: ReactNode
  defaultTheme?: `light` | `dark` | `system`
}

export function Providers({
  children,
  defaultTheme = `light`,
}: ProvidersProps) {
  return (
    <ThemeProvider defaultTheme={defaultTheme}>
      <SidebarProvider>{children}</SidebarProvider>
    </ThemeProvider>
  )
}
