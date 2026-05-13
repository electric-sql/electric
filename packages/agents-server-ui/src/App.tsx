import { RouterProvider } from '@tanstack/react-router'
import { useEffect } from 'react'
import {
  ServerConnectionProvider,
  useServerConnection,
} from './hooks/useServerConnection'
import { PinnedEntitiesProvider } from './hooks/usePinnedEntities'
import { ElectricAgentsProvider } from './lib/ElectricAgentsProvider'
import { DarkModeProvider, useDarkModeContext } from './hooks/useDarkMode'
import { ThemeProvider } from './ui'
import { router } from './router'

function AppInner(): React.ReactElement {
  const { activeServer, connected } = useServerConnection()

  return (
    <ElectricAgentsProvider
      baseUrl={connected ? (activeServer?.url ?? null) : null}
    >
      <PinnedEntitiesProvider>
        <RouterProvider router={router} />
      </PinnedEntitiesProvider>
    </ElectricAgentsProvider>
  )
}

function ThemedApp(): React.ReactElement {
  const { darkMode, preference } = useDarkModeContext()
  const appearance = darkMode ? `dark` : `light`

  useEffect(() => {
    void window.electronAPI?.setNativeAppearance?.(preference)
  }, [preference])

  return (
    <ThemeProvider appearance={appearance}>
      <div className="app-root">
        <ServerConnectionProvider>
          <AppInner />
        </ServerConnectionProvider>
      </div>
    </ThemeProvider>
  )
}

export function App(): React.ReactElement {
  return (
    <DarkModeProvider>
      <ThemedApp />
    </DarkModeProvider>
  )
}
