import { RouterProvider } from '@tanstack/react-router'
import {
  ServerConnectionProvider,
  useServerConnection,
} from './hooks/useServerConnection'
import { PinnedEntitiesProvider } from './hooks/usePinnedEntities'
import { ProjectsProvider } from './hooks/useProjects'
import { ElectricAgentsProvider } from './lib/ElectricAgentsProvider'
import { DarkModeProvider, useDarkModeContext } from './hooks/useDarkMode'
import { ThemeProvider } from './ui'
import { router } from './router'

function AppInner(): React.ReactElement {
  const { activeServer } = useServerConnection()

  return (
    <ElectricAgentsProvider baseUrl={activeServer?.url ?? null}>
      <PinnedEntitiesProvider>
        <ProjectsProvider>
          <RouterProvider router={router} />
        </ProjectsProvider>
      </PinnedEntitiesProvider>
    </ElectricAgentsProvider>
  )
}

function ThemedApp(): React.ReactElement {
  const { darkMode } = useDarkModeContext()
  const appearance = darkMode ? `dark` : `light`

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
