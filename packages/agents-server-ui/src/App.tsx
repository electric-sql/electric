import { Theme } from '@radix-ui/themes'
import { RouterProvider } from '@tanstack/react-router'
import {
  ServerConnectionProvider,
  useServerConnection,
} from './hooks/useServerConnection'
import { PinnedEntitiesProvider } from './hooks/usePinnedEntities'
import { ElectricAgentsProvider } from './lib/ElectricAgentsProvider'
import { DarkModeProvider, useDarkModeContext } from './hooks/useDarkMode'
import { router } from './router'

function AppInner(): React.ReactElement {
  const { activeServer } = useServerConnection()

  return (
    <ElectricAgentsProvider baseUrl={activeServer?.url ?? null}>
      <PinnedEntitiesProvider>
        <RouterProvider router={router} />
      </PinnedEntitiesProvider>
    </ElectricAgentsProvider>
  )
}

function ThemedApp(): React.ReactElement {
  const { darkMode } = useDarkModeContext()

  return (
    <Theme
      appearance={darkMode ? `dark` : `light`}
      grayColor="slate"
      radius="medium"
      panelBackground="solid"
    >
      <ServerConnectionProvider>
        <AppInner />
      </ServerConnectionProvider>
    </Theme>
  )
}

export function App(): React.ReactElement {
  return (
    <DarkModeProvider>
      <ThemedApp />
    </DarkModeProvider>
  )
}
